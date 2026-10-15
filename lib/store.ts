"use client";

import { create } from "zustand";
import {
  LAYER_PALETTE,
  makeLayer,
  noteRange,
  uid,
  type Anchor,
  type Layer,
  type MeasureFields,
  type MeasureNote,
  type MeasureRange,
  type Priority,
  type Pin,
  type ScoreDocument,
  type PartInfo,
  type ScoreSummary,
  type Stroke,
  type ToolId,
} from "./types";
import {
  countStoredScores,
  deleteScore,
  listScores,
  loadScore,
  localSyncStore,
  repairIndex,
  saveScore,
} from "./persistence";
import {
  anchorForPin,
  anchorOf,
  anchorsFor,
  needsAnchoring,
  pinBelongsToPart,
  strokeBelongsToPart,
} from "./anchors";
import { EMPTY_EXTENT, type ScoreExtent } from "./geometry";
import { adoptReadings } from "./transpose";
import type { PlaybackTimeline } from "./playback";
import { DriveError, listRemote, testConnection } from "./drive";
import {
  describeAuthError,
  hasValidSession,
  loadAuth,
  revalidateSession,
  saveAuth,
  signIn,
  signOut,
  toDriveConfig,
  type AuthState,
} from "./auth";
import {
  describeReport,
  loadSyncOwner,
  loadSyncState,
  markDeleted,
  needsOwnerConfirmation,
  saveSyncOwner,
  saveSyncState,
  syncWithDrive,
  type SyncState,
} from "./sync";

type Snapshot = { layers: Layer[]; activeLayerId: string };
type Panel = "annotations" | "layers";

/**
 * Estado de la sincronización con Drive. `working` se usa para no lanzar dos
 * sincronizaciones a la vez (el autoguardado y el botón pueden coincidir).
 */
export type SyncStatus = "idle" | "working" | "error";

interface StoreState {
  ready: boolean;
  library: ScoreSummary[];
  doc: ScoreDocument | null;
  saving: boolean;
  /** Hay cambios locales sin escribir en disco todavía. */
  pendingSave: boolean;
  /**
   * Último fallo de guardado local, o "". Existe porque el peor final posible
   * es que IndexedDB rechace una escritura (cuota llena, modo privado) y el
   * usuario siga dibujando creyendo que se guarda.
   */
  saveError: string;

  tool: ToolId;
  zoom: number;
  activeLayerId: string;
  /**
   * Tramo de compases seleccionado. Puede ser un solo compás o un pasaje
   * entero ("33 a 40"), que es lo que hace falta para anotar de verdad:
   * las indicaciones casi nunca son de un único compás.
   */
  selectedMeasures: MeasureRange | null;
  selectedPinId: string | null;
  selectedStrokeId: string | null;
  panel: Panel;

  /* Plantilla y reproducción */
  /** Partes (instrumentos) de la partitura cargada. */
  parts: PartInfo[];
  /** Número impreso de cada compás, para poder etiquetar los tramos. */
  measureNumbers: string[];
  /** Parte a la que se atribuyen las anotaciones nuevas (null = plantilla). */
  targetPartId: string | null;
  /** Línea de tiempo de reproducción, o null si no hay nada que suene. */
  timeline: PlaybackTimeline | null;
  isPlaying: boolean;
  /** Compás que suena ahora, para marcarlo en la partitura. */
  playheadMeasure: number | null;
  /** Partes silenciadas durante la reproducción. */
  mutedParts: string[];
  /** Seguir el compás que suena, desplazando la vista. */
  followPlayhead: boolean;

  /* Sesión y sincronización con Drive */
  /** Quién está dentro, con qué sesión y contra qué implementación. */
  auth: AuthState;
  /** Hay una petición de acceso en curso. */
  authBusy: boolean;
  /** Fallo del último intento de acceso, o "" para limpiar. */
  authError: string;
  /**
   * Se ha pedido «ver lo guardado en este equipo» desde la pantalla de acceso.
   * Permite trabajar con las partituras locales cuando no hay red, sin sesión:
   * son datos del usuario, y bloquear su propio trabajo por un corte de wifi no
   * protege nada (lo compartido, en Drive, sigue exigiendo sesión).
   */
  localOnly: boolean;
  drivePanelOpen: boolean;
  syncStatus: SyncStatus;
  /** Última frase de resultado o de error, para la barra de estado. */
  syncMessage: string;
  lastSyncAt: number | null;
  /** Sincronizar solo, unos segundos después de cada cambio. */
  autoSync: boolean;
  /** Partituras que hay en Drive ahora mismo, según la última sincronización. */
  remote: ScoreSummary[];

  /** null = el trazo usa el color de su capa. */
  penColor: string | null;
  penWidth: number;
  markerWidth: number;
  soloActiveLayer: boolean;

  past: Snapshot[];
  future: Snapshot[];

  refreshLibrary: () => Promise<void>;
  openScore: (id: string) => Promise<void>;
  createScore: (doc: ScoreDocument) => Promise<void>;
  closeScore: () => void;
  saveNow: () => Promise<void>;
  removeScore: (id: string) => Promise<void>;

  refreshRemote: () => Promise<void>;
  setEndpoint: (endpoint: string) => void;
  setDrivePanelOpen: (open: boolean) => void;
  setAutoSync: (on: boolean) => void;
  testDrive: () => Promise<void>;
  /**
   * Sincroniza. `force` es la confirmación explícita de quien pulsa el botón:
   * hace falta cuando este equipo sincronizó antes con OTRA cuenta, porque
   * subir aquí la biblioteca local subiría el trabajo de otra persona a tu
   * Drive. Sin `force`, en ese caso no se sincroniza y se explica por qué.
   */
  syncNow: (options?: { force?: boolean }) => Promise<void>;

  /** Entra con correo y contraseña (el backend decide si puede). */
  signIn: (email: string, password: string) => Promise<boolean>;
  /** Cierra la sesión. No borra nada de este equipo. */
  signOut: () => void;
  /** Entra sin sesión, sólo con lo que ya está guardado en el navegador. */
  enterLocalOnly: () => void;
  /** Revalida la sesión guardada contra el servidor (y sale si ya no vale). */
  restoreSession: () => Promise<void>;

