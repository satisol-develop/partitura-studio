"use client";

import { unzipSync, strFromU8 } from "fflate";
import { midiToMusicXml } from "./midi-to-musicxml";
import {
  makeLayer,
  uid,
  type Layer,
  type ScoreDocument,
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
    return { doc: normalizeDocument(parsed as Partial<ScoreDocument>), warnings };
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
 * Un .mxl es un ZIP con un `META-INF/container.xml` que apunta al MusicXML
 * real. Extraemos ese archivo y guardamos el XML en claro: así el documento
 * es texto plano, se puede versionar y no dependemos de descomprimir al vuelo.
 */
function extractMxl(buffer: ArrayBuffer): string {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(buffer));
  } catch {
    throw new Error("No se pudo leer el archivo .mxl (ZIP dañado o cifrado).");
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

/** Rellena los huecos de un JSON importado de una versión anterior. */
export function normalizeDocument(input: Partial<ScoreDocument>): ScoreDocument {
  const now = Date.now();
  const layers: Layer[] = (input.layers ?? []).map((l) => ({
    id: l.id ?? uid("layer"),
    name: l.name ?? "Capa",
    color: l.color ?? "#1f6feb",
    visible: l.visible ?? true,
    locked: l.locked ?? false,
    opacity: typeof l.opacity === "number" ? l.opacity : 1,
    strokes: l.strokes ?? [],
    pins: l.pins ?? [],
    // Los documentos guardados antes de que existieran los tramos y las partes
    // no traen `measureEnd` ni `partId`: se completan aquí, y un tramo sin
    // final es un solo compás.
    notes: (l.notes ?? []).map((n) => ({
      ...n,
      measureEnd: n.measureEnd ?? n.measureIndex,
      partId: n.partId ?? null,
    })),
  }));
  if (layers.length === 0) layers.push(makeLayer("Mis anotaciones", 0));

  return {
    meta: {
      id: input.meta?.id ?? uid("score"),
      title: input.meta?.title ?? "Sin título",
      composer: input.meta?.composer ?? "",
      instrumentation: input.meta?.instrumentation ?? "",
      source: input.meta?.source ?? "musicxml",
      createdAt: input.meta?.createdAt ?? now,
      updatedAt: now,
    },
    xml: input.xml ?? "",
    layers,
    activeLayerId: input.activeLayerId ?? layers[0].id,
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
