/**
 * Partitura Studio — backend en Google Apps Script.
 *
 * Convierte una carpeta de Google Drive en el almacén de la aplicación, que es
 * un sitio estático sin servidor, y decide **quién puede entrar**. Guarda, por
 * cada partitura:
 *
 *   Partitura Studio/
 *     library.json                 índice: qué partituras hay y cuándo cambiaron
 *     scores/<id>/document.json    las capas de anotación y los metadatos
 *     scores/<id>/score.musicxml   el MusicXML sobre el que están anotadas
 *
 * El MusicXML se guarda aparte, y no dentro del JSON, por dos razones: se puede
 * abrir y reutilizar desde Drive sin la aplicación, y una partitura grande no
 * obliga a reescribir las anotaciones cada vez que se guardan.
 *
 * ---------------------------------------------------------------------------
 * QUIÉN ENTRA — por qué el login vive aquí y no en la web
 * ---------------------------------------------------------------------------
 * Un login escrito sólo en el navegador no protege nada: el sitio es estático,
 * así que cualquiera puede leer el JavaScript, quitarse la puerta de delante y
 * seguir llamando a este script. Por eso la decisión se toma **aquí**: cada
 * petición de datos trae una sesión firmada, y sin una sesión válida no se lee
 * ni se escribe nada en Drive.
 *
 * No hay roles ni permisos distintos: hay una lista de correos autorizados. O
 * estás en ella, o no entras. Es a propósito, y es todo lo que hace falta para
 * un grupo de estudio o un aula.
 *
 * Lo que sí conviene saber: como la web no se puede cerrar de verdad, este
 * script **tampoco guarda secretos**. Las partituras están en la carpeta de
 * Drive de quien instala el script, y eso es lo que hay que proteger de
 * verdad — con la cuenta de Google, no con este código.
 *
 * ---------------------------------------------------------------------------
 * INSTALACIÓN (una vez, 5 minutos)
 * ---------------------------------------------------------------------------
 *  1. script.google.com → Nuevo proyecto → pega este archivo como `Code.gs`.
 *  2. Ejecuta la función `prepararInstalacion` (menú ▶ Ejecutar) y autoriza los
 *     permisos de Drive. Crea las propiedades `PASSWORD_SALT` y
 *     `SESSION_SECRET` con valores aleatorios.
 *  3. Crea el primer usuario: llama a `generarUsuario("tu@correo.com",
 *     "una-contraseña-larga")` y copia la línea que aparece en el registro
 *     (Ver → Registros) dentro de la propiedad `USERS`.
 *     `USERS` es una lista JSON: `[ {email, hash, active}, … ]`. Para dar de
 *     alta a más gente, añade más líneas separadas por comas.
 *  4. Añade también una propiedad `SERVICE_KEY` con un valor largo y aleatorio
 *     (sólo se usa desde la consola y desde `curl`, nunca desde la web).
 *  5. *Implementar* → *Nueva implementación* → tipo *Aplicación web*:
 *       - Ejecutar como: **Yo**
 *       - Quién tiene acceso: **Cualquier persona**
 *     (Sí, «cualquiera»: el control de acceso lo hace la sesión, no Google. Con
 *     «Cualquier persona con cuenta de Google» el navegador tendría que
 *     autenticarse contra Google en cada `fetch`, y eso un sitio estático no lo
 *     puede hacer.)
 *  6. Copia la URL que acaba en `/exec` y pégala en la aplicación (o en la
 *     variable `NEXT_PUBLIC_DRIVE_ENDPOINT` del flujo de publicación) y entra
 *     con el correo y la contraseña del paso 3.
 *
 * Tras cambiar este código hay que crear una *nueva versión* de la
 * implementación (Implementar → Gestionar implementaciones → ✏️ → Versión:
 * nueva) o la URL seguirá sirviendo el código viejo. Es el error más común.
 *
 * ---------------------------------------------------------------------------
 * FUNCIONES DE ADMINISTRACIÓN (se ejecutan desde el editor, nunca desde la web)
 * ---------------------------------------------------------------------------
 *   prepararInstalacion()                 crea los secretos que falten
 *   generarUsuario(email, contraseña)     imprime la línea para pegar en USERS
 *   listarUsuarios()                      imprime los correos autorizados
 *   desactivarUsuario(email)              lo bloquea sin borrar su línea
 *   activarUsuario(email)                 lo vuelve a permitir
 *   revocarSesiones()                     invalida todas las sesiones abiertas
 */

