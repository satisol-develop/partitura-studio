/**
 * Pruebas de `lib/files.ts`: lo que entra y lo que sale de la aplicación.
 *
 * Aquí está la frontera con el exterior, que es donde más fácil es equivocarse
 * en silencio: un archivo que no es una copia de la aplicación no puede acabar
 * convertido en una partitura vacía, un `.mxl` tiene que salir con el XML que
 * lleva dentro y no con el índice del ZIP, y el nombre del archivo exportado no
 * puede salir con acentos ni barras que rompan la descarga.
 *
 * Node trae `File`, `Blob` y `zipSync` (de `fflate`, ya es dependencia de la
 * aplicación), así que todo esto se puede probar sin navegador: las funciones
 * que tocan el DOM —las que crean el enlace de descarga— no se llaman.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { strToU8, zipSync } from "fflate";

import { importScoreFile, musicXmlFileName, normalizeDocument, slug } from "../lib/files.ts";

const MUSICXML = '<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"></score-partwise>';

const fileOf = (contents, name) =>
  new File([typeof contents === "string" ? contents : contents], name);

test("un .json que no es una copia de la aplicación se rechaza con un motivo", async () => {
  const ajeno = fileOf(JSON.stringify({ contactos: [{ nombre: "Ana" }] }), "agenda.json");
  await assert.rejects(
    () => importScoreFile(ajeno),
    /no parece una copia exportada por Partitura Studio/,
  );

  // Un documento al que le falta la partitura tampoco vale: sin XML no hay
  // música que anotar y quedaría una partitura inservible.
  const sinXml = fileOf(
    JSON.stringify({ meta: { title: "X" }, layers: [{ id: "l1" }] }),
    "roto.json",
  );
  await assert.rejects(() => importScoreFile(sinXml), /no parece una copia exportada/);

  // Y un JSON cortado a medias se distingue de un JSON que no es nuestro.
  await assert.rejects(
    () => importScoreFile(fileOf('{"meta": {"title": "X"', "cortado.json")),
    /no es un JSON válido/,
  );
});

test("una copia antigua se completa en vez de romperse", () => {
  // Los documentos guardados antes de que existieran los tramos y las partes
  // no traen `measureEnd` ni `partId`.
  const doc = normalizeDocument({
    meta: { id: "score_1", title: "Antigua" },
    xml: MUSICXML,
    layers: [{ id: "layer_1", name: "Mía", notes: [{ id: "note_1", measureIndex: 4 }] }],
  });

  assert.equal(doc.layers[0].notes[0].measureEnd, 4, "un tramo sin fin es un compás");
  assert.equal(doc.layers[0].notes[0].partId, null);
  assert.equal(doc.layers[0].visible, true);
  assert.equal(doc.activeLayerId, "layer_1");
  // Sin capas no hay nada donde dibujar: se crea una.
  assert.equal(normalizeDocument({ meta: {}, xml: MUSICXML, layers: [] }).layers.length, 1);

  // Y los campos estructurados existen aunque el documento no los traiga: el
  // panel los lee (`note.fields.text`) y un `fields` ausente lo tumbaba entero,
  // con la partitura ya abierta. Es el caso que se escapaba antes.
  assert.deepEqual(doc.layers[0].notes[0].fields, {
    text: "",
    dynamics: "",
    articulation: "",
    fingering: "",
    technique: "",
    harmony: "",
  });
  assert.deepEqual(doc.layers[0].notes[0].tags, []);
  assert.equal(doc.layers[0].notes[0].priority, 0);
  assert.deepEqual(doc.layers[0].strokes, [], "una capa sin lista de trazos es una capa vacía");
  assert.deepEqual(doc.layers[0].pins, []);
});

test("lo que no se puede leer se sustituye o se descarta, nunca revienta", () => {
  const doc = normalizeDocument({
    // Ni el documento ni las capas tienen por qué ser objetos: un `null` en el
    // JSON es legal y antes se leía campo a campo.
    meta: null,
    xml: 42,
    layers: [
      null,
      "una capa de texto",
      {
        id: "layer_1",
        opacity: "mucha",
        visible: "sí",
        strokes: [
          null,
          { id: "stroke_malo" },
          {
            id: "stroke_1",
            points: [{ x: 1, y: 2, p: 4 }, { x: Number.NaN, y: 0 }, "punto"],
            width: Number.POSITIVE_INFINITY,
            tool: "rotulador",
          },
        ],
        pins: [
          { id: "pin_1", x: 10, y: "20" },
          { id: "pin_2", x: 1, y: 2, messages: [{ text: "hola" }, 7], resolved: "sí" },
        ],
        notes: [
          { id: "note_1", measureIndex: "primero" },
          { id: "note_2", measureIndex: 3, fields: { text: "hola", inventado: "fuera" } },
        ],
      },
    ],
  });

  assert.equal(doc.meta.title, "Sin título");
  assert.equal(doc.meta.source, "musicxml", "un origen desconocido se lee como MusicXML");
  assert.equal(doc.xml, "");
  assert.equal(doc.layers.length, 1, "las capas que no son capas se descartan");

  const layer = doc.layers[0];
  assert.equal(layer.opacity, 1, "una opacidad ilegible vuelve a su valor neutro");
  assert.equal(layer.visible, true);
  // Un trazo sin puntos NI anclas no se puede dibujar, y se descarta.
  assert.deepEqual(layer.strokes.map((stroke) => stroke.id), ["stroke_1"]);
  assert.deepEqual(
    layer.strokes[0].points,
    [{ x: 1, y: 2, p: 1 }],
    "la presión se acota y los puntos sin coordenadas no entran",
  );
  assert.equal(layer.strokes[0].width, 2.4, "un grosor infinito no es un grosor");
  assert.equal(layer.strokes[0].tool, "pencil");

  assert.deepEqual(layer.pins.map((pin) => pin.id), ["pin_2"], "un pin sin y legible no tiene sitio");
  assert.deepEqual(
    layer.pins[0].messages.map((message) => message.text),
    ["hola"],
    "un mensaje que no es un objeto (un número suelto en la lista) se descarta",
  );
  assert.equal(layer.pins[0].resolved, false);

  assert.deepEqual(layer.notes.map((note) => note.id), ["note_2"], "una nota sin compás no existe");
  assert.deepEqual(layer.notes[0].fields, {
    text: "hola",
    dynamics: "",
    articulation: "",
    fingering: "",
    technique: "",
    harmony: "",
  });
});

test("dos anotaciones con el mismo id dejan de pisarse", () => {
  // Un archivo editado a mano puede traer el id repetido; con él repetido,
  // borrar una capa borraría las dos y mover un trazo movería los dos.
  const doc = normalizeDocument({
    meta: {},
    xml: MUSICXML,
    layers: [
      { id: "layer_1", strokes: [{ id: "stroke_1", points: [{ x: 0, y: 0 }] }] },
      { id: "layer_1", strokes: [{ id: "stroke_1", points: [{ x: 1, y: 1 }] }] },
    ],
  });

  assert.notEqual(doc.layers[0].id, doc.layers[1].id);
  assert.notEqual(doc.layers[0].strokes[0].id, doc.layers[1].strokes[0].id);
  assert.equal(doc.activeLayerId, doc.layers[0].id);
});

test("un ancla a medias no se cuela: o entera, o se recalcula", () => {
  // Las anclas son lo que decide dónde cae una anotación al re-maquetar. Una con
  // `NaN` colocaría la tinta en el infinito y ya no se recalcularía.
  const [stroke] = normalizeDocument({
    meta: {},
    xml: MUSICXML,
    layers: [
      {
        id: "layer_1",
        strokes: [
          {
            id: "stroke_1",
            points: [{ x: 10, y: 10 }],
            anchors: [
              { m: 0, p: "P1", o: 0, u: 0.5, v: 0.5 },
              { m: 1, p: null, o: 0, u: Number.NaN, v: 0.5 },
            ],
          },
          {
            id: "stroke_2",
            points: [{ x: 20, y: 20 }],
            anchors: [{ m: 0, p: "P1", o: 0, u: 0.25, v: 0.75 }],
          },
        ],
      },
    ],
  }).layers[0].strokes;

  assert.equal(stroke.anchors, undefined, "con un ancla rota se descartan todas y se recalculan");
  assert.deepEqual(
    normalizeDocument({
      meta: {},
      xml: MUSICXML,
      layers: [
        {
          id: "layer_1",
          strokes: [
            {
              id: "s",
              points: [{ x: 1, y: 1 }],
              anchors: [{ m: 2, p: "P1", o: 1, u: 0.5, v: 0.5 }],
            },
          ],
        },
      ],
    }).layers[0].strokes[0].anchors,
    [{ m: 2, p: "P1", o: 1, u: 0.5, v: 0.5 }],
    "un ancla entera se conserva tal cual",
  );
});

test("normalizar lo que baja de Drive no cambia la fecha: la decide lo que llega", () => {
  // Al bajar algo de Drive, ponerle la fecha de ahora haría que la copia pareciera
  // más nueva que su original y la siguiente sincronización la devolviera.
  const remote = normalizeDocument(
    { meta: { id: "score_1", updatedAt: 1_700_000_000_000 }, xml: MUSICXML, layers: [{}] },
    { touch: false },
  );
  assert.equal(remote.meta.updatedAt, 1_700_000_000_000);

  // Y una copia importada a mano sí se pone al día: abrirla es una decisión tuya.
  const imported = normalizeDocument({
    meta: { id: "score_1", updatedAt: 1 },
    xml: MUSICXML,
    layers: [{}],
  });
  assert.ok(imported.meta.updatedAt > 1_700_000_000_000);
});

test("un .xml que no es MusicXML se rechaza antes de llegar al lienzo", async () => {
  await assert.rejects(
    () => importScoreFile(fileOf("<html><body>Hola</body></html>", "pagina.xml")),
    /no parece MusicXML/,
  );
});

test("el .mxl se abre por su container y, si no lo trae, por el primer XML", async () => {
  const conContainer = zipSync({
    "META-INF/container.xml": strToU8(
      '<?xml version="1.0"?><container><rootfiles><rootfile full-path="Cuarteto/score.xml"/></rootfiles></container>',
    ),
    "Cuarteto/score.xml": strToU8(MUSICXML),
    "Cuarteto/otro.xml": strToU8("<score-partwise version=\"1.0\"></score-partwise>"),
  });
  const { doc } = await importScoreFile(fileOf(conContainer, "Cuarteto op. 3.mxl"));
  assert.equal(doc.meta.source, "mxl");
  assert.equal(doc.meta.title, "Cuarteto op. 3", "el título sale del nombre del archivo");
  assert.equal(doc.xml, MUSICXML, "se guarda el XML que apunta el container, no otro");

  const sinContainer = zipSync({ "score.xml": strToU8(MUSICXML) });
  const segundo = await importScoreFile(fileOf(sinContainer, "Suelto.mxl"));
  assert.equal(segundo.doc.xml, MUSICXML);

  // Un ZIP que no es un .mxl se explica, no se cuelga intentándolo.
  await assert.rejects(
    () => importScoreFile(fileOf(zipSync({ "leeme.txt": strToU8("hola") }), "falso.mxl")),
    /no contiene ningún documento MusicXML/,
  );
});

test("un archivo enorme se rechaza con el motivo, no dejando la pestaña colgada", async () => {
  const enorme = new File([new Uint8Array(26 * 1024 * 1024)], "escaneo.musicxml");
  await assert.rejects(() => importScoreFile(enorme), /el límite son 25 MB/);
});

/**
 * Un ZIP a mano que declara gigabytes y lleva veinte bytes dentro.
 *
 * Es la bomba de descompresión clásica, y la única forma de montarla sin
 * reservar de verdad los gigabytes: los tamaños van en la cabecera del archivo,
 * así que se pueden escribir sin tener los datos. `zipSync` no sirve para esto
 * —comprime lo que le des—, y por eso el ZIP se arma byte a byte.
 */
