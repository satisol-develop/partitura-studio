/**
 * Sincronización entre el almacén local (IndexedDB) y la carpeta de Drive.
 *
 * La aplicación es *local-first* a propósito, y no es un detalle de
 * implementación: sin servidor propio, el navegador es lo único que responde
 * cuando no hay red, así que lo que se escribe se guarda siempre en local y
 * Drive es la copia compartida. Lo contrario (escribir directamente en Drive)
 * dejaría la aplicación inservible en un aula sin wifi, y un trazo de tinta
 * perdido por un timeout es peor que una sincronización que llega tarde.
 *
 * Cómo se resuelven los choques:
 *
 *  - **Gana el más reciente** (`meta.updatedAt`), que es lo que espera
 *    cualquiera que edite lo mismo desde dos sitios. No se intenta mezclar
 *    capas: fusionar dos versiones de la misma lista de trazos sin un modelo de
 *    diferencias sólo puede inventar anotaciones que nadie dibujó.
 *  - Cada partitura guarda el *último estado acordado* (`synced[id]`). Gracias a
 *    eso se distingue «lo he cambiado yo» de «lo han cambiado en otro sitio», y
 *    un cambio en ambos lados se reporta como conflicto en vez de resolverse en
 *    silencio.
 *  - Los borrados se recuerdan como lápidas hasta que Drive los confirma: si no,
 *    borrar en local y sincronizar volvería a bajar lo que se acaba de borrar.
 *
 * El motor no conoce ni IndexedDB ni `fetch` de verdad: recibe las dos cosas.
 * Así se puede probar entero sin navegador (ver `tests/drive-sync.test.mjs`).
 */

import {
  deleteRemoteScore,
  getRemoteScore,
  listRemote,
  putRemoteScore,
  type DriveConfig,
} from "./drive";
import type { ScoreDocument, ScoreSummary } from "./types";

/** Lo que el motor necesita del almacén local. Lo cumple `lib/persistence.ts`. */
export interface SyncLocalStore {
  list(): Promise<ScoreSummary[]>;
  load(id: string): Promise<ScoreDocument | null>;
  save(doc: ScoreDocument): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface SyncState {
  /** id → último `updatedAt` en el que local y Drive coincidían. */
  synced: Record<string, number>;
  /** Ids borrados en local que Drive todavía no sabe que se borraron. */
  tombstones: string[];
}

export const EMPTY_SYNC_STATE: SyncState = { synced: {}, tombstones: [] };

export interface SyncConflict {
  id: string;
  title: string;
  kept: "local" | "remoto";
  localUpdatedAt: number;
  remoteUpdatedAt: number;
}

export interface SyncReport {
  uploaded: string[];
  downloaded: string[];
  deletedRemote: string[];
  conflicts: SyncConflict[];
  unchanged: number;
  /** Fallos por partitura: se informan, no abortan la sincronización entera. */
  errors: { id: string; message: string }[];
}

export interface SyncResult {
  report: SyncReport;
  state: SyncState;
  /**
   * Cómo queda Drive después de esta pasada (los subidos incluidos y los
   * borrados fuera). La biblioteca lo usa para marcar qué está en la nube, y
   * tenerlo aquí ahorra una petición extra justo cuando la red es el cuello de
   * botella.
   */
  remote: ScoreSummary[];
}

export interface SyncOptions {
  fetchImpl?: typeof fetch;
  /**
   * Reserva de conflicto. Por defecto gana el más reciente; con `"local"` se
   * conserva siempre lo de este equipo, que es lo que se quiere justo después
   * de trabajar sin conexión y no fiarse de la copia de Drive.
   */
  conflictPolicy?: "newest" | "local";
}

export const SYNC_STATE_KEY = "ps:drive:state";

export function loadSyncState(): SyncState {
  if (typeof window === "undefined") return EMPTY_SYNC_STATE;
  try {
    const raw = window.localStorage.getItem(SYNC_STATE_KEY);
    if (!raw) return EMPTY_SYNC_STATE;
    const parsed = JSON.parse(raw) as Partial<SyncState>;
    return {
      synced: parsed.synced && typeof parsed.synced === "object" ? parsed.synced : {},
      tombstones: Array.isArray(parsed.tombstones) ? parsed.tombstones : [],
    };
  } catch {
    return EMPTY_SYNC_STATE;
  }
}

export function saveSyncState(state: SyncState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SYNC_STATE_KEY, JSON.stringify(state));
  } catch {
    // Sin persistencia: la próxima sincronización rehará el cálculo completo.
  }
}

/** Marca una partitura como borrada aquí, para borrarla también en Drive. */
export function markDeleted(id: string, state: SyncState): SyncState {
  if (!(id in state.synced)) return state;
  const synced = { ...state.synced };
  delete synced[id];
  return { synced, tombstones: [...new Set([...state.tombstones, id])] };
}

function emptyReport(): SyncReport {
  return {
    uploaded: [],
    downloaded: [],
    deletedRemote: [],
    conflicts: [],
    unchanged: 0,
    errors: [],
  };
}

/**
 * Sincroniza en los dos sentidos. Nunca lanza por un fallo de una partitura
 * concreta: los recoge en `errors` para que la interfaz pueda decir «3 de 5
 * subidas, y esta ha fallado por esto» en vez de dejar la pantalla a medias.
 */
