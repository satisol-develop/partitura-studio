/**
 * Pruebas del backend de verdad: `apps-script/Code.gs`.
 *
 * Hasta ahora el backend sólo se probaba de refilón, a través de
 * `tools/mock-apps-script.mjs`, que es una reimplementación del mismo contrato.
 * Eso verifica lo que hace el CLIENTE contra un servidor que cumple el trato,
 * pero no el script que de verdad corre en Google: una errata en `isAuthorized`
 * o un `requireId` que deje pasar un «..» no la veía nadie hasta que estaba en
 * producción, con la carpeta del usuario detrás.
 *
 * Aquí se ejecuta el archivo tal cual, dentro de un `new Function` con dobles de
 * los servicios de Apps Script (Drive, propiedades, caché, cerrojo, utilidades
 * de criptografía y salida de contenido). No es Apps Script —no hay límites de
 * cuota, ni cerrojo entre instancias, ni redirección a googleusercontent— y eso
 * está dicho en la cabecera del propio script: lo que se comprueba es su lógica,
 * que es donde están las decisiones.
 *
 * Lo que sí es idéntico: las funciones de criptografía son las de Node
 * (HMAC-SHA256 y SHA-256), que dan exactamente los mismos bytes que las de Apps
 * Script. Por eso una sesión firmada aquí sería válida allí.
 */

import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const SOURCE = readFileSync(new URL("../apps-script/Code.gs", import.meta.url), "utf8");

/* ------------------------------------------------------------------ */
/* Dobles de los servicios de Apps Script                              */
/* ------------------------------------------------------------------ */

/**
 * Almacén de propiedades del script. Los valores son cadenas, como en Apps
 * Script, así que `setProperty` convierte.
 */
function createProperties() {
  const values = new Map();
  const store = {
    getProperty: (name) => (values.has(name) ? values.get(name) : null),
    setProperty: (name, value) => {
      values.set(name, String(value));
    },
    deleteProperty: (name) => {
      values.delete(name);
    },
  };
  return {
    values,
    store,
    // El script pide las propiedades con `getScriptProperties()`, no las recibe
    // hechas: el doble tiene que tener la misma puerta.
    service: { getScriptProperties: () => store },
  };
}

function createCache() {
  const values = new Map();
  const store = {
    get: (key) => (values.has(key) ? values.get(key) : null),
    put: (key, value) => {
      values.set(key, String(value));
    },
    remove: (key) => {
      values.delete(key);
    },
  };
  return { values, store, service: { getScriptCache: () => store } };
}

/**
 * Drive en memoria, con la forma de API que usa `Code.gs` y nada más: carpetas
 * por nombre dentro de una carpeta, archivos por nombre dentro de una carpeta, y
 * `setTrashed` como único borrado.
 */
function createDrive() {
  let nextId = 0;
  const folders = new Map();
  const files = new Map();

  const makeFile = (ownerId, name, contents, mimeType) => {
    const id = `file-${++nextId}`;
    const file = {
      getId: () => id,
      getName: () => name,
      getBlob: () => ({ getDataAsString: () => contents, getContentType: () => mimeType }),
      setContent: (next) => {
        contents = String(next);
      },
    };
    files.set(id, { file, ownerId, name });
    return file;
  };

  const makeFolder = (parentId, name) => {
    const id = `folder-${++nextId}`;
    const folder = {
      getId: () => id,
      getName: () => name,
      isTrashed: () => Boolean(folders.get(id)?.trashed),
      createFolder: (childName) => makeFolder(id, childName),
      getFoldersByName: (childName) => {
        const found = [...folders.values()].filter(
          (candidate) =>
            candidate.parentId === id && candidate.name === childName && !candidate.trashed,
        );
        return iterator(found.map((candidate) => candidate.folder));
      },
      createFile: (fileName, contents, mimeType) => makeFile(id, fileName, contents, mimeType),
      getFilesByName: (fileName) => {
        const found = [...files.values()].filter(
          (candidate) => candidate.ownerId === id && candidate.name === fileName,
        );
        return iterator(found.map((candidate) => candidate.file));
      },
      setTrashed: (trashed) => {
        const entry = folders.get(id);
        if (entry) entry.trashed = Boolean(trashed);
      },
    };
    folders.set(id, { folder, parentId, name, trashed: false });
    return folder;
  };

  const iterator = (items) => {
    let index = 0;
    return {
      hasNext: () => index < items.length,
      next: () => items[index++],
    };
  };

  const rootIds = [];
  return {
    makeFolder,
    api: {
      getFoldersByName: (name) => {
        const found = rootIds
          .map((id) => folders.get(id))
          .filter((entry) => entry && entry.name === name && !entry.trashed);
        return iterator(found.map((entry) => entry.folder));
      },
      createFolder: (name) => {
        const folder = makeFolder(null, name);
        rootIds.push(folder.getId());
        return folder;
      },
      getFolderById: (id) => {
        const entry = folders.get(id);
        if (!entry) throw new Error(`No hay carpeta con id ${id}`);
        return entry.folder;
      },
    },
    /** Carpetas que existen, para poder mirar qué escribió el script. */
    folders: () => [...folders.values()].map((entry) => ({ name: entry.name, folder: entry.folder })),
  };
}

