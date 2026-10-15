/**
 * Cliente del backend de Apps Script que guarda todo en Google Drive y decide
 * quién puede entrar.
 *
 * La aplicación es estática: no tiene servidor propio, así que el «servidor» es
 * una implementación de Apps Script que se ejecuta con los permisos de Drive de
 * quien la instala (ver `apps-script/Code.gs`). Toda decisión de acceso se toma
 * allí; aquí sólo se transporta la sesión que devuelve al entrar.
 *
 * Dos detalles del protocolo que no son negociables y conviene tener a la vista:
 *
 *  1. **El cuerpo va como `text/plain`, no como `application/json`.** Un
 *     `Content-Type: application/json` dispara un `OPTIONS` previo que Apps
 *     Script no responde, y la petición muere como error de red. Con
 *     `text/plain` la petición es «simple» y no hay preflight.
 *  2. **Ninguna cabecera propia.** Igual que lo anterior: `Authorization`
 *     también provoca preflight. La sesión viaja en el cuerpo.
 *
 * El cuerpo de la respuesta es siempre `{ ok: boolean }` con HTTP 200, incluso
 * cuando hay un error, porque un 4xx sin cabeceras CORS no se puede leer desde
 * el navegador: se convierte en un «Failed to fetch» indistinguible de estar
 * sin conexión. Por eso el campo `code` importa: es lo único que permite
 * distinguir «tu sesión ha caducado, vuelve a entrar» de «no hay red», y son
 * dos cosas que se resuelven de forma opuesta.
 */

import type { ScoreDocument, ScoreSummary } from "./types";
import { countAnnotations } from "./types";

/** Cómo se habla con el backend y en nombre de quién. */
export interface DriveConfig {
  /** URL de la implementación, terminada en `/exec`. */
  endpoint: string;
  /** Sesión firmada que devolvió `login`; vacía si no se ha entrado. */
  session: string;
}

export interface DriveRequest {
  action: "login" | "whoami" | "ping" | "list" | "get" | "put" | "delete";
  session?: string;
  email?: string;
  password?: string;
  id?: string;
  document?: ScoreDocument;
  xml?: string;
}

export type DriveResponse =
  | { ok: true; name?: string; version?: number; scores?: ScoreSummary[] }
  | { ok: true; summary: ScoreSummary }
  | { ok: true; document: ScoreDocument; xml: string }
  | { ok: true; email: string; expiresAt: number }
  | { ok: true; session: string; email: string; expiresAt: number }
  | { ok: true }
  | { ok: false; error: string; code?: string };

/**
 * Motivo del fallo, tal cual lo manda el backend. `unauthenticated` es el único
 * que cambia el comportamiento de la aplicación (cerrar sesión y pedir acceso);
 * el resto se muestran y ya está.
 */
export type BackendErrorCode =
  | "unauthenticated"
  | "bad_request"
  | "not_found"
  | "too_many_attempts"
  | "server_error"
  | "error"
  | "network"
  | "invalid_response";

/** Error con el mensaje ya en castellano y listo para enseñar al usuario. */
export class DriveError extends Error {
  /** `network` cuando no se llegó a hablar con el servidor. */
  readonly code: BackendErrorCode;

  constructor(message: string, code: BackendErrorCode = "error") {
    super(message);
    this.name = "DriveError";
    this.code = code;
  }
}

/** ¿Se pudo hablar con el servidor? Si no, la sesión no se toca. */
export function isNetworkError(error: unknown): boolean {
  return error instanceof DriveError && error.code === "network";
}

export const DRIVE_EMPTY_CONFIG: DriveConfig = { endpoint: "", session: "" };

/* ------------------------------------------------------------------ */
/* Endpoint                                                            */
/* ------------------------------------------------------------------ */

/**
 * URL de la implementación fijada al construir. Se puede publicar el sitio ya
 * apuntando a un backend concreto (`NEXT_PUBLIC_DRIVE_ENDPOINT`), que es lo
 * cómodo: quien recibe el enlace sólo escribe su correo y su contraseña, sin
 * pegar una URL larga. Sigue siendo editable en los ajustes.
 */
