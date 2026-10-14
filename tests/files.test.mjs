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