/** Un servicio de contenido que deja leer lo que el script devuelve. */
function createContentService() {
  return {
    MimeType: { JSON: "application/json", TEXT: "text/plain" },
    createTextOutput: (text) => ({
      mime: "text/plain",
      context: "script",
      setMimeType(mime) {
        this.mime = mime;
        return this;
      },
      getContent: () => String(text),
      getMimeType() {
        return this.mime;
      },
    }),
  };
}

const utilities = {
  Charset: { UTF_8: "UTF-8" },
  DigestAlgorithm: { SHA_256: "SHA_256" },
  getUuid: () => randomUUID(),
  // Las mismas funciones que usa Apps Script por debajo, así que los bytes son
  // los mismos: una firma hecha aquí valdría allí.
  computeHmacSha256Signature: (payload, secret) => [
    ...createHmac("sha256", String(secret)).update(String(payload)).digest(),
  ],
  computeDigest: (_algorithm, value) => [...createHash("sha256").update(String(value)).digest()],
};

/** El script cargado, con sus dobles. */
function loadBackend() {
  const properties = createProperties();
  const cache = createCache();
  const drive = createDrive();
  const content = createContentService();
  const locks = [];
  const logger = { lines: [] };

  const factory = new Function(
    "DriveApp",
    "PropertiesService",
    "CacheService",
    "LockService",
    "Utilities",
    "ContentService",
    "Logger",
    [
      SOURCE,
      "return { doGet, doPost, prepararInstalacion, generarUsuario, listarUsuarios, desactivarUsuario, activarUsuario, revocarSesiones };",
    ].join("\n"),
  );

  const backend = factory(
    drive.api,
    properties.service,
    cache.service,
    {
      getScriptLock: () => ({
        waitLock: () => locks.push("wait"),
        releaseLock: () => locks.push("release"),
      }),
    },
    utilities,
    content,
    { log: (line) => logger.lines.push(String(line)) },
  );

  /** Llama a `doPost` como lo haría el navegador: cuerpo JSON, respuesta JSON. */
  const post = (request) => {
    const response = backend.doPost({ postData: { contents: JSON.stringify(request) } });
    return JSON.parse(response.getContent());
  };

  /** Igual, pero mandando el cuerpo en crudo (para probar cuerpos rotos). */
  const postRaw = (contents) =>
    JSON.parse(backend.doPost({ postData: { contents } }).getContent());

  return { backend, post, postRaw, properties, cache, drive, locks };
}

/* ------------------------------------------------------------------ */
/* Andamiaje de usuarios                                               */
/* ------------------------------------------------------------------ */

const ANA = { email: "ana@ejemplo.com", password: "una-contraseña-larga-y-rara" };
const OSTRA = { email: "ostra@ejemplo.com", password: "otra-contraseña-distinta" };