export const BUILD_ENDPOINT = (process.env.NEXT_PUBLIC_DRIVE_ENDPOINT ?? "").trim();

/**
 * Acepta la URL tal cual se copia de Apps Script y también variantes que la
 * gente pega de verdad (con `?` de más, sin `/exec`, o el `/dev` de pruebas),
 * porque rechazar por un detalle de formato es una mala primera impresión.
 */
export function normalizeEndpoint(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new DriveError("Falta la URL de la implementación de Apps Script.", "bad_request");
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new DriveError(
      "La URL no es válida. Copia la que da Apps Script al implementar (termina en /exec).",
      "bad_request",
    );
  }
  // El doble local (`tools/mock-apps-script.mjs`) sirve el mismo contrato desde
  // 127.0.0.1 para poder probar y verificar el ciclo completo sin publicar
  // nada; es la única excepción a «https y dominio de Google».
  const loopback = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(url.hostname);
  if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) {
    throw new DriveError("La URL debe empezar por https:// (Apps Script siempre usa https).", "bad_request");
  }
  if (!loopback && !/(^|\.)google(usercontent)?\.com$/.test(url.hostname)) {
    throw new DriveError(
      "Esa URL no parece de Apps Script. Debe ser script.google.com/…/exec o script.googleusercontent.com/…",
      "bad_request",
    );
  }
  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = /\/(exec|dev)$/.test(path) ? path : `${path}/exec`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

/* ------------------------------------------------------------------ */
/* Peticiones                                                          */
/* ------------------------------------------------------------------ */

/** Tiempo máximo por petición: un `fetch` colgado deja la interfaz esperando. */
const DEFAULT_TIMEOUT_MS = 20000;

function describeNetworkError(error: unknown, endpoint: string): DriveError {
  const name = error instanceof Error ? error.name : "";
  if (name === "AbortError") {
    return new DriveError(
      "El servidor no respondió a tiempo. Comprueba la conexión y que la implementación siga publicada.",
      "network",
    );
  }
  // Apps Script redirige a script.googleusercontent.com; si la red bloquea la
  // redirección o hay un proxy de por medio, esto es lo que se ve.
  let host = "el servidor";
  try {
    host = new URL(endpoint).hostname;
  } catch {
    /* la URL ya está validada antes de llegar aquí */
  }
  return new DriveError(
    `No se pudo contactar con ${host}. Revisa la conexión, que la implementación esté publicada «para cualquiera» y que no haya algo bloqueando la petición.`,
    "network",
  );
}

/**
 * Envía una petición al backend y devuelve el cuerpo ya interpretado.
 * `fetch` se inyecta para poder probar esto sin navegador.
 */
export async function driveRequest(
  config: DriveConfig,
  request: DriveRequest,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<DriveResponse> {
  const endpoint = normalizeEndpoint(config.endpoint);
  const doFetch = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  let response: Response;
  try {
    response = await doFetch(endpoint, {
      method: "POST",
      // Ver la cabecera del archivo: `text/plain` evita el preflight y la
      // sesión viaja en el cuerpo porque cualquier cabecera propia lo provocaría.
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ ...request, session: request.session ?? config.session }),
      redirect: "follow",
      signal: controller.signal,
    });
  } catch (error) {
    throw describeNetworkError(error, endpoint);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new DriveError(
      `El servidor respondió con un error ${response.status}. Si la implementación se ha vuelto a publicar, abre su URL en el navegador para comprobar que sigue viva.`,
      "server_error",
    );
  }

  const text = await response.text();
  let parsed: DriveResponse;
  try {
    parsed = JSON.parse(text) as DriveResponse;
  } catch {
    // Apps Script devuelve HTML cuando la implementación no está autorizada o
    // cuando se ha llegado a la pantalla de inicio de sesión de Google.
    throw new DriveError(
      "La respuesta no era JSON. Normalmente significa que la implementación no está publicada «para cualquiera», o que hay que volver a autorizarla.",
      "invalid_response",
    );
  }

  if (!parsed.ok) {
    throw new DriveError(parsed.error || "El servidor rechazó la operación.", parsed.code as BackendErrorCode);
  }
  return parsed;
}

