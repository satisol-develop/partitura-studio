import { del, get, keys, set } from "idb-keyval";
import type { SyncLocalStore } from "./sync";
import type { ScoreDocument, ScoreSummary } from "./types";
import { countAnnotations } from "./types";

const INDEX_KEY = "ps:index";
const SCORE_PREFIX = "ps:score:";

function scoreKey(id: string) {
  return `${SCORE_PREFIX}${id}`;
}

export function summarize(doc: ScoreDocument): ScoreSummary {
  return {
    id: doc.meta.id,
    title: doc.meta.title,
    composer: doc.meta.composer,
    source: doc.meta.source,
    updatedAt: doc.meta.updatedAt,
    annotationCount: countAnnotations(doc.layers),
  };
}

export async function listScores(): Promise<ScoreSummary[]> {
  const index = (await get<ScoreSummary[]>(INDEX_KEY)) ?? [];
  return index.sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Cuántas partituras hay guardadas de verdad, al margen de lo que diga el
 * índice.
 *
 * Existe porque guardar son DOS escrituras (el documento y el índice) y la
 * pestaña puede morir entre las dos: el documento queda ahí, completo, y la
 * partitura desaparece de la biblioteca sin haber perdido nada. Comparar este
 * número con el del índice es lo que detecta ese caso y también el contrario
 * (entradas de índice cuyo documento ya no está).
 */
export async function countStoredScores(): Promise<number> {
  const allKeys = await keys();
  return allKeys.filter(
    (key): key is string => typeof key === "string" && key.startsWith(SCORE_PREFIX),
  ).length;
}

export async function loadScore(id: string): Promise<ScoreDocument | null> {
  const doc = await get<ScoreDocument>(scoreKey(id));
  return doc ?? null;
}

export async function saveScore(doc: ScoreDocument): Promise<ScoreSummary[]> {
  await set(scoreKey(doc.meta.id), doc);
  const index = (await get<ScoreSummary[]>(INDEX_KEY)) ?? [];
  const next = index.filter((s) => s.id !== doc.meta.id);
  next.push(summarize(doc));
  next.sort((a, b) => b.updatedAt - a.updatedAt);
  await set(INDEX_KEY, next);
  return next;
}

export async function deleteScore(id: string): Promise<ScoreSummary[]> {
  await del(scoreKey(id));
  const index = (await get<ScoreSummary[]>(INDEX_KEY)) ?? [];
  const next = index.filter((s) => s.id !== id);
  await set(INDEX_KEY, next);
  return next;
}

/**
 * Vista de IndexedDB con la forma que espera el motor de sincronización.
 *
 * El motor no conoce IndexedDB (ni `fetch`), así que se le pasa esto: en el
 * navegador son estas cinco funciones y en las pruebas un `Map`. Que la
 * sincronización se pueda probar entera sin navegador depende de esta costura.
 * `saveScore` devuelve el índice para refrescar la biblioteca, que aquí no hace
 * falta, así que se descarta.
 */
export const localSyncStore: SyncLocalStore = {
  list: listScores,
  load: loadScore,
  save: async (doc) => {
    await saveScore(doc);
  },
  remove: async (id) => {
    await deleteScore(id);
  },
};

/** Reconstruye el índice si el usuario borra datos del navegador de forma parcial. */
export async function repairIndex(): Promise<ScoreSummary[]> {
  const allKeys = await keys();
  const scoreKeys = allKeys.filter(
    (k): k is string => typeof k === "string" && k.startsWith(SCORE_PREFIX),
  );
  const docs = await Promise.all(scoreKeys.map((k) => get<ScoreDocument>(k)));
  const next = docs.filter(Boolean).map((d) => summarize(d as ScoreDocument));
  next.sort((a, b) => b.updatedAt - a.updatedAt);
  await set(INDEX_KEY, next);
  return next;
}