/** Nombre de la carpeta raíz dentro de Mi unidad. */
var ROOT_FOLDER_NAME = "Partitura Studio";
/** Propiedad donde se recuerda el id de la carpeta raíz. */
var ROOT_ID_PROPERTY = "ROOT_FOLDER_ID";
/** Versión del formato del índice, por si algún día cambia. */
var INDEX_VERSION = 1;

/** Lista JSON de usuarios permitidos: `[{email, hash, active}]`. */
var USERS_PROPERTY = "USERS";
/** Sal con la que se calcula el hash de las contraseñas. NO cambiar. */
var SALT_PROPERTY = "PASSWORD_SALT";
/** Secreto con el que se firman las sesiones. Cambiarlo las invalida todas. */
var SESSION_SECRET_PROPERTY = "SESSION_SECRET";
/** Clave de servicio, sólo para la consola y `curl`. */
var SERVICE_KEY_PROPERTY = "SERVICE_KEY";

/** Duración de una sesión, en días. */
var SESSION_DAYS = 30;
/** Intentos fallidos seguidos antes de bloquear un correo un rato. */
var MAX_ATTEMPTS = 8;
/** Cuánto dura ese bloqueo, en segundos. */
var LOCKOUT_SECONDS = 15 * 60;
/** Tope de usuarios que se pueden comprobar sin sospechar de una lista enorme. */
var MAX_USERS = 500;
/**
 * Tope del documento serializado y del MusicXML, en caracteres.
 *
 * No es un capricho: una petición que no cabe la corta Google antes de llegar
 * aquí, y el cliente recibe un error de red indistinguible de «no hay wifi». Con
 * esto, en cambio, se responde con un motivo en castellano. Los 20 MB están por
 * encima de lo que puede producir la aplicación (que no deja importar nada de
 * más de 25 MB, y el XML viaja una sola vez) y por debajo del límite de Apps
 * Script. Se cuentan caracteres, que en JSON son bytes salvo en lo que no es
 * ASCII: sobra margen.
 */
var MAX_DOCUMENT_CHARS = 20 * 1024 * 1024;
var MAX_XML_CHARS = 20 * 1024 * 1024;

/* ------------------------------------------------------------------------- */
/* Puntos de entrada                                                          */
/* ------------------------------------------------------------------------- */

/**
 * GET sólo sirve para comprobar desde el navegador que la implementación está
 * viva. La aplicación usa siempre POST: una petición GET no puede llevar
 * cuerpo, y con `fetch` desde otro origen acabaría en un preflight que Apps
 * Script no responde.
 */
function doGet() {
  return plainText("Partitura Studio: backend listo. Usa la aplicación para entrar.");
}

/**
 * Único punto de entrada real. El cuerpo es JSON y la respuesta también.
 *
 * Se responde SIEMPRE con HTTP 200 y un campo `ok`, incluso en los errores:
 * desde el navegador, un código distinto de 200 en una respuesta sin cabeceras
 * CORS llega como un fallo de red opaco («Failed to fetch») y no permite
 * distinguir «contraseña mal» de «sin conexión». El campo `code` sí distingue
 * el tipo de problema, y es lo que usa la aplicación para saber si debe
 * cerrar la sesión o sólo avisar.
 */