  setTool: (tool: ToolId) => void;
  setZoom: (zoom: number) => void;
  setPanel: (panel: Panel) => void;
  selectMeasure: (index: number | null) => void;
  /** Extiende la selección hasta `index`, conservando el extremo inicial. */
  extendMeasureSelection: (index: number) => void;
  selectMeasureRange: (range: MeasureRange | null) => void;
  selectPin: (id: string | null) => void;
  selectStroke: (id: string | null) => void;
  /** Metadatos del documento: título, compositor, instrumentación. */
  setMeta: (patch: Partial<ScoreDocument["meta"]>) => void;
  setPenColor: (color: string | null) => void;
  setPenWidth: (width: number) => void;
  setMarkerWidth: (width: number) => void;
  toggleSoloActiveLayer: () => void;

  commitStroke: (stroke: Stroke) => void;
  removeStrokes: (ids: string[]) => void;
  moveStrokeToLayer: (strokeId: string, layerId: string) => void;

  addPin: (input: {
    x: number;
    y: number;
    measureIndex: number | null;
    text: string;
    tag: string;
    /** Ancla explícita; si no se pasa, se calcula con la maquetación actual. */
    anchor?: Anchor | null;
  }) => string | null;
  addPinMessage: (pinId: string, text: string, tag: string) => void;
  togglePinResolved: (pinId: string) => void;
  removePin: (pinId: string) => void;
  /**
   * Mueve un pin de sitio. `measureIndex` se pasa al soltarlo, porque un pin
   * arrastrado a otro compás tiene que quedar anotado en el compás al que ha
   * ido a parar y no en el que estaba; `null` significa «fuera de la música».
   */
  movePin: (
    pinId: string,
    x: number,
    y: number,
    measureIndex?: number | null,
    anchor?: Anchor | null,
  ) => void;

  upsertMeasureNote: (
    target: { from: number; to: number; label: string; partId: string | null },
    patch: Partial<MeasureFields> & { priority?: Priority; tags?: string[] },
  ) => void;
  removeMeasureNoteRange: (from: number, to: number, partId: string | null) => void;

  /**
   * Extensión medida de la partitura abierta. La fija el lienzo después de
   * dibujarla.
   *
   * Vive aquí, y no sólo en el lienzo, para que las anotaciones se anelen al
   * crearse sin que cada punto de llamada tenga que acordarse de hacerlo: el
   * invariante se cumple en el almacén o no se cumple.
   */
  extent: ScoreExtent;
  setExtent: (extent: ScoreExtent) => void;
  /**
   * Pone ancla a las anotaciones que no la tengan (documentos anteriores a que
   * existiera el anclaje). No pasa por el historial: normalizar el formato no
   * es una edición tuya y no debe aparecer en «deshacer».
   */
  reanchor: () => void;

  setParts: (parts: PartInfo[]) => void;
  setMeasureNumbers: (numbers: string[]) => void;
  setTargetPartId: (partId: string | null) => void;
  /**
   * Parte en la que se está centrado, o null para ver la partitura entera.
   *
   * Centrarse en una parte oculta las demás con OSMD, que reserva su espacio:
   * el papel no se mueve y las anotaciones se quedan donde estaban. Y de paso
   * filtra las anotaciones de los demás, que es lo que hace que se pueda
   * anotar «solo lo mío» sin que se mezcle.
   */
  focusedPartId: string | null;
  setFocusedPartId: (partId: string | null) => void;
  /**
   * Transporte de la obra entera, en semitonos. Cambia lo que se lee y lo que
   * suena: es pasar la pieza a otro tono.
   */
  setBaseTranspose: (semitones: number) => void;
  /**
   * Transposición de un instrumento: lo que suma a lo que suena para escribir
   * lo que lee. Sólo afecta al papel.
   */
  setPartTranspose: (partId: string, semitones: number) => void;
  /**
   * Adopta la lectura que el archivo declara para cada parte.
   *
   * No es lo mismo que fijarla: lo que ya esté decidido en el documento manda,
   * y si no hay nada que adoptar no se toca el documento (ni se guarda).
   */
  adoptDeclaredReadings: (declared: Record<string, number>) => void;
  setTimeline: (timeline: PlaybackTimeline | null) => void;
  setIsPlaying: (playing: boolean) => void;
  setPlayheadMeasure: (index: number | null) => void;
  togglePartMuted: (partId: string) => void;
  setFollowPlayhead: (follow: boolean) => void;

  addLayer: (name?: string) => void;
  updateLayer: (id: string, patch: Partial<Omit<Layer, "strokes" | "pins" | "notes">>) => void;
  removeLayer: (id: string) => void;
  moveLayer: (id: string, direction: -1 | 1) => void;
  duplicateLayer: (id: string) => void;
  clearLayer: (id: string) => void;
  setActiveLayer: (id: string) => void;

  undo: () => void;
  redo: () => void;
}

/* ------------------------------------------------------------------ */
/* Historial                                                           */
/* ------------------------------------------------------------------ */

const HISTORY_LIMIT = 80;

function pushHistory(state: StoreState): Snapshot[] {
  if (!state.doc) return state.past;
  return [
    ...state.past,
    { layers: state.doc.layers, activeLayerId: state.activeLayerId },
  ].slice(-HISTORY_LIMIT);
}

/**
 * Aplica un cambio sobre las capas y lo registra en el historial.
 * Las actualizaciones son inmutables, así que podemos guardar la
 * referencia anterior sin clonar nada: el historial sale gratis.
 */
function edit(
  state: StoreState,
  update: (
    layers: Layer[],
    activeLayerId: string,
  ) => { layers: Layer[]; activeLayerId: string } | null,
): Partial<StoreState> {
  if (!state.doc) return {};
  const result = update(state.doc.layers, state.activeLayerId);
  if (!result) return {};
  return {
    doc: {
      ...state.doc,
      layers: result.layers,
      activeLayerId: result.activeLayerId,
      meta: { ...state.doc.meta, updatedAt: Date.now() },
    },
    past: pushHistory(state),
    future: [],
  };
}

