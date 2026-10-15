/**
 * Modelo de datos de Partitura Studio.
 *
 * Idea central (lo que nos separa de un lector de PDF anotado):
 * una partitura no tiene "una capa de anotaciones", tiene VARIAS.
 * Cada capa agrupa tres tipos de anotación distintos y se puede
 * ocultar, bloquear, reordenar y recolorear por separado.
 *
 *   1. Trazos de tinta   (manuscrito libre sobre el pentagrama)
 *   2. Notas de compás   (datos estructurados, un registro por compás)
 *   3. Comentarios       (hilo de texto anclado a un punto del papel)
 */

/** Punto en "espacio de partitura": píxeles con zoom 1. Nunca píxeles de pantalla. */
export interface Pt {
  x: number;
  y: number;
  /** Presión del lápiz 0..1 (ratón = 0.5 fijo). */
  p: number;
}

/**
 * Ancla de una anotación: el compás sobre el que vive y su sitio dentro de la
 * caja de ese compás (o de uno de sus pentagramas).
 *
 * Sustituye a las coordenadas absolutas como fuente de verdad. Los píxeles se
 * vuelven a calcular al pintar, así que transponer la obra u ocultar una parte
 * mueve la música sin despegar la tinta. Ver `lib/anchors.ts`.
 */
export interface Anchor {
  /** `measureListIndex` del compás de referencia. */
  m: number;
  /**
   * Parte (instrumento) sobre la que vive, o null si el punto cae fuera de
   * todos los pentagramas y se ancla al compás entero.
   *
   * La parte, y no el índice de pentagrama: al ocultar un instrumento los
   * índices se renumeran, y con el índice la anotación saltaría a otro
   * pentagrama. Con la parte, sigue siendo de quien era.
   */
  p: string | null;
  /** Ordinal del pentagrama dentro de su parte (0 para un instrumento de uno). */
  o: number;
  /** Posición relativa a la caja (1 = borde derecho). Puede salirse de [0,1]. */
  u: number;
  /** Posición relativa a la caja (1 = borde inferior). Puede salirse de [0,1]. */
  v: number;
}

export type ToolId =
  | "select"
  | "pencil"
  | "highlighter"
  | "eraser"
  | "comment"
  | "measure";

export interface Stroke {
  id: string;
  /**
   * Puntos en espacio de partitura. Es la posición de la ÚLTIMA maquetación,
   * no la verdad: al pintar se recalculan desde `anchors`. Se conservan para no
   * romper los documentos antiguos ni el formato guardado.
   */
  points: Pt[];
  /**
   * Dónde vive el trazo, compás a compás. Los documentos antiguos no lo traen:
   * al abrirlos se calcula con la maquetación actual, que es la misma en la que
   * se dibujó porque el ancho del papel es una constante de la aplicación (ver
   * `meta.layoutWidth`). Sin este campo, un trazo se coloca por sus píxeles.
   */
  anchors?: Anchor[];
  /** Color en hex; si es null hereda el de la capa. */
  color: string | null;
  /** Ancho base en espacio de partitura. */
  width: number;
  opacity: number;
  tool: "pencil" | "highlighter";
  createdAt: number;
}

export interface CommentMessage {
  id: string;
  text: string;
  createdAt: number;
  /** Etiqueta libre: "digitación", "dinámica", "recordatorio", "corrección"... */
  tag: string;
}

export interface Pin {
  id: string;
  /** Posición de la última maquetación; se recalcula desde `anchor`. */
  x: number;
  y: number;
  /** Compás sobre el que cae, resuelto al crearlo (measureListIndex). */
  measureIndex: number | null;
  /** Dónde vive el comentario. Los documentos antiguos no lo traen. */
  anchor?: Anchor;
  messages: CommentMessage[];
  resolved: boolean;
  createdAt: number;
}

/** Campos estructurados de una nota de compás. Todo opcional. */
export interface MeasureFields {
  /** Texto libre extenso. */
  text: string;
  /** pp, p, mp, mf, f, ff, <, > …  */
  dynamics: string;
  /** staccato, legato, accent, marcato, fermata … */
  articulation: string;
  /** Digitación ("3-2-1", "IV"), posición, cuerda. */
  fingering: string;
  /** Arco / plectro / percusión. */
  technique: string;
  /** Análisis armónico: "I - V7 - I", "Cm7". */
  harmony: string;
}

export const EMPTY_FIELDS: MeasureFields = {
  text: "",
  dynamics: "",
  articulation: "",
  fingering: "",
  technique: "",
  harmony: "",
};

