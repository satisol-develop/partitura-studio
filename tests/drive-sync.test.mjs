import assert from "node:assert/strict";
import test from "node:test";

import {
  DriveError,
  getRemoteScore,
  listRemote,
  login,
  normalizeEndpoint,
  putRemoteScore,
  testConnection,
} from "../lib/drive.ts";
import {
  describeReport,
  EMPTY_SYNC_STATE,
  loadSyncOwner,
  markDeleted,
  needsOwnerConfirmation,
  saveSyncOwner,
  syncWithDrive,
} from "../lib/sync.ts";
import { createMockDrive, DEFAULT_USERS } from "../tools/mock-apps-script.mjs";

const ANA = DEFAULT_USERS[0];

/* ------------------------------------------------------------------ */
/* Andamiaje                                                           */
/* ------------------------------------------------------------------ */

/** Almacén local en memoria: cumple el contrato de `lib/persistence.ts`. */
function makeLocalStore(initial = []) {
  const docs = new Map(initial.map((doc) => [doc.meta.id, doc]));
  return {
    docs,
    async list() {
      return [...docs.values()].map((doc) => ({
        id: doc.meta.id,
        title: doc.meta.title,
        composer: doc.meta.composer,
        source: doc.meta.source,
        updatedAt: doc.meta.updatedAt,
        annotationCount: doc.layers.reduce(
          (total, layer) =>
            total + layer.strokes.length + layer.pins.length + layer.notes.length,
          0,
        ),
      }));
    },
    async load(id) {
      return docs.get(id) ?? null;
    },
    async save(doc) {
      docs.set(doc.meta.id, doc);
    },
    async remove(id) {
      docs.delete(id);
    },
  };
}

const XML = '<?xml version="1.0"?><score-partwise version="3.1"><part id="P1"/></score-partwise>';

function makeDoc(id, { title, updatedAt, strokes = 1 } = {}) {
  return {
    meta: {
      id,
      title: title ?? `Partitura ${id}`,
      composer: "Anónima",
      instrumentation: "Piano",
      source: "musicxml",
      createdAt: 1_700_000_000_000,
      updatedAt,
    },
    xml: XML,
    layers: [
      {
        id: "layer_1",
        name: "Mis anotaciones",
        color: "#1f6feb",
        visible: true,
        locked: false,
        opacity: 1,
        strokes: Array.from({ length: strokes }, (_, i) => ({
          id: `stroke_${i}`,
          points: [{ x: 10, y: 10, p: 0.5 }],
          color: null,
          width: 2.4,
          opacity: 1,
          tool: "pencil",
          createdAt: updatedAt,
        })),
        pins: [],
        notes: [],
      },
    ],
    activeLayerId: "layer_1",
  };
}

/**
 * Un servidor por prueba, y la sesión se obtiene **entrando de verdad**: si
 * estas pruebas usaran la clave de servicio, no comprobarían lo que hace la
 * aplicación, que es hablar siempre con una sesión de usuario.
 */
async function withDrive(run, options = {}) {
  const drive = await createMockDrive(options);
  try {
    const { session } = await login(drive.url, ANA.email, ANA.password);
    await run({ drive, config: { endpoint: drive.url, session } });
  } finally {
    await drive.close();
  }
}

/* ------------------------------------------------------------------ */
/* URL de la implementación                                            */
/* ------------------------------------------------------------------ */

test("normalizeEndpoint acepta lo que se copia de Apps Script y arregla lo obvio", () => {
  const exec = "https://script.google.com/macros/s/AKfycb/exec";
  assert.equal(normalizeEndpoint(exec), exec);
  // Con espacios al copiar y con barra de más.
  assert.equal(normalizeEndpoint(`  ${exec}/  `), exec);
  // Si falta el /exec, se añade en vez de rechazar la URL.
  assert.equal(normalizeEndpoint("https://script.google.com/macros/s/AKfycb"), exec);
  // El ?gid=... que aparece al copiar desde el navegador no es parte del destino.
  assert.equal(normalizeEndpoint(`${exec}?gid=0`), exec);
  // El dominio de las respuestas de Apps Script también vale.
  assert.equal(
    normalizeEndpoint("https://script.googleusercontent.com/macros/echo/exec"),
    "https://script.googleusercontent.com/macros/echo/exec",
  );
});