function mapLayer(layers: Layer[], id: string, fn: (l: Layer) => Layer): Layer[] {
  return layers.map((l) => (l.id === id ? fn(l) : l));
}

/* ------------------------------------------------------------------ */
/* Autoguardado                                                        */
/* ------------------------------------------------------------------ */

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  // Queda trabajo por escribir: lo consulta el aviso al cerrar la pestaña.
  useStore.setState({ pendingSave: true });
  saveTimer = setTimeout(() => {
    void useStore.getState().saveNow();
  }, 900);
  scheduleAutoSync();
}

/* ------------------------------------------------------------------ */
/* Drive                                                              */
/* ------------------------------------------------------------------ */

/**
 * Lo que Drive ya conoce de cada partitura (ver `lib/sync.ts`). Está fuera del
 * store a propósito: se lee y se escribe sólo al borrar y al sincronizar, y
 * meterlo en el estado haría re-renderizar la interfaz por algo invisible.
 */
let syncState: SyncState = loadSyncState();

let syncTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Espera antes de sincronizar. Subir en cada trazo saturaría Drive de
 * peticiones: un trazo son decenas de puntos y se dibujan muchos por minuto, y
 * la cuota de Drive no perdona. Ocho segundos después del último cambio es un
 * equilibrio entre «está guardado en la nube» y «no molestar».
 */
const AUTO_SYNC_DELAY = 8000;

function scheduleAutoSync() {
  const { autoSync, auth } = useStore.getState();
  if (!autoSync || !hasValidSession(auth)) return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    void useStore.getState().syncNow();
  }, AUTO_SYNC_DELAY);
}

