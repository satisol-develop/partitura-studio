/**
 * Doble local del backend de Apps Script (`apps-script/Code.gs`).
 *
 * Existe para poder verificar el ciclo completo —entrar, subir, bajar,
 * conflictos, borrados, sesión caducada, usuario desactivado— sin desplegar
 * nada en Google: `tests/auth.test.mjs` y `tests/drive-sync.test.mjs` lo
 * arrancan en un puerto libre, y la aplicación puede apuntarse a él desde la
 * pantalla de acceso.
 *
 * Implementa el MISMO contrato que el script real, que es lo que hace que las
 * pruebas valgan: cuerpo JSON en `text/plain` (sin preflight), respuesta
 * siempre con HTTP 200 y un campo `ok` más un `code` que distingue el tipo de
 * error, sesión firmada para todo menos `login`, ids restringidos a
 * `[A-Za-z0-9_-]`, y el MusicXML guardado aparte de las anotaciones.
 *
 * La única diferencia a propósito: aquí las contraseñas se guardan en claro
 * porque el doble se usa desde las pruebas, donde leerlas es útil. El script
 * real nunca guarda una contraseña, sólo un hash con la sal del script.
 *
 * Lo que NO reproduce, y conviene no olvidar: los límites de Drive, el cerrojo
 * entre instancias (aquí todo vive en memoria, en un solo proceso), los tiempos
 * de red ni la redirección a `script.googleusercontent.com`.
 *
 * Uso como servidor:
 *   node tools/mock-apps-script.mjs [puerto] [clave-de-servicio]
 */

import { createHmac, randomUUID } from "node:crypto";
import { createServer } from "node:http";

/** Clave de servicio del doble (equivale a `SERVICE_KEY`). */
export const DEFAULT_SERVICE_KEY = "clave-de-servicio-de-pruebas";
/** Secreto con el que se firman las sesiones (equivale a `SESSION_SECRET`). */
export const DEFAULT_SESSION_SECRET = "secreto-de-firmas-de-pruebas";
/** Un usuario de ejemplo, para no tener que sembrarlo en cada prueba. */
export const DEFAULT_USERS = [
  { email: "ana@ejemplo.com", password: "contraseña-de-ana", active: true },
  { email: "bloqueado@ejemplo.com", password: "contraseña-valida", active: false },
];

const SESSION_DAYS = 30;
const MAX_ATTEMPTS = 8;

function json(response, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    // El script real acaba en script.googleusercontent.com, que responde `*`.
    "access-control-allow-origin": "*",
    // Sin esto, un POST con Content-Type que no sea «simple» no pasaría el
    // preflight… que es exactamente el fallo que el cliente evita usando
    // text/plain. Se deja implementado para poder comprobar que no se usa.
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "POST, OPTIONS, GET",
  });
  response.end(body);
}

function summarize(id, document) {
  const meta = document.meta ?? {};
  const annotations = (document.layers ?? []).reduce(
    (total, layer) =>
      total +
      (layer.strokes?.length ?? 0) +
      (layer.pins?.length ?? 0) +
      (layer.notes?.length ?? 0),
    0,
  );
  return {
    id,
    title: meta.title || "Sin título",
    composer: meta.composer || "",
    source: meta.source || "musicxml",
    updatedAt: typeof meta.updatedAt === "number" ? meta.updatedAt : Date.now(),
    annotationCount: annotations,
  };
}

const normalizeEmail = (value) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? "").trim().toLowerCase())
    ? String(value).trim().toLowerCase()
    : "";

/**
 * Arranca el doble. Devuelve la URL `/exec` para el cliente, el estado en
 * memoria (para inspeccionarlo desde las pruebas) y `close()`.
 *
 * `users` acepta `{email, password, active}`. `expiredAfterMs` permite acortar
 * la vida de las sesiones para poder probar la caducidad sin esperar 30 días.
 */