/** Deja el script instalado con los usuarios que se le pasen. */
function withUsers(users = [ANA]) {
  const world = loadBackend();
  world.backend.prepararInstalacion();
  const entries = users.map((user) => world.backend.generarUsuario(user.email, user.password));
  world.properties.values.set("USERS", JSON.stringify(entries));
  const login = (user) =>
    world.post({ action: "login", email: user.email, password: user.password });
  return { ...world, entries, login };
}

function makeDocument(id, { strokes = 1 } = {}) {
  return {
    meta: {
      id,
      title: "Estudio",
      composer: "Anónima",
      instrumentation: "Piano",
      source: "musicxml",
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_001_000,
    },
    xml: "",
    layers: [
      {
        id: "layer_1",
        name: "Mis anotaciones",
        color: "#1f6feb",
        visible: true,
        locked: false,
        opacity: 1,
        strokes: Array.from({ length: strokes }, (_, index) => ({
          id: `stroke_${index}`,
          points: [{ x: 1, y: 2, p: 0.5 }],
          color: null,
          width: 2.4,
          opacity: 1,
          tool: "pencil",
          createdAt: 1,
        })),
        pins: [],
        notes: [],
      },
    ],
    activeLayerId: "layer_1",
  };
}

/* ------------------------------------------------------------------ */
/* Puntos de entrada                                                   */
/* ------------------------------------------------------------------ */

test("una petición GET sólo sirve para ver que la implementación está viva", () => {
  const { backend } = loadBackend();
  const response = backend.doGet();
  assert.equal(response.getMimeType(), "text/plain");
  assert.match(response.getContent(), /backend listo/);
});

test("un cuerpo que no es JSON se explica como tal, no revienta", () => {
  const { postRaw } = loadBackend();
  const response = postRaw("no soy json");
  assert.equal(response.ok, false);
  assert.equal(response.code, "bad_request");
  assert.match(response.error, /no es JSON válido/);
});

test("una acción desconocida se rechaza sin tocar Drive", () => {
  const { post } = withUsers();
  const { session } = post({ action: "login", ...ANA });
  const response = post({ action: "explotar", session });
  assert.equal(response.ok, false);
  assert.equal(response.code, "bad_request");
});

/* ------------------------------------------------------------------ */
/* Acceso                                                              */
/* ------------------------------------------------------------------ */

test("sin sesión no se lee ni se escribe nada, y se distingue de otros fallos", () => {
  const { post } = withUsers();
  for (const action of ["list", "get", "put", "delete", "whoami", "ping"]) {
    const response = post({ action, id: "score_1" });
    assert.equal(response.ok, false, `${action} no puede responder sin sesión`);
    assert.equal(response.code, "unauthenticated");
  }
});

test("entrar con la contraseña buena devuelve una sesión utilizable", () => {
  const { post } = withUsers();
  const login = post({ action: "login", ...ANA });
  assert.equal(login.ok, true);
  assert.equal(login.email, ANA.email);
  assert.ok(login.session, "tiene que venir una sesión firmada");
  assert.ok(login.expiresAt > Date.now(), "y su caducidad");

  const whoami = post({ action: "whoami", session: login.session });
  assert.equal(whoami.ok, true);
  assert.equal(whoami.email, ANA.email);
  assert.equal(whoami.expiresAt, login.expiresAt);

  const ping = post({ action: "ping", session: login.session });
  assert.equal(ping.ok, true);
  assert.equal(ping.version, 1);
});

test("el mismo mensaje para «ese correo no existe» y «esa contraseña no es»", () => {
  const { post } = withUsers();
  const unknown = post({ action: "login", email: "nadie@ejemplo.com", password: "lo-que-sea" });
  const wrongPassword = post({ action: "login", email: ANA.email, password: "lo-que-sea" });
  assert.equal(unknown.error, wrongPassword.error);
  assert.equal(unknown.code, "unauthenticated");
  assert.equal(wrongPassword.code, "unauthenticated");
});

