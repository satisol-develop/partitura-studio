/**
 * Anclaje de las anotaciones a la partitura.
 *
 * El problema que resuelve: si un trazo se guarda como píxeles absolutos
 * («el punto (412, 308) del papel»), cualquier cosa que re-maquete la partitura
 * lo deja apuntando a otro sitio. Y no es un caso raro: transponer cambia los
 * alterados y con ellos el ancho de los compases, y ocultar una parte sube
 * todos los pentagramas. Con coordenadas absolutas, la tinta se despega de la
 * música.
 *
 * Así que una anotación no guarda «dónde estaba en el papel», sino «en qué
 * compás, sobre qué pentagrama, y en qué sitio de esa caja». Al pintar se
 * vuelve a calcular el píxel con la maquetación de ese momento.
 *
 * El pentagrama se identifica por **parte + ordinal**, nunca por su índice
 * global. Esto no es un detalle: al ocultar una parte, OSMD renumera los
 * pentagramas que quedan, y con el índice global la digitación de un saxo
 * aparecía de pronto sobre el piano. Con la parte, la anotación sabe de quién
 * es aunque el vecino desaparezca.
 *
 * Las coordenadas son relativas a la caja del pentagrama (o a la del compás si
 * el punto cae fuera de todos, que es lo normal: una digitación va por encima
 * del pentagrama). Por eso pueden valer menos que 0 o más que 1.
 */

import type { MeasureBox, ScoreExtent, StaffBox } from "./geometry";
import type { Anchor, Pin, Pt, Stroke } from "./types";

// El ancla vive en el modelo de datos (`types.ts`), que no depende de nadie.
// Aquí se reexporta para que quien resuelva posiciones tenga una sola puerta.
export type { Anchor };