export async function syncWithDrive(
  config: DriveConfig,
  local: SyncLocalStore,
  state: SyncState,
  options: SyncOptions = {},
): Promise<SyncResult> {
  const fetchImpl = options.fetchImpl;
  const conflictsPolicy = options.conflictPolicy ?? "newest";
  const report = emptyReport();
  const next: SyncState = { synced: { ...state.synced }, tombstones: [...state.tombstones] };

  // Sin red no hay nada que hacer y el error es de red, no de una partitura:
  // este es el único punto que puede lanzar.
  const remote = await listRemote(config, { fetchImpl });
  const remoteById = new Map(remote.map((summary) => [summary.id, summary]));
  const localSummaries = await local.list();
  const localById = new Map(localSummaries.map((summary) => [summary.id, summary]));

  /* 1. Lápidas: borrar en Drive lo que ya no existe aquí. */
  const remainingTombstones: string[] = [];
  for (const id of next.tombstones) {
    try {
      await deleteRemoteScore(config, id, { fetchImpl });
      remoteById.delete(id);
      report.deletedRemote.push(id);
    } catch (error) {
      remainingTombstones.push(id);
      report.errors.push({ id, message: messageOf(error) });
    }
  }
  next.tombstones = remainingTombstones;

  /* 2. Todo lo que está en alguno de los dos lados. */
  const ids = new Set([...localById.keys(), ...remoteById.keys()]);

  for (const id of ids) {
    const localSummary = localById.get(id);
    const remoteSummary = remoteById.get(id);
    const known = next.synced[id];

    try {
      if (localSummary && !remoteSummary) {
        // Está aquí y no allí: se sube. Si además constaba como sincronizada,
        // es que alguien la borró en Drive (o se vació la carpeta), y eso se
        // avisa en vez de resucitarla en silencio sin decir nada.
        if (known !== undefined) {
          report.conflicts.push({
            id,
            title: localSummary.title,
            kept: "local",
            localUpdatedAt: localSummary.updatedAt,
            remoteUpdatedAt: 0,
          });
        }
        await upload(id, local, config, next, report, remoteById, fetchImpl);
        continue;
      }

      if (!localSummary && remoteSummary) {
        await download(id, local, config, next, report, fetchImpl);
        continue;
      }

      if (!localSummary || !remoteSummary) continue;

      if (localSummary.updatedAt === remoteSummary.updatedAt) {
        next.synced[id] = localSummary.updatedAt;
        report.unchanged += 1;
        continue;
      }

      const localChanged = known === undefined || localSummary.updatedAt > known;
      const remoteChanged = known === undefined || remoteSummary.updatedAt > known;
      const remoteWins =
        conflictsPolicy === "local"
          ? false
          : remoteSummary.updatedAt > localSummary.updatedAt;

      if (localChanged && remoteChanged) {
        report.conflicts.push({
          id,
          title: localSummary.title || remoteSummary.title,
          kept: remoteWins ? "remoto" : "local",
          localUpdatedAt: localSummary.updatedAt,
          remoteUpdatedAt: remoteSummary.updatedAt,
        });
      }

      if (remoteWins) {
        await download(id, local, config, next, report, fetchImpl);
      } else {
        await upload(id, local, config, next, report, remoteById, fetchImpl);
      }
    } catch (error) {
      report.errors.push({ id, message: messageOf(error) });
    }
  }

  return { report, state: next, remote: [...remoteById.values()] };
}

async function upload(
  id: string,
  local: SyncLocalStore,
  config: DriveConfig,
  state: SyncState,
  report: SyncReport,
  remoteById: Map<string, ScoreSummary>,
  fetchImpl?: typeof fetch,
) {
  const doc = await local.load(id);
  if (!doc) throw new Error("La partitura ya no está en este equipo.");
  const summary = await putRemoteScore(config, doc, { fetchImpl });
  state.synced[id] = summary.updatedAt;
  remoteById.set(id, summary);
  report.uploaded.push(id);
}

async function download(
  id: string,
  local: SyncLocalStore,
  config: DriveConfig,
  state: SyncState,
  report: SyncReport,
  fetchImpl?: typeof fetch,
) {
  const remote = await getRemoteScore(config, id, { fetchImpl });
  if (!remote) throw new Error("Drive dice que existe pero ya no está.");
  const doc: ScoreDocument = {
    ...remote.document,
    // El MusicXML vive en su propio archivo dentro de la carpeta; se recupera
    // tal cual para que la partitura se pueda volver a dibujar en este equipo.
    xml: remote.xml || remote.document.xml || "",
  };
  await local.save(doc);
  state.synced[id] = doc.meta.updatedAt;
  report.downloaded.push(id);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Resume un informe en una frase, para la barra de estado. */
export function describeReport(report: SyncReport): string {
  const parts: string[] = [];
  if (report.uploaded.length) parts.push(`${report.uploaded.length} subida(s)`);
  if (report.downloaded.length) parts.push(`${report.downloaded.length} bajada(s)`);
  if (report.deletedRemote.length) parts.push(`${report.deletedRemote.length} borrada(s) en Drive`);
  if (report.conflicts.length) parts.push(`${report.conflicts.length} conflicto(s)`);
  if (report.unchanged) parts.push(`${report.unchanged} sin cambios`);
  if (report.errors.length) parts.push(`${report.errors.length} error(es)`);
  return parts.length ? parts.join(" · ") : "Nada que sincronizar";
}