/** 0 = sin marcar, 1 = repasar, 2 = importante, 3 = crítico. */
export type Priority = 0 | 1 | 2 | 3;

export interface MeasureNote {
  id: string;
  /** measureListIndex del primer compás del tramo (0-based). */
  measureIndex: number;
  /**
   * Último compás del tramo, inclusive. Una anotación puede cubrir un pasaje
   * entero ("compases 33 a 40: aquí entra el saxo"), no sólo un compás.
   * Los documentos antiguos no tienen este campo: al cargarlos vale el propio
   * `measureIndex`, es decir, un solo compás.
   */
  measureEnd?: number;
  /** Número impreso en la partitura, para mostrar ("12" o "33–40"). */
  measureNumber: string;
  /**
   * Parte (instrumento) a la que se refiere la nota, o null para toda la
   * plantilla. En una partitura de saxo + piano + bajo, "dinámica f" no
   * significa lo mismo para los tres.
   */
  partId?: string | null;
  fields: MeasureFields;
  priority: Priority;
  tags: string[];
  updatedAt: number;
}

/** Metadatos de una parte (instrumento) de la partitura. */
export interface PartInfo {
  id: string;
  name: string;
  abbreviation: string;
  /** Índices globales de pentagrama que le pertenecen. */
  staffIndices: number[];
}

/** Tramo de compases seleccionado, ambos extremos incluidos. */
export interface MeasureRange {
  from: number;
  to: number;
}

/** Rango de compases que ocupa una nota (tolera documentos antiguos). */
export function noteRange(note: MeasureNote): MeasureRange {
  const from = Math.min(note.measureIndex, note.measureEnd ?? note.measureIndex);
  const to = Math.max(note.measureIndex, note.measureEnd ?? note.measureIndex);
  return { from, to };
}

export function rangeCovers(range: MeasureRange, index: number): boolean {
  return index >= range.from && index <= range.to;
}

export function rangesOverlap(a: MeasureRange, b: MeasureRange): boolean {
  return a.from <= b.to && b.from <= a.to;
}

/** "33–40" para un tramo, "33" para un compás suelto. */
export function rangeLabel(from: number, to: number, numbers: string[]): string {
  if (from === to) return numbers[from] ?? String(from + 1);
  return `${numbers[from] ?? from + 1}–${numbers[to] ?? to + 1}`;
}

export interface Layer {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  strokes: Stroke[];
  pins: Pin[];
  notes: MeasureNote[];
}

export interface ScoreMeta {
  id: string;
  title: string;
  composer: string;
  /** Instrumento/plantilla libre. */
  instrumentation: string;
  /** Origen del archivo importado. */
  source: "demo" | "musicxml" | "mxl" | "midi";
  /**
   * Ancho de maquetación fijo del documento. Se guarda con la partitura
   * porque cambiarlo re-maqueta los compases y desplazaría las anotaciones
   * guardadas en coordenadas absolutas.
   */
  layoutWidth?: number;
  /**
   * Transporte de la obra entera, en semitonos.
   *
   * Esto sí es música: la pieza pasa a estar en otro tono, así que cambia lo
   * que se lee **y** lo que suena.
   */
  transpose?: number;
  /**
   * Transposición de cada instrumento, por id de parte: los semitonos que hay
   * que sumar a lo que suena para escribir lo que ese instrumento lee.
   *
   * Sólo cambia el papel, nunca el sonido: si el saxo alto lee en Mi♭, el piano
   * sigue oyéndose en el mismo tono. Ver `lib/transpose.ts`.
   */
  partTransposes?: Record<string, number>;
  createdAt: number;
  updatedAt: number;
}

export interface ScoreDocument {
  meta: ScoreMeta;
  /** MusicXML como texto. */
  xml: string;
  layers: Layer[];
  /** Id de la capa activa. */
  activeLayerId: string;
}

export interface ScoreSummary {
  id: string;
  title: string;
  composer: string;
  source: ScoreMeta["source"];
  updatedAt: number;
  /** Nº de anotaciones totales, para la lista de la biblioteca. */
  annotationCount: number;
}

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

let counter = 0;
export function uid(prefix = "id"): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

/** Paleta de capas, pensada para leerse bien sobre papel blanco. */
export const LAYER_PALETTE = [
  "#1f6feb", // azul estudio
  "#d1242f", // rojo correcciones
  "#1a7f37", // verde análisis
  "#9a6700", // ocre director
  "#8250df", // violeta digitación
  "#bf3989", // magenta
  "#0550ae", // azul marino
  "#57606a", // gris lápiz
];

