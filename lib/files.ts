"use client";

import { unzipSync, strFromU8 } from "fflate";
import { midiToMusicXml } from "./midi-to-musicxml";
import {
  boolValue,
  finiteNumber,
  isRecord,
  LAYER_PALETTE,
  makeLayer,
  sanitizeAnchor,
  sanitizePoint,
  textValue,
  uid,
  wholeNumber,
  type Anchor,
  type CommentMessage,
  type Layer,
  type MeasureFields,
  type MeasureNote,
  type Pin,
  type Priority,
  type Pt,
  type ScoreDocument,
  type ScoreMeta,
  type Stroke,
} from "./types";

export interface ImportedScore {
  doc: ScoreDocument;
  warnings: string[];
}

function baseName(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "");
}

function emptyDocument(
  title: string,
  xml: string,
  source: ScoreDocument["meta"]["source"],
): ScoreDocument {
  const layer = makeLayer("Mis anotaciones", 0);
  const now = Date.now();
  return {
    meta: {
      id: uid("score"),
      title,
      composer: "",
      instrumentation: "",
      source,
      createdAt: now,
      updatedAt: now,
    },
    xml,
    layers: [layer],
    activeLayerId: layer.id,
  };
}

/**
 * Tope de tamaño. No es una limitación real de MusicXML: es que por encima de
 * esto la pestaña se queda colgada descomprimiendo o dibujando, y es mejor
 * decir que no a tiempo que dejar la aplicación sin responder sin explicación.
 */
const MAX_IMPORT_BYTES = 25 * 1024 * 1024;

function checkSize(file: File) {
  if (file.size > MAX_IMPORT_BYTES) {
    throw new Error(
      `«${file.name}» pesa ${(file.size / 1024 / 1024).toFixed(0)} MB y el límite son ${MAX_IMPORT_BYTES / 1024 / 1024} MB. ` +
        "Suele pasar con partituras escaneadas: esto trabaja con MusicXML o MIDI, no con imágenes.",
    );
  }
}

export async function importScoreFile(file: File): Promise<ImportedScore> {
  const warnings: string[] = [];
  checkSize(file);
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";

  if (extension === "mid" || extension === "midi") {
    const buffer = await file.arrayBuffer();
    let converted;
    try {
      converted = midiToMusicXml(buffer, baseName(file.name));
    } catch (error) {
      throw new Error(
        `No se pudo leer «${file.name}» como MIDI: ${
          error instanceof Error ? error.message : "archivo dañado o no es un MIDI"
        }`,
      );
    }
    warnings.push(...converted.warnings);
    return {
      doc: emptyDocument(converted.title, converted.xml, "midi"),
      warnings,
    };
  }

  if (extension === "json") {
    const text = await file.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(
        `«${file.name}» no es un JSON válido (puede estar cortado a medias). Exporta la copia otra vez desde la aplicación.`,
      );
    }
    // Se comprueba la forma antes de normalizar: un JSON cualquiera (una lista
    // de contactos, la configuración de otra aplicación) daría un documento
    // vacío que parecería una partitura rota en vez de un archivo equivocado.
    if (!isScoreDocumentShape(parsed)) {
      throw new Error(
        `«${file.name}» no parece una copia exportada por Partitura Studio: le faltan el documento (` +
          "meta o xml) o las capas de anotación.",
      );
    }
    return { doc: normalizeDocument(parsed), warnings };
  }

  if (extension === "mxl") {
    const xml = extractMxl(await file.arrayBuffer());
    return {
      doc: emptyDocument(baseName(file.name), xml, "mxl"),
      warnings,
    };
  }

  const text = await file.text();
  if (!text.includes("<score-partwise") && !text.includes("<score-timewise")) {
    throw new Error(
      `«${file.name}» no parece MusicXML. Se admiten .musicxml, .xml, .mxl, .mid y .json.`,
    );
  }
  return {
    doc: emptyDocument(baseName(file.name), withDeclaration(text), "musicxml"),
    warnings,
  };
}