test("normalizeEndpoint rechaza lo que no puede funcionar, diciendo por qué", () => {
  assert.throws(() => normalizeEndpoint(""), /Falta la URL/);
  assert.throws(() => normalizeEndpoint("   "), DriveError);
  assert.throws(
    () => normalizeEndpoint("script.google.com/macros/s/x/exec"),
    /no es válida/,
  );
  assert.throws(() => normalizeEndpoint("http://ejemplo.com/exec"), /https/);
  assert.throws(() => normalizeEndpoint("https://ejemplo.com/exec"), /no parece de Apps Script/);
});

/* ------------------------------------------------------------------ */
/* Protocolo                                                           */
/* ------------------------------------------------------------------ */

test("la sesión viaja en el cuerpo y sin cabeceras propias (evitar el preflight)", async () => {
  await withDrive(async ({ drive, config }) => {
    let seen;
    const recordingFetch = async (url, init) => {
      seen = { url, init };
      return fetch(url, init);
    };
    await testConnection(config, { fetchImpl: recordingFetch });

    assert.equal(seen.url, config.endpoint);
    assert.equal(seen.init.method, "POST");
    // Una cabecera propia dispararía un OPTIONS que Apps Script no contesta.
    assert.deepEqual(Object.keys(seen.init.headers), ["Content-Type"]);
    assert.match(seen.init.headers["Content-Type"], /^text\/plain/);
    const body = JSON.parse(seen.init.body);
    assert.equal(body.action, "ping");
    assert.equal(body.session, config.session);
    assert.deepEqual(drive.calls(), ["login", "ping"]);
  });
});

test("una implementación apagada se explica como problema de conexión", async () => {
  await assert.rejects(
    () =>
      testConnection(
        { endpoint: "http://127.0.0.1:1/exec", session: "x" },
        { timeoutMs: 2000 },
      ),
    /No se pudo contactar/,
  );
});

test("una respuesta que no es JSON (pantalla de login de Google) se explica", async () => {
  const htmlFetch = async () =>
    new Response("<!doctype html><html>Acceso denegado</html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  await assert.rejects(
    () =>
      testConnection(
        { endpoint: "https://script.google.com/macros/s/x/exec", session: "x" },
        { fetchImpl: htmlFetch },
      ),
    /no era JSON/,
  );
});

/* ------------------------------------------------------------------ */
/* Sincronización                                                      */
/* ------------------------------------------------------------------ */

test("la primera sincronización sube las anotaciones y el MusicXML", async () => {
  await withDrive(async ({ config }) => {
    const doc = makeDoc("score_a", { updatedAt: 1_700_000_001_000 });
    const local = makeLocalStore([doc]);

    const { report, state, remote } = await syncWithDrive(config, local, EMPTY_SYNC_STATE);

    assert.deepEqual(report.uploaded, ["score_a"]);
    assert.deepEqual(report.downloaded, []);
    assert.deepEqual(report.errors, []);
    // El listado que devuelve ya incluye lo recién subido: es lo que pinta la
    // etiqueta «en Drive» de la biblioteca sin pedirlo otra vez.
    assert.deepEqual(
      remote.map((s) => [s.id, s.annotationCount]),
      [["score_a", 1]],
    );
    assert.equal(state.synced.score_a, doc.meta.updatedAt);

    // En Drive quedan las dos cosas: anotaciones y el XML que se está anotando.
    const stored = await getRemoteScore(config, "score_a");
    assert.equal(stored.document.layers[0].strokes.length, 1);
    assert.equal(stored.xml, XML);

    const listed = await listRemote(config);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].title, doc.meta.title);
    assert.equal(listed[0].annotationCount, 1);
  });
});

test("un segundo equipo recibe las anotaciones y el XML, y no vuelve a subirlas", async () => {
  await withDrive(async ({ config }) => {
    const origin = makeDoc("score_b", { updatedAt: 1_700_000_002_000, strokes: 3 });
    const first = makeLocalStore([origin]);
    const firstRun = await syncWithDrive(config, first, EMPTY_SYNC_STATE);

    // Otro equipo, vacío, con el mismo estado (como si fuera una instalación
    // nueva que ya conoce Drive).
    const second = makeLocalStore();
    const secondRun = await syncWithDrive(config, second, firstRun.state);

    assert.deepEqual(secondRun.report.downloaded, ["score_b"]);
    assert.deepEqual(secondRun.report.uploaded, []);

    const restored = await second.load("score_b");
    assert.equal(restored.layers[0].strokes.length, 3);
    assert.equal(restored.xml, XML, "el MusicXML debe viajar con las anotaciones");
    assert.equal(restored.meta.title, origin.meta.title);

    // Y una tercera pasada no hace nada: ya coinciden.
    const third = await syncWithDrive(config, second, secondRun.state);
    assert.equal(third.report.unchanged, 1);
    assert.deepEqual(third.report.uploaded, []);
    assert.deepEqual(third.report.downloaded, []);
    assert.equal(describeReport(third.report), "1 sin cambios");
  });
});

