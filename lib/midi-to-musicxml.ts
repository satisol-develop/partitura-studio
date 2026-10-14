/**
 * Conversor MIDI → MusicXML (mejor esfuerzo).
 *
 * MIDI dice *cuándo suena qué*, no *cómo se escribe*. Así que esto es una
 * transcripción legible, no una reconstrucción literal:
 *
 *   - Cuantizamos a semicorchea: es la rejilla que espera quien va a anotar
 *     encima, no los micro-timings del original.
 *   - Agrupamos notas simultáneas y de igual duración en acordes.
 *   - Separamos en voces (máx. 4) para que una melodía pueda sonar sobre un
 *     bajo mantenido sin pisarse.
 *   - Repartimos en dos pentagramas si el registro cruza el Do central.
 *   - Partimos las notas largas con ligaduras cuando cruzan el compás.
 *
 * Limitación: se pierden dinámicas, articulaciones y pedal, porque MIDI no
 * las lleva de forma fiable. Las pistas de percusión (canal 10) se descartan.
 */

import { Midi } from "@tonejs/midi";

interface RawNote {
  start: number; // ticks absolutos
  dur: number; // ticks
  midi: number;
}

interface Group {
  start: number;
  dur: number;
  pitches: number[];
}

interface Value {
  div: number;
  type: string;
  dots: number;
}

/** Un valor concreto ya colocado en un compás, con sus alturas. */
interface Placed extends Value {
  measure: number;
  offset: number; // divisions desde el inicio del compás
  pitches: number[];
  /**
   * Ligaduras. Se deciden al trocear la nota, NUNCA deduciendo que el
   * siguiente valor empieza donde acaba éste: una melodía de negras
   * consecutivas es contigua y no está ligada. Una ligadura sólo une dos
   * valores que salen de la MISMA nota.
   */
  tieStart: boolean;
  tieStop: boolean;
}

const BASE: { type: string; quarters: number }[] = [
  { type: "whole", quarters: 4 },
  { type: "half", quarters: 2 },
  { type: "quarter", quarters: 1 },
  { type: "eighth", quarters: 0.5 },
  { type: "16th", quarters: 0.25 },
  { type: "32nd", quarters: 0.125 },
];

const STEPS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const ALTER: Record<string, number> = { "C#": 1, "D#": 1, "F#": 1, "G#": 1, "A#": 1 };

function pitchParts(midi: number) {
  const name = STEPS[((midi % 12) + 12) % 12];
  return {
    step: name[0],
    alter: ALTER[name] ?? 0,
    octave: Math.floor(midi / 12) - 1,
  };
}

/** Descompone una duración en valores notables (con puntillos) que sumen exacto. */
function decompose(div: number, quarterDiv: number, grid: number): Value[] {
  const candidates: Value[] = [];
  for (const b of BASE) {
    for (const dots of [0, 1, 2]) {
      const factor = dots === 0 ? 1 : dots === 1 ? 1.5 : 1.75;
      const value = b.quarters * factor * quarterDiv;
      if (value >= grid - 1e-6 && value <= 4 * quarterDiv + 1e-6) {
        candidates.push({ div: value, type: b.type, dots });
      }
    }
  }
  candidates.sort((a, b) => b.div - a.div);

  const out: Value[] = [];
  let remaining = div;
  const eps = grid / 4;
  let guard = 0;
  while (remaining > eps && guard++ < 64) {
    const pick = candidates.find((c) => c.div <= remaining + eps);
    if (!pick) {
      out.push({ div: grid, type: "32nd", dots: 0 });
      remaining -= grid;
      continue;
    }
    out.push(pick);
    remaining -= pick.div;
  }
  if (out.length === 0) out.push({ div: grid, type: "32nd", dots: 0 });
  return out;
}

function typeXml(v: Value) {
  return `<type>${v.type}</type>${"<dot/>".repeat(v.dots)}`;
}

/** Reparte grupos no solapados en como mucho `max` voces. */
function assignVoices(groups: Group[], max = 4): Group[][] {
  const voices: Group[][] = [];
  const ends: number[] = [];
  for (const g of groups) {
    let placed = false;
    for (let v = 0; v < voices.length; v++) {
      if (ends[v] <= g.start + 1e-6) {
        voices[v].push(g);
        ends[v] = g.start + g.dur;
        placed = true;
        break;
      }
    }
    if (!placed) {
      if (voices.length < max) {
        voices.push([g]);
        ends.push(g.start + g.dur);
      } else {
        voices[max - 1].push(g);
        ends[max - 1] = Math.max(ends[max - 1], g.start + g.dur);
      }
    }
  }
  return voices;
}