function doPost(e) {
  var request;
  try {
    request = parseRequest(e);
  } catch (error) {
    return json(fail(String(error.message || error), "bad_request"));
  }

  // Lo único que no exige sesión: pedirla.
  if (request.action === "login") {
    return json(handleLogin(request));
  }

  if (!isAuthorized(request)) {
    return json(fail("Tu sesión ha caducado. Vuelve a entrar.", "unauthenticated"));
  }

  // Todas las funciones de abajo devuelven el CUERPO de la respuesta, no la
  // respuesta: así `json()` se llama en un solo sitio y es imposible que una
  // acción devuelva un objeto suelto por descuido.
  try {
    switch (request.action) {
      case "whoami":
        return json({ ok: true, email: request.email, expiresAt: request.expiresAt });
      case "ping":
        return json({ ok: true, name: "Partitura Studio", version: INDEX_VERSION });
      case "list":
        return json({ ok: true, scores: readIndex().scores });
      case "get":
        return json(handleGet(request));
      case "put":
        return json(handlePut(request));
      case "delete":
        return json(handleDelete(request));
      default:
        return json(fail("Acción desconocida: " + request.action, "bad_request"));
    }
  } catch (error) {
    // No todo lo que salta por aquí es culpa del servidor. Un id imposible o un
    // dato que falta los ha mandado el cliente, y decirlos como «server_error»
    // manda a mirar el registro de ejecuciones para nada: el cliente decide
    // cosas distintas con un error de petición que con uno del servidor.
    var code = error && error.code === "bad_request" ? "bad_request" : "server_error";
    return json(fail(String(error.message || error), code));
  }
}

/* ------------------------------------------------------------------------- */
/* Acceso                                                                     */
/* ------------------------------------------------------------------------- */

/**
 * Comprueba correo y contraseña y devuelve una sesión firmada.
 *
 * Los errores son deliberadamente iguales para «ese correo no está en la lista»
 * y «esa contraseña no es»: quien prueba correos a ciegas no debe poder
 * averiguar quién tiene cuenta.
 */
function handleLogin(request) {
  var email = normalizeEmail(request.email);
  var password = typeof request.password === "string" ? request.password : "";

  if (!email || !password) {
    return fail("Escribe un correo válido y tu contraseña.", "bad_request");
  }

  var blocked = loginAttempts(email);
  if (blocked > MAX_ATTEMPTS) {
    return fail(
      "Demasiados intentos fallidos con ese correo. Espera unos minutos e inténtalo otra vez.",
      "too_many_attempts",
    );
  }

  var user = findUser(email);
  if (!user || user.active === false || !passwordMatches(email, password, user.hash)) {
    registerFailedAttempt(email);
    return fail("Correo o contraseña incorrectos.", "unauthenticated");
  }

  clearAttempts(email);
  var expiresAt = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  return {
    ok: true,
    email: email,
    expiresAt: expiresAt,
    session: createSession(email, expiresAt),
  };
}

/** Una sesión son tres campos: correo, caducidad y firma. */
function createSession(email, expiresAt) {
  var payload = email + "|" + expiresAt;
  return payload + "|" + sign(payload);
}

/**
 * Valida la sesión (o la clave de servicio) y deja el correo y la caducidad en
 * la propia petición, para que el resto del script no tenga que volver a
 * mirarla.
 */
function isAuthorized(request) {
  var serviceKey = getProperty(SERVICE_KEY_PROPERTY);
  if (serviceKey && constantEquals(String(request.serviceKey || ""), serviceKey)) {
    request.email = "service-key";
    request.expiresAt = 0;
    return true;
  }

  var session = String(request.session || "");
  var parts = session.split("|");
  if (parts.length !== 3) return false;

  var email = normalizeEmail(parts[0]);
  var expiresAt = Number(parts[1]);
  if (!email || !isFinite(expiresAt) || expiresAt <= Date.now()) return false;
  if (!constantEquals(parts[2], sign(email + "|" + expiresAt))) return false;
  // La firma prueba que la sesión la emitimos nosotros, pero no que el usuario
  // siga autorizado: si se le ha desactivado o borrado, su sesión muere aquí.
  var user = findUser(email);
  if (!user || user.active === false) return false;

  request.email = email;
  request.expiresAt = expiresAt;
  return true;
}