function bombOf(name, declaredSize) {
  const nameBytes = strToU8(name);
  const payload = new Uint8Array(20);
  const u16 = (n) => [n & 255, (n >>> 8) & 255];
  const u32 = (n) => [...u16(n & 0xffff), ...u16((n >>> 16) & 0xffff)];
  const local = [
    ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
    ...u32(0), ...u32(payload.length), ...u32(declaredSize),
    ...u16(nameBytes.length), ...u16(0),
    ...nameBytes, ...payload,
  ];
  const central = [
    ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
    ...u32(0), ...u32(payload.length), ...u32(declaredSize),
    ...u16(nameBytes.length), ...u16(0), ...u16(0),
    ...u16(0), ...u16(0), ...u32(0), ...u32(0),
    ...nameBytes,
  ];
  return new Uint8Array([
    ...local, ...central,
    ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(1), ...u16(1),
    ...u32(central.length), ...u32(local.length), ...u16(0),
  ]);
}

test("un .mxl que se expande a gigabytes se para antes de descomprimirlo", async () => {
  // 40 KB de archivo que declaran 2 GB al descomprimirse: antes de esto, la
  // única defensa era el tope de tamaño de la importación, que cuenta lo
  // COMPRIMIDO y por tanto no ve nada.
  const bomb = bombOf("score.xml", 2 * 1024 * 1024 * 1024);
  assert.ok(bomb.length < 100 * 1024, "la bomba es pequeña: eso es justo el problema");
  await assert.rejects(
    () => importScoreFile(new File([bomb], "bomba.mxl")),
    /se expande a más de 64 MB/,
  );
});