/**
 * ¿Tiene la forma mínima de un documento de la aplicación?
 *
 * A propósito sólo se comprueba lo imprescindible (metadatos, la partitura y
 * alguna capa): los detalles de dentro los completa `normalizeDocument`, que
 * existe justo para que una copia exportada por una versión anterior siga
 * abriéndose. Aquí se filtra lo que claramente no es esto.
 */
function isScoreDocumentShape(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ScoreDocument>;
  if (!candidate.meta || typeof candidate.meta !== "object") return false;
  if (typeof candidate.xml !== "string" || candidate.xml.trim() === "") return false;
  return Array.isArray(candidate.layers) && candidate.layers.length > 0;
}

/**
 * Tope de lo que se deja descomprimir de un .mxl, en bytes.
 *
 * Un ZIP puede declarar y contener mucho más de lo que pesa (unas pocas decenas
 * de KB que se expanden a gigabytes): es la bomba de descompresión clásica, y un
 * archivo de 40 KB bastaba para dejar la pestaña sin memoria antes de decir nada. El
 * límite de tamaño de la importación no protege de esto —cuenta lo comprimido—,
 * así que se mira lo que el propio ZIP declara ocupar.
 */
const MAX_UNPACKED_BYTES = 64 * 1024 * 1024;

/**
 * Un .mxl es un ZIP con un `META-INF/container.xml` que apunta al MusicXML
 * real. Extraemos ese archivo y guardamos el XML en claro: así el documento
 * es texto plano, se puede versionar y no dependemos de descomprimir al vuelo.
 *
 * Se extrae sólo el XML, y con el freno de la bomba de descompresión delante:
 * el filtro se llama antes de descomprimir cada archivo y, en cuanto la suma de
 * lo declarado pasa del tope, deja de extraer. Un .mxl suele llevar además la
 * partitura en PDF y las imágenes de la portada, que no se usan para nada.
 */
function extractMxl(buffer: ArrayBuffer): string {
  let declaredBytes = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(buffer), {
      filter: (file) => {
        const isXml =
          file.name === "META-INF/container.xml" ||
          (file.name.toLowerCase().endsWith(".xml") && !file.name.startsWith("META-INF/"));
        // Lo que no se extrae no gasta memoria, así que no cuenta: un .mxl con
        // la portada escaneada dentro se abre igual. Lo que SÍ se va a
        // descomprimir se cuenta antes de descomprimirlo, que es lo único que
        // puede parar a tiempo una bomba.
        if (!isXml) return false;
        declaredBytes += file.originalSize ?? file.size ?? 0;
        return declaredBytes <= MAX_UNPACKED_BYTES;
      },
    });
  } catch {
    throw new Error("No se pudo leer el archivo .mxl (ZIP dañado o cifrado).");
  }

  if (declaredBytes > MAX_UNPACKED_BYTES) {
    throw new Error(
      `Ese .mxl se expande a más de ${MAX_UNPACKED_BYTES / 1024 / 1024} MB al descomprimirlo, así que no se ha abierto. ` +
        "Suele ser un archivo dañado; ábrelo en un editor de partituras y expórtalo otra vez como MusicXML.",
    );
  }

  const container = files["META-INF/container.xml"];
  let rootPath: string | null = null;
  if (container) {
    const containerXml = strFromU8(container);
    rootPath =
      /full-path="([^"]+)"/.exec(containerXml)?.[1]?.replace(/^\//, "") ??
      null;
  }

  const candidates = Object.keys(files).filter(
    (name) =>
      name.toLowerCase().endsWith(".xml") &&
      !name.startsWith("META-INF/"),
  );
  const chosen = rootPath && files[rootPath] ? rootPath : candidates[0];
  if (!chosen) {
    throw new Error("El archivo .mxl no contiene ningún documento MusicXML.");
  }
  return withDeclaration(strFromU8(files[chosen]));
}

/** OSMD sólo reconoce una cadena como XML si empieza por la declaración. */
function withDeclaration(xml: string): string {
  return xml.trimStart().startsWith("<?xml")
    ? xml
    : `<?xml version="1.0" encoding="UTF-8"?>\n${xml}`;
}

/**
 * Cómo se completa un documento que llega de fuera.
 */