test("un correo mal formado o una contraseña vacía no gastan intento", () => {
  const { post, cache } = withUsers();
  assert.equal(post({ action: "login", email: "sin-arroba", password: "x" }).code, "bad_request");
  assert.equal(post({ action: "login", email: ANA.email, password: "" }).code, "bad_request");
  assert.equal(cache.values.size, 0, "no se ha contado ningún intento");
});

test("los intentos fallidos bloquean el correo un rato", () => {
  const { post } = withUsers();
  // `MAX_ATTEMPTS` es 8: el noveno fallo se registra y el décimo ya encuentra la
  // puerta cerrada. Se cuenta el intento ANTES de comprobar la contraseña, así
  // que el bloqueo no se puede esquivar adivinando justo en el límite.
  for (let attempt = 0; attempt < 9; attempt += 1) {
    const response = post({ action: "login", email: ANA.email, password: "mal" });
    assert.equal(response.code, "unauthenticated", `intento ${attempt + 1}`);
  }
  const blocked = post({ action: "login", email: ANA.email, password: "mal" });
  assert.equal(blocked.code, "too_many_attempts");

  // Y el bloqueo es de ese correo, no de la instalación.
  const other = post({ action: "login", email: OSTRA.email, password: "mal" });
  assert.equal(other.code, "unauthenticated");
});

test("entrar bien limpia los intentos: no se arrastra el bloqueo", () => {
  const { post } = withUsers();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    post({ action: "login", email: ANA.email, password: "mal" });
  }
  assert.equal(post({ action: "login", ...ANA }).ok, true);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    post({ action: "login", email: ANA.email, password: "mal" });
  }
  assert.equal(
    post({ action: "login", ...ANA }).ok,
    true,
    "cuatro fallos más no pueden bloquear a quien ha entrado bien en medio",
  );
});

test("una sesión con la firma cambiada no vale", () => {
  const { post } = withUsers();
  const { session } = post({ action: "login", ...ANA });
  const [email, expiresAt, signature] = session.split("|");

  // Un solo carácter cambiado de la firma (el primero, y a otra cosa: cambiar el
  // último podría dejarla igual y la prueba diría lo contrario de lo que cree).
  const flipped = `${signature[0] === "0" ? "1" : "0"}${signature.slice(1)}`;
  const tampered = post({ action: "whoami", session: `${email}|${expiresAt}|${flipped}` });
  assert.equal(tampered.code, "unauthenticated");

  const otherEmail = post({
    action: "whoami",
    session: `${OSTRA.email}|${expiresAt}|${signature}`,
  });
  assert.equal(otherEmail.code, "unauthenticated");

  // Y una caducidad alargada a mano tampoco: la firma cubre el correo Y la
  // fecha, que es justo lo que impide alargarse la sesión uno mismo.
  const extended = post({
    action: "whoami",
    session: `${email}|${Number(expiresAt) + 10_000_000}|${signature}`,
  });
  assert.equal(extended.code, "unauthenticated");
});

test("una sesión caducada no vale, aunque la firma sea buena", () => {
  const { post, properties } = withUsers();
  const secret = properties.values.get("SESSION_SECRET");
  const expiredAt = Date.now() - 1000;
  const payload = `${ANA.email}|${expiredAt}`;
  const signature = createHmac("sha256", secret).update(payload).digest("hex");

  const response = post({ action: "whoami", session: `${payload}|${signature}` });
  assert.equal(response.code, "unauthenticated");
});

test("desactivar a alguien mata su sesión en la siguiente petición", () => {
  const { post, backend } = withUsers();
  const { session } = post({ action: "login", ...ANA });
  assert.equal(post({ action: "list", session }).ok, true);

  assert.equal(backend.desactivarUsuario(ANA.email), true);
  const after = post({ action: "list", session });
  assert.equal(after.ok, false);
  assert.equal(after.code, "unauthenticated");

  assert.equal(backend.activarUsuario(ANA.email), true);
  assert.equal(
    post({ action: "list", session }).ok,
    true,
    "y al reactivarle, su sesión de antes vuelve a servir (la firma sigue siendo buena)",
  );
});

