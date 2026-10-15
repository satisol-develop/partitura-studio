/**
 * Geometría: traduce las coordenadas internas de OpenSheetMusicDisplay
 * al "espacio de partitura" que usamos para TODAS las anotaciones.
 *
 * Reglas del sistema de coordenadas (importante, no cambiar a la ligera):
 *
 *  - OSMD trabaja en unidades donde 1 unidad = distancia entre líneas
 *    consecutivas del pentagrama, y 1 píxel de VexFlow = 0.1 unidades.
 *    Por eso `UnitToPixelFactor` vale 10.
 *  - Nosotros guardamos las anotaciones en PÍXELES CON ZOOM 1.
 *  - El zoom NO se aplica recalculando coordenadas: se aplica con un
 *    transform CSS `scale()` sobre un contenedor que envuelve a la vez
 *    la partitura y el lienzo de anotaciones. Así es imposible que se
 *    desalineen, y el zoom es instantáneo (no hay re-layout de la partitura).
 */

import type { PartInfo } from "./types";
import { readingFromPlaybackOffset, shiftsFor } from "./transpose";

export const DEFAULT_UNIT_TO_PIXEL = 10;

/** Un compás agregado: la caja que cubre todos los pentagramas de ese compás. */
export interface MeasureBox {
  measureIndex: number;
  measureNumber: string;
  /** Espacio de partitura (px, zoom 1). */
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Caja de un pentagrama concreto. Hace falta en cuanto la partitura tiene
 * varias partes: en una plantilla de saxo + piano + bajo, la caja agregada del
 * compás cubre los tres sistemas, y una anotación "aquí entra el saxo" debe
 * poder dibujarse sobre la línea del saxo, no sobre todo.
 */
export interface StaffBox {
  measureIndex: number;
  /** Índice global de pentagrama, el segundo eje de `MeasureList`. */
  staffIndex: number;
  partId: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScoreExtent {
  boxes: MeasureBox[];
  staffBoxes: StaffBox[];
  parts: PartInfo[];
  /** Tamaño total del contenido dibujado, en px de partitura. */
  width: number;
  height: number;
}

/**
 * Extensión de una partitura que todavía no se ha medido: aún no hay dibujado
 * del que sacar cajas. Se comparte la misma instancia para poder compararla por
 * identidad, que es como el lienzo sabe si ya tiene música medida.
 */
export const EMPTY_EXTENT: ScoreExtent = {
  boxes: [],
  staffBoxes: [],
  parts: [],
  width: 0,
  height: 0,
};

interface RawInstrument {
  Id?: string;
  IdString?: string;
  Name?: string;
  NameLabel?: { text?: string } | string;
  Abbreviation?: string;
  AbbreviationLabel?: { text?: string } | string;
  Staves?: unknown[];
  Visible?: boolean;
  Transpose?: number;
  PlaybackTranspose?: number;
}

interface RawSheet {
  Parts?: RawInstrument[];
  Instruments?: RawInstrument[];
  Transpose?: number;
}

interface RawBox {
  AbsolutePosition?: { x?: number; y?: number };
  Size?: { width?: number; height?: number };
  BorderLeft?: number;
  BorderRight?: number;
  BorderTop?: number;
  BorderBottom?: number;
}

interface RawMeasure {
  PositionAndShape?: RawBox;
  MeasureNumber?: string | number;
  parentSourceMeasure?: {
    measureListIndex?: number;
    MeasureNumber?: string | number;
  } | null;
}

interface RawGraphicSheet {
  MeasureList?: (RawMeasure | undefined)[][];
}

interface OSMDOwner {
  GraphicSheet?: RawGraphicSheet;
  EngravingRules?: { UnitToPixelFactor?: number };
  Sheet?: RawSheet;
}

function labelOf(value: { text?: string } | string | undefined): string {
  if (!value) return "";
  return typeof value === "string" ? value : (value.text ?? "");
}

/**
 * Lista de partes y a qué pentagramas globales corresponde cada una.
 *
 * El segundo índice de `MeasureList` es el pentagrama global, numerado parte
 * a parte en orden de plantilla; por eso reconstruimos ese orden contando los
 * pentagramas de cada instrumento en vez de leerlo de la parte gráfica.
 */
function readParts(owner: OSMDOwner): PartInfo[] {
  const instruments = owner.Sheet?.Parts ?? owner.Sheet?.Instruments ?? [];
  let flatStaff = 0;
  return instruments.map((instrument, index) => {
    const staveCount = Math.max(1, instrument.Staves?.length ?? 1);
    const staffIndices: number[] = [];
    for (let i = 0; i < staveCount; i++) staffIndices.push(flatStaff++);
    const name =
      instrument.Name || labelOf(instrument.NameLabel) || `Parte ${index + 1}`;
    return {
      id: instrument.IdString || instrument.Id || `part-${index}`,
      name,
      abbreviation: instrument.Abbreviation || labelOf(instrument.AbbreviationLabel),
      staffIndices,
    };
  });
}

function boxOf(ps: RawBox | undefined, f: number) {
  if (!ps) return null;
  const x = (ps.AbsolutePosition?.x ?? 0) * f;
  const y = (ps.AbsolutePosition?.y ?? 0) * f;
  let w = (ps.Size?.width ?? 0) * f;
  let h = (ps.Size?.height ?? 0) * f;
  // `Size` puede venir a 0 en algunos compases: los bordes son la verdad.
  if (!w && ps.BorderRight != null && ps.BorderLeft != null) {
    w = (ps.BorderRight - ps.BorderLeft) * f;
  }
  if (!h && ps.BorderBottom != null && ps.BorderTop != null) {
    h = (ps.BorderBottom - ps.BorderTop) * f;
  }
  if (!(w > 0) || !(h > 0)) return null;
  return { x, y, width: w, height: h };
}

/**
 * Lee la extensión completa de la partitura dibujada.
 * Se llama SIEMPRE después de `osmd.render()`.
 */
export function readScoreExtent(osmd: unknown): ScoreExtent {
  const owner = osmd as OSMDOwner;
  const factor = owner.EngravingRules?.UnitToPixelFactor ?? DEFAULT_UNIT_TO_PIXEL;
  const list = owner.GraphicSheet?.MeasureList ?? [];

  const parts = readParts(owner);
  const partOfStaff = new Map<number, string>();
  for (const part of parts) {
    for (const staffIndex of part.staffIndices) partOfStaff.set(staffIndex, part.id);
  }

  const byMeasure = new Map<number, MeasureBox>();
  const staffBoxes: StaffBox[] = [];
  let maxX = 0;
  let maxY = 0;

  for (let mi = 0; mi < list.length; mi++) {
    const staves = list[mi];
    if (!staves) continue;
    let minX = Infinity;
    let minY = Infinity;
    let maxR = 0;
    let maxB = 0;
    let number: string | null = null;

    for (let si = 0; si < staves.length; si++) {
      const b = boxOf(staves[si]?.PositionAndShape, factor);
      if (!b) continue;
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxR = Math.max(maxR, b.x + b.width);
      maxB = Math.max(maxB, b.y + b.height);
      staffBoxes.push({
        measureIndex: mi,
        staffIndex: si,
        partId: partOfStaff.get(si) ?? null,
        ...b,
      });
      const raw =
        staves[si]?.parentSourceMeasure?.MeasureNumber ?? staves[si]?.MeasureNumber;
      if (raw != null && number == null) number = String(raw);
    }

    if (minX === Infinity) continue;
    const box: MeasureBox = {
      measureIndex: mi,
      measureNumber: number ?? String(mi + 1),
      x: minX,
      y: minY,
      width: maxR - minX,
      height: maxB - minY,
    };
    byMeasure.set(mi, box);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }

  const boxes = [...byMeasure.values()].sort(
    (a, b) => a.measureIndex - b.measureIndex,
  );

  return { boxes, staffBoxes, parts, width: maxX, height: maxY };
}

/**
 * Deja dibujada una sola parte, o todas si `partId` es null.
 *
 * Lo importante es lo que NO hace: no recorta el papel. OSMD reserva el espacio
 * de los pentagramas ocultos (comprobado: siguen en `MeasureList`, con sus
 * mismas coordenadas), así que la partitura no se re-maqueta y las anotaciones
 * se quedan exactamente donde estaban. Si algún día una versión de OSMD sí
 * recortara, el anclaje por compases ya está para que la tinta siga a su parte.
 *
 * Hay que llamarlo DESPUÉS de `load()` y ANTES de `render()`.
 */
export function setFocusedPart(osmd: unknown, partId: string | null): void {
  const owner = osmd as OSMDOwner;
  const instruments = owner.Sheet?.Parts ?? owner.Sheet?.Instruments ?? [];
  for (const instrument of instruments) {
    const id = instrument.IdString ?? instrument.Id ?? "";
    instrument.Visible = partId == null || id === partId;
  }
}

/**
 * Lo que el archivo declara de cada parte, en nuestra convención (semitonos que
 * se suman a lo que suena para escribir lo que se lee).
 *
 * Un archivo de banda ya dice que el saxo lee en Mi♭; adoptarlo es lo que hace
 * que se abra tal y como se escribió. Ver `lib/transpose.ts`.
 */
export function declaredReadings(osmd: unknown): Record<string, number> {
  const owner = osmd as OSMDOwner;
  const instruments = owner.Sheet?.Parts ?? owner.Sheet?.Instruments ?? [];
  const readings: Record<string, number> = {};
  for (const instrument of instruments) {
    const id = instrument.IdString ?? instrument.Id ?? "";
    if (!id) continue;
    readings[id] = readingFromPlaybackOffset(instrument.PlaybackTranspose ?? 0);
  }
  return readings;
}

/**
 * Aplica el transporte de la obra y el de cada instrumento.
 *
 * Son dos cosas distintas y por eso se aplican en sitios distintos:
 *
 *  - `Sheet.Transpose` mueve la obra entera. Eso es música: se lee y se oye en
 *    otro tono.
 *  - `Instrument.Transpose` es lo que lee un instrumento concreto. Eso es una
 *    forma de escribir, no un cambio musical, así que **no puede** tocar el
 *    sonido. Y no lo toca: OSMD no modifica las alturas de origen, sólo añade
 *    este desplazamiento al dibujo (`GraphicalMeasure.getTransposedHalftones()`
 *    = `Sheet.Transpose` + `Instrument.Transpose`), y la reproducción lee las
 *    alturas de origen. O sea que la invariante sale del propio reparto de
 *    responsabilidades, no de compensar un desplazamiento con otro.
 *
 * `Instrument.Transpose` se mide **sobre las notas del archivo**, no sobre lo
 * que suenan: en una parte que el archivo ya escribió en Mi♭ hay que restar lo
 * que declara, o al elegir «lee en Mi♭» la parte subiría una sexta en pantalla
 * sin que nadie lo hubiera pedido.
 *
 * Se llama DESPUÉS de `load()` y ANTES de `render()`. Necesita que el
 * renderizador tenga puesta una `TransposeCalculator`: sin ella `Transpose` se
 * guarda y no hace nada, que es la trampa clásica de esta API.
 */
export function applyTransposition(
  osmd: unknown,
  base: number,
  readings: Record<string, number> | undefined,
): void {
  const owner = osmd as OSMDOwner;
  const instruments = owner.Sheet?.Parts ?? owner.Sheet?.Instruments ?? [];
  for (const instrument of instruments) {
    const id = instrument.IdString ?? instrument.Id ?? "";
    const reading = readings?.[id] ?? 0;
    const declared = readingFromPlaybackOffset(instrument.PlaybackTranspose ?? 0);
    // `part` y no el total: la obra la suma OSMD por su cuenta, con `Sheet.Transpose`.
    instrument.Transpose = shiftsFor(base, reading, declared).part;
  }
  // La obra, al final: al asignarla se recalcula todo el transporte y tiene que
  // ver ya lo de cada instrumento.
  if (owner.Sheet) owner.Sheet.Transpose = base;
}

/**
 * Caja del tramo [from, to] para una parte concreta (o para toda la plantilla
 * si `partId` es null), agrupada por sistema.
 *
 * Se agrupa por sistema porque un tramo de compases que cruza un salto de
 * sistema no se puede dibujar con un solo rectángulo: hay que pintar un tramo
 * por cada línea de la partitura, y los saltos de sistema son justo lo que
 * más abunda en una parte con pocos compases por línea.
 */
export function spanBands(
  extent: Pick<ScoreExtent, "boxes" | "staffBoxes" | "parts">,
  from: number,
  to: number,
  partId: string | null,
): { x: number; y: number; width: number; height: number }[] {
  const parts = extent.parts;
  const allowed = partId
    ? new Set(parts.find((p) => p.id === partId)?.staffIndices ?? [])
    : null;

  const rows = new Map<number, { x: number; right: number; y: number; bottom: number }>();

  for (let mi = from; mi <= to; mi++) {
    const aggregate = extent.boxes.find((b) => b.measureIndex === mi);
    const staff = extent.staffBoxes.filter(
      (b) => b.measureIndex === mi && (!allowed || allowed.has(b.staffIndex)),
    );
    if (staff.length === 0) {
      // Si se pidió una parte concreta y no tiene pentagramas aquí (por ejemplo
      // una anotación que apunta a una parte que ya no existe en la partitura
      // cargada), no se pinta nada: pintar la caja agregada sería mentir sobre
      // a quién va dirigida la anotación.
      if (allowed) continue;
      if (!aggregate) continue;
      const key = Math.round(aggregate.y);
      const row = rows.get(key) ?? {
        x: aggregate.x,
        right: aggregate.x + aggregate.width,
        y: aggregate.y,
        bottom: aggregate.y + aggregate.height,
      };
      row.x = Math.min(row.x, aggregate.x);
      row.right = Math.max(row.right, aggregate.x + aggregate.width);
      row.bottom = Math.max(row.bottom, aggregate.y + aggregate.height);
      rows.set(key, row);
      continue;
    }
    for (const b of staff) {
      const key = Math.round(b.y);
      const row = rows.get(key) ?? { x: b.x, right: b.x + b.width, y: b.y, bottom: b.y + b.height };
      row.x = Math.min(row.x, b.x);
      row.right = Math.max(row.right, b.x + b.width);
      row.bottom = Math.max(row.bottom, b.y + b.height);
      rows.set(key, row);
    }
  }

  return [...rows.values()].map((row) => ({
    x: row.x,
    y: row.y,
    width: row.right - row.x,
    height: row.bottom - row.y,
  }));
}

/** Compás que contiene un punto, con un pequeño margen para acertar entre pentagramas. */
export function measureAt(
  boxes: MeasureBox[],
  x: number,
  y: number,
): MeasureBox | null {
  for (const b of boxes) {
    if (
      x >= b.x &&
      x <= b.x + b.width &&
      y >= b.y &&
      y <= b.y + b.height
    ) {
      return b;
    }
  }
  // Fuera por poco (entre sistema y sistema): cogemos el más cercano en vertical.
  let best: MeasureBox | null = null;
  let bestDist = 48;
  for (const b of boxes) {
    if (x < b.x || x > b.x + b.width) continue;
    const dy =
      y < b.y ? b.y - y : y > b.y + b.height ? y - (b.y + b.height) : 0;
    if (dy < bestDist) {
      bestDist = dy;
      best = b;
    }
  }
  return best;
}

/** Convierte coordenadas de pantalla a espacio de partitura. */
export function clientToScore(
  overlayRect: DOMRect,
  zoom: number,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  return {
    x: (clientX - overlayRect.left) / zoom,
    y: (clientY - overlayRect.top) / zoom,
  };
}

/** Distancia de un punto a un segmento (para la goma de borrar). */
export function distToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/** Puntos de control para curvas Catmull-Rom → Bézier (trazado suave). */
export function smoothPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) {
    const p = points[0];
    return `M ${p.x} ${p.y} l 0.01 0.01`;
  }
  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  }
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