export interface NormalizeOptions {
  /**
   * Poner al día `meta.updatedAt`.
   *
   * Encendido (el valor por defecto) al importar una copia: abrir tu propia
   * copia es una decisión tuya, y tiene que ganarle a lo que haya en Drive, que
   * es exactamente lo que decide `updatedAt` al sincronizar.
   *
   * Apagado al bajar algo de Drive: cambiarle la fecha a lo que llega haría que
   * la próxima sincronización lo devolviera como si fuera nuevo —la copia
   * recién bajada parecería más reciente que su original— y el conflicto
   * quedaría al revés.
   */
  touch?: boolean;
}

/**
 * Un identificador único dentro de su colección.
 *
 * Un documento editado a mano puede traer dos capas con el mismo id (o dos
 * trazos): y entonces borrar uno borraría los dos, y mover una capa movería la
 * otra. Al segundo se le da un id nuevo.
 */
function pickId(candidate: unknown, used: Set<string>, prefix: string): string {
  let id = typeof candidate === "string" && candidate ? candidate : uid(prefix);
  if (used.has(id)) id = uid(prefix);
  used.add(id);
  return id;
}

function sanitizeMessage(value: unknown, used: Set<string>, now: number): CommentMessage | null {
  if (!isRecord(value)) return null;
  return {
    id: pickId(value.id, used, "msg"),
    text: textValue(value.text),
    tag: textValue(value.tag, "nota"),
    createdAt: finiteNumber(value.createdAt, now),
  };
}

function sanitizeStroke(value: unknown, used: Set<string>, now: number): Stroke | null {
  if (!isRecord(value)) return null;
  const points = (Array.isArray(value.points) ? value.points : [])
    .map(sanitizePoint)
    .filter((point): point is Pt => point !== null);
  const rawAnchors = Array.isArray(value.anchors) ? value.anchors : [];
  const anchors = rawAnchors
    .map(sanitizeAnchor)
    .filter((anchor): anchor is Anchor => anchor !== null);
  // Sin puntos ni anclas no hay nada que dibujar: no es un trazo, es un
  // registro roto, y enseñarlo sería enseñar tinta que no existe.
  if (points.length === 0 && anchors.length === 0) return null;
  return {
    id: pickId(value.id, used, "stroke"),
    points,
    // O están TODAS las anclas, o no hay ninguna: media ancla es peor que
    // ninguna, porque coloca el trazo a medias y ya no se recalcula (ver
    // `lib/anchors.ts`). Sin anclas, la primera maquetación las calcula.
    anchors: anchors.length === rawAnchors.length ? anchors : undefined,
    color: typeof value.color === "string" ? value.color : null,
    width: Math.max(0.1, finiteNumber(value.width, 2.4)),
    opacity: Math.min(1, Math.max(0, finiteNumber(value.opacity, 1))),
    tool: value.tool === "highlighter" ? "highlighter" : "pencil",
    createdAt: finiteNumber(value.createdAt, now),
  };
}

function sanitizePin(value: unknown, used: Set<string>, now: number): Pin | null {
  if (!isRecord(value)) return null;
  // Un comentario sin sitio en el papel no se puede colocar en ningún lado.
  if (typeof value.x !== "number" || !Number.isFinite(value.x)) return null;
  if (typeof value.y !== "number" || !Number.isFinite(value.y)) return null;
  return {
    id: pickId(value.id, used, "pin"),
    x: value.x,
    y: value.y,
    measureIndex: wholeNumber(value.measureIndex),
    anchor: sanitizeAnchor(value.anchor) ?? undefined,
    messages: (Array.isArray(value.messages) ? value.messages : [])
      .map((message) => sanitizeMessage(message, used, now))
      .filter((message): message is CommentMessage => message !== null),
    resolved: boolValue(value.resolved, false),
    createdAt: finiteNumber(value.createdAt, now),
  };
}

/**
 * Campos estructurados de una nota.
 *
 * Se construyen campo a campo y no esparciendo lo que venga: es la diferencia
 * entre un documento antiguo sin `fields` —que hacía `note.fields.text` y
 * tumbaba el panel entero— y uno que abre con todo en blanco. Tampoco pasan los
 * campos de más: un `fields` con veinte claves ajenas se guardaría tal cual y
 * viajaría en cada copia y en cada sincronización.
 */