test("si los dos lados cambian, gana el más reciente y se avisa del conflicto", async () => {
  await withDrive(async ({ drive, config }) => {
    const base = makeDoc("score_c", { updatedAt: 1_700_000_003_000, strokes: 1 });
    const local = makeLocalStore([base]);
    const run = await syncWithDrive(config, local, EMPTY_SYNC_STATE);

    // Este equipo dibuja un trazo más…
    const editedLocally = makeDoc("score_c", { updatedAt: 1_700_000_009_000, strokes: 2 });
    await local.save(editedLocally);
    // …y Drive ha recibido otra edición, más nueva todavía.
    drive.seed("score_c", makeDoc("score_c", { updatedAt: 1_700_000_010_000, strokes: 5 }), XML);

    const second = await syncWithDrive(config, local, run.state);

    assert.equal(second.report.conflicts.length, 1);
    assert.equal(second.report.conflicts[0].kept, "remoto");
    assert.deepEqual(second.report.downloaded, ["score_c"]);
    assert.equal((await local.load("score_c")).layers[0].strokes.length, 5);

    // Con la política contraria se conserva lo de este equipo, y sigue
    // habiendo conflicto porque los dos lados han vuelto a cambiar.
    await local.save(makeDoc("score_c", { updatedAt: 1_700_000_020_000, strokes: 7 }));
    drive.seed("score_c", makeDoc("score_c", { updatedAt: 1_700_000_019_000, strokes: 4 }), XML);
    const third = await syncWithDrive(config, local, second.state, { conflictPolicy: "local" });
    assert.equal(third.report.conflicts.length, 1);
    assert.equal(third.report.conflicts[0].kept, "local");
    assert.deepEqual(third.report.uploaded, ["score_c"]);
    assert.equal(drive.scores.get("score_c").document.layers[0].strokes.length, 7);
  });
});

test("borrar en local borra en Drive, pero sólo una vez", async () => {
  await withDrive(async ({ drive, config }) => {
    const local = makeLocalStore([makeDoc("score_d", { updatedAt: 1_700_000_004_000 })]);
    const run = await syncWithDrive(config, local, EMPTY_SYNC_STATE);
    assert.equal(drive.scores.has("score_d"), true);

    await local.remove("score_d");
    const marked = markDeleted("score_d", run.state);
    const second = await syncWithDrive(config, local, marked);

    assert.deepEqual(second.report.deletedRemote, ["score_d"]);
    assert.deepEqual(second.state.tombstones, []);
    assert.equal(drive.scores.has("score_d"), false);

    // Un borrado que nunca se subió no deja lápida: no hay nada que borrar allí.
    const untouched = markDeleted("score_inexistente", EMPTY_SYNC_STATE);
    assert.deepEqual(untouched.tombstones, []);
  });
});

test("si Drive pierde una partitura sincronizada, se vuelve a subir y se avisa", async () => {
  await withDrive(async ({ drive, config }) => {
    const local = makeLocalStore([makeDoc("score_e", { updatedAt: 1_700_000_005_000 })]);
    const run = await syncWithDrive(config, local, EMPTY_SYNC_STATE);
    // Alguien borra esa partitura desde la web de Drive: desaparece el
    // documento y su entrada en el índice.
    drive.remove("score_e");

    const second = await syncWithDrive(config, local, run.state);
    assert.deepEqual(second.report.uploaded, ["score_e"]);
    assert.equal(second.report.conflicts.length, 1);
    assert.equal(second.report.conflicts[0].kept, "local");
  });
});