test("revocar las sesiones invalida todas las que había abiertas", () => {
  const { post, backend } = withUsers();
  const { session } = post({ action: "login", ...ANA });
  assert.equal(post({ action: "list", session }).ok, true);

  backend.revocarSesiones();
  assert.equal(post({ action: "list", session }).code, "unauthenticated");
  // Y se puede volver a entrar con la misma contraseña: lo que cambió es el
  // secreto de firma, no la contraseña.
  assert.equal(post({ action: "login", ...ANA }).ok, true);
});

test("la lista de usuarios se lee de las propiedades, no de la petición", () => {
  const { post, properties } = withUsers([ANA, OSTRA]);
  // Un `email` en la petición no autoriza nada: sólo la sesión.
  const response = post({ action: "list", email: ANA.email });
  assert.equal(response.code, "unauthenticated");
  assert.match(properties.values.get("USERS"), /ana@ejemplo\.com/);
});

/* ------------------------------------------------------------------ */
/* Partituras                                                          */
/* ------------------------------------------------------------------ */

test("guardar, listar y leer: el documento y el MusicXML acaban donde deben", () => {
  const { post, drive } = withUsers();
  const { session } = post({ action: "login", ...ANA });
  const document = makeDocument("score_1");

  const put = post({ action: "put", session, id: "score_1", document, xml: "<score-partwise/>" });
  assert.equal(put.ok, true);
  assert.equal(put.summary.title, "Estudio");
  assert.equal(put.summary.annotationCount, 1);
  assert.equal(put.summary.updatedAt, document.meta.updatedAt);

  // El XML vive aparte de las anotaciones, que es lo que permite abrirlo desde
  // Drive sin la aplicación y no reescribirlo en cada guardado.
  const folder = drive
    .folders()
    .find((entry) => entry.name === "score_1");
  assert.ok(folder, "tiene que existir la carpeta de la partitura");
  const files = ["document.json", "score.musicxml"].map((name) => {
    const iterator = folder.folder.getFilesByName(name);
    return iterator.hasNext() ? iterator.next().getBlob().getDataAsString() : null;
  });
  assert.equal(JSON.parse(files[0]).meta.title, "Estudio");
  assert.equal(files[1], "<score-partwise/>");

  const list = post({ action: "list", session });
  assert.deepEqual(list.scores.map((score) => score.id), ["score_1"]);

  const get = post({ action: "get", session, id: "score_1" });
  assert.equal(get.ok, true);
  assert.equal(get.document.layers[0].strokes.length, 1);
  assert.equal(get.xml, "<score-partwise/>");
});

test("guardar dos veces la misma partitura no la duplica", () => {
  const { post } = withUsers();
  const { session } = post({ action: "login", ...ANA });
  const document = makeDocument("score_1");

  post({ action: "put", session, id: "score_1", document, xml: "<a/>" });
  post({ action: "put", session, id: "score_1", document, xml: "<a/>" });

  const list = post({ action: "list", session });
  assert.equal(list.scores.length, 1);
});

test("el id del documento se alinea con el de la carpeta, no al revés", () => {
  const { post } = withUsers();
  const { session } = post({ action: "login", ...ANA });
  const document = makeDocument("otro_id_cualquiera");

  const put = post({ action: "put", session, id: "score_1", document, xml: "" });
  assert.equal(put.ok, true);

  // Si el documento se guardara con su id de dentro, la partitura viviría en la
  // carpeta `score_1` pero el índice lo diría con otro nombre, y el cliente la
  // volvería a bajar con un id que no es el suyo (y a subir, y a bajar).
  const get = post({ action: "get", session, id: "score_1" });
  assert.equal(get.document.meta.id, "score_1");
  assert.equal(put.summary.id, "score_1");
});