function sanitizeFields(value: unknown): MeasureFields {
  const source = isRecord(value) ? value : {};
  return {
    text: textValue(source.text),
    dynamics: textValue(source.dynamics),
    articulation: textValue(source.articulation),
    fingering: textValue(source.fingering),
    technique: textValue(source.technique),
    harmony: textValue(source.harmony),
  };
}

function sanitizeNote(value: unknown, used: Set<string>, now: number): MeasureNote | null {
  if (!isRecord(value)) return null;
  // El compás ES la identidad de una nota de pasaje: sin uno válido no hay
  // dónde ponerla ni a qué compás apuntarla.
  const from = wholeNumber(value.measureIndex);
  if (from === null) return null;
  const to = wholeNumber(value.measureEnd) ?? from;
  const priority = wholeNumber(value.priority);
  return {
    id: pickId(value.id, used, "note"),
    measureIndex: from,
    measureEnd: to,
    measureNumber: textValue(value.measureNumber, String(from + 1)),
    partId: typeof value.partId === "string" && value.partId ? value.partId : null,
    fields: sanitizeFields(value.fields),
    priority: (priority !== null && priority <= 3 ? priority : 0) as Priority,
    tags: (Array.isArray(value.tags) ? value.tags : []).filter(
      (tag): tag is string => typeof tag === "string" && tag.trim() !== "",
    ),
    updatedAt: finiteNumber(value.updatedAt, now),
  };
}

function sanitizeLayer(
  value: unknown,
  used: Set<string>,
  now: number,
  index: number,
): Layer | null {
  if (!isRecord(value)) return null;
  return {
    id: pickId(value.id, used, "layer"),
    name: textValue(value.name, `Capa ${index + 1}`),
    color:
      typeof value.color === "string" && value.color
        ? value.color
        : LAYER_PALETTE[index % LAYER_PALETTE.length],
    visible: boolValue(value.visible, true),
    locked: boolValue(value.locked, false),
    opacity: Math.min(1, Math.max(0.05, finiteNumber(value.opacity, 1))),
    strokes: (Array.isArray(value.strokes) ? value.strokes : [])
      .map((stroke) => sanitizeStroke(stroke, used, now))
      .filter((stroke): stroke is Stroke => stroke !== null),
    pins: (Array.isArray(value.pins) ? value.pins : [])
      .map((pin) => sanitizePin(pin, used, now))
      .filter((pin): pin is Pin => pin !== null),
    notes: (Array.isArray(value.notes) ? value.notes : [])
      .map((note) => sanitizeNote(note, used, now))
      .filter((note): note is MeasureNote => note !== null),
  };
}

/** Origen legible del documento: lo que no se reconoce es MusicXML. */
function sanitizeSource(value: unknown): ScoreMeta["source"] {
  return value === "demo" || value === "mxl" || value === "midi" ? value : "musicxml";
}

/**
 * Lecturas por parte, una a una.
 *
 * Se construye un objeto NUEVO con lo que se puede leer y se descarta el resto:
 * el que llega puede traer `__proto__` (que escrito con corchetes toca el
 * prototipo) o valores que no son números, y de aquí sale el tono con el que se
 * dibuja cada instrumento.
 */
function sanitizePartTransposes(value: unknown): Record<string, number> | undefined {
  if (!isRecord(value)) return undefined;
  const out: Record<string, number> = {};
  let any = false;
  for (const [partId, semitones] of Object.entries(value)) {
    if (!partId || partId === "__proto__") continue;
    if (typeof semitones !== "number" || !Number.isFinite(semitones)) continue;
    out[partId] = semitones;
    any = true;
  }
  return any ? out : undefined;
}

/**
 * Rellena los huecos de un documento que no ha escrito esta aplicación, y
 * sustituye lo que no se puede leer por un valor neutro.
 *
 * Es la única puerta de entrada de datos ajenos: la usa la importación de un
 * `.json` y la sincronización con Drive, porque los dos llegan de fuera y los
 * dos acaban en un documento que se dibuja y se edita. Antes de esto sólo se
 * completaban tres campos, así que una copia antigua sin `fields` en una nota
 * —o una capa sin la lista de comentarios— abría y reventaba al llegar al
 * panel. Ver `tests/files.test.mjs`.
 */