export const useStore = create<StoreState>((set, get) => ({
  ready: false,
  library: [],
  doc: null,
  saving: false,
  pendingSave: false,
  saveError: "",

  tool: "pencil",
  zoom: 1,
  activeLayerId: "",
  selectedMeasures: null,
  selectedPinId: null,
  selectedStrokeId: null,
  panel: "annotations",

  parts: [],
  measureNumbers: [],
  targetPartId: null,
  timeline: null,
  isPlaying: false,
  playheadMeasure: null,
  mutedParts: [],
  followPlayhead: true,
  focusedPartId: null,

  auth: loadAuth(),
  authBusy: false,
  authError: "",
  localOnly: false,
  drivePanelOpen: false,
  syncStatus: "idle",
  syncMessage: "",
  lastSyncAt: null,
  autoSync: true,
  remote: [],

  penColor: null,
  penWidth: 2.4,
  markerWidth: 14,
  soloActiveLayer: false,

  extent: EMPTY_EXTENT,

  past: [],
  future: [],

  async refreshLibrary() {
    let lib = await listScores();
    // El índice y lo guardado pueden discrepar: guardar son dos escrituras (el
    // documento y después el índice) y si la pestaña muere entre las dos, o el
    // navegador vacía parte de IndexedDB, queda una partitura completa que no
    // aparece en la biblioteca y a la que no hay forma de llegar. Se compara con
    // lo que hay de verdad —cuesta un `keys()`— y, si no cuadra, se rehace el
    // índice a partir de los documentos, que son los que mandan.
    if (lib.length === 0 || (await countStoredScores()) !== lib.length) {
      lib = await repairIndex();
    }
    set({ library: lib, ready: true });
  },

  async openScore(id) {
    const doc = await loadScore(id);
    if (!doc) {
      // Pasa cuando el navegador ha vaciado parte de IndexedDB (o al abrir algo
      // que ya no está): sin este aviso, pulsar una partitura no haría nada y
      // parecería que la aplicación se ha colgado.
      set({
        saveError:
          "Esa partitura ya no está en este navegador. Se ha actualizado la lista; si estaba en Drive, sincroniza para recuperarla.",
      });
      await get().refreshLibrary();
      return;
    }
    const activeLayerId =
      doc.layers.find((l) => l.id === doc.activeLayerId)?.id ??
      doc.layers[0]?.id ??
      "";
    set({
      doc: { ...doc, activeLayerId },
      activeLayerId,
      selectedMeasures: null,
      selectedPinId: null,
      selectedStrokeId: null,
      past: [],
      future: [],
      zoom: 1,
      tool: "pencil",
      targetPartId: null,
      isPlaying: false,
      playheadMeasure: null,
      mutedParts: [],
      focusedPartId: null,
    });
  },

  async createScore(doc) {
    const activeLayerId = doc.layers[0]?.id ?? "";
    set({
      doc: { ...doc, activeLayerId },
      activeLayerId,
      selectedMeasures: null,
      selectedPinId: null,
      selectedStrokeId: null,
      past: [],
      future: [],
      zoom: 1,
      tool: "pencil",
      targetPartId: null,
      isPlaying: false,
      playheadMeasure: null,
      mutedParts: [],
      focusedPartId: null,
    });
    try {
      const library = await saveScore(doc);
      set({ library, saveError: "" });
    } catch (error) {
      set({
        saveError:
          "La partitura se ha abierto, pero no se ha podido guardar en este navegador" +
          (error instanceof Error && error.message ? `: ${error.message}` : ".") +
          " Exporta el .json para no perderla.",
      });
    }
  },

  closeScore() {
    set({
      saveError: "",
      doc: null,
      selectedMeasures: null,
      selectedPinId: null,
      selectedStrokeId: null,
      past: [],
      future: [],
      isPlaying: false,
      playheadMeasure: null,
      parts: [],
      timeline: null,
      focusedPartId: null,
    });
  },

  async saveNow() {
    const { doc, saving } = get();
    if (!doc) return;
    if (saving) {
      // Hay una escritura en curso. Esta petición NO se puede descartar: su
      // temporizador ya se ha consumido, así que nadie volvería a pedir el
      // guardado y el último trazo se quedaría sin escribir hasta el siguiente
      // cambio (o hasta cerrar, que es cuando más caro sale perderlo). Se vuelve
      // a programar: la escritura en curso dura milisegundos.
      scheduleSave();
      return;
    }
    set({ saving: true });
    try {
      const library = await saveScore(doc);
      // Si mientras se escribía ha habido más cambios, el aviso de «sin
      // guardar» sigue siendo verdad y no se puede apagar: es lo que consulta
      // el aviso al cerrar la pestaña.
      const stillCurrent = get().doc === doc;
      set({ library, saving: false, pendingSave: !stillCurrent, saveError: "" });
    } catch (error) {
      // Un fallo aquí es grave y hay que decirlo: IndexedDB puede rechazar la
      // escritura por cuota o en modo privado, y seguir dibujando sin avisar
      // sería perder el trabajo en silencio.
      set({
        saving: false,
        saveError:
          "No se han podido guardar los cambios en este navegador" +
          (error instanceof Error && error.message ? `: ${error.message}` : ".") +
          " Exporta el .json para no perderlos.",
      });
    }
  },

  async removeScore(id) {
    const library = await deleteScore(id);
    // Si esa partitura estaba en Drive, hay que borrarla también allí: la
    // lápida espera a la próxima sincronización (ver `lib/sync.ts`).
    syncState = markDeleted(id, syncState);
    saveSyncState(syncState);
    set({ library });
    scheduleAutoSync();
  },

  // Guardar la configuración es sólo eso: se escribe cada tecla de la URL y
  // del token, así que aquí no se toca nada más. Dejar el diálogo a medias (o
  // cerrarlo con `Escape`) no borra lo escrito ni miente sobre el estado.
  /**
   * Pregunta a Drive qué partituras hay, sin sincronizar nada. Sólo sirve para
   * que la biblioteca pueda marcar «en Drive» al abrir la aplicación: sin esto,
   * las etiquetas desaparecían al recargar hasta la siguiente sincronización.
   * Si falla, no se dice nada: la etiqueta es información, no una alarma, y
   * quien quiera enterarse de un problema tiene «Probar conexión».
   */
  async refreshRemote() {
    const auth = get().auth;
    if (!hasValidSession(auth)) return;
    try {
      set({ remote: await listRemote(toDriveConfig(auth)) });
    } catch {
      set({ remote: [] });
    }
  },

  setEndpoint(endpoint) {
    const auth = { ...get().auth, endpoint };
    saveAuth(auth);
    set({ auth, authError: "" });
  },

  setDrivePanelOpen: (drivePanelOpen) => set({ drivePanelOpen }),
  setAutoSync: (autoSync) => set({ autoSync }),

  async signIn(email, password) {
    set({ authBusy: true, authError: "" });
    try {
      const auth = await signIn(get().auth, email, password);
      saveAuth(auth);
      set({ auth, authBusy: false, authError: "", localOnly: false });
      // Al entrar, lo primero es saber qué hay en Drive y traer lo que falte:
      // quien acaba de pedir acceso espera ver sus partituras, no una pantalla
      // vacía que le obligue a buscar un botón.
      await get().refreshRemote();
      // Sincronizar aquí no siempre sube: si este equipo venía de OTRA cuenta,
      // `syncNow` no toca Drive y explica por qué (lo que hay guardado es de
      // quien lo dibujó). Las partituras de Drive se listan igual, que eso no
      // expone el trabajo de nadie.
      await get().syncNow();
      return true;
    } catch (error) {
      set({ authBusy: false, authError: describeAuthError(error) });
      return false;
    }
  },

  signOut() {
    const auth = signOut(get().auth);
    saveAuth(auth);
    // Las partituras NO se tocan: son de este equipo. Lo que se pierde es el
    // acceso a lo compartido, que es justo lo que se está cerrando.
    set({
      auth,
      localOnly: false,
      authError: "",
      remote: [],
      syncStatus: "idle",
      syncMessage: "",
      lastSyncAt: null,
    });
  },

  enterLocalOnly: () => set({ localOnly: true, authError: "" }),

  async restoreSession() {
    const auth = get().auth;
    if (!hasValidSession(auth)) return;
    const confirmed = await revalidateSession(auth, {});
    if (confirmed) {
      saveAuth(confirmed);
      set({ auth: confirmed });
      return;
    }
    // El servidor ha dicho que esta sesión ya no vale (caducada, revocada o la
    // persona ha sido desactivada). Se cierra aquí, no al intentar guardar.
    set({ auth: signOut(auth), authError: "Tu sesión ya no es válida. Vuelve a entrar." });
    saveAuth(get().auth);
  },

  async testDrive() {
    const auth = get().auth;
    if (!hasValidSession(auth)) {
      set({ syncStatus: "error", syncMessage: "Entra con tu cuenta antes de probar." });
      return;
    }
    set({ syncStatus: "working", syncMessage: "Comprobando…" });
    try {
      await testConnection(toDriveConfig(auth));
      set({ syncStatus: "idle", syncMessage: "Conexión correcta. El servidor responde." });
    } catch (error) {
      set({ syncStatus: "error", syncMessage: describeAuthError(error) });
    }
  },

  async syncNow(options) {
    const { auth, syncStatus } = get();
    // Dos sincronizaciones a la vez pisarían el mismo estado y podrían subir y
    // bajar la misma partitura en paralelo.
    if (syncStatus === "working") return;
    if (!hasValidSession(auth)) {
      set({
        syncStatus: "error",
        syncMessage: "Entra con tu cuenta para sincronizar con Drive.",
      });
      return;
    }

    // La biblioteca de este equipo puede ser de otra persona (un ordenador
    // compartido, o simplemente otra cuenta tuya): subirla sin preguntar
    // metería su trabajo en esta carpeta de Drive. Con `force` —el botón, que
    // es una decisión explícita— se sigue adelante y la cuenta pasa a ser la
    // dueña de lo que hay aquí. Ver `needsOwnerConfirmation`.
    const owner = loadSyncOwner();
    if (!options?.force && needsOwnerConfirmation(owner, auth.email)) {
      set({
        syncStatus: "idle",
        syncMessage:
          `Este equipo tiene las partituras de ${owner} y has entrado como ${auth.email}. ` +
          "Pulsa «Sincronizar ahora» si quieres subirlas también a esta cuenta.",
      });
      return;
    }

    // Y antes de hablar con Drive, lo que esté a medias se escribe: sincronizar
    // con el documento viejo que aún está en disco subiría una versión atrasada,
    // y el guardado siguiente la dejaría otra vez pendiente (un vaivén de
    // subidas que no acaba).
    if (get().pendingSave) await get().saveNow();

    saveSyncOwner(auth.email);
    set({ syncStatus: "working", syncMessage: "Sincronizando…" });
    try {
      const { report, state, remote } = await syncWithDrive(
        toDriveConfig(auth),
        localSyncStore,
        syncState,
      );
      syncState = state;
      saveSyncState(state);
      const library = await listScores();

      // Una partitura bajada que estuviera abierta se recarga sola: si no, se
      // seguiría editando una copia vieja y el siguiente guardado pisaría lo
      // que acaba de llegar de Drive.
      let doc: ScoreDocument | null = get().doc;
      const openId = doc?.meta.id;
      if (openId && report.downloaded.includes(openId)) {
        const reloaded = await loadScore(openId);
        if (reloaded) doc = reloaded;
      }

      set({
        library,
        doc,
        remote,
        activeLayerId: doc?.activeLayerId ?? get().activeLayerId,
        syncStatus: report.errors.length > 0 ? "error" : "idle",
        syncMessage: describeReport(report),
        lastSyncAt: Date.now(),
      });
    } catch (error) {
      // Si el servidor dice que la sesión ya no vale, no tiene sentido seguir
      // mostrando un error de sincronización: hay que volver a entrar.
      if (error instanceof DriveError && error.code === "unauthenticated") {
        const fresh = signOut(auth);
        saveAuth(fresh);
        set({
          auth: fresh,
          remote: [],
          syncStatus: "idle",
          syncMessage: "",
          authError: "Tu sesión ha caducado. Vuelve a entrar.",
          drivePanelOpen: false,
        });
        return;
      }
      set({ syncStatus: "error", syncMessage: describeAuthError(error) });
    }
  },

  setTool: (tool) => set({ tool }),
  setZoom: (zoom) =>
    set({ zoom: Math.max(0.3, Math.min(3, Number(zoom.toFixed(2)))) }),
  setPanel: (panel) => set({ panel }),
  selectMeasure: (index) =>
    set({
      selectedMeasures: index == null ? null : { from: index, to: index },
      selectedPinId: null,
      selectedStrokeId: null,
    }),
  extendMeasureSelection: (index) => {
    const current = get().selectedMeasures;
    if (!current) {
      set({ selectedMeasures: { from: index, to: index }, selectedStrokeId: null });
      return;
    }
    // El extremo que NO se mueve es el más alejado del punto pulsado: así
    // arrastrar hacia atrás y hacia delante se comporta como se espera.
    const anchor =
      Math.abs(index - current.from) >= Math.abs(index - current.to)
        ? current.from
        : current.to;
    set({
      selectedMeasures: {
        from: Math.min(anchor, index),
        to: Math.max(anchor, index),
      },
      selectedStrokeId: null,
    });
  },
  selectMeasureRange: (range) => set({ selectedMeasures: range }),
  selectStroke: (id) => set({ selectedStrokeId: id, selectedPinId: null }),
  selectPin: (id) => {
    const pin = id
      ? get().doc?.layers.flatMap((l) => l.pins).find((p) => p.id === id)
      : null;
    const current = get().selectedMeasures;
    set({
      selectedPinId: id,
      selectedStrokeId: null,
      selectedMeasures:
        pin?.measureIndex != null
          ? { from: pin.measureIndex, to: pin.measureIndex }
          : current,
      panel: "annotations",
    });
  },
  /**
   * Metadatos del documento. Van por aquí y no escribiendo el documento a mano
   * desde el componente porque cambiar el título es un cambio como cualquier
   * otro: tiene que marcar `pendingSave` y pasar por el autoguardado. Cuando
   * esto se hacía con un `setState` suelto en `ScoreView`, renombrar una
   * partitura y salir de la aplicación sin tocar nada más podía perder el
   * nombre (sólo se salvaba si el navegador avisaba al cerrar la pestaña).
   */
  setMeta: (patch) => {
    const state = get();
    if (!state.doc) return;
    set({
      doc: {
        ...state.doc,
        meta: { ...state.doc.meta, ...patch, updatedAt: Date.now() },
      },
    });
    scheduleSave();
  },

  setPenColor: (penColor) => set({ penColor }),
  setPenWidth: (penWidth) => set({ penWidth: Math.max(0.5, Math.min(20, penWidth)) }),
  setMarkerWidth: (markerWidth) =>
    set({ markerWidth: Math.max(6, Math.min(60, markerWidth)) }),
  toggleSoloActiveLayer: () => set((s) => ({ soloActiveLayer: !s.soloActiveLayer })),

  setExtent: (extent) => set({ extent }),

  setFocusedPartId: (focusedPartId) =>
    set((state) => ({
      focusedPartId,
      // Centrarse en un instrumento también decide a quién se le apuntan las
      // notas nuevas: si estás mirando el saxo, una dinámica es del saxo.
      targetPartId: focusedPartId ?? state.targetPartId,
    })),

  // El transporte va a los metadatos y no al historial: éste guarda capas, y
  // meter los metadatos dentro obligaría a «deshacer» a saber de dos cosas.
  setBaseTranspose: (semitones) => get().setMeta({ transpose: semitones }),

  setPartTranspose: (partId, semitones) => {
    const state = get();
    if (!state.doc) return;
    set({
      doc: {
        ...state.doc,
        meta: {
          ...state.doc.meta,
          partTransposes: {
            ...state.doc.meta.partTransposes,
            [partId]: semitones,
          },
          updatedAt: Date.now(),
        },
      },
    });
    scheduleSave();
  },

  adoptDeclaredReadings: (declared) => {
    const state = get();
    if (!state.doc) return;
    const merged = adoptReadings(state.doc.meta.partTransposes, declared);
    // Sin nada que adoptar no se toca el documento: ni se guarda ni cambia de
    // identidad, que es lo que evitaría que el lienzo se volviera a maquetar.
    if (!merged) return;
    set({
      doc: {
        ...state.doc,
        meta: { ...state.doc.meta, partTransposes: merged, updatedAt: Date.now() },
      },
    });
    scheduleSave();
  },

  reanchor: () => {
    const state = get();
    if (!state.doc || state.extent.boxes.length === 0) return;

    // Camino rápido: en una partitura ya anclada no hay nada que hacer, y
    // recorrer todas las capas para no cambiar nada despertaría a media
    // aplicación en cada dibujado del lienzo.
    const strokes = state.doc.layers.flatMap((l) => l.strokes);
    const pins = state.doc.layers.flatMap((l) => l.pins);
    if (!needsAnchoring(strokes, pins)) return;

    let changed = false;
    const layers = state.doc.layers.map((l) => {
      // Una capa que no gana ninguna ancla se devuelve tal cual: así lo único
      // que cambia de identidad en el documento es lo que de verdad cambió.
      let touched = false;
      const nextStrokes = l.strokes.map((s) => {
        if (s.anchors && s.anchors.length > 0) return s;
        const anchors = anchorsFor(s, state.extent);
        if (!anchors) return s;
        touched = true;
        return { ...s, anchors };
      });
      const nextPins = l.pins.map((p) => {
        if (p.anchor) return p;
        const anchor = anchorForPin(p, state.extent);
        if (!anchor) return p;
        touched = true;
        return { ...p, anchor };
      });
      if (!touched) return l;
      changed = true;
      return { ...l, strokes: nextStrokes, pins: nextPins };
    });

    if (!changed) return;
    set({ doc: { ...state.doc, layers } });
    scheduleSave();
  },

  commitStroke: (stroke) => {
    const state = get();
    if (!state.doc) return;
    // El trazo nace anclado: quien dibuja no tiene que acordarse de anclarlo, y
    // sin esto una transposición posterior lo dejaría apuntando al papel.
    const anchored: Stroke = {
      ...stroke,
      anchors: stroke.anchors ?? anchorsFor(stroke, state.extent) ?? undefined,
    };
    set(
      edit(state, (layers, activeLayerId) => ({
        layers: mapLayer(layers, activeLayerId, (l) => ({
          ...l,
          strokes: [...l.strokes, anchored],
        })),
        activeLayerId,
      })),
    );
    scheduleSave();
  },

  removeStrokes: (ids) => {
    const state = get();
    if (!state.doc || ids.length === 0) return;
    const gone = new Set(ids);
    set(
      edit(state, (layers, activeLayerId) => {
        // La goma perdona las capas bloqueadas: es la única forma de
        // conservar el trabajo de otros atriles mientras corriges el tuyo.
        const next = layers.map((l) =>
          l.locked || !l.strokes.some((s) => gone.has(s.id))
            ? l
            : { ...l, strokes: l.strokes.filter((s) => !gone.has(s.id)) },
        );
        return { layers: next, activeLayerId };
      }),
    );
    scheduleSave();
  },

  moveStrokeToLayer: (strokeId, layerId) => {
    const state = get();
    if (!state.doc) return;
    set(
      edit(state, (layers, activeLayerId) => {
        const source = layers.find((l) => l.strokes.some((s) => s.id === strokeId));
        const target = layers.find((l) => l.id === layerId);
        if (!source || !target || source.id === target.id || target.locked) return null;
        const stroke = source.strokes.find((s) => s.id === strokeId)!;
        return {
          layers: layers.map((l) => {
            if (l.id === source.id) {
              return { ...l, strokes: l.strokes.filter((s) => s.id !== strokeId) };
            }
            if (l.id === target.id) {
              return { ...l, strokes: [...l.strokes, stroke] };
            }
            return l;
          }),
          activeLayerId,
        };
      }),
    );
    scheduleSave();
  },

  addPin: ({ x, y, measureIndex, text, tag, anchor }) => {
    const state = get();
    if (!state.doc) return null;
    const id = uid("pin");
    const pin: Pin = {
      id,
      x,
      y,
      measureIndex,
      anchor: anchor ?? anchorOf(state.extent, x, y) ?? undefined,
      resolved: false,
      createdAt: Date.now(),
      messages: [
        { id: uid("msg"), text, tag, createdAt: Date.now() },
      ],
    };
    set({
      ...edit(state, (layers, activeLayerId) => ({
        layers: mapLayer(layers, activeLayerId, (l) => ({
          ...l,
          pins: [...l.pins, pin],
        })),
        activeLayerId,
      })),
      selectedPinId: id,
    });
    scheduleSave();
    return id;
  },

  addPinMessage: (pinId, text, tag) => {
    const state = get();
    if (!state.doc) return;
    const message = { id: uid("msg"), text, tag, createdAt: Date.now() };
    set(
      edit(state, (layers, activeLayerId) => ({
        layers: layers.map((l) =>
          l.pins.some((p) => p.id === pinId)
            ? {
                ...l,
                pins: l.pins.map((p) =>
                  p.id === pinId ? { ...p, messages: [...p.messages, message] } : p,
                ),
              }
            : l,
        ),
        activeLayerId,
      })),
    );
    scheduleSave();
  },

  togglePinResolved: (pinId) => {
    const state = get();
    if (!state.doc) return;
    set(
      edit(state, (layers, activeLayerId) => ({
        layers: layers.map((l) =>
          l.pins.some((p) => p.id === pinId)
            ? {
                ...l,
                pins: l.pins.map((p) =>
                  p.id === pinId ? { ...p, resolved: !p.resolved } : p,
                ),
              }
            : l,
        ),
        activeLayerId,
      })),
    );
    scheduleSave();
  },

  removePin: (pinId) => {
    const state = get();
    if (!state.doc) return;
    set({
      ...edit(state, (layers, activeLayerId) => ({
        layers: layers.map((l) =>
          l.locked ? l : { ...l, pins: l.pins.filter((p) => p.id !== pinId) },
        ),
        activeLayerId,
      })),
      selectedPinId: null,
    });
    scheduleSave();
  },

  movePin: (pinId, x, y, measureIndex, anchor) => {
    const state = get();
    if (!state.doc) return;
    set(
      edit(state, (layers, activeLayerId) => ({
        layers: layers.map((l) =>
          l.pins.some((p) => p.id === pinId) && !l.locked
            ? {
                ...l,
                pins: l.pins.map((p) =>
                  p.id === pinId
                    ? {
                        ...p,
                        x,
                        y,
                        // El ancla se recalcula desde la posición nueva. Si no
                        // se puede (partitura aún sin medir), se borra: dejar
                        // el ancla vieja haría que el comentario volviera al
                        // sitio del que lo acabas de mover.
                        anchor: anchor ?? anchorOf(state.extent, x, y) ?? undefined,
                        // Sin destinación no se toca: sólo cuando llega se
                        // actualiza, para no borrar el compás de un pin que
                        // simplemente se ha movido unos píxeles dentro del
                        // mismo compás.
                        measureIndex:
                          measureIndex === undefined ? p.measureIndex : measureIndex,
                      }
                    : p,
                ),
              }
            : l,
        ),
        activeLayerId,
      })),
    );
    scheduleSave();
  },

  upsertMeasureNote: ({ from, to, label, partId }, patch) => {
    const state = get();
    if (!state.doc) return;
    set(
      edit(state, (layers, activeLayerId) => {
        const layer = layers.find((l) => l.id === activeLayerId);
        if (!layer || layer.locked) return null;
        // La identidad de una nota es su tramo MÁS su parte: el mismo pasaje
        // puede llevar una indicación para el saxo y otra para el bajo.
        const sameTarget = (n: MeasureNote) => {
          const r = noteRange(n);
          return r.from === from && r.to === to && (n.partId ?? null) === partId;
        };
        const existing = layer.notes.find(sameTarget);
        const base: MeasureNote = existing ?? {
          id: uid("note"),
          measureIndex: from,
          measureEnd: to,
          measureNumber: label,
          partId,
          fields: { text: "", dynamics: "", articulation: "", fingering: "", technique: "", harmony: "" },
          priority: 0,
          tags: [],
          updatedAt: Date.now(),
        };
        // `priority` y `tags` viajan en el mismo patch pero NO son campos de
        // texto: hay que separarlos antes de esparcir, o se cuelan en `fields`.
        const { priority, tags, ...fieldPatch } = patch;
        const merged: MeasureNote = {
          ...base,
          measureIndex: from,
          measureEnd: to,
          measureNumber: label,
          partId,
          fields: { ...base.fields, ...fieldPatch },
          priority: priority ?? base.priority,
          tags: tags ?? base.tags,
          updatedAt: Date.now(),
        };
        const isEmpty =
          Object.values(merged.fields).every(
            (value) => !String(value ?? "").trim(),
          ) &&
          merged.priority === 0 &&
          merged.tags.length === 0;

        return {
          layers: mapLayer(layers, activeLayerId, (l) => ({
            ...l,
            notes: existing
              ? isEmpty
                ? l.notes.filter((n) => !sameTarget(n))
                : l.notes.map((n) => (sameTarget(n) ? merged : n))
              : isEmpty
                ? l.notes
                : [...l.notes, merged],
          })),
          activeLayerId,
        };
      }),
    );
    scheduleSave();
  },

  removeMeasureNoteRange: (from, to, partId) => {
    const state = get();
    if (!state.doc) return;
    set(
      edit(state, (layers, activeLayerId) => ({
        layers: mapLayer(layers, activeLayerId, (l) => ({
          ...l,
          notes: l.notes.filter((n) => {
            const r = noteRange(n);
            return !(
              r.from === from &&
              r.to === to &&
              (n.partId ?? null) === partId
            );
          }),
        })),
        activeLayerId,
      })),
    );
    scheduleSave();
  },

  setParts: (parts) => set({ parts }),
  setMeasureNumbers: (measureNumbers) => set({ measureNumbers }),
  setTargetPartId: (targetPartId) => set({ targetPartId }),
  setTimeline: (timeline) => set({ timeline }),
  setIsPlaying: (isPlaying) => set({ isPlaying }),
  setPlayheadMeasure: (playheadMeasure) => {
    if (get().playheadMeasure === playheadMeasure) return;
    set({ playheadMeasure });
  },
  togglePartMuted: (partId) =>
    set((s) => ({
      mutedParts: s.mutedParts.includes(partId)
        ? s.mutedParts.filter((id) => id !== partId)
        : [...s.mutedParts, partId],
    })),
  setFollowPlayhead: (followPlayhead) => set({ followPlayhead }),

  addLayer: (name) => {
    const state = get();
    if (!state.doc) return;
    const layer = makeLayer(name ?? `Capa ${state.doc.layers.length}`, state.doc.layers.length);
    set({
      ...edit(state, (layers) => ({ layers: [...layers, layer], activeLayerId: layer.id })),
      activeLayerId: layer.id,
    });
    scheduleSave();
  },

  updateLayer: (id, patch) => {
    const state = get();
    if (!state.doc) return;
    set(edit(state, (layers, activeLayerId) => ({
      layers: mapLayer(layers, id, (l) => ({ ...l, ...patch })),
      activeLayerId,
    })));
    scheduleSave();
  },

  removeLayer: (id) => {
    const state = get();
    if (!state.doc || state.doc.layers.length <= 1) return;
    const remaining = state.doc.layers.filter((l) => l.id !== id);
    set({
      ...edit(state, (layers, activeLayerId) => ({
        layers: remaining,
        activeLayerId:
          activeLayerId === id ? remaining[remaining.length - 1].id : activeLayerId,
      })),
      activeLayerId:
        state.activeLayerId === id
          ? remaining[remaining.length - 1].id
          : state.activeLayerId,
    });
    scheduleSave();
  },

  moveLayer: (id, direction) => {
    const state = get();
    if (!state.doc) return;
    set(
      edit(state, (layers, activeLayerId) => {
        const i = layers.findIndex((l) => l.id === id);
        const j = i + direction;
        if (i < 0 || j < 0 || j >= layers.length) return null;
        const next = [...layers];
        [next[i], next[j]] = [next[j], next[i]];
        return { layers: next, activeLayerId };
      }),
    );
    scheduleSave();
  },

  duplicateLayer: (id) => {
    const state = get();
    if (!state.doc) return;
    set(
      edit(state, (layers) => {
        const source = layers.find((l) => l.id === id);
        if (!source) return null;
        const color =
          LAYER_PALETTE[(layers.length + 1) % LAYER_PALETTE.length];
        const copy: Layer = {
          ...source,
          id: uid("layer"),
          name: `${source.name} (copia)`,
          color,
          // Las anclas se copian una a una: con `{...s}` las dos copias
          // compartirían el MISMO array, y cualquier cosa que lo tocara en un
          // sitio movería la tinta del otro. Los identificadores sí son nuevos:
          // son dos trazos distintos aunque salgan del mismo sitio.
          strokes: source.strokes.map((s) => ({
            ...s,
            id: uid("stroke"),
            anchors: s.anchors?.map((anchor) => ({ ...anchor })),
          })),
          pins: source.pins.map((p) => ({
            ...p,
            id: uid("pin"),
            anchor: p.anchor ? { ...p.anchor } : undefined,
            messages: p.messages.map((m) => ({ ...m, id: uid("msg") })),
          })),
          notes: source.notes.map((n) => ({ ...n, id: uid("note"), tags: [...n.tags] })),
        };
        return { layers: [...layers, copy], activeLayerId: copy.id };
      }),
    );
    scheduleSave();
  },

  clearLayer: (id) => {
    const state = get();
    if (!state.doc) return;
    set(
      edit(state, (layers, activeLayerId) => ({
        layers: mapLayer(layers, id, (l) => ({ ...l, strokes: [], pins: [], notes: [] })),
        activeLayerId,
      })),
    );
    scheduleSave();
  },

  setActiveLayer: (activeLayerId) => {
    const state = get();
    if (!state.doc) return;
    set({
      activeLayerId,
      doc: { ...state.doc, activeLayerId },
    });
  },

  undo: () => {
    const state = get();
    if (!state.doc || state.past.length === 0) return;
    const previous = state.past[state.past.length - 1];
    set({
      doc: { ...state.doc, layers: previous.layers, activeLayerId: previous.activeLayerId },
      activeLayerId: previous.activeLayerId,
      past: state.past.slice(0, -1),
      future: [
        ...state.future,
        { layers: state.doc.layers, activeLayerId: state.activeLayerId },
      ].slice(-HISTORY_LIMIT),
    });
    scheduleSave();
  },

  redo: () => {
    const state = get();
    if (!state.doc || state.future.length === 0) return;
    const next = state.future[state.future.length - 1];
    set({
      doc: { ...state.doc, layers: next.layers, activeLayerId: next.activeLayerId },
      activeLayerId: next.activeLayerId,
      future: state.future.slice(0, -1),
      past: [
        ...state.past,
        { layers: state.doc.layers, activeLayerId: state.activeLayerId },
      ].slice(-HISTORY_LIMIT),
    });
    scheduleSave();
  },
}));