export function createMockDrive({
  port = 0,
  serviceKey = DEFAULT_SERVICE_KEY,
  sessionSecret = DEFAULT_SESSION_SECRET,
  users = DEFAULT_USERS,
  expiredAfterMs = SESSION_DAYS * 24 * 60 * 60 * 1000,
  clock = () => Date.now(),
  host = "127.0.0.1",
} = {}) {
  /** id → { document, xml } */
  const scores = new Map();
  /** El mismo índice que `library.json`. */
  let index = [];
  const calls = [];
  const attempts = new Map();
  /** Se pueden cambiar desde fuera para probar la revocación de acceso. */
  const accounts = users.map((user) => ({ ...user, email: normalizeEmail(user.email) }));
  /** Sesiones emitidas, por si hace falta revocarlas todas. */
  const sessions = new Map();
  /**
   * El secreto de firma es mutable a propósito: revocar todas las sesiones no
   * consiste en borrar una lista (las sesiones no se consultan en ningún
   * sitio), sino en cambiar el secreto para que las firmas ya emitidas dejen de
   * cuadrar. Es lo que hace `revocarSesiones()` en el script real.
   */
  let activeSecret = sessionSecret;

  const sign = (payload) =>
    createHmac("sha256", activeSecret).update(payload).digest("hex");

  const createSession = (email, expiresAt) => {
    const payload = `${email}|${expiresAt}`;
    const token = `${payload}|${sign(payload)}`;
    sessions.set(token, { email, expiresAt });
    return token;
  };

  /**
   * Devuelve `{email, expiresAt}` si la credencial es válida, o `null`.
   *
   * La clave de servicio viaja en su propio campo (`serviceKey`), igual que en
   * `apps-script/Code.gs`: es la vía de la consola y de `curl`, no la de la
   * aplicación, que sólo manda sesiones firmadas en `session`. Aceptarla por
   * `session` haría que el doble autorizase algo que el script real rechaza, y
   * un doble que dice sí donde el real dice no no sirve para verificar nada.
   */
  const readSession = (token, key) => {
    if (serviceKey && key !== undefined && String(key) === serviceKey) {
      return { email: "service-key", expiresAt: 0 };
    }
    const raw = String(token ?? "");
    const parts = raw.split("|");
    if (parts.length !== 3) return null;
    const email = normalizeEmail(parts[0]);
    const expiresAt = Number(parts[1]);
    if (!email || !Number.isFinite(expiresAt) || expiresAt <= clock()) return null;
    if (sign(`${email}|${expiresAt}`) !== parts[2]) return null;
    // La firma prueba que la sesión la emitimos nosotros; esto comprueba que la
    // persona sigue autorizada ahora mismo.
    const user = accounts.find((candidate) => candidate.email === email);
    if (!user || user.active === false) return null;
    return { email, expiresAt };
  };

  const server = createServer((request, response) => {
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "*",
        "access-control-allow-methods": "POST, OPTIONS, GET",
      });
      response.end();
      return;
    }

    let raw = "";
    request.on("data", (chunk) => (raw += chunk));
    request.on("end", () => {
      // El script real sólo acepta POST para hablar; GET sólo sirve de estado.
      if (request.method === "GET") {
        response.writeHead(200, {
          "content-type": "text/plain; charset=utf-8",
          "access-control-allow-origin": "*",
        });
        response.end("Partitura Studio: doble local listo. Usa la aplicación para entrar.");
        return;
      }
      if (request.method !== "POST") {
        response.writeHead(405, { "content-type": "text/plain" });
        response.end("Método no permitido");
        return;
      }

      let payload;
      try {
        payload = JSON.parse(raw);
      } catch {
        json(response, {
          ok: false,
          error: "El cuerpo de la petición no es JSON válido.",
          code: "bad_request",
        });
        return;
      }

      const action = payload.action;
      calls.push(action);

      if (action === "login") {
        const email = normalizeEmail(payload.email);
        const password = typeof payload.password === "string" ? payload.password : "";
        if (!email || !password) {
          json(response, {
            ok: false,
            error: "Escribe un correo válido y tu contraseña.",
            code: "bad_request",
          });
          return;
        }
        if ((attempts.get(email) ?? 0) > MAX_ATTEMPTS) {
          json(response, {
            ok: false,
            error:
              "Demasiados intentos fallidos con ese correo. Espera unos minutos e inténtalo otra vez.",
            code: "too_many_attempts",
          });
          return;
        }
        const user = accounts.find((candidate) => candidate.email === email);
        // El mismo mensaje para «no existe» y «contraseña mal», como el real.
        if (!user || user.active === false || user.password !== password) {
          attempts.set(email, (attempts.get(email) ?? 0) + 1);
          json(response, {
            ok: false,
            error: "Correo o contraseña incorrectos.",
            code: "unauthenticated",
          });
          return;
        }
        attempts.delete(email);
        const expiresAt = clock() + expiredAfterMs;
        json(response, {
          ok: true,
          email,
          expiresAt,
          session: createSession(email, expiresAt),
        });
        return;
      }

      const authorized = readSession(payload.session, payload.serviceKey);
      if (!authorized) {
        json(response, {
          ok: false,
          error: "Tu sesión ha caducado. Vuelve a entrar.",
          code: "unauthenticated",
        });
        return;
      }

      if (action === "whoami") {
        json(response, { ok: true, email: authorized.email, expiresAt: authorized.expiresAt });
        return;
      }
      if (action === "ping") {
        json(response, { ok: true, name: "Partitura Studio", version: 1 });
        return;
      }

      if (!/^[A-Za-z0-9_-]{3,120}$/.test(String(payload.id ?? "")) && action !== "list") {
        json(response, {
          ok: false,
          error: "El identificador de la partitura no es válido.",
          code: "bad_request",
        });
        return;
      }

      switch (action) {
        case "list":
          json(response, { ok: true, scores: [...index] });
          return;
        case "get": {
          const stored = scores.get(payload.id);
          if (!stored) {
            json(response, { ok: false, error: "Esa partitura no está en Drive.", code: "not_found" });
            return;
          }
          json(response, { ok: true, document: stored.document, xml: stored.xml });
          return;
        }
        case "put": {
          if (!payload.document || typeof payload.document !== "object") {
            json(response, {
              ok: false,
              error: "Falta el documento de anotaciones.",
              code: "bad_request",
            });
            return;
          }
          const previous = scores.get(payload.id);
          scores.set(payload.id, {
            document: payload.document,
            xml: typeof payload.xml === "string" ? payload.xml : (previous?.xml ?? ""),
          });
          const summary = summarize(payload.id, payload.document);
          index = [...index.filter((s) => s.id !== summary.id), summary].sort(
            (a, b) => b.updatedAt - a.updatedAt,
          );
          json(response, { ok: true, summary });
          return;
        }
        case "delete": {
          scores.delete(payload.id);
          index = index.filter((s) => s.id !== payload.id);
          json(response, { ok: true });
          return;
        }
        default:
          json(response, {
            ok: false,
            error: `Acción desconocida: ${action}`,
            code: "bad_request",
          });
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(port, host, () => {
      const address = server.address();
      resolve({
        url: `http://${host}:${address.port}/exec`,
        port: address.port,
        serviceKey,
        sessionSecret,
        scores,
        /** Índice remoto tal cual lo devolvería `library.json`. */
        index: () => index,
        /** Acciones recibidas, en orden: sirve para comprobar lo que no debe pasar. */
        calls: () => [...calls],
        /** Cuentas, para activar o desactivar a alguien a mitad de una prueba. */
        accounts,
        /** Invalida todas las sesiones rotando el secreto de firma. */
        revokeAll() {
          activeSecret = randomUUID() + randomUUID();
          sessions.clear();
        },
        /** Mete una partitura a mano, como si la hubiera subido otro equipo. */
        seed(id, document, xml = "") {
          scores.set(id, { document, xml });
          const summary = summarize(id, document);
          index = [...index.filter((s) => s.id !== summary.id), summary];
        },
        /**
         * La hace desaparecer de Drive sin pasar por la API, que es lo que se
         * ve cuando alguien vacía la carpeta desde la web de Drive: no queda
         * ni el documento ni su entrada en `library.json`.
         */
        remove(id) {
          scores.delete(id);
          index = index.filter((s) => s.id !== id);
        },
        close: () =>
          new Promise((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

/* Ejecución directa: servidor de verdad escuchando. */
const invokedDirectly = process.argv[1]?.endsWith("mock-apps-script.mjs") === true;
if (invokedDirectly) {
  const port = Number(process.argv[2] ?? 4599);
  const serviceKey = process.argv[3] ?? DEFAULT_SERVICE_KEY;
  const drive = await createMockDrive({ port, serviceKey });
  console.log(`Doble de Apps Script en ${drive.url}`);
  console.log("Usuarios de prueba:");
  for (const user of DEFAULT_USERS) {
    console.log(`  ${user.email} / ${user.password}${user.active ? "" : "  (desactivado)"}`);
  }
  console.log(`Clave de servicio (consola y curl): ${serviceKey}`);
}