/**
 * Nombre de cada color, en el mismo orden que `LAYER_PALETTE`.
 *
 * Los botones de color sólo tienen un cuadro de color: sin esto, quien navegue
 * con lector de pantalla oye «#1f6feb», que no dice nada. El nombre sale del
 * uso real de cada color en una partitura.
 */
export const LAYER_PALETTE_NAMES = [
  "Azul estudio",
  "Rojo correcciones",
  "Verde análisis",
  "Ocre director",
  "Violeta digitación",
  "Magenta",
  "Azul marino",
  "Gris lápiz",
];

/** Nombre legible de un color de la paleta (o el hex si no está en ella). */
export function colorName(color: string): string {
  const index = LAYER_PALETTE.indexOf(color);
  return index >= 0 ? LAYER_PALETTE_NAMES[index] : color;
}

export function makeLayer(name: string, index = 0): Layer {
  return {
    id: uid("layer"),
    name,
    color: LAYER_PALETTE[index % LAYER_PALETTE.length],
    visible: true,
    locked: false,
    opacity: 1,
    strokes: [],
    pins: [],
    notes: [],
  };
}

export function countAnnotations(layers: Layer[]): number {
  return layers.reduce(
    (acc, l) => acc + l.strokes.length + l.pins.length + l.notes.length,
    0,
  );
}

/* ------------------------------------------------------------------ */
/* Saneado de lo que llega de fuera                                    */
/* ------------------------------------------------------------------ */

/**
 * Lo que construye un documento que no ha escrito esta aplicación.
 *
 * Una partitura puede llegar de tres sitios y en los tres el dato es ajeno:
 * un `.json` exportado por una versión anterior, un archivo que alguien ha
 * editado a mano, y lo que devuelve Drive —donde hay lo que subiera cualquier
 * equipo con la misma cuenta—. Los tres caminos acaban en el mismo sitio: en
 * un documento que se dibuja, se cuenta y se edita dando por hechos campos que
 * puede que no estén.
 *
 * `normalizeDocument` (`lib/files.ts`) es quien rellena los huecos, y lo hace
 * con estas piezas. La regla es siempre la misma: un valor que no se puede
 * leer se sustituye por el valor neutro —sin lanzar, sin adivinar— y una
 * anotación que no puede existir sin él (un trazo sin puntos ni anclas, una
 * nota sin compás) se descarta. Descartar es lo honesto: es mejor perder un
 * dato que no se puede interpretar que enseñar una partitura que se rompe al
 * abrirla.
 *
 * Viven aquí, en el modelo, porque no dependen de nadie: cualquier capa de la
 * aplicación que reciba datos de fuera tiene que poder usarlas.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Número finito, o el valor por defecto. `NaN` y `Infinity` no son coordenadas. */
export function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Entero mayor o igual que cero, o `null` si no lo es. */
export function wholeNumber(value: unknown, minimum = 0): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum) return null;
  return value;
}

export function textValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function boolValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/**
 * Ancla legible, o `null`.
 *
 * Un ancla es lo que decide dónde cae una anotación cuando la partitura se
 * vuelve a maquetar o se transpone, así que un ancla a medias (con `NaN`, con
 * un compás negativo, con la parte como número) no se arregla sola: o está
 * entera, o se trata como si la anotación no tuviera ancla y se recalcula con
 * la maquetación actual.
 */
export function sanitizeAnchor(value: unknown): Anchor | null {
  if (!isRecord(value)) return null;
  const measure = wholeNumber(value.m);
  if (measure === null) return null;
  if (typeof value.u !== "number" || !Number.isFinite(value.u)) return null;
  if (typeof value.v !== "number" || !Number.isFinite(value.v)) return null;
  return {
    m: measure,
    p: typeof value.p === "string" && value.p ? value.p : null,
    o: wholeNumber(value.o) ?? 0,
    u: value.u,
    v: value.v,
  };
}

/** Punto de un trazo: sin coordenadas no hay punto que dibujar. */
export function sanitizePoint(value: unknown): Pt | null {
  if (!isRecord(value)) return null;
  if (typeof value.x !== "number" || !Number.isFinite(value.x)) return null;
  if (typeof value.y !== "number" || !Number.isFinite(value.y)) return null;
  return {
    x: value.x,
    y: value.y,
    // La presión se acota: un 40 en el campo daría un trazo de 40 veces su
    // grosor, que no es un trazo, es un borrón.
    p: Math.min(1, Math.max(0, finiteNumber(value.p, 0.5))),
  };
}