/* ------------------------------------------------------------------ */
/* Acceso                                                              */
/* ------------------------------------------------------------------ */

export interface LoginResult {
  session: string;
  email: string;
  /** Cuándo caduca la sesión, en milisegundos. */
  expiresAt: number;
}

/** Pide una sesión con correo y contraseña. */
export async function login(
  endpoint: string,
  email: string,
  password: string,
  options?: { fetchImpl?: typeof fetch },
): Promise<LoginResult> {
  const response = await driveRequest(
    { endpoint, session: "" },
    { action: "login", email, password },
    options,
  );
  if (!("session" in response) || !response.session) {
    throw new DriveError("El servidor no devolvió una sesión.", "invalid_response");
  }
  return {
    session: response.session,
    email: response.email,
    expiresAt: response.expiresAt,
  };
}

/**
 * Comprueba si la sesión sigue siendo buena y devuelve su caducidad real.
 * Sirve para no fiarse de una sesión guardada: el backend es el que sabe si
 * alguien ha sido desactivado o si se revocaron todas las sesiones.
 */
export async function whoami(
  config: DriveConfig,
  options?: { fetchImpl?: typeof fetch },
): Promise<{ email: string; expiresAt: number }> {
  const response = await driveRequest(config, { action: "whoami" }, options);
  if (!("email" in response)) {
    throw new DriveError("El servidor no reconoció la sesión.", "unauthenticated");
  }
  return { email: response.email, expiresAt: response.expiresAt };
}

/* ------------------------------------------------------------------ */
/* Operaciones                                                         */
/* ------------------------------------------------------------------ */

/** Comprueba URL y sesión. No toca datos. */
export async function testConnection(
  config: DriveConfig,
  options?: { fetchImpl?: typeof fetch },
): Promise<void> {
  await driveRequest(config, { action: "ping" }, options);
}

export async function listRemote(
  config: DriveConfig,
  options?: { fetchImpl?: typeof fetch },
): Promise<ScoreSummary[]> {
  const response = await driveRequest(config, { action: "list" }, options);
  if (!("scores" in response) || !response.scores) return [];
  return response.scores;
}

export async function getRemoteScore(
  config: DriveConfig,
  id: string,
  options?: { fetchImpl?: typeof fetch },
): Promise<{ document: ScoreDocument; xml: string } | null> {
  const response = await driveRequest(config, { action: "get", id }, options);
  if (!("document" in response)) return null;
  return { document: response.document, xml: response.xml };
}

/**
 * Sube una partitura: las anotaciones y el MusicXML que tiene delante. El
 * resumen que devuelve el servidor se construye allí con la misma forma que el
 * local, así que sirve para refrescar la biblioteca sin recalcular nada.
 */
export async function putRemoteScore(
  config: DriveConfig,
  doc: ScoreDocument,
  options?: { fetchImpl?: typeof fetch },
): Promise<ScoreSummary> {
  const response = await driveRequest(
    config,
    {
      action: "put",
      id: doc.meta.id,
      // El MusicXML viaja en su propio campo porque el servidor lo guarda en su
      // propio archivo (`score.musicxml`, abrible desde Drive sin la
      // aplicación). Mandarlo ADEMÁS dentro del documento lo subía dos veces
      // —una partitura de 8 MB eran 16 MB de subida en cada guardado— y no
      // había nadie que leyera esa copia.
      document: { ...doc, xml: "" },
      xml: doc.xml,
    },
    options,
  );
  if (!("summary" in response)) {
    return {
      id: doc.meta.id,
      title: doc.meta.title,
      composer: doc.meta.composer,
      source: doc.meta.source,
      updatedAt: doc.meta.updatedAt,
      annotationCount: countAnnotations(doc.layers),
    };
  }
  return response.summary;
}

export async function deleteRemoteScore(
  config: DriveConfig,
  id: string,
  options?: { fetchImpl?: typeof fetch },
): Promise<void> {
  await driveRequest(config, { action: "delete", id }, options);
}