test("un fallo en una partitura no impide sincronizar las demás", async () => {
  await withDrive(async ({ config }) => {
    const local = makeLocalStore([
      makeDoc("score_f", { updatedAt: 1_700_000_006_000 }),
      makeDoc("score_g", { updatedAt: 1_700_000_007_000 }),
    ]);

    // El `put` de score_g falla (por ejemplo, un 500 de Google a mitad de la
    // subida); el resto del ciclo tiene que seguir.
    const flakyFetch = async (url, init) => {
      const body = JSON.parse(init.body);
      if (body.action === "put" && body.id === "score_g") {
        return new Response("boom", { status: 500 });
      }
      return fetch(url, init);
    };

    const { report, state } = await syncWithDrive(config, local, EMPTY_SYNC_STATE, {
      fetchImpl: flakyFetch,
    });

    assert.deepEqual(report.uploaded, ["score_f"]);
    assert.equal(report.errors.length, 1);
    assert.equal(report.errors[0].id, "score_g");
    assert.match(report.errors[0].message, /error 500/);
    // Lo que sí subió queda registrado; lo que falló no, así que se reintenta.
    assert.equal(state.synced.score_f, 1_700_000_006_000);
    assert.equal(state.synced.score_g, undefined);
  });
});

test("sin conexión, la sincronización falla con un mensaje claro y no toca nada", async () => {
  const local = makeLocalStore([makeDoc("score_h", { updatedAt: 1_700_000_008_000 })]);
  const brokenFetch = async () => {
    const error = new Error("getaddrinfo ENOTFOUND");
    error.name = "TypeError";
    throw error;
  };
  await assert.rejects(
    () =>
      syncWithDrive(
        { endpoint: "https://script.google.com/macros/s/x/exec", session: "t" },
        local,
        EMPTY_SYNC_STATE,
        { fetchImpl: brokenFetch },
      ),
    (error) => {
      // `network` y no `unauthenticated`: sin esta distinción, un corte de wifi
      // cerraría la sesión y dejaría fuera a quien no ha hecho nada malo.
      assert.equal(error.code, "network");
      return true;
    },
  );
  // El documento local sigue intacto: local-first, la red nunca destruye datos.
  assert.equal(local.docs.size, 1);
});

test("con una sesión que ya no vale, la sincronización lo dice como tal", async () => {
  await withDrive(async ({ config }) => {
    const expired = { ...config, session: `${ANA.email}|1|firma` };
    await assert.rejects(
      () => syncWithDrive(expired, makeLocalStore(), EMPTY_SYNC_STATE),
      (error) => {
        assert.equal(error.code, "unauthenticated");
        return true;
      },
    );
  });
});

test("la subida es idempotente: repetirla no duplica ni cambia nada", async () => {
  await withDrive(async ({ drive, config }) => {
    const doc = makeDoc("score_i", { updatedAt: 1_700_000_011_000 });
    const first = await putRemoteScore(config, doc);
    const second = await putRemoteScore(config, doc);

    assert.deepEqual(first, second);
    assert.equal(drive.index().length, 1);
    assert.equal(drive.index()[0].annotationCount, 1);
  });
});

test("el MusicXML viaja una sola vez, no dentro y fuera del documento", async () => {
  await withDrive(async ({ config }) => {
    const doc = makeDoc("score_xml", { updatedAt: 1_700_000_012_000 });
    let sent = null;
    const recordingFetch = async (url, init) => {
      sent = JSON.parse(init.body);
      return fetch(url, init);
    };

    await putRemoteScore(config, doc, { fetchImpl: recordingFetch });

    // El documento viaja SIN el XML (que el servidor guarda en su propio
    // archivo) y el XML viaja en su campo: subirlo en los dos sitios duplicaba
    // el peso de cada guardado de una partitura grande.
    assert.equal(sent.document.xml, "");
    assert.equal(sent.xml, doc.xml);
    assert.equal(sent.id, doc.meta.id);

    // Y lo que queda en Drive y lo que se vuelve a bajar es la partitura entera.
    const stored = await getRemoteScore(config, "score_xml");
    assert.equal(stored.xml, doc.xml);
  });
});