function sign(payload) {
  var secret = getProperty(SESSION_SECRET_PROPERTY);
  var bytes = Utilities.computeHmacSha256Signature(payload, secret);
  return bytesToHex(bytes);
}

function passwordMatches(email, password, expectedHash) {
  if (!expectedHash) return false;
  return constantEquals(hashPassword(email, password), String(expectedHash));
}

/**
 * Hash de la contraseña. Lleva la sal del script y el propio correo, así que
 * dos personas con la misma contraseña no comparten hash y la lista `USERS`
 * por sí sola no sirve para nada si se filtra.
 */
function hashPassword(email, password) {
  var salt = getProperty(SALT_PROPERTY);
  var digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    salt + "|" + normalizeEmail(email) + "|" + password,
    Utilities.Charset.UTF_8,
  );
  return bytesToHex(digest);
}

/* ------------------------------------------------------------------------- */
/* Intentos fallidos                                                          */
/* ------------------------------------------------------------------------- */

/**
 * Límite de intentos con `CacheService`: sin él, una lista de correos conocidos
 * se puede probar a razón de miles de contraseñas por hora. Es un freno de
 * mejor esfuerzo —la caché es por script y puede vaciarse— pero convierte un
 * ataque trivial en uno incómodo.
 */
function loginAttempts(email) {
  var raw = CacheService.getScriptCache().get("login:" + email);
  return raw ? Number(raw) || 0 : 0;
}

function registerFailedAttempt(email) {
  var count = loginAttempts(email) + 1;
  CacheService.getScriptCache().put("login:" + email, String(count), LOCKOUT_SECONDS);
}

function clearAttempts(email) {
  CacheService.getScriptCache().remove("login:" + email);
}

/* ------------------------------------------------------------------------- */
/* Acciones sobre las partituras                                              */
/* ------------------------------------------------------------------------- */

function handleGet(request) {
  var id = requireId(request);
  var folder = findScoreFolder(id);
  if (!folder) {
    return fail("Esa partitura no está en Drive.", "not_found");
  }
  var document = readJsonFile(folder, "document.json");
  if (!document) {
    return fail("El documento de la partitura está incompleto.", "not_found");
  }
  return { ok: true, document: document, xml: readTextFile(folder, "score.musicxml") };
}

/**
 * Guarda (o reemplaza) una partitura. Es idempotente: repetir la misma llamada
 * deja exactamente el mismo estado, así que un reintento tras un corte de red
 * no puede duplicar nada.
 */
function handlePut(request) {
  var id = requireId(request);
  var document = request.document;
  if (!document || typeof document !== "object") {
    return fail("Falta el documento de anotaciones.", "bad_request");
  }
  // Se comprueba la forma antes de escribir nada: lo que entra aquí acaba siendo
  // el `document.json` de una carpeta y el resumen del índice, y un documento
  // sin `meta` o sin `layers` (una petición hecha a mano, un cliente antiguo)
  // dejaría una partitura que la aplicación baja y no puede dibujar.
  if (typeof document.meta !== "object" || document.meta === null) {
    return fail("El documento no trae sus metadatos (meta).", "bad_request");
  }
  if (Object.prototype.toString.call(document.layers) !== "[object Array]") {
    return fail("El documento no trae sus capas de anotación (layers).", "bad_request");
  }
  // El id manda el nombre de la carpeta, así que el documento tiene que decir lo
  // mismo: si no, el índice guardaría la partitura bajo una clave que su propio
  // documento desmiente y el siguiente `get` devolvería algo que la aplicación
  // volvería a bajar con otro id (y a subir, y a bajar). Se corrige aquí, que es
  // el único sitio que escribe.
  document.meta.id = id;

  var xml = typeof request.xml === "string" ? request.xml : "";
  if (xml.length > MAX_XML_CHARS) {
    return fail(
      "El MusicXML de esa partitura es demasiado grande para esta instalación.",
      "bad_request",
    );
  }
  var serialized = JSON.stringify(document);
  if (serialized === null || serialized.length > MAX_DOCUMENT_CHARS) {
    return fail(
      "El documento de anotaciones es demasiado grande para esta instalación.",
      "bad_request",
    );
  }

  var lock = LockService.getScriptLock();
  // Sin el cerrojo, dos guardados a la vez (dos pestañas, o el autoguardado y
  // una sincronización) pueden leer el índice a la vez y perder uno de los dos.
  lock.waitLock(20000);
  try {
    var root = getRootFolder();
    var scores = getOrCreateFolder(root, "scores");
    var folder = getOrCreateFolder(scores, id);
    writeFile(folder, "document.json", serialized, "application/json");
    if (xml.length > 0) {
      writeFile(folder, "score.musicxml", xml, "application/xml");
    }
    var summary = summarize(id, document);
    updateIndex(function (index) {
      return upsert(index, summary);
    });
    return { ok: true, summary: summary };
  } finally {
    lock.releaseLock();
  }
}