test("lo que no hace falta del .mxl no cuenta: la portada escaneada dentro no estorba", async () => {
  // Un .mxl puede llevar dentro imágenes o un PDF además del XML. No se extraen,
  // así que no gastan memoria y no pueden hacer que un archivo legítimo se
  // rechace por «pesar» más de lo que se abre.
  const withCover = zipSync({
    "META-INF/container.xml": strToU8(
      '<?xml version="1.0"?><container><rootfiles><rootfile full-path="part/score.xml"/></rootfiles></container>',
    ),
    "part/score.xml": strToU8(MUSICXML),
    // Altamente comprimible: 80 MB de ceros ocupan unas decenas de KB.
    "part/portada.pdf": new Uint8Array(80 * 1024 * 1024),
  });
  const { doc } = await importScoreFile(new File([withCover], "Con portada.mxl"));
  assert.equal(doc.xml, MUSICXML);
});

test("el MusicXML exportado sale con un nombre de archivo utilizable", () => {
  // Los acentos y la `ñ` se descomponen (NFD) y se quedan en su letra: una
  // descarga llamada «estudio-n-3…» se escribe y se busca sin sorpresas. Lo que
  // no es ASCII —`º`, la barra, los paréntesis— pasa a ser un guion, y los
  // guiones repetidos no se acumulan.
  const doc = { meta: { title: "Estudio nº 3 (revisada) / v2" } };
  assert.equal(musicXmlFileName(doc), "estudio-n-3-revisada-v2.musicxml");
  assert.equal(slug("Canción de cuna"), "cancion-de-cuna");
  // Sin nada aprovechable en el título, un nombre por defecto: nunca un
  // «.musicxml» suelto ni un nombre vacío.
  assert.equal(musicXmlFileName({ meta: { title: "" } }), "partitura.musicxml");
  assert.equal(musicXmlFileName({ meta: { title: "¿?" } }), "partitura.musicxml");
  assert.equal(slug("  "), "partitura");
});