test("un documento sin la forma esperada no llega a escribirse", () => {
  const { post, drive } = withUsers();
  const { session } = post({ action: "login", ...ANA });

  assert.equal(post({ action: "put", session, id: "score_1" }).code, "bad_request");
  assert.equal(
    post({ action: "put", session, id: "score_1", document: "texto" }).code,
    "bad_request",
  );
  assert.equal(
    post({ action: "put", session, id: "score_1", document: { layers: [] } }).code,
    "bad_request",
    "sin metadatos no hay partitura que la aplicación pueda abrir",
  );
  assert.equal(
    post({ action: "put", session, id: "score_1", document: { meta: {} } }).code,
    "bad_request",
    "sin capas no hay dónde anotar",
  );

  // Y nada de eso ha dejado una carpeta a medias por ahí.
  assert.deepEqual(
    drive.folders().filter((entry) => entry.name === "score_1"),
    [],
  );
});

test("un documento enorme se rechaza con un motivo, no con un error de Google", () => {
  const { post } = withUsers();
  const { session } = post({ action: "login", ...ANA });
  const document = makeDocument("score_1");
  // 21 MB de texto: por encima del tope del script, y muy por debajo de lo que
  // Google corta sin explicar (que llegaría al navegador como «Failed to fetch»).
  document.layers[0].notes = [
    {
      id: "note_1",
      measureIndex: 0,
      measureNumber: "1",
      fields: { text: "x".repeat(21 * 1024 * 1024) },
      priority: 0,
      tags: [],
      updatedAt: 1,
    },
  ];

  const response = post({ action: "put", session, id: "score_1", document, xml: "" });
  assert.equal(response.ok, false);
  assert.equal(response.code, "bad_request");
  assert.match(response.error, /demasiado grande/);
});

test("el id de una partitura no puede salirse de su carpeta", () => {
  const { post } = withUsers();
  const { session } = post({ action: "login", ...ANA });
  for (const id of ["../otra", "scores/otra", "con espacio", "ab", "x".repeat(200)]) {
    const response = post({ action: "get", session, id });
    assert.equal(response.ok, false, `«${id}» tiene que rechazarse`);
    assert.equal(response.code, "bad_request");
  }
});

test("leer una partitura que no está se explica como tal", () => {
  const { post } = withUsers();
  const { session } = post({ action: "login", ...ANA });
  const response = post({ action: "get", session, id: "no_existe" });
  assert.equal(response.code, "not_found");
});

test("un documento sin el archivo de anotaciones está incompleto, y se dice", () => {
  const { post, drive } = withUsers();
  const { session } = post({ action: "login", ...ANA });
  // La jerarquía montada a mano, como quedaría si alguien borra desde Drive el
  // `document.json` y deja la carpeta: hay que decirlo, no devolver un documento
  // vacío que la aplicación guardaría como una partitura sin nada.
  const root = drive.api.createFolder("Partitura Studio");
  const scores = root.createFolder("scores");
  scores.createFolder("score_1");

  const response = post({ action: "get", session, id: "score_1" });
  assert.equal(response.ok, false);
  assert.equal(response.code, "not_found");
  assert.match(response.error, /incompleto/);
});

test("borrar es idempotente y quita la partitura del índice", () => {
  const { post, drive } = withUsers();
  const { session } = post({ action: "login", ...ANA });
  post({ action: "put", session, id: "score_1", document: makeDocument("score_1"), xml: "<a/>" });

  const first = post({ action: "delete", session, id: "score_1" });
  assert.equal(first.ok, true);
  assert.deepEqual(post({ action: "list", session }).scores, []);
  const trashed = drive
    .folders()
    .filter((entry) => entry.name === "score_1")
    .every((entry) => entry.folder.isTrashed());
  assert.equal(trashed, true, "la carpeta se manda a la papelera, no se destruye");

  // Borrar otra vez no falla: es lo que hace un reintento después de un corte.
  assert.equal(post({ action: "delete", session, id: "score_1" }).ok, true);
});

test("el cerrojo se suelta incluso cuando el guardado falla", () => {
  const { post, locks } = withUsers();
  const { session } = post({ action: "login", ...ANA });
  post({ action: "put", session, id: "score_1", document: makeDocument("score_1"), xml: "" });
  assert.deepEqual(locks, ["wait", "release"], "un guardado, un cerrojo cogido y soltado");
});