test("lo que baja de Drive se sanea antes de guardarse", async () => {
  await withDrive(async ({ drive, config }) => {
    const local = makeLocalStore();
    // Una partitura subida por una versión anterior: sin `fields` en la nota,
    // sin `notes` en la capa y sin la lista de comentarios. Abrirla así tumbaba
    // el panel de anotaciones.
    const old = {
      meta: { id: "score_old", title: "Antigua", updatedAt: 1_700_000_013_000 },
      layers: [
        {
          id: "layer_1",
          name: "Mía",
          notes: [{ id: "note_1", measureIndex: 4, measureNumber: "5" }],
        },
        "una capa que no es una capa",
      ],
    };
    drive.seed("score_old", old, XML);

    const first = await syncWithDrive(config, local, EMPTY_SYNC_STATE);
    assert.deepEqual(first.report.downloaded, ["score_old"]);

    const restored = await local.load("score_old");
    assert.deepEqual(
      restored.layers[0].notes[0].fields,
      { text: "", dynamics: "", articulation: "", fingering: "", technique: "", harmony: "" },
      "el panel lee estos campos: tienen que existir",
    );
    assert.deepEqual(restored.layers[0].strokes, []);
    assert.equal(restored.layers[0].notes[0].measureEnd, 4, "un tramo sin fin es un compás");
    assert.equal(restored.layers.length, 1, "lo que no es una capa se descarta entero");
    assert.equal(restored.xml, XML);
    assert.equal(restored.meta.updatedAt, 1_700_000_013_000, "la fecha la manda lo que llega");

    // Y no parece nueva: normalizarla no puede provocar que la siguiente pasada
    // la devuelva como si aquí se hubiera editado.
    const second = await syncWithDrive(config, local, first.state);
    assert.equal(second.report.unchanged, 1);
    assert.deepEqual(second.report.uploaded, []);
  });
});

test("el servidor alinea el id del documento con el de la carpeta", async () => {
  await withDrive(async ({ config }) => {
    const send = (body) =>
      fetch(config.endpoint, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ session: config.session, ...body }),
      }).then((response) => response.json());

    // Un documento que dice llamarse de otra manera: vive en la carpeta del id
    // que manda la petición, así que su `meta.id` se corrige al guardarlo.
    const put = await send({
      action: "put",
      id: "score_z",
      document: { ...makeDoc("otro_id", { updatedAt: 1_700_000_014_000 }) },
      xml: XML,
    });
    assert.equal(put.ok, true);
    assert.equal(put.summary.id, "score_z");
    const stored = await getRemoteScore(config, "score_z");
    assert.equal(stored.document.meta.id, "score_z");

    // Y un documento sin la forma esperada no llega a escribirse (el doble tiene
    // que decir lo mismo que el script real: ver `tests/apps-script.test.mjs`).
    const sinMetadatos = await send({ action: "put", id: "score_y", document: { layers: [] } });
    assert.equal(sinMetadatos.ok, false);
    assert.equal(sinMetadatos.code, "bad_request");
    const sinCapas = await send({ action: "put", id: "score_y", document: { meta: {} } });
    assert.equal(sinCapas.code, "bad_request");
    // Y no ha quedado nada guardado: el servidor explica que no está, no devuelve
    // un documento a medias.
    await assert.rejects(() => getRemoteScore(config, "score_y"), /no está en Drive/);
  });
});

test("la biblioteca de este equipo tiene dueño, y no se sube a otra cuenta sin permiso", () => {
  // Puro: sin navegador, guardar y leer el dueño no hace nada (y no revienta).
  assert.equal(loadSyncOwner(), "");
  saveSyncOwner("ana@ejemplo.com");
  assert.equal(loadSyncOwner(), "");

  // Con dueño apuntado y otra cuenta delante, hay que preguntar. Sin dueño (una
  // instalación nueva) o con la misma cuenta, no.
  assert.equal(needsOwnerConfirmation("ana@ejemplo.com", "otro@ejemplo.com"), true);
  assert.equal(needsOwnerConfirmation("ana@ejemplo.com", "ana@ejemplo.com"), false);
  assert.equal(needsOwnerConfirmation("", "otro@ejemplo.com"), false);
  assert.equal(needsOwnerConfirmation("ana@ejemplo.com", ""), false);
});

test("describeReport resume el informe en una frase", () => {
  assert.equal(
    describeReport({
      ...EMPTY_SYNC_STATE,
      uploaded: [],
      downloaded: [],
      deletedRemote: [],
      conflicts: [],
      unchanged: 0,
      errors: [],
    }),
    "Nada que sincronizar",
  );
  assert.equal(
    describeReport({
      uploaded: ["a"],
      downloaded: ["b", "c"],
      deletedRemote: ["d"],
      conflicts: [],
      unchanged: 2,
      errors: [{ id: "e", message: "x" }],
    }),
    "1 subida(s) · 2 bajada(s) · 1 borrada(s) en Drive · 2 sin cambios · 1 error(es)",
  );
});