/* ------------------------------------------------------------------ */
/* Selectores                                                          */
/* ------------------------------------------------------------------ */

export function useActiveLayer(): Layer | null {
  return useStore((s) => s.doc?.layers.find((l) => l.id === s.activeLayerId) ?? null);
}

/** Capas que deben pintarse, respetando "solo capa activa" y el orden de z. */
/**
 * Capas que deben pintarse, ya con el filtro de la parte en la que se está
 * centrado.
 *
 * El filtro vive aquí, y no en quien pinta, porque hay tres sitios que tienen
 * que estar de acuerdo —lo que se dibuja, lo que borra la goma y lo que
 * encuentra el puntero—: si cada uno filtrara por su cuenta, se podría borrar
 * lo que no se ve.
 */
export function visibleLayers(
  layers: Layer[],
  activeLayerId: string,
  soloActiveLayer: boolean,
  focusedPartId: string | null = null,
): Layer[] {
  const shown = layers.filter(
    (l) => l.visible && (!soloActiveLayer || l.id === activeLayerId),
  );
  if (!focusedPartId) return shown;
  return shown.map((l) => ({
    ...l,
    strokes: l.strokes.filter((s) => strokeBelongsToPart(s, focusedPartId)),
    pins: l.pins.filter((p) => pinBelongsToPart(p, focusedPartId)),
    // Una dinámica del piano no pinta nada mientras se mira el saxo.
    notes: l.notes.filter((n) => !n.partId || n.partId === focusedPartId),
  }));
}

export function collectPins(layers: Layer[]): { pin: Pin; layer: Layer }[] {
  const out: { pin: Pin; layer: Layer }[] = [];
  for (const layer of layers) {
    for (const pin of layer.pins) out.push({ pin, layer });
  }
  return out.sort((a, b) => a.pin.createdAt - b.pin.createdAt);
}

export function collectNotes(layers: Layer[]): { note: MeasureNote; layer: Layer }[] {
  const out: { note: MeasureNote; layer: Layer }[] = [];
  for (const layer of layers) {
    for (const note of layer.notes) out.push({ note, layer });
  }
  return out.sort((a, b) => a.note.measureIndex - b.note.measureIndex);
}