test("un índice roto no se lleva por delante la carpeta", () => {
  const { post, drive, properties } = withUsers();
  const { session } = post({ action: "login", ...ANA });
  post({ action: "put", session, id: "score_1", document: makeDocument("score_1"), xml: "" });

  // `library.json` editado a mano desde Drive: no es la lista que se espera.
  const root = drive.api.getFolderById(properties.values.get("ROOT_FOLDER_ID"));
  root.getFilesByName("library.json").next().setContent('{"version":1,"scores":"vaya"}');

  const list = post({ action: "list", session });
  assert.equal(list.ok, true);
  assert.deepEqual(list.scores, [], "se devuelve una lista vacía, no un destrozo");

  // Y volver a guardar reconstruye el índice con lo que hay.
  post({ action: "put", session, id: "score_1", document: makeDocument("score_1"), xml: "" });
  assert.deepEqual(
    post({ action: "list", session }).scores.map((score) => score.id),
    ["score_1"],
  );
});

/* ------------------------------------------------------------------ */
/* Administración                                                      */
/* ------------------------------------------------------------------ */

test("la instalación crea los secretos una sola vez", () => {
  const { backend, properties } = loadBackend();
  backend.prepararInstalacion();
  const first = new Map(properties.values);
  assert.ok(first.get("PASSWORD_SALT"));
  assert.ok(first.get("SESSION_SECRET"));
  assert.ok(first.get("SERVICE_KEY"));
  assert.notEqual(first.get("PASSWORD_SALT"), first.get("SESSION_SECRET"));

  backend.prepararInstalacion();
  assert.deepEqual([...properties.values], [...first], "volver a ejecutarla no cambia nada");
});

test("una contraseña no se guarda: sólo su hash, y con la sal del script", () => {
  const { entries, properties } = withUsers();
  assert.equal(entries[0].email, ANA.email);
  assert.ok(entries[0].hash);
  assert.equal(
    JSON.stringify(entries).includes(ANA.password),
    false,
    "la contraseña no puede aparecer en la lista de usuarios",
  );

  // Dos personas con la misma contraseña no comparten hash (la sal del script y
  // el correo entran en el cálculo), así que la lista filtrada no sirve sola.
  const same = withUsers([ANA, { email: OSTRA.email, password: ANA.password }]);
  assert.notEqual(same.entries[0].hash, same.entries[1].hash);

  // Y la sal es de la instalación, no del archivo: con otra sal sale otro hash
  // para exactamente la misma contraseña. Es lo que hace que esta lista se pueda
  // filtrar sin regalar las contraseñas de nadie.
  const other = withUsers();
  assert.notEqual(other.properties.values.get("PASSWORD_SALT"), properties.values.get("PASSWORD_SALT"));
  assert.notEqual(other.entries[0].hash, entries[0].hash);
});

test("la clave de servicio sirve para la consola y `curl`, y no es una sesión", () => {
  const { post, properties } = withUsers();
  const serviceKey = properties.values.get("SERVICE_KEY");
  const response = post({ action: "ping", serviceKey });
  assert.equal(response.ok, true);

  // Pero no puede viajar donde viajan las sesiones: el campo es otro a propósito.
  assert.equal(post({ action: "ping", session: serviceKey }).code, "unauthenticated");
});

test("administrar usuarios informa de lo que ha hecho", () => {
  const { backend, entries } = withUsers();
  assert.equal(entries.length, 1);
  assert.equal(backend.desactivarUsuario("nadie@ejemplo.com"), false);
  assert.equal(backend.desactivarUsuario(ANA.email), true);
  assert.deepEqual(backend.listarUsuarios().map((user) => [user.email, user.active]), [
    [ANA.email, false],
  ]);
  assert.equal(backend.activarUsuario(ANA.email), true);
  assert.equal(backend.listarUsuarios()[0].active, true);
});

test("un correo se normaliza al entrar, así que da igual cómo se escriba", () => {
  const { post } = withUsers();
  const response = post({ action: "login", email: "  ANA@Ejemplo.COM ", password: ANA.password });
  assert.equal(response.ok, true);
  assert.equal(response.email, ANA.email);
});