function handleDelete(request) {
  var id = requireId(request);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var folder = findScoreFolder(id);
    if (folder) folder.setTrashed(true);
    updateIndex(function (index) {
      return index.filter(function (score) {
        return score.id !== id;
      });
    });
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

/* ------------------------------------------------------------------------- */
/* Índice                                                                     */
/* ------------------------------------------------------------------------- */

function readIndex() {
  var file = findFile(getRootFolder(), "library.json");
  var parsed = file ? parseJson(file.getBlob().getDataAsString()) : null;
  // `scores` tiene que ser una lista: si el archivo se quedó a medias al
  // escribirse, o alguien lo ha editado desde Drive, esto es lo que evita que
  // `list` devuelva algo que el cliente no sabe leer (y que la escritura
  // siguiente del índice arrastre el destrozo).
  if (!parsed || Object.prototype.toString.call(parsed.scores) !== "[object Array]") {
    return { version: INDEX_VERSION, scores: [] };
  }
  return parsed;
}

function updateIndex(mutate) {
  var root = getRootFolder();
  var current = readIndex();
  var next = {
    version: INDEX_VERSION,
    updatedAt: new Date().toISOString(),
    scores: mutate(current.scores || []),
  };
  writeFile(root, "library.json", JSON.stringify(next, null, 2), "application/json");
  return next;
}

function upsert(scores, summary) {
  var out = scores.filter(function (score) {
    return score.id !== summary.id;
  });
  out.push(summary);
  out.sort(function (a, b) {
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });
  return out;
}

/** Resumen que guarda el índice: lo justo para pintar la biblioteca remota. */
function summarize(id, document) {
  var meta = document.meta || {};
  var layers = document.layers || [];
  var annotations = 0;
  for (var i = 0; i < layers.length; i++) {
    var layer = layers[i] || {};
    annotations +=
      (layer.strokes || []).length +
      (layer.pins || []).length +
      (layer.notes || []).length;
  }
  return {
    id: id,
    title: meta.title || "Sin título",
    composer: meta.composer || "",
    source: meta.source || "musicxml",
    updatedAt: typeof meta.updatedAt === "number" ? meta.updatedAt : Date.now(),
    annotationCount: annotations,
  };
}

/* ------------------------------------------------------------------------- */
/* Drive                                                                      */
/* ------------------------------------------------------------------------- */

/**
 * Carpeta raíz. Se recuerda su id en las propiedades del script para que
 * renombrarla desde Drive no cree una carpeta nueva y «pierda» lo guardado.
 */
function getRootFolder() {
  var properties = PropertiesService.getScriptProperties();
  var savedId = properties.getProperty(ROOT_ID_PROPERTY);
  if (savedId) {
    var saved = findFolderById(savedId);
    if (saved) return saved;
  }
  var existing = DriveApp.getFoldersByName(ROOT_FOLDER_NAME);
  var folder = existing.hasNext() ? existing.next() : DriveApp.createFolder(ROOT_FOLDER_NAME);
  properties.setProperty(ROOT_ID_PROPERTY, folder.getId());
  return folder;
}

function findFolderById(id) {
  try {
    var folder = DriveApp.getFolderById(id);
    return folder.isTrashed() ? null : folder;
  } catch (error) {
    return null;
  }
}

function getOrCreateFolder(parent, name) {
  var found = parent.getFoldersByName(name);
  return found.hasNext() ? found.next() : parent.createFolder(name);
}

function findScoreFolder(id) {
  var scores = findFolderByName(getRootFolder(), "scores");
  return scores ? findFolderByName(scores, id) : null;
}

function findFolderByName(parent, name) {
  var found = parent.getFoldersByName(name);
  return found.hasNext() ? found.next() : null;
}

function findFile(folder, name) {
  var found = folder.getFilesByName(name);
  return found.hasNext() ? found.next() : null;
}

/** Escribe (o reemplaza) un archivo de texto dentro de una carpeta. */
function writeFile(folder, name, contents, mimeType) {
  var existing = findFile(folder, name);
  if (existing) {
    existing.setContent(contents);
    return existing;
  }
  return folder.createFile(name, contents, mimeType);
}

function readJsonFile(folder, name) {
  var file = findFile(folder, name);
  return file ? parseJson(file.getBlob().getDataAsString()) : null;
}

function readTextFile(folder, name) {
  var file = findFile(folder, name);
  return file ? file.getBlob().getDataAsString() : "";
}

/* ------------------------------------------------------------------------- */
/* Administración (se ejecuta desde el editor)                                */
/* ------------------------------------------------------------------------- */

/** Crea los secretos que falten. Cambiar los valores invalida lo que depende de ellos. */
function prepararInstalacion() {
  var properties = PropertiesService.getScriptProperties();
  if (!properties.getProperty(SALT_PROPERTY)) {
    properties.setProperty(SALT_PROPERTY, Utilities.getUuid() + Utilities.getUuid());
  }
  if (!properties.getProperty(SESSION_SECRET_PROPERTY)) {
    properties.setProperty(SESSION_SECRET_PROPERTY, Utilities.getUuid() + Utilities.getUuid());
  }
  if (!properties.getProperty(SERVICE_KEY_PROPERTY)) {
    properties.setProperty(SERVICE_KEY_PROPERTY, Utilities.getUuid() + Utilities.getUuid());
  }
  if (!properties.getProperty(USERS_PROPERTY)) {
    properties.setProperty(USERS_PROPERTY, "[]");
  }
  Logger.log(
    "Listo. Ahora crea el primer usuario con generarUsuario(\"tu@correo.com\", \"contraseña\").",
  );
}

/**
 * Imprime la línea que hay que pegar dentro de la propiedad `USERS`, y el
 * comando de `curl` para probar la implementación sin la aplicación.
 */
function generarUsuario(email, password) {
  var normalized = normalizeEmail(email);
  if (!normalized || !password) {
    Logger.log("Hacen falta un correo válido y una contraseña.");
    return "";
  }
  prepararInstalacion();
  var entry = {
    email: normalized,
    hash: hashPassword(normalized, password),
    active: true,
  };
  Logger.log(
    "Añade esta línea a la propiedad USERS (separada por comas de las demás):\n" +
      JSON.stringify(entry),
  );
  Logger.log(
    "Prueba sin la web:\n" +
      "curl -s -X POST '<URL_DE_TU_IMPLEMENTACION>' -H 'Content-Type: text/plain' " +
      '-d \'{"action":"login","email":"' +
      normalized +
      '","password":"TU_CONTRASEÑA"}\'',
  );
  return entry;
}

function listarUsuarios() {
  var users = readUsers();
  Logger.log(users.length + " usuario(s):");
  for (var i = 0; i < users.length; i++) {
    Logger.log("- " + users[i].email + (users[i].active === false ? "  (desactivado)" : ""));
  }
  return users;
}

function desactivarUsuario(email) {
  return setUserActive(email, false);
}

function activarUsuario(email) {
  return setUserActive(email, true);
}

function setUserActive(email, active) {
  var normalized = normalizeEmail(email);
  var users = readUsers();
  var found = false;
  for (var i = 0; i < users.length; i++) {
    if (normalizeEmail(users[i].email) === normalized) {
      users[i].active = active;
      found = true;
    }
  }
  if (!found) {
    Logger.log("No hay ningún usuario con ese correo.");
    return false;
  }
  writeUsers(users);
  Logger.log(normalized + (active ? " puede volver a entrar." : " ya no puede entrar."));
  return true;
}

/**
 * Invalida todas las sesiones abiertas: cambia el secreto de firma, con lo que
 * las sesiones ya emitidas dejan de cuadrar. Las contraseñas no se tocan.
 */
function revocarSesiones() {
  PropertiesService.getScriptProperties().setProperty(
    SESSION_SECRET_PROPERTY,
    Utilities.getUuid() + Utilities.getUuid(),
  );
  Logger.log("Todas las sesiones quedan invalidadas: cada quien tendrá que volver a entrar.");
}

/* ------------------------------------------------------------------------- */
/* Utilidades                                                                 */
/* ------------------------------------------------------------------------- */

function readUsers() {
  var parsed = parseJson(getProperty(USERS_PROPERTY) || "[]");
  if (!parsed || !parsed.length) return [];
  var out = [];
  for (var i = 0; i < parsed.length && i < MAX_USERS; i++) {
    var user = parsed[i];
    if (user && user.email && user.hash) {
      out.push({ email: normalizeEmail(user.email), hash: String(user.hash), active: user.active !== false });
    }
  }
  return out;
}

function writeUsers(users) {
  PropertiesService.getScriptProperties().setProperty(USERS_PROPERTY, JSON.stringify(users));
}

function findUser(email) {
  var normalized = normalizeEmail(email);
  var users = readUsers();
  for (var i = 0; i < users.length; i++) {
    if (users[i].email === normalized) return users[i];
  }
  return null;
}

function normalizeEmail(value) {
  var email = String(value || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function parseRequest(e) {
  if (!e || !e.postData || !e.postData.contents) {
    throw new Error("Petición vacía.");
  }
  var parsed = parseJson(e.postData.contents);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("El cuerpo de la petición no es JSON válido.");
  }
  return parsed;
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
}

function requireId(request) {
  var id = String(request.id || "").trim();
  // El id viene del nombre de una carpeta de Drive: se restringe a caracteres
  // seguros para no poder salirse de `scores/` con «..» o «/».
  if (!/^[A-Za-z0-9_-]{3,120}$/.test(id)) {
    var error = new Error("El identificador de la partitura no es válido.");
    error.code = "bad_request";
    throw error;
  }
  return id;
}

function getProperty(name) {
  return PropertiesService.getScriptProperties().getProperty(name) || "";
}

function bytesToHex(bytes) {
  var hex = "";
  for (var i = 0; i < bytes.length; i++) {
    var value = (bytes[i] + 256) % 256;
    hex += (value < 16 ? "0" : "") + value.toString(16);
  }
  return hex;
}

/**
 * Comparación que no se corta al primer byte distinto. Apps Script no trae una
 * función para esto y los tiempos que se pueden medir desde fuera son
 * ruidosos, pero dejar la comparación obvia sería peor.
 */
function constantEquals(a, b) {
  a = String(a);
  b = String(b);
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Cuerpo de error. Se envuelve con `json()` en `doPost`. */
function fail(error, code) {
  return { ok: false, error: error, code: code || "error" };
}

function json(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

function plainText(text) {
  return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.TEXT);
}
