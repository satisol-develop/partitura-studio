import assert from "node:assert/strict";
import test from "node:test";

// `@tonejs/midi` es CommonJS: la importación con nombre no existe en Node.
import toneMidi from "@tonejs/midi";

import { midiToMusicXml } from "../lib/midi-to-musicxml.ts";

const { Midi } = toneMidi;

const PPQ = 480;
const QUARTER = PPQ;
const WHOLE = PPQ * 4;

/** Construye un MIDI de verdad y devuelve el ArrayBuffer que lee el conversor. */
function makeMidi({ timeSignature = [4, 4], tempo = 120, name, tracks }) {
  const midi = new Midi();
  midi.header.tempos = [{ ticks: 0, bpm: tempo }];
  midi.header.timeSignatures = [{ ticks: 0, timeSignature }];
  if (name) midi.name = name;
  midi.header.update();
  for (const notes of tracks) {
    const track = midi.addTrack();
    for (const note of notes) {
      track.addNote({
        midi: note.midi,
        ticks: note.ticks,
        durationTicks: note.durationTicks,
        velocity: 0.8,
      });
    }
  }
  const bytes = midi.toArray();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

/* ---------------------------- lectura del XML ---------------------------- */

const measureBodies = (xml) =>
  [...xml.matchAll(/<measure\b[^>]*>([\s\S]*?)<\/measure>/g)].map((m) => m[1]);

/** Cada `<note>` del compás, con los datos que nos interesan ya extraídos. */
function readNotes(body) {
  return [...body.matchAll(/<note\b[^>]*>([\s\S]*?)<\/note>/g)].map((m) => {
    const block = m[1];
    const step = /<step>([^<]+)<\/step>/.exec(block)?.[1] ?? null;
    const octave = /<octave>(-?\d+)<\/octave>/.exec(block)?.[1] ?? null;
    const alter = Number(/<alter>(-?\d+)<\/alter>/.exec(block)?.[1] ?? 0);
    const accidental = alter === 0 ? "" : alter > 0 ? "#".repeat(alter) : "b".repeat(-alter);
    return {
      block,
      pitchCount: (block.match(/<pitch>/g) ?? []).length,
      pitch: step ? `${step}${accidental}${octave}` : null,
      duration: Number(/<duration>(\d+)<\/duration>/.exec(block)?.[1] ?? 0),
      voice: Number(/<voice>(\d+)<\/voice>/.exec(block)?.[1] ?? 0),
      isRest: /<rest\s*\/>/.test(block),
      isChord: /<chord\s*\/>/.test(block),
      tieStart: /<tie type="start"\s*\/>/.test(block),
      tieStop: /<tie type="stop"\s*\/>/.test(block),
      durationIndex: block.indexOf("<duration>"),
      tieIndex: block.indexOf("<tie "),
    };
  });
}

const measureLength = ([beats, beatType]) => Math.round((beats / beatType) * 4 * QUARTER);

/* -------------------------------- pruebas -------------------------------- */

test("cada <note> lleva una sola altura (regresión: acordes con varios <pitch>)", () => {
  // Tres notas simultáneas de la misma duración: un acorde, no un `<note>` con
  // tres alturas dentro, que es MusicXML inválido aunque OSMD lo dibuje.
  const xml = midiToMusicXml(
    makeMidi({
      tracks: [[
        { midi: 60, ticks: 0, durationTicks: WHOLE },
        { midi: 64, ticks: 0, durationTicks: WHOLE },
        { midi: 67, ticks: 0, durationTicks: WHOLE },
      ]],
    }),
    "acorde",
  ).xml;

  const notes = measureBodies(xml).flatMap(readNotes);
  assert.ok(notes.length >= 3);
  for (const note of notes) {
    assert.ok(
      note.pitchCount <= 1,
      `un <note> con ${note.pitchCount} alturas:\n${note.block}`,
    );
  }
  // El acorde se escribe como notas seguidas, y las siguientes llevan <chord/>.
  assert.equal(notes.filter((n) => n.isChord).length, 2);
  assert.deepEqual(
    notes.filter((n) => !n.isRest).map((n) => n.pitch),
    ["C4", "E4", "G4"],
  );
});

test("<duration> va antes que <tie> (el orden lo fija el DTD)", () => {
  // Una nota que cruza la barra de compás obliga a generar ligaduras.
  const xml = midiToMusicXml(
    makeMidi({ tracks: [[{ midi: 62, ticks: 0, durationTicks: WHOLE * 2 }]] }),
    "ligadura",
  ).xml;

  for (const note of measureBodies(xml).flatMap(readNotes)) {
    if (note.tieIndex < 0) continue;
    assert.ok(note.durationIndex >= 0, "hay <tie> sin <duration>");
    assert.ok(
      note.durationIndex < note.tieIndex,
      `<duration> debe ir antes que <tie>:\n${note.block}`,
    );
    // Y las ligaduras se anuncian también en <notations>, que además cierra el
    // `<note>`: cualquier hijo posterior sería inválido.
    assert.match(note.block, /<notations>[\s\S]*<\/notations>/);
    assert.ok(
      note.block.indexOf("</notations>") > note.tieIndex,
      "las <notations> van después de las ligaduras",
    );
  }
});

test("las ligaduras unen la misma altura (regresión: unir notas contiguas distintas)", () => {
  // Melodía de negras distintas más una negra que cruza la barra. Antes las
  // ligaduras se inferían por contigüidad de tiempos, así que la melodía entera
  // quedaba "ligada" entre alturas distintas.
  const xml = midiToMusicXml(
    makeMidi({
      tracks: [[
        { midi: 69, ticks: 0, durationTicks: QUARTER },
        { midi: 71, ticks: QUARTER, durationTicks: QUARTER },
        { midi: 72, ticks: QUARTER * 2, durationTicks: QUARTER },
        { midi: 74, ticks: QUARTER * 3, durationTicks: QUARTER * 2 },
        { midi: 76, ticks: QUARTER * 5, durationTicks: QUARTER },
      ]],
    }),
    "melodia",
  ).xml;

  const perVoice = new Map();
  measureBodies(xml).forEach((body, index) => {
    for (const note of readNotes(body)) {
      if (note.isRest) continue;
      const list = perVoice.get(note.voice) ?? [];
      list.push({ ...note, measure: index });
      perVoice.set(note.voice, list);
    }
  });

  const pairs = [];
  for (const list of perVoice.values()) {
    for (let i = 0; i < list.length; i++) {
      const note = list[i];
      if (note.tieStop) {
        const previous = list[i - 1];
        assert.ok(previous, "una ligadura que termina sin nada antes");
        assert.equal(
          previous.pitch,
          note.pitch,
          `ligadura entre alturas distintas: ${previous.pitch} → ${note.pitch}`,
        );
        assert.ok(previous.tieStart, "la nota anterior debería abrir la ligadura");
      }
      if (note.tieStart) {
        const next = list[i + 1];
        assert.ok(next, "ligadura abierta sin continuación");
        assert.equal(next.pitch, note.pitch, "ligadura abierta hacia otra altura");
        assert.ok(next.tieStop, "la continuación debería cerrar la ligadura");
        pairs.push(`${note.pitch}@${note.measure}->${next.measure}`);
      }
    }
  }

  // Exactamente una: el RE que salta la barra (empieza en el 3er tiempo y
  // dura dos negras). Las demás son melodía normal y no llevan ligadura.
  assert.deepEqual(pairs, ["D5@0->1"]);
});

test("las voces suman exactamente el compás, en 4/4 y en 3/4", () => {
  for (const timeSignature of [[4, 4], [3, 4]]) {
    const expected = measureLength(timeSignature);
    const xml = midiToMusicXml(
      makeMidi({
        timeSignature,
        // Dos alturas mantenidas y una melodía encima: fuerza voces separadas.
        tracks: [
          [
            { midi: 48, ticks: 0, durationTicks: WHOLE * 2 },
            { midi: 55, ticks: 0, durationTicks: WHOLE },
          ],
          [
            { midi: 72, ticks: 0, durationTicks: QUARTER },
            { midi: 74, ticks: QUARTER, durationTicks: QUARTER },
            { midi: 76, ticks: QUARTER * 2, durationTicks: QUARTER },
            { midi: 77, ticks: QUARTER * 3, durationTicks: QUARTER * 4 },
          ],
        ],
      }),
      "voces",
    ).xml;

    assert.match(xml, new RegExp(`<beats>${timeSignature[0]}</beats>`));
    assert.match(xml, new RegExp(`<beat-type>${timeSignature[1]}</beat-type>`));

    const measures = measureBodies(xml);
    assert.ok(measures.length >= 2, `esperaba varios compases en ${timeSignature}`);

    for (const [index, body] of measures.entries()) {
      const totals = new Map();
      const voices = new Set();
      for (const note of readNotes(body)) {
        totals.set(note.voice, (totals.get(note.voice) ?? 0) + note.duration);
        voices.add(note.voice);
      }
      assert.ok(voices.size > 0, `el compás ${index} no tiene voces`);
      assert.ok(voices.size <= 4, `demasiadas voces en el compás ${index}: ${voices.size}`);
      for (const [voice, total] of totals) {
        assert.equal(
          total,
          expected,
          `compás ${index}, voz ${voice}: suma ${total} y debe medir ${expected}`,
        );
      }
    }
  }
});

test("la altura escrita lleva la octava correcta (Do central = C4)", () => {
  const xml = midiToMusicXml(
    makeMidi({
      tracks: [[
        { midi: 60, ticks: 0, durationTicks: QUARTER },
        { midi: 61, ticks: QUARTER, durationTicks: QUARTER },
        { midi: 36, ticks: QUARTER * 2, durationTicks: QUARTER },
        { midi: 24, ticks: QUARTER * 3, durationTicks: QUARTER },
      ]],
    }),
    "octavas",
  ).xml;

  const notes = measureBodies(xml).flatMap(readNotes);
  assert.deepEqual(notes.map((n) => n.pitch), ["C4", "C#4", "C2", "C1"]);
  // El alter no aparece cuando es natural.
  assert.doesNotMatch(notes[0].block, /<alter>/);
  assert.match(notes[1].block, /<alter>1<\/alter>/);
});

test("el compás se rellena con silencios hasta la última nota", () => {
  const xml = midiToMusicXml(
    makeMidi({ tracks: [[{ midi: 60, ticks: 0, durationTicks: QUARTER }]] }),
    "silencio",
  ).xml;

  const notes = measureBodies(xml).flatMap(readNotes);
  assert.equal(notes.filter((n) => n.isRest).length, 1);
  assert.equal(
    notes.reduce((sum, n) => sum + n.duration, 0),
    measureLength([4, 4]),
  );
});

test("un MIDI sin notas se rechaza con un mensaje claro en vez de exportar vacío", () => {
  assert.throws(
    () => midiToMusicXml(makeMidi({ tracks: [[]] }), "vacío"),
    /no contiene notas/,
  );
});

test("el título del MIDI se escapa y se usa como título del documento", () => {
  const conversion = midiToMusicXml(
    makeMidi({
      name: "Sonata & Fuga <nº 2>",
      tracks: [[{ midi: 60, ticks: 0, durationTicks: QUARTER }]],
    }),
    "sin título",
  );

  assert.equal(conversion.title, "Sonata & Fuga <nº 2>");
  assert.match(conversion.xml, /<work-title>Sonata &amp; Fuga &lt;nº 2&gt;<\/work-title>/);
  // Un título con caracteres especiales no puede romper el XML.
  assert.doesNotMatch(conversion.xml, /<work-title>[^<]*&(?!amp;|lt;|gt;|quot;)/);
});

test("una partitura que cruza el Do central avisa y usa dos pentagramas", () => {
  const conversion = midiToMusicXml(
    makeMidi({
      tracks: [[
        { midi: 36, ticks: 0, durationTicks: WHOLE },
        { midi: 76, ticks: 0, durationTicks: WHOLE },
      ]],
    }),
    "dos pentagramas",
  );

  assert.ok(conversion.warnings.some((w) => /dos pentagramas/.test(w)));
  assert.match(conversion.xml, /<staves>2<\/staves>/);
  assert.match(conversion.xml, /<clef number="2"><sign>F<\/sign><line>4<\/line><\/clef>/);
  assert.equal((conversion.xml.match(/<staff>2<\/staff>/g) ?? []).length > 0, true);
});

test("las pistas de percusión se descartan y se avisa", () => {
  const midi = new Midi();
  midi.header.tempos = [{ ticks: 0, bpm: 120 }];
  midi.header.update();
  const drums = midi.addTrack();
  drums.channel = 9;
  drums.addNote({ midi: 38, ticks: 0, durationTicks: QUARTER, velocity: 0.9 });
  const melodic = midi.addTrack();
  melodic.addNote({ midi: 60, ticks: 0, durationTicks: QUARTER, velocity: 0.9 });
  const bytes = midi.toArray();

  const conversion = midiToMusicXml(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    "con batería",
  );

  assert.ok(conversion.warnings.some((w) => /percusión/.test(w)));
  const notes = measureBodies(conversion.xml).flatMap(readNotes);
  const sounded = notes.filter((n) => !n.isRest).map((n) => n.pitch);
  assert.deepEqual(sounded, ["C4"]);
  // El resto del compás son silencios, no notas fantasma.
  assert.ok(notes.some((n) => n.isRest));
});