export function normalizeDocument(input: unknown, options: NormalizeOptions = {}): ScoreDocument {
  const now = Date.now();
  const touch = options.touch ?? true;
  const source = isRecord(input) ? input : {};
  const meta = isRecord(source.meta) ? source.meta : {};

  const usedIds = new Set<string>();
  const layers = (Array.isArray(source.layers) ? source.layers : [])
    .map((layer, index) => sanitizeLayer(layer, usedIds, now, index))
    .filter((layer): layer is Layer => layer !== null);
  // Un documento sin capas no tiene dónde anotar: se le pone una. No hay
  // ninguno legítimo en esta forma -hasta la versión más antigua traía una-
  // así que esto es el suelo, no el caso normal.
  if (layers.length === 0) layers.push(makeLayer("Mis anotaciones", 0));

  const wantedActive = textValue(source.activeLayerId);

  return {
    meta: {
      id: textValue(meta.id) || uid("score"),
      title: textValue(meta.title, "Sin título"),
      composer: textValue(meta.composer),
      instrumentation: textValue(meta.instrumentation),
      source: sanitizeSource(meta.source),
      // Estas tres no son adorno: las dos últimas son el transporte (el de la
      // obra y el de cada instrumento) y `layoutWidth` es el ancho del papel,
      // que hoy es una constante de la aplicación y por eso casi ningún
      // documento lo trae; si viene, manda. Al reconstruir los metadatos campo a
      // campo, la que no se copie aquí desaparece sin avisar al abrir una copia
      // exportada.
      layoutWidth:
        typeof meta.layoutWidth === "number" &&
        Number.isFinite(meta.layoutWidth) &&
        meta.layoutWidth > 0
          ? meta.layoutWidth
          : undefined,
      transpose:
        typeof meta.transpose === "number" && Number.isFinite(meta.transpose)
          ? meta.transpose
          : undefined,
      partTransposes: sanitizePartTransposes(meta.partTransposes),
      createdAt: finiteNumber(meta.createdAt, now),
      updatedAt: touch ? now : finiteNumber(meta.updatedAt, now),
    },
    xml: textValue(source.xml),
    layers,
    // La capa activa tiene que existir: si el id guardado no está (un documento
    // reconstruido, una capa borrada a mano), editar no haría nada y parecería
    // que el lápiz se ha roto.
    activeLayerId: layers.some((layer) => layer.id === wantedActive)
      ? wantedActive
      : layers[0].id,
  };
}

/**
 * Las anotaciones se exportan como JSON independiente del MusicXML:
 * así puedes reutilizar tu capa de digitaciones en otra edición de la obra,
 * que es imposible cuando las anotaciones viven pegadas a un PDF.
 */
export function downloadJson(doc: ScoreDocument) {
  downloadBlob(
    new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" }),
    `${slug(doc.meta.title)}.partitura.json`,
  );
}

export function downloadText(text: string, fileName: string, mime: string) {
  downloadBlob(new Blob([text], { type: mime }), fileName);
}

/** Nombre del archivo con el que sale el MusicXML. */
export function musicXmlFileName(doc: ScoreDocument) {
  return `${slug(doc.meta.title)}.musicxml`;
}

/**
 * La música sola, sin las anotaciones.
 *
 * Hace falta porque la aplicación no es el único sitio donde se trabaja con
 * una partitura: es la única forma de sacar de aquí la transcripción de un MIDI
 * o el XML que venía dentro de un .mxl, y de llevarse el documento a un editor
 * de partituras de verdad. La copia .json, en cambio, es el documento entero
 * con sus capas, y sólo sirve para volver a abrirlo aquí.
 */
export function downloadMusicXml(doc: ScoreDocument) {
  downloadText(
    doc.xml,
    musicXmlFileName(doc),
    "application/vnd.recordare.musicxml+xml",
  );
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function slug(value: string) {
  return (
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase() || "partitura"
  );
}