/**
 * Trocea los grupos de una voz en valores por compás. Los grupos que cruzan
 * la barra se parten aquí en lugar de descartarse: si no, la nota se
 * convertiría en un silencio y el resultado sonaría distinto.
 *
 * Cada tramo puede además descomponerse en varios valores (una blanca ligada
 * a una corchea, por ejemplo), y esos valores quedan contiguos, que es
 * justo la condición que luego usamos para decidir las ligaduras.
 */
function placeVoice(
  groups: Group[],
  measureDiv: number,
  quarterDiv: number,
  grid: number,
): Placed[] {
  const out: Placed[] = [];

  for (const g of groups) {
    // 1. Partimos la nota en tramos, uno por compás que atraviesa.
    const segments: { measure: number; offset: number; div: number }[] = [];
    let cursor = g.start;
    const end = g.start + g.dur;
    while (cursor < end - 1e-6) {
      const measure = Math.floor(cursor / measureDiv);
      const measureEnd = (measure + 1) * measureDiv;
      const cut = Math.min(end, measureEnd);
      segments.push({
        measure,
        offset: cursor - measure * measureDiv,
        div: cut - cursor,
      });
      cursor = cut;
    }

    // 2. Cada tramo se descompone en valores notables (blanca + corchea…).
    const chain: Placed[] = [];
    for (const segment of segments) {
      let offset = segment.offset;
      for (const v of decompose(segment.div, quarterDiv, grid)) {
        chain.push({
          ...v,
          measure: segment.measure,
          offset,
          pitches: g.pitches,
          tieStart: false,
          tieStop: false,
        });
        offset += v.div;
      }
    }

    // 3. Los valores de ESTA nota se encadenan entre sí, incluido el salto de
    //    compás. Todo lo que va antes o después es otra nota y no se liga.
    chain.forEach((placed, index) => {
      placed.tieStart = index < chain.length - 1;
      placed.tieStop = index > 0;
    });

    out.push(...chain);
  }

  return out.sort((a, b) => a.measure - b.measure || a.offset - b.offset);
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Emite una nota o un acorde.
 *
 * En MusicXML un acorde NO es un `<note>` con varias alturas: son VARIOS
 * `<note>` seguidos, y del segundo en adelante llevan `<chord/>` antes de la
 * altura. Meter cuatro `<pitch>` en el mismo `<note>` es inválido y el lector
 * se queda sólo con el primero, así que el acorde se perdería en silencio.
 *
 * El orden de los hijos también importa (lo fija el DTD):
 *   chord, pitch, duration, tie, voice, type, dot, staff, notations.
 * De ahí que `<duration>` vaya antes que `<tie>`.
 */
function xmlNote(opts: {
  pitches: number[];
  value: Value;
  voice: number;
  staff: number;
  tieStart: boolean;
  tieStop: boolean;
}): string {
  const { pitches, value, voice, staff, tieStart, tieStop } = opts;

  return pitches
    .map((pitch, index) => {
      const { step, alter, octave } = pitchParts(pitch);
      const lines: string[] = [];
      if (index > 0) lines.push("        <chord/>");
      lines.push(
        `        <pitch><step>${step}</step>${
          alter ? `<alter>${alter}</alter>` : ""
        }<octave>${octave}</octave></pitch>`,
      );
      lines.push(`        <duration>${value.div}</duration>`);
      if (tieStart) lines.push('        <tie type="start"/>');
      if (tieStop) lines.push('        <tie type="stop"/>');
      lines.push(`        <voice>${voice}</voice>`);
      lines.push(`        ${typeXml(value)}`);
      lines.push(`        <staff>${staff}</staff>`);
      if (tieStart || tieStop) {
        lines.push(
          `        <notations>${
            tieStop ? '<tied type="stop"/>' : ""
          }${tieStart ? '<tied type="start"/>' : ""}</notations>`,
        );
      }
      return `      <note>\n${lines.join("\n")}\n      </note>`;
    })
    .join("\n");
}

function xmlRest(value: Value, voice: number, staff: number): string {
  return `      <note>
        <rest/>
        <duration>${value.div}</duration>
        <voice>${voice}</voice>
        ${typeXml(value)}
        <staff>${staff}</staff>
      </note>`;
}

export interface MidiConversion {
  xml: string;
  title: string;
  warnings: string[];
}

export function midiToMusicXml(
  data: ArrayBuffer,
  fallbackTitle: string,
): MidiConversion {
  const midi = new Midi(data);
  const warnings: string[] = [];
  const ppq = midi.header.ppq || 480;

  const grid = Math.max(1, Math.round(ppq / 4)); // semicorchea
  const quarterDiv = grid * 4;
  const divisions = quarterDiv;

  const raw: RawNote[] = [];
  let skipped = 0;
  for (const track of midi.tracks) {
    if (track.channel === 9) {
      skipped++;
      continue;
    }
    for (const n of track.notes) {
      raw.push({
        start: n.ticks,
        dur: Math.max(grid, n.durationTicks),
        midi: n.midi,
      });
    }
  }
  if (skipped > 0) {
    warnings.push(`Se descartaron ${skipped} pista(s) de percusión (canal 10).`);
  }
  if (raw.length === 0) {
    throw new Error("El archivo MIDI no contiene notas que se puedan transcribir.");
  }

  const quantized: RawNote[] = raw.map((n) => ({
    start: Math.round(n.start / grid) * grid,
    dur: Math.max(grid, Math.round(n.dur / grid) * grid),
    midi: n.midi,
  }));

  const timeSig = midi.header.timeSignatures?.[0]?.timeSignature;
  const beats = timeSig?.[0] ?? 4;
  const beatType = timeSig?.[1] ?? 4;
  const measureDiv = Math.max(grid, Math.round(beats * divisions * (4 / beatType)));

  const endTick = quantized.reduce((m, n) => Math.max(m, n.start + n.dur), 0);
  const measureCount = Math.max(1, Math.ceil(endTick / measureDiv));

  // Agrupar por (inicio, duración) convierte los acordes en un solo evento.
  const groupMap = new Map<string, Group>();
  for (const n of quantized) {
    const key = `${n.start}:${n.dur}`;
    const existing = groupMap.get(key);
    if (existing) {
      if (!existing.pitches.includes(n.midi)) existing.pitches.push(n.midi);
    } else {
      groupMap.set(key, { start: n.start, dur: n.dur, pitches: [n.midi] });
    }
  }
  const groups = [...groupMap.values()].sort((a, b) => a.start - b.start);
  groups.forEach((g) => g.pitches.sort((a, b) => a - b));

  const minPitch = Math.min(...quantized.map((n) => n.midi));
  const maxPitch = Math.max(...quantized.map((n) => n.midi));
  const twoStaves = minPitch < 55 && maxPitch > 64;
  if (twoStaves) {
    warnings.push(
      "El registro cruza el Do central: repartido en dos pentagramas.",
    );
  }

  const average = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
  const staves: Group[][] = twoStaves
    ? [
        groups.filter((g) => average(g.pitches) >= 60),
        groups.filter((g) => average(g.pitches) < 60),
      ]
    : [groups];

  // Por cada pentagrama: voces, y cada voz troceada por compás.
  const staffVoices: Placed[][][] = staves.map((staffGroups) =>
    assignVoices(staffGroups).map((voice) =>
      placeVoice(voice, measureDiv, quarterDiv, grid),
    ),
  );

  const measures: string[] = [];

  for (let m = 0; m < measureCount; m++) {
    const parts: string[] = [];

    if (m === 0) {
      parts.push(
        `      <attributes>
        <divisions>${divisions}</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time>
        <staves>${staves.length}</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>${
          staves.length > 1
            ? '\n        <clef number="2"><sign>F</sign><line>4</line></clef>'
            : ""
        }
      </attributes>`,
      );
    }

    let voiceNumber = 1;
    let needsBackup = false;

    staffVoices.forEach((voices, staffIndex) => {
      for (const voice of voices) {
        const inMeasure = voice.filter((p) => p.measure === m);
        if (needsBackup) {
          parts.push(
            `      <backup><duration>${measureDiv}</duration></backup>`,
          );
        }
        needsBackup = true;

        let cursor = 0;
        for (let i = 0; i < inMeasure.length; i++) {
          const placed = inMeasure[i];
          if (placed.offset > cursor) {
            for (const v of decompose(placed.offset - cursor, quarterDiv, grid)) {
              parts.push(xmlRest(v, voiceNumber, staffIndex + 1));
            }
          }
          parts.push(
            xmlNote({
              pitches: placed.pitches,
              value: placed,
              voice: voiceNumber,
              staff: staffIndex + 1,
              tieStart: placed.tieStart,
              tieStop: placed.tieStop,
            }),
          );
          cursor = placed.offset + placed.div;
        }

        if (cursor < measureDiv) {
          for (const v of decompose(measureDiv - cursor, quarterDiv, grid)) {
            parts.push(xmlRest(v, voiceNumber, staffIndex + 1));
          }
        }
        voiceNumber++;
      }
    });

    measures.push(
      `    <measure number="${m + 1}">\n${parts.join("\n")}\n    </measure>`,
    );
  }

  const title = midi.name?.trim() || fallbackTitle;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <work><work-title>${escapeXml(title)}</work-title></work>
  <identification>
    <encoding><software>Partitura Studio (import MIDI)</software></encoding>
  </identification>
  <part-list>
    <score-part id="P1"><part-name>${
      staves.length > 1 ? "Piano" : "Instrumento"
    }</part-name></score-part>
  </part-list>
  <part id="P1">
${measures.join("\n")}
  </part>
</score-partwise>
`;

  return { xml, title, warnings };
}