/** Caja de referencia ya identificada: un pentagrama de un compás, o el compás. */
interface RefBox {
  measureIndex: number;
  /** Parte a la que pertenece, o null si es la caja del compás entero. */
  partId: string | null;
  /** Ordinal del pentagrama dentro de su parte. */
  ordinal: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

const EMPTY = 0;

/** Margen para considerar que un punto cae «en» una caja. */
const SLACK = 0;
/** A qué distancia vertical máxima un pentagrama sigue siendo «el más cercano». */
const NEAR_STAFF = 96;

function inside(box: { x: number; y: number; width: number; height: number }, x: number, y: number): boolean {
  return (
    x >= box.x - SLACK &&
    x <= box.x + box.width + SLACK &&
    y >= box.y - SLACK &&
    y <= box.y + box.height + SLACK
  );
}

/** Distancia vertical al borde más próximo de la caja (0 si está dentro). */
function verticalGap(box: { y: number; height: number }, y: number): number {
  if (y < box.y) return box.y - y;
  if (y > box.y + box.height) return y - (box.y + box.height);
  return 0;
}

/** Índice global del pentagrama de una parte, o null si esa parte no lo tiene. */
function staffIndexOf(extent: ScoreExtent, partId: string | null, ordinal: number): number | null {
  if (partId == null) return null;
  const part = extent.parts.find((p) => p.id === partId);
  const index = part?.staffIndices[ordinal];
  return typeof index === "number" ? index : null;
}

function measureRefOf(extent: ScoreExtent, box: MeasureBox): RefBox {
  return {
    measureIndex: box.measureIndex,
    partId: null,
    ordinal: 0,
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
  };
}

function staffRefOf(extent: ScoreExtent, box: StaffBox): RefBox {
  const part = extent.parts.find((p) => p.id === box.partId);
  const ordinal = part ? part.staffIndices.indexOf(box.staffIndex) : -1;
  return {
    measureIndex: box.measureIndex,
    partId: box.partId,
    // Un pentagrama sin parte conocida se ancla al compás: es lo único honesto
    // que se puede decir de él.
    ordinal: ordinal >= 0 ? ordinal : 0,
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
  };
}

/**
 * Compás de referencia de un punto.
 *
 * Es más tolerante que `measureAt` a propósito: aquél devuelve `null` cuando el
 * punto cae a más de 48 px de todo, y aquí eso no vale, porque una anotación
 * escrita en el margen también tiene que seguir a la música. Si el punto no cae
 * en ningún compás, se ancla al que le cae más cerca.
 */
function measureRef(extent: ScoreExtent, x: number, y: number): MeasureBox | null {
  const boxes = extent.boxes;
  if (boxes.length === 0) return null;

  for (const box of boxes) if (inside(box, x, y)) return box;

  // Fuera por poco en vertical (el hueco entre dos sistemas): el más cercano.
  let best: MeasureBox | null = null;
  let bestGap = 48;
  for (const box of boxes) {
    if (x < box.x || x > box.x + box.width) continue;
    const gap = verticalGap(box, y);
    if (gap < bestGap) {
      bestGap = gap;
      best = box;
    }
  }
  if (best) return best;

  // Fuera de todo: el más cercano en horizontal, pesando menos la vertical para
  // no arrastrar siempre al primer compás de la línea.
  let closest: MeasureBox | null = null;
  let closestDistance = Infinity;
  for (const box of boxes) {
    const dx = x < box.x ? box.x - x : x > box.x + box.width ? x - (box.x + box.width) : 0;
    const distance = dx + verticalGap(box, y) * 0.25;
    if (distance < closestDistance) {
      closestDistance = distance;
      closest = box;
    }
  }
  return closest;
}

/** Pentagramas de un compás, en orden. */
function stavesOf(extent: ScoreExtent, measureIndex: number): StaffBox[] {
  return extent.staffBoxes
    .filter((box) => box.measureIndex === measureIndex)
    .sort((a, b) => a.staffIndex - b.staffIndex);
}

/** Caja más próxima en vertical, si está lo bastante cerca. */
function nearestStaff(staves: StaffBox[], y: number): StaffBox | null {
  let best: StaffBox | null = null;
  let bestGap = Infinity;
  for (const staff of staves) {
    const gap = verticalGap(staff, y);
    if (gap < bestGap) {
      bestGap = gap;
      best = staff;
    }
  }
  return best && bestGap <= NEAR_STAFF ? best : null;
}

/**
 * Caja de referencia de un punto: primero su pentagrama, y si no cae en
 * ninguno, el compás entero. Preferir el pentagrama es lo que hace que una
 * digitación siga a SU instrumento cuando se oculta otro.
 */
function refBoxOf(extent: ScoreExtent, x: number, y: number): RefBox | null {
  const measure = measureRef(extent, x, y);
  if (!measure) return null;
  const staves = stavesOf(extent, measure.measureIndex);
  for (const staff of staves) if (inside(staff, x, y)) return staffRefOf(extent, staff);
  const near = nearestStaff(staves, y);
  return near ? staffRefOf(extent, near) : measureRefOf(extent, measure);
}

/** Caja donde volver a colocar un ancla, con las mismas reglas que al crearla. */
function boxFor(extent: ScoreExtent, anchor: Anchor): RefBox | null {
  const measure =
    extent.boxes.find((box) => box.measureIndex === anchor.m) ?? measureRef(extent, EMPTY, EMPTY);
  if (!measure) return null;

  const staffIndex = staffIndexOf(extent, anchor.p, anchor.o);
  if (staffIndex != null) {
    const box = extent.staffBoxes.find(
      (candidate) =>
        candidate.measureIndex === measure.measureIndex && candidate.staffIndex === staffIndex,
    );
    if (box) return staffRefOf(extent, box);
  }
  // La parte anclada no está en esta maquetación (por ejemplo, oculta): la
  // anotación no se pierde, cae sobre el compás. La altura es aproximada, y por
  // eso sólo importa cuando la parte oculta es la tuya, que es cuando la
  // anotación tampoco se está mirando.
  return measureRefOf(extent, measure);
}

/** Ancla un punto del papel. `null` sólo si la partitura aún no está medida. */
export function anchorOf(extent: ScoreExtent, x: number, y: number): Anchor | null {
  const box = refBoxOf(extent, x, y);
  if (!box) return null;
  return {
    m: box.measureIndex,
    p: box.partId,
    o: box.ordinal,
    u: box.width > 0 ? (x - box.x) / box.width : 0,
    v: box.height > 0 ? (y - box.y) / box.height : 0,
  };
}

/** Píxel de partitura donde vuelve a caer un ancla con la maquetación actual. */
export function pointOf(extent: ScoreExtent, anchor: Anchor): { x: number; y: number } | null {
  const box = boxFor(extent, anchor);
  if (!box) return null;
  return { x: box.x + anchor.u * box.width, y: box.y + anchor.v * box.height };
}

/** Ancla todos los puntos de un trazo. */
export function anchorPoints(
  points: { x: number; y: number }[],
  extent: ScoreExtent,
): Anchor[] | null {
  const anchors: Anchor[] = [];
  for (const point of points) {
    const anchor = anchorOf(extent, point.x, point.y);
    if (!anchor) return null;
    anchors.push(anchor);
  }
  return anchors.length > 0 ? anchors : null;
}

/**
 * Puntos de un trazo, ya resueltos con la maquetación actual.
 *
 * Es la única puerta de entrada: quien dibuja, quien borra y quien busca un
 * trazo bajo el puntero tienen que ver lo mismo, y lo ven porque todos pasan
 * por aquí. Un trazo sin ancla (documento antiguo) devuelve sus puntos tal cual.
 */
export function strokePoints(stroke: Stroke, extent: ScoreExtent): Pt[] {
  const anchors = stroke.anchors;
  if (!anchors || anchors.length === 0 || extent.boxes.length === 0) return stroke.points;
  const resolved: Pt[] = [];
  for (let i = 0; i < anchors.length; i++) {
    const point = pointOf(extent, anchors[i]);
    // Sin poder resolver no se inventa una posición: mejor lo guardado.
    if (!point) return stroke.points;
    resolved.push({ x: point.x, y: point.y, p: stroke.points[i]?.p ?? 0.5 });
  }
  return resolved;
}

/** Posición de un comentario, resuelta con la maquetación actual. */
export function pinPoint(pin: Pin, extent: ScoreExtent): { x: number; y: number } {
  if (pin.anchor && extent.boxes.length > 0) {
    const point = pointOf(extent, pin.anchor);
    if (point) return point;
  }
  return { x: pin.x, y: pin.y };
}

/**
 * Ancla que le falta a una anotación.
 *
 * Se usa para dos cosas: al crear (para no volver a guardar coordenadas
 * absolutas como si fueran la verdad) y al cargar un documento antiguo, donde
 * se calcula con la maquetación actual. Ese cálculo es fiel porque el ancho del
 * papel no cambia entre sesiones: es una constante de la aplicación, y
 * `meta.layoutWidth` sólo manda si un documento trae el suyo.
 */
export function anchorsFor(stroke: Stroke, extent: ScoreExtent): Anchor[] | null {
  if (stroke.anchors && stroke.anchors.length > 0) return stroke.anchors;
  return anchorPoints(stroke.points, extent);
}

export function anchorForPin(pin: Pin, extent: ScoreExtent): Anchor | null {
  if (pin.anchor) return pin.anchor;
  return anchorOf(extent, pin.x, pin.y);
}

/**
 * ¿Hace falta anclar? Se pregunta antes de recorrer todas las capas, para no
 * reescribir el documento (y despertar a quien lo observa) cuando no cambia nada.
 */
export function needsAnchoring(strokes: Stroke[], pins: Pin[]): boolean {
  return strokes.some((s) => !s.anchors || s.anchors.length === 0) || pins.some((p) => !p.anchor);
}

/* ------------------------------------------------------------------ */
/* De quién es cada anotación                                          */
/* ------------------------------------------------------------------ */

/**
 * A qué partes pertenece una anotación, según dónde está anclada.
 *
 * Sale del ancla y no de un campo aparte: la posición ya dice en qué
 * pentagrama se escribió, así que guardar además «esto es del saxo» sería
 * guardar dos veces lo mismo y poder contradecirse.
 */
export function strokePartIds(stroke: Stroke): string[] {
  const parts = new Set<string>();
  for (const anchor of stroke.anchors ?? []) if (anchor.p) parts.add(anchor.p);
  return [...parts];
}

/**
 * ¿Se enseña este trazo cuando la vista está centrada en una parte?
 *
 * Basta con que TOQUE la parte: un trazo que cruza del saxo al piano es de los
 * dos, y esconderlo en la vista del saxo sería perder trabajo que sí escribiste
 * ahí. Lo que no se puede atribuir a nadie (un trazo en el margen, o un
 * documento que aún no se ha anclado) tampoco se esconde: no se borra de la
 * vista lo que no se sabe de quién es.
 */
export function strokeBelongsToPart(stroke: Stroke, partId: string): boolean {
  if (!stroke.anchors || stroke.anchors.length === 0) return true;
  const parts = strokePartIds(stroke);
  return parts.length === 0 || parts.includes(partId);
}

/** Lo mismo para un comentario. */
export function pinBelongsToPart(pin: Pin, partId: string): boolean {
  const owner = pin.anchor?.p;
  return !owner || owner === partId;
}
