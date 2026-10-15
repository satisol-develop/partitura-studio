/**
 * Pruebas de la línea de tiempo de reproducción (`lib/playback.ts`).
 *
 * Aquí se protege la mitad sonora de la transposición, que es la que se puede
 * romper sin que se note en pantalla: OSMD aplica el transporte **sólo al
 * dibujo**, deja las alturas de origen intactas y no toca nunca la lectura de un
 * instrumento. La reproducción lee esas alturas de origen, así que tiene que
 * sumar por su cuenta lo que el archivo declara y el transporte de la obra, y
 * no sumar nunca cómo lee cada parte.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { buildTimeline } from "../lib/playback.ts";

/**
 * Altura de OSMD. Ojo con la convención, que ya costó un fallo: `getHalfTone()`
 * va doce por debajo del número MIDI (su Do5 es 60 y son 523,25 Hz, o sea MIDI
 * 72). Aquí se usa 60 a propósito para que la suma de la prueba sea legible.
 */
const HALFTONE_TO_MIDI = 12;

function fakePitch(halfTone) {
  return { getHalfTone: () => halfTone };
}

/**
 * Una partitura mínima con la forma que lee `buildTimeline`. Los compases van de
 * redonda en redonda (una redonda = 1 en el modelo de OSMD) y a 120 negras por
 * minuto, así que una redonda son 2 segundos.
 */
function fakeScore({ instrument, notes }) {
  return {
    Sheet: {
      DefaultStartTempoInBpm: 120,
      SourceMeasures: [
        {
          AbsoluteTimestamp: { RealValue: 0 },
          Duration: { RealValue: 1 },
          VerticalSourceStaffEntryContainers: [
            {
              StaffEntries: [
                {
                  VoiceEntries: [
                    {
                      Notes: notes.map((n) => ({
                        Pitch: fakePitch(n.halfTone),
                        Length: { RealValue: n.length ?? 0.25 },
                        getAbsoluteTimestamp: () => ({ RealValue: n.start ?? 0 }),
                        ParentStaff: { ParentInstrument: instrument },
                      })),
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

/** Un instrumento tal y como lo deja el cargador de OSMD. */
function fakeInstrument({ id = "P1", declared = 0, reading = 0 } = {}) {
  return {
    IdString: id,
    PlaybackTranspose: declared,
    Transpose: reading,
  };
}

test("el sonido sale de la altura escrita, más lo que declara el archivo y el transporte", () => {
  // Un saxo alto: el archivo declara −9 (escribe Do y suena Mi♭).
  const instrument = fakeInstrument({ declared: -9 });
  const score = fakeScore({ instrument, notes: [{ halfTone: 60 }] }); // Do central escrito

  // En su tono: lo escrito menos los nueve semitonos que declara el archivo.
  const sinTransporte = buildTimeline(score).notes[0];
  assert.equal(sinTransporte.midi, 60 + HALFTONE_TO_MIDI - 9);
  assert.equal(sinTransporte.time, 0);
  assert.equal(sinTransporte.duration, 0.5, "una negra a 120 son medio segundo");

  // Y transportar la obra mueve el sonido, que es lo que la hace música.
  const transportado = buildTimeline(score, 2).notes[0];
  assert.equal(transportado.midi, 60 + HALFTONE_TO_MIDI - 9 + 2);
});

test("cambiar cómo lee una parte no cambia ni una nota de lo que suena", () => {
  // El mismo trío, con la parte del saxo leída en Do, en Mi♭ o en Si♭.
  const enDo = buildTimeline(
    fakeScore({ instrument: fakeInstrument({ declared: 0, reading: 0 }), notes: [{ halfTone: 60 }] }),
  );
  const enMib = buildTimeline(
    fakeScore({ instrument: fakeInstrument({ declared: 0, reading: 9 }), notes: [{ halfTone: 60 }] }),
  );
  const enSib = buildTimeline(
    fakeScore({ instrument: fakeInstrument({ declared: 0, reading: 2 }), notes: [{ halfTone: 60 }] }),
  );

  assert.deepEqual(enMib.notes, enDo.notes);
  assert.deepEqual(enSib.notes, enDo.notes);
  // Y con el archivo declarando su lectura: la parte llega con `Transpose` a
  // cero (se dibuja tal como se escribió) pero el sonido es el mismo.
  const comoElArchivo = buildTimeline(
    fakeScore({ instrument: fakeInstrument({ declared: -9, reading: 0 }), notes: [{ halfTone: 69 }] }),
  );
  assert.equal(comoElArchivo.notes[0].midi, 69 + HALFTONE_TO_MIDI - 9);
});

test("la línea de tiempo respeta los tempos por compás y el silencio final", () => {
  const score = {
    Sheet: {
      DefaultStartTempoInBpm: 60,
      SourceMeasures: [
        {
          AbsoluteTimestamp: { RealValue: 0 },
          Duration: { RealValue: 1 },
          TempoInBPM: 60,
          VerticalSourceStaffEntryContainers: [
            {
              StaffEntries: [
                {
                  VoiceEntries: [
                    {
                      Notes: [
                        {
                          Pitch: fakePitch(60),
                          Length: { RealValue: 0.25 },
                          getAbsoluteTimestamp: () => ({ RealValue: 0 }),
                          ParentStaff: { ParentInstrument: fakeInstrument() },
                        },
                        {
                          Pitch: fakePitch(62),
                          Length: { RealValue: 0.25 },
                          getAbsoluteTimestamp: () => ({ RealValue: 0.5 }),
                          ParentStaff: { ParentInstrument: fakeInstrument() },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  };
  const timeline = buildTimeline(score);
  // A 60 negras por minuto, una negra son 1 s y una redonda 4 s.
  assert.equal(timeline.notes[1].time, 2);
  assert.equal(timeline.duration, 4, "el compás entero, aunque la última nota sea corta");
  assert.equal(timeline.tempo, 60);
  assert.deepEqual(timeline.partIds, ["P1"]);
  assert.equal(timeline.cursorTimes, null, "sin cursor no hay indicador, pero la reproducción sigue");
});