/**
 * Contorno relleno de un trazo con grosor variable según presión.
 * Devolvemos un polígono cerrado (izquierda + derecha invertida) para
 * dibujarlo con `fill`, en lugar de `stroke`: así la presión del lápiz
 * se traduce en grosor real y el trazo escala perfecto con el zoom.
 */
export function pressureOutline(
  points: { x: number; y: number; p: number }[],
  baseWidth: number,
): string {
  if (points.length === 0) return "";
  if (points.length === 1) {
    const p = points[0];
    const r = (baseWidth * widthFor(p.p)) / 2;
    return `M ${p.x - r} ${p.y} a ${r} ${r} 0 1 0 ${r * 2} 0 a ${r} ${r} 0 1 0 ${-r * 2} 0 Z`;
  }

  const left: string[] = [];
  const right: string[] = [];

  for (let i = 0; i < points.length; i++) {
    const prev = points[i - 1] ?? points[i];
    const next = points[i + 1] ?? points[i];
    let dx = next.x - prev.x;
    let dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const half = (baseWidth * widthFor(points[i].p)) / 2;
    left.push(`${points[i].x - dy * half} ${points[i].y + dx * half}`);
    right.push(`${points[i].x + dy * half} ${points[i].y - dx * half}`);
  }

  const head = points[0];
  const tail = points[points.length - 1];
  const r0 = (baseWidth * widthFor(head.p)) / 2;
  const r1 = (baseWidth * widthFor(tail.p)) / 2;

  // Punta redondeada en el inicio, trazada como arco.
  const first = points[1];
  const last = points[points.length - 2];
  const a0 = Math.atan2(first.y - head.y, first.x - head.x) + Math.PI / 2;
  const a1 = Math.atan2(last.y - tail.y, last.x - tail.x) + Math.PI / 2;

  return [
    `M ${head.x + Math.cos(a0) * r0} ${head.y + Math.sin(a0) * r0}`,
    `L ${left.join(" L ")}`,
    `A ${r1} ${r1} 0 0 1 ${tail.x + Math.cos(a1) * r1} ${tail.y + Math.sin(a1) * r1}`,
    `L ${[...right].reverse().join(" L ")}`,
    `A ${r0} ${r0} 0 0 1 ${head.x + Math.cos(a0) * r0} ${head.y + Math.sin(a0) * r0}`,
    "Z",
  ].join(" ");
}

/**
 * Factor de grosor segun presion. El raton reporta 0.5 fijo, asi que
 * anclamos ese valor en 1.0 para que el trazo de raton mida exactamente
 * lo que mide `baseWidth`, y el lapiz module por encima y por debajo.
 */
function widthFor(pressure: number): number {
  const p = Number.isFinite(pressure) ? Math.max(0, Math.min(1, pressure)) : 0.5;
  return 0.55 + 0.9 * p;
}
