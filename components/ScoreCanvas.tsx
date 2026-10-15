"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  EMPTY_EXTENT,
  applyTransposition,
  clientToScore,
  declaredReadings,
  distToSegment,
  measureAt,
  pressureOutline,
  readScoreExtent,
  setFocusedPart,
  spanBands,
  type ScoreExtent,
} from "@/lib/geometry";
import { pinPoint, strokePoints } from "@/lib/anchors";
import { effectiveReadings } from "@/lib/transpose";
import { buildTimeline, getSharedPlayer } from "@/lib/playback";
import { collectPins, useStore, visibleLayers } from "@/lib/store";
import {
  noteRange,
  uid,
  type Layer,
  type Pin,
  type Pt,
  type Stroke,
} from "@/lib/types";
import TransportBar from "./TransportBar";

/**
 * Ancho de maquetación de la partitura, en píxeles de espacio de partitura.
 *
 * NO es un detalle cosmético: OSMD decide dónde rompe los sistemas según el
 * ancho del contenedor. Si el ancho cambiara al redimensionar la ventana, los
 * compases se moverían y todas las anotaciones guardadas en coordenadas
 * absolutas se desalinearían. Por eso el ancho es fijo y el zoom se aplica con
 * un transform sobre el conjunto partitura + anotaciones.
 */
const DEFAULT_LAYOUT_WIDTH = 1180;

const COMMENT_TAGS = [
  "recordatorio",
  "digitación",
  "dinámica",
  "corrección",
  "duda",
  "análisis",
];

interface CommentDraft {
  left: number;
  top: number;
  x: number;
  y: number;
  measureIndex: number | null;
  measureNumber: string;
}

/** Mismo rango y mismo redondeo que aplica `setZoom` en el store. */
const clampZoom = (zoom: number) => Math.max(0.3, Math.min(3, Number(zoom.toFixed(2))));

/**
 * Zoom mínimo al que se abre una partitura en una pantalla estrecha. Encajar
 * 1180 px de maquetación en los 390 de un móvil da un 30 %: la música queda
 * ilegible. A partir de aquí se lee, y para recorrerla están el desplazamiento
 * de dos dedos y el pellizco.
 */
const READABLE_MIN_ZOOM = 0.55;

export default function ScoreCanvas() {
  const doc = useStore((s) => s.doc);
  const zoom = useStore((s) => s.zoom);
  const tool = useStore((s) => s.tool);
  const penColor = useStore((s) => s.penColor);
  const penWidth = useStore((s) => s.penWidth);
  const markerWidth = useStore((s) => s.markerWidth);
  const activeLayerId = useStore((s) => s.activeLayerId);
  const soloActiveLayer = useStore((s) => s.soloActiveLayer);
  const selectedMeasures = useStore((s) => s.selectedMeasures);
  const selectedPinId = useStore((s) => s.selectedPinId);
  const selectedStrokeId = useStore((s) => s.selectedStrokeId);
  const playheadMeasure = useStore((s) => s.playheadMeasure);
  const followPlayhead = useStore((s) => s.followPlayhead);
  const mutedParts = useStore((s) => s.mutedParts);

  const setZoom = useStore((s) => s.setZoom);
  const selectMeasure = useStore((s) => s.selectMeasure);
  const extendMeasureSelection = useStore((s) => s.extendMeasureSelection);
  const selectPin = useStore((s) => s.selectPin);
  const selectStroke = useStore((s) => s.selectStroke);
  const commitStroke = useStore((s) => s.commitStroke);
  const removeStrokes = useStore((s) => s.removeStrokes);
  const addPin = useStore((s) => s.addPin);
  const movePin = useStore((s) => s.movePin);
  const setParts = useStore((s) => s.setParts);
  const setMeasureNumbers = useStore((s) => s.setMeasureNumbers);
  const setTimeline = useStore((s) => s.setTimeline);
  const setPlayheadMeasure = useStore((s) => s.setPlayheadMeasure);
  const setIsPlaying = useStore((s) => s.setIsPlaying);
  const setStoreExtent = useStore((s) => s.setExtent);
  const adoptDeclaredReadings = useStore((s) => s.adoptDeclaredReadings);
  const reanchor = useStore((s) => s.reanchor);
  const parts = useStore((s) => s.parts);
  const focusedPartId = useStore((s) => s.focusedPartId);
  const setFocusedPartId = useStore((s) => s.setFocusedPartId);

  const viewportRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<SVGSVGElement>(null);
  const livePathRef = useRef<SVGPathElement>(null);
  /** Papel y escenario: el gesto de dos dedos los escala sin pasar por React. */
  const paperRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  /** Dedos apoyados en la partitura, por identificador de puntero. */
  const pointers = useRef(new Map<number, { x: number; y: number; type: string }>());
  const pinch = useRef<{
    /** Punto de la partitura que debe seguir bajo los dedos. */
    anchor: { x: number; y: number };
    distance: number;
    zoom: number;
    paperTop: number;
  } | null>(null);
  const appliedZoom = useRef<number | null>(null);
  const osmdRef = useRef<unknown>(null);
  /**
   * Partitura que está dibujada ahora mismo. Sirve para distinguir «abrir otra
   * partitura» de «volver a dibujar ésta» (al cambiar el transporte): lo primero
   * vacía la pantalla, lo segundo no debe hacerlo.
   */
  const renderedScore = useRef<string | undefined>(undefined);

  const [extent, setExtent] = useState<ScoreExtent>(EMPTY_EXTENT);
  const [contentHeight, setContentHeight] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [draft, setDraft] = useState<CommentDraft | null>(null);

  const layoutWidth = doc?.meta.layoutWidth ?? DEFAULT_LAYOUT_WIDTH;
  // Se extraen aquí para que el efecto de dibujo dependa sólo de la partitura
  // y no del objeto `doc` completo (que cambia con cada trazo).
  const scoreId = doc?.meta.id;
  const scoreXml = doc?.xml;
  // Se extraen igual que el XML: cambiar el transporte re-maqueta la partitura,
  // así que tienen que disparar el mismo efecto que abrir otro documento.
  const baseTranspose = doc?.meta.transpose ?? 0;
  const partTransposes = doc?.meta.partTransposes;

  const boxes = extent.boxes;

  // Trazo en curso: vive en un ref y se pinta tocando el atributo `d`
  // directamente. Meter cada pointermove en el estado haría el dibujo pesado.
  const livePoints = useRef<Pt[]>([]);
  const liveWidth = useRef(2.4);
  const drawing = useRef(false);
  const erasing = useRef(false);
  const pendingErase = useRef<Set<string>>(new Set());
  const [erasingIds, setErasingIds] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  /** Compás donde empezó un arrastre con la herramienta de compases. */
  const dragAnchor = useRef<number | null>(null);
  /**
   * Pin que se está arrastrando, con el desfase entre el dedo y el pin (para
   * que no salte al agarrarlo) y su posición de partida, por si el arrastre
   * acaba siendo un simple toque y hay que devolverlo a su sitio.
   */
  const pinDrag = useRef<{
    id: string;
    offsetX: number;
    offsetY: number;
    fromX: number;
    fromY: number;
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);
  /** Nodos de los pines, para moverlos sin pasar por React en cada fotograma. */
  const pinNodes = useRef(new Map<string, SVGGElement>());

  const layers = useMemo(() => doc?.layers ?? [], [doc?.layers]);
  const drawn = useMemo(
    () => visibleLayers(layers, activeLayerId, soloActiveLayer, focusedPartId),
    [layers, activeLayerId, soloActiveLayer, focusedPartId],
  );

  /**
   * Posiciones ya resueltas desde su ancla.
   *
   * Se calculan una vez por maquetación y las comparten el dibujo, la goma, el
   * buscador de trazos y el arrastre de comentarios: es lo que garantiza que
   * todos ven lo mismo. Si cada uno resolviera por su cuenta, la tinta donde se
   * pinta y la tinta donde se borra podrían no coincidir.
   */
  const strokeView = useMemo(() => {
    const map = new Map<string, Pt[]>();
    for (const layer of drawn) {
      for (const stroke of layer.strokes) map.set(stroke.id, strokePoints(stroke, extent));
    }
    return map;
  }, [drawn, extent]);

  const pinView = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    for (const layer of drawn) {
      for (const pin of layer.pins) map.set(pin.id, pinPoint(pin, extent));
    }
    return map;
  }, [drawn, extent]);

  const pointsOf = useCallback(
    (stroke: Stroke) => strokeView.get(stroke.id) ?? stroke.points,
    [strokeView],
  );
  const pinAt = useCallback(
    (pin: Pin) => pinView.get(pin.id) ?? { x: pin.x, y: pin.y },
    [pinView],
  );

  /**
   * Un documento guardado antes de que existiera el anclaje se normaliza en
   * cuanto hay maquetación con la que hacerlo. Se hace aquí, después de medir,
   * porque el ancho de maquetación va congelado en el documento: esta primera
   * maquetación es la misma en la que se dibujó, así que el cálculo es fiel.
   */
  useEffect(() => {
    if (extent.boxes.length > 0) reanchor();
  }, [extent, reanchor]);

  /* ---------------------------------------------------------------- */
  /* Render de la partitura                                            */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    if (!scoreId || !scoreXml || !hostRef.current) return;
    let cancelled = false;
    // Cambiar el transporte re-maqueta la misma partitura que ya está en
    // pantalla. Vaciar aquí dejaría un parpadeo en blanco (y anunciaría una
    // carga) por algo que en realidad es redibujar lo que ya se ve.
    const sameScore = renderedScore.current === scoreId;
    renderedScore.current = scoreId;
    if (!sameScore) {
      setStatus("loading");
      setExtent(EMPTY_EXTENT);
      // La plantilla y la línea de tiempo las calcula y las vacía este efecto,
      // que es quien tiene la partitura renderizada. No las toca el store: si
      // `openScore` las vaciara al abrir, podría hacerlo *después* de que este
      // efecto ya las hubiera llenado (la lectura de IndexedDB queda detrás de
      // la escritura de guardado) y el transporte se quedaba sin partitura.
      setParts([]);
      setTimeline(null);
      // Y la extensión que conoce el almacén también se vacía. Es la que usan
      // `commitStroke`, `addPin` y `movePin` para anclar, así que dejarla con los
      // compases de la partitura anterior anclaría un trazo dibujado en este
      // hueco mortal —el rato que OSMD tarda en maquetar— a las cajas de la otra
      // partitura. Vacía, esas anotaciones nacen sin ancla y las ancla
      // `reanchor` en cuanto hay maquetación nueva, que es su trabajo.
      setStoreExtent(EMPTY_EXTENT);
    }

    (async () => {
      try {
        const mod = await import("opensheetmusicdisplay");
        if (cancelled || !hostRef.current) return;

        hostRef.current.innerHTML = "";
        const osmd = new mod.OpenSheetMusicDisplay(hostRef.current, {
          autoResize: false,
          backend: "svg",
          drawTitle: true,
          drawComposer: true,
          drawPartNames: true,
        } as ConstructorParameters<typeof mod.OpenSheetMusicDisplay>[1]);
        // Sin calculadora de transposición, `Transpose` se guarda y no hace
        // nada. Es el paso que se olvida siempre, así que va aquí y no en una
        // nota al pie.
        osmd.TransposeCalculator = new mod.TransposeCalculator();

        await osmd.load(scoreXml);
        if (cancelled) return;
        // Lo que el archivo ya declara sobre cómo se lee cada parte se adopta
        // aquí, donde el modelo de OSMD está delante. La primera pasada usa la
        // mezcla para que la parte se dibuje ya como se escribió: adoptarlo
        // después enseñaría un salto de una sexta al abrir una partitura de
        // banda.
        const declared = declaredReadings(osmd);
        adoptDeclaredReadings(declared);
        // Centrarse en una parte oculta el dibujo de las demás. Va entre el
        // `load` y el `render`, y no recorta el papel: OSMD reserva el espacio
        // de lo oculto, así que las anotaciones no se mueven ni un píxel.
        setFocusedPart(osmd, focusedPartId);
        applyTransposition(osmd, baseTranspose, effectiveReadings(declared, partTransposes));
        // Y hay que rehacer la plancha gráfica, que es el paso que se salta
        // todo el mundo: `render()` sola transpone la **armadura** y deja las
        // notas donde estaban, así que un saxo en Mi♭ acababa leyendo «tres
        // sostenidos» con un Do debajo. Medido, no supuesto.
        //
        // Los desplazamientos de la plancha nueva siguen viniendo en unidades
        // de OSMD (no en píxeles): quien los lee después los convierte.
        osmd.updateGraphic();
        await Promise.resolve(osmd.render());
        if (cancelled) return;

        osmdRef.current = osmd;
        const measured = readScoreExtent(osmd);
        setExtent(measured);
        // El almacén también necesita las cajas: es quien ancla al crear.
        setStoreExtent(measured);
        setContentHeight(
          Math.max(measured.height, hostRef.current.offsetHeight),
        );
        setStatus("ready");

        // La línea de tiempo de reproducción se construye una sola vez, con la
        // partitura ya cargada, y sale del mismo modelo que se ha dibujado.
        // El transporte se le pasa al motor: OSMD sólo lo aplica al dibujo, así
        // que sin esto la obra se leería en otro tono y sonaría en el de antes.
        const timeline = buildTimeline(osmd, baseTranspose);
        const player = getSharedPlayer();
        player.stop();
        player.setTimeline(timeline);
        player.resetCursorTracking();
        setParts(measured.parts);
        setMeasureNumbers(measured.boxes.map((b) => b.measureNumber));
        setTimeline(timeline);
        // La barra de transporte vuelve a cero con la partitura nueva.
        window.dispatchEvent(new Event("ps:playback-reset"));
        try {
          (osmd as { cursor?: { hide?: () => void } }).cursor?.hide?.();
        } catch {
          /* el cursor es opcional */
        }
      } catch (error) {
        if (cancelled) return;
        console.error("No se pudo cargar la partitura", error);
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Error desconocido al leer la partitura.",
        );
        setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
    };
    // Ojo: nada de las capas en esta lista. La partitura dibujada no depende de
    // las anotaciones, y volver a maquetarla al crear una capa movería los
    // compases y dejaría los trazos desalineados.
  }, [
    scoreId,
    scoreXml,
    baseTranspose,
    partTransposes,
    focusedPartId,
    adoptDeclaredReadings,
    setParts,
    setMeasureNumbers,
    setTimeline,
    setStoreExtent,
  ]);

  // Encuadre: si la partitura es más ancha que el hueco, se encaja.
  const fittedFor = useRef<string | null>(null);
  /** Último zoom puesto por la aplicación, para no pisar el del usuario. */
  const autoZoom = useRef<number | null>(null);

  const fitZoom = useCallback(
    (floor: number) => {
      const viewport = viewportRef.current;
      if (!viewport) return null;
      const available = viewport.clientWidth - 64;
      if (available <= 0) return null;
      // Si la partitura cabe entera, no se amplía más allá del tamaño real.
      return available >= layoutWidth ? 1 : clampZoom(Math.max(floor, available / layoutWidth));
    },
    [layoutWidth],
  );

  useEffect(() => {
    if (status !== "ready" || !doc) return;
    const viewport = viewportRef.current;

    if (fittedFor.current !== doc.meta.id) {
      fittedFor.current = doc.meta.id;
      const width = viewport?.clientWidth ?? 0;
      autoZoom.current = fitZoom(width > 0 && width < 640 ? READABLE_MIN_ZOOM : 0.3);
      if (autoZoom.current !== null) setZoom(autoZoom.current);
    }

    // Girar la tableta o el móvil, o cambiar de tamaño la ventana, vuelve a
    // encuadrar. Sólo mientras el zoom siga siendo el que puso la aplicación:
    // si el usuario lo cambió a mano (o con los dedos), su elección manda.
    if (!viewport || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (autoZoom.current === null) return;
      if (Math.abs(useStore.getState().zoom - autoZoom.current) > 0.001) return;
      const next = fitZoom(viewport.clientWidth < 640 ? READABLE_MIN_ZOOM : 0.3);
      if (next === null) return;
      autoZoom.current = next;
      setZoom(next);
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [status, doc, fitZoom, setZoom]);

  /* ---------------------------------------------------------------- */
  /* Reproducción: callbacks y seguimiento                             */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    const player = getSharedPlayer();
    player.setCallbacks({
      onTime: (seconds, measureIndex) => {
        if (measureIndex != null) setPlayheadMeasure(measureIndex);
        const osmd = osmdRef.current as
          | { cursor?: { next?: () => void; update?: () => void; show?: () => void } }
          | null;
        const cursor = osmd?.cursor;
        if (!cursor?.next) return;
        try {
          cursor.show?.();
          player.advanceCursorTo(seconds, () => cursor.next?.());
          cursor.update?.();
        } catch {
          // Si el cursor falla, la reproducción sigue: es un extra.
        }
      },
      onEnded: () => {
        setIsPlaying(false);
        setPlayheadMeasure(null);
        const osmd = osmdRef.current as { cursor?: { reset?: () => void; hide?: () => void } } | null;
        try {
          osmd?.cursor?.reset?.();
          osmd?.cursor?.hide?.();
        } catch {
          /* opcional */
        }
      },
    });
    return () => player.setCallbacks({});
  }, [setPlayheadMeasure, setIsPlaying]);

  // El silenciado por parte lo aplica el motor, que es quien agenda las notas.
  useEffect(() => {
    getSharedPlayer().setMutedParts(mutedParts);
  }, [mutedParts]);

  /**
   * Superficie de diagnóstico en desarrollo. Un lienzo con dos sistemas de
   * coordenadas (el de OSMD y el nuestro) es imposible de depurar a ojo:
   * desde la consola se pueden comprobar las cajas de los compases, la
   * plantilla, la línea de tiempo de reproducción y qué compás cae en un punto.
   */
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    (window as unknown as Record<string, unknown>).__partitura = {
      // Documento vivo de OSMD: imprescindible para comprobar a mano de dónde
      // sale cada altura o cada tiempo en vez de deducirlo del dibujo.
      osmd: () => osmdRef.current,
      measureBoxes: () => extent.boxes,
      staffBoxes: () => extent.staffBoxes,
      layoutWidth,
      zoom: () => useStore.getState().zoom,
      measureAt: (x: number, y: number) => measureAt(extent.boxes, x, y),
      snapshot: () => {
        const s = useStore.getState();
        return {
          tool: s.tool,
          zoom: s.zoom,
          activeLayerId: s.activeLayerId,
          selectedMeasures: s.selectedMeasures,
          targetPartId: s.targetPartId,
          mutedParts: s.mutedParts,
          playheadMeasure: s.playheadMeasure,
          isPlaying: s.isPlaying,
          parts: s.parts.map((p) => ({
            id: p.id,
            name: p.name,
            staffIndices: p.staffIndices,
          })),
          measureNumbers: s.measureNumbers,
          timeline: s.timeline
            ? {
                notes: s.timeline.notes.length,
                duration: Number(s.timeline.duration.toFixed(3)),
                tempo: s.timeline.tempo,
                measureTimes: s.timeline.measureTimes.length,
                cursorSteps: s.timeline.cursorTimes?.length ?? null,
                firstNotes: s.timeline.notes.slice(0, 10),
              }
            : null,
          notes: (s.doc?.layers ?? []).flatMap((l) =>
            l.notes.map((n) => ({
              layer: l.name,
              range: [n.measureIndex, n.measureEnd ?? n.measureIndex],
              partId: n.partId ?? null,
              label: n.measureNumber,
              priority: n.priority,
            })),
          ),
          // Lo que el documento CONTIENE y lo que se está PINTANDO no tienen por
          // qué coincidir: al centrarse en una parte se apartan las anotaciones
          // de las demás. Sin esta pareja de números no se puede comprobar el
          // filtro desde la consola.
          focusedPartId: s.focusedPartId,
          // Con esto se comprueba desde la consola la invariante que sostiene la
          // transposición: cambiar cómo lee una parte mueve las dos primeras
          // cifras y no la tercera, y transportar la obra las mueve todas.
          transposes: {
            /** Transporte de la obra: lo que se lee y lo que suena. */
            obra: baseTranspose,
            /** Cómo lee cada parte: sólo lo que se lee. */
            lecturas: partTransposes ?? {},
            /** Lo que declara el propio archivo, en la misma convención. */
            declarado: declaredReadings(osmdRef.current),
          },
          dibujados: drawn.reduce(
            (total, l) => total + l.strokes.length + l.pins.length + l.notes.length,
            0,
          ),
          layers: (s.doc?.layers ?? []).map((l) => ({
            id: l.id,
            name: l.name,
            visible: l.visible,
            locked: l.locked,
            strokes: l.strokes.length,
            pins: l.pins.length,
            notes: l.notes.length,
          })),
          strokes: (s.doc?.layers ?? []).flatMap((l) =>
            l.strokes.map((st) => ({
              id: st.id,
              layer: l.name,
              tool: st.tool,
              width: st.width,
              points: st.points.length,
              // El ancla es la verdad; `points` es sólo la última maquetación.
              // Ver la posición dibujada, y no la guardada, es lo que permite
              // comprobar a mano que una transposición no mueve la tinta.
              anchors: st.anchors?.length ?? 0,
              // A quién pertenece el trazo, según dónde cayó.
              partesDe: st.anchors
                ? [...new Set(st.anchors.map((a) => a.p).filter(Boolean))]
                : null,
              guardadoEn: st.points[0],
              dibujadoEn: strokePoints(st, extent)[0],
            })),
          ),
          // Estado de la sesión y de la sincronización. La sesión NO se incluye
          // entera: una consola de desarrollo se acaba pegando en un informe de
          // error, y ese token vale tanto como una contraseña mientras dura.
          auth: {
            endpoint: s.auth.endpoint || null,
            email: s.auth.email || null,
            expiresAt: s.auth.expiresAt || null,
            localOnly: s.localOnly,
          },
          drive: {
            autoSync: s.autoSync,
            status: s.syncStatus,
            message: s.syncMessage,
            lastSyncAt: s.lastSyncAt,
            remoteIds: s.remote.map((r) => r.id),
          },
        };
      },
    };
  }, [extent, layoutWidth, drawn, baseTranspose, partTransposes]);

  // Cerrar la partitura no debe dejar música sonando: el reproductor es
  // compartido y sobrevive a este componente, así que hay que pararlo aquí.
  useEffect(() => {
    const player = getSharedPlayer();
    return () => {
      player.stop();
      player.setCallbacks({});
      setIsPlaying(false);
      setPlayheadMeasure(null);
    };
  }, [setIsPlaying, setPlayheadMeasure]);

  // Al detener o al buscar otra posición hay que rebobinar el cursor: avanza
  // sólo hacia delante, así que no sirve dejarlo donde estaba. Al detener hay
  // que ocultarlo además, o queda una barra negra parada en el primer compás.
  useEffect(() => {
    const rewind = (event: Event) => {
      const player = getSharedPlayer();
      player.resetCursorTracking();
      const osmd = osmdRef.current as {
        cursor?: { reset?: () => void; hide?: () => void };
      } | null;
      try {
        osmd?.cursor?.reset?.();
        if (event.type === "ps:playback-reset") osmd?.cursor?.hide?.();
      } catch {
        /* el cursor es opcional */
      }
    };
    window.addEventListener("ps:playback-reset", rewind);
    window.addEventListener("ps:playback-seek", rewind);
    return () => {
      window.removeEventListener("ps:playback-reset", rewind);
      window.removeEventListener("ps:playback-seek", rewind);
    };
  }, []);

  // Seguir el compás que suena desplazando la vista.
  useEffect(() => {
    if (!followPlayhead || playheadMeasure == null || !viewportRef.current) return;
    const box = boxes.find((b) => b.measureIndex === playheadMeasure);
    const viewport = viewportRef.current;
    if (!box) return;
    const targetTop = (box.y - 60) * zoom;
    const targetBottom = (box.y + box.height + 40) * zoom;
    const visibleTop = viewport.scrollTop;
    const visibleBottom = visibleTop + viewport.clientHeight;
    if (targetTop < visibleTop || targetBottom > visibleBottom) {
      viewport.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
    }
  }, [playheadMeasure, followPlayhead, boxes, zoom]);

  /* ---------------------------------------------------------------- */
  /* Conversión de coordenadas                                         */
  /* ---------------------------------------------------------------- */

  const toScore = useCallback(
    (clientX: number, clientY: number) => {
      const rect = overlayRef.current?.getBoundingClientRect();
      if (!rect) return null;
      return clientToScore(rect, zoom, clientX, clientY);
    },
    [zoom],
  );

  /* ---------------------------------------------------------------- */
  /* Tinta                                                             */
  /* ---------------------------------------------------------------- */

  const finishStroke = useCallback(() => {
    const points = livePoints.current;
    drawing.current = false;
    if (livePathRef.current) livePathRef.current.setAttribute("d", "");
    if (points.length === 0) return;
    const store = useStore.getState();
    const layer = store.doc?.layers.find((l) => l.id === store.activeLayerId);
    if (!layer || layer.locked) {
      livePoints.current = [];
      return;
    }
    const stroke: Stroke = {
      id: uid("stroke"),
      points:
        points.length === 1
          ? [points[0], { ...points[0], x: points[0].x + 0.5 }]
          : points,
      color: store.penColor,
      width: tool === "highlighter" ? store.markerWidth : store.penWidth,
      opacity: tool === "highlighter" ? 0.35 : 1,
      tool: tool === "highlighter" ? "highlighter" : "pencil",
      createdAt: Date.now(),
    };
    commitStroke(stroke);
    livePoints.current = [];
  }, [commitStroke, tool]);

  const eraseAt = useCallback((x: number, y: number) => {
    const store = useStore.getState();
    const state = store.doc;
    if (!state) return;
    const radius = 9 / store.zoom;
    let changed = false;
    for (const layer of visibleLayers(
      state.layers,
      state.activeLayerId,
      store.soloActiveLayer,
      store.focusedPartId,
    )) {
      if (layer.locked) continue;
      for (const stroke of layer.strokes) {
        if (pendingErase.current.has(stroke.id)) continue;
        const pts = strokePoints(stroke, store.extent);
        const hit =
          pts.length === 1
            ? Math.hypot(pts[0].x - x, pts[0].y - y) <= radius + stroke.width / 2
            : pts.some((p, i) => {
                if (i === 0) return false;
                return (
                  distToSegment(x, y, pts[i - 1].x, pts[i - 1].y, p.x, p.y) <=
                  radius + stroke.width / 2
                );
              });
        if (hit) {
          pendingErase.current.add(stroke.id);
          changed = true;
        }
      }
    }
    if (changed) setErasingIds(new Set(pendingErase.current));
  }, []);

  const finishErase = useCallback(() => {
    erasing.current = false;
    const ids = [...pendingErase.current];
    pendingErase.current = new Set();
    setErasingIds(new Set());
    if (ids.length > 0) removeStrokes(ids);
  }, [removeStrokes]);

  /* ---------------------------------------------------------------- */
  /* Gestos de dos dedos                                               */
  /* ---------------------------------------------------------------- */

  /**
   * En una pantalla táctil el dedo que toca la partitura tiene que dibujar, así
   * que desplazar y ampliar son gestos de dos dedos: el punto medio entre los
   * dedos mueve la vista y la distancia entre ellos cambia el zoom. Sin esto,
   * en una tableta no hay forma de llegar al compás 40 sin cambiar de zoom.
   *
   * Durante el gesto el zoom se escribe directamente en el DOM y no en el
   * store: un pellizco son decenas de eventos por segundo y cada uno
   * re-renderizaría la partitura entera. Al levantar los dedos se confirma el
   * valor en el store, ya redondeado igual que lo redondearía él, para que no
   * haya ningún salto.
   */
  const abortInteraction = useCallback(() => {
    drawing.current = false;
    erasing.current = false;
    dragAnchor.current = null;
    livePoints.current = [];
    pendingErase.current = new Set();
    livePathRef.current?.setAttribute("d", "");
    setErasingIds(new Set());
  }, []);

  /** Sólo los dedos cuentan para el gesto: el lápiz escribe, no pellizca. */
  const activeTouches = () =>
    [...pointers.current.values()].filter((p) => p.type === "touch");

  const beginPinch = useCallback(() => {
    const viewport = viewportRef.current;
    const overlay = overlayRef.current;
    const [a, b] = activeTouches();
    if (!viewport || !overlay || !a || !b) return;
    abortInteraction();
    const rect = overlay.getBoundingClientRect();
    const viewportRect = viewport.getBoundingClientRect();
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    pinch.current = {
      anchor: { x: (midX - rect.left) / zoom, y: (midY - rect.top) / zoom },
      distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      zoom,
      // El papel va con `my-6`: su distancia al borde superior no depende del
      // zoom, así que se mide una vez y sirve para todo el gesto.
      paperTop: viewport.scrollTop + (rect.top - viewportRect.top),
    };
    appliedZoom.current = null;
  }, [abortInteraction, zoom]);

  const applyPinch = useCallback(() => {
    const gesture = pinch.current;
    const viewport = viewportRef.current;
    const [a, b] = activeTouches();
    if (!gesture || !viewport || !a || !b) return;
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    const next = clampZoom(gesture.zoom * (distance / gesture.distance));

    if (paperRef.current) {
      paperRef.current.style.width = `${layoutWidth * next}px`;
      paperRef.current.style.height = `${contentHeight * next}px`;
    }
    if (stageRef.current) stageRef.current.style.transform = `scale(${next})`;

    const viewportRect = viewport.getBoundingClientRect();
    // Igual que hace `mx-auto`: centrado mientras quepa, pegado al borde si no.
    const stageWidth = layoutWidth * next;
    const paperLeft =
      stageWidth <= viewport.clientWidth ? (viewport.clientWidth - stageWidth) / 2 : 0;
    viewport.scrollLeft = paperLeft + gesture.anchor.x * next - (midX - viewportRect.left);
    viewport.scrollTop =
      gesture.paperTop + gesture.anchor.y * next - (midY - viewportRect.top);
    appliedZoom.current = next;
  }, [contentHeight, layoutWidth]);

  const endPinch = useCallback(() => {
    pinch.current = null;
    const applied = appliedZoom.current;
    appliedZoom.current = null;
    if (applied !== null) setZoom(applied);
  }, [setZoom]);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (event.button === 1 || event.button === 2) return;
      pointers.current.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
        type: event.pointerType,
      });

      // Con el lápiz apoyado, un dedo que toque la pantalla es la palma, no un
      // gesto: si contara, escribir con un lápiz en una tableta cancelaría el
      // trazo en cada palabra.
      if (
        event.pointerType === "touch" &&
        [...pointers.current.values()].some((p) => p.type === "pen")
      ) {
        pointers.current.delete(event.pointerId);
        return;
      }

      // El segundo dedo no dibuja: arranca el gesto y descarta lo que hubiera a
      // medias (un trazo, un borrado o un tramo de compases).
      if (pointers.current.size >= 2) {
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          /* la captura es opcional */
        }
        if (activeTouches().length >= 2) beginPinch();
        return;
      }
      const point = toScore(event.clientX, event.clientY);
      if (!point) return;
      const hit = measureAt(boxes, point.x, point.y);
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        /* algunos lápices no admiten captura */
      }

      const opensRange = (index: number) => {
        if (event.shiftKey) extendMeasureSelection(index);
        else selectMeasure(index);
      };

      switch (tool) {
        case "pencil":
        case "highlighter": {
          const layer = useStore.getState().doc?.layers.find(
            (l) => l.id === activeLayerId,
          );
          if (layer?.locked) return;
          drawing.current = true;
          liveWidth.current = tool === "highlighter" ? markerWidth : penWidth;
          livePoints.current = [
            {
              x: point.x,
              y: point.y,
              p: event.pointerType === "pen" ? event.pressure || 0.35 : 0.5,
            },
          ];
          break;
        }
        case "eraser": {
          erasing.current = true;
          eraseAt(point.x, point.y);
          break;
        }
        case "comment": {
          const layer = useStore.getState().doc?.layers.find(
            (l) => l.id === activeLayerId,
          );
          if (layer?.locked) return;
          const overlay = overlayRef.current?.getBoundingClientRect();
          setDraft({
            left: event.clientX - (overlay?.left ?? 0),
            top: event.clientY - (overlay?.top ?? 0),
            x: point.x,
            y: point.y,
            measureIndex: hit?.measureIndex ?? null,
            measureNumber: hit?.measureNumber ?? "—",
          });
          break;
        }
        case "measure": {
          if (hit) {
            dragAnchor.current = hit.measureIndex;
            opensRange(hit.measureIndex);
          } else {
            selectMeasure(null);
          }
          break;
        }
        case "select": {
          const store = useStore.getState();
          const currentLayers = visibleLayers(
            store.doc?.layers ?? [],
            activeLayerId,
            soloActiveLayer,
            store.focusedPartId,
          );
          const candidates = collectPins(store.doc?.layers ?? []).filter((entry) =>
            currentLayers.some((l) => l.id === entry.layer.id),
          );
          const pinHit = pickPin(candidates, pinView, point, zoom);
          if (pinHit) {
            selectPin(pinHit);
            break;
          }
          const strokeHit = findStrokeAt(currentLayers, point, zoom, store.extent);
          if (strokeHit) {
            selectStroke(strokeHit);
            break;
          }
          if (hit) opensRange(hit.measureIndex);
          else selectMeasure(null);
          break;
        }
      }
    },
    [
      activeLayerId,
      beginPinch,
      boxes,
      eraseAt,
      extendMeasureSelection,
      markerWidth,
      penWidth,
      pinView,
      selectMeasure,
      selectPin,
      selectStroke,
      soloActiveLayer,
      toScore,
      tool,
      zoom,
    ],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      const active = pointers.current.get(event.pointerId);
      if (active) {
        pointers.current.set(event.pointerId, {
          x: event.clientX,
          y: event.clientY,
          type: active.type,
        });
      }
      if (pinch.current) {
        applyPinch();
        return;
      }
      // Arrastrar un pin: se mueve el nodo a mano en vez de por estado, porque
      // un `setState` por fotograma redibujaría la partitura entera con cada
      // movimiento del dedo.
      const pinMove = pinDrag.current;
      if (pinMove) {
        const point = toScore(event.clientX, event.clientY);
        if (!point) return;
        const x = point.x - pinMove.offsetX;
        const y = point.y - pinMove.offsetY;
        // Un temblor de dos píxeles al tocar no es un movimiento: si lo fuera,
        // cada toque para leer un comentario acabaría moviéndolo.
        if (!pinMove.moved) {
          const moved = Math.hypot(x - pinMove.fromX, y - pinMove.fromY);
          if (moved < 3) return;
          pinMove.moved = true;
        }
        pinNodes.current
          .get(pinMove.id)
          ?.setAttribute("transform", `translate(${x}, ${y}) scale(${1 / zoom})`);
        pinMove.x = x;
        pinMove.y = y;
        return;
      }

      const dragging = dragAnchor.current !== null;
      if (!drawing.current && !erasing.current && !dragging) return;
      const point = toScore(event.clientX, event.clientY);
      if (!point) return;

      if (drawing.current) {
        const previous = livePoints.current[livePoints.current.length - 1];
        const distance = previous
          ? Math.hypot(point.x - previous.x, point.y - previous.y)
          : Infinity;
        // Filtramos el ruido del puntero: por debajo de ~1.2 px de partitura
        // sólo acumulamos basura que engorda el trazo y el fichero.
        if (distance < 1.2 / zoom) return;
        livePoints.current.push({
          x: point.x,
          y: point.y,
          p: event.pointerType === "pen" ? event.pressure || 0.35 : 0.5,
        });
        if (livePathRef.current) {
          livePathRef.current.setAttribute(
            "d",
            pressureOutline(livePoints.current, liveWidth.current),
          );
        }
        return;
      }

      if (erasing.current) {
        eraseAt(point.x, point.y);
        return;
      }

      // Arrastrar con la herramienta de compases extiende el tramo.
      const over = measureAt(boxes, point.x, point.y);
      if (over && over.measureIndex !== useStore.getState().selectedMeasures?.to) {
        extendMeasureSelection(over.measureIndex);
      }
    },
    [applyPinch, boxes, eraseAt, extendMeasureSelection, toScore, zoom],
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      pointers.current.delete(event.pointerId);

      const pinMove = pinDrag.current;
      if (pinMove) {
        pinDrag.current = null;
        if (!pinMove.moved) {
          // Ha sido un toque, no un arrastre: el pin vuelve exactamente a donde
          // estaba, porque el nodo sí se había movido con el temblor del dedo.
          pinNodes.current
            .get(pinMove.id)
            ?.setAttribute(
              "transform",
              `translate(${pinMove.fromX}, ${pinMove.fromY}) scale(${1 / zoom})`,
            );
          return;
        }
        // Al soltarlo se recalcula a qué compás ha ido a parar: un comentario
        // arrastrado dos sistemas más abajo pertenece al compás de destino, no
        // al que estaba. Fuera del papel queda sin compás (`null`).
        const point = toScore(event.clientX, event.clientY);
        const over = point ? measureAt(boxes, point.x, point.y) : null;
        movePin(pinMove.id, pinMove.x, pinMove.y, over ? over.measureIndex : null);
        return;
      }

      if (pinch.current) {
        // El gesto termina cuando quedan menos de dos dedos. El que quede no
        // empieza a dibujar: habría que volver a tocarlo.
        if (pointers.current.size < 2) endPinch();
        dragAnchor.current = null;
        return;
      }
      dragAnchor.current = null;
      if (drawing.current) finishStroke();
      if (erasing.current) finishErase();
    },
    [boxes, endPinch, finishErase, finishStroke, movePin, toScore, zoom],
  );

  const isDrawingTool = tool === "pencil" || tool === "highlighter";
  const activeLayer = layers.find((l) => l.id === activeLayerId);
  const focusedPart = focusedPartId
    ? (parts.find((p) => p.id === focusedPartId) ?? null)
    : null;
  const lockedDrawing = (activeLayer?.locked ?? false) && isDrawingTool;
  const cursorClass = lockedDrawing
    ? "cursor-not-allowed"
    : tool === "pencil" || tool === "highlighter"
      ? "cursor-pencil"
      : tool === "eraser"
        ? "cursor-eraser"
        : tool === "comment"
          ? "cursor-pin"
          : tool === "measure"
            ? "cursor-measure"
            : "cursor-default";

  const stageWidth = layoutWidth * zoom;
  const stageHeight = contentHeight * zoom;
  const selectionBands = selectedMeasures
    ? spanBands(extent, selectedMeasures.from, selectedMeasures.to, null)
    : [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative min-h-0 flex-1 bg-[#eceae5]">
        {/* El contenedor sí se puede desplazar con un dedo (para eso queda el
            margen alrededor del papel); lo que no cede el gesto es la partitura
            misma, que es donde va el lápiz. */}
        <div
          ref={viewportRef}
          className={`thin-scroll h-full w-full select-none overflow-auto ${cursorClass}`}
        >
          <div
            ref={paperRef}
            className="relative mx-auto my-6 bg-paper shadow-[0_1px_2px_rgba(28,27,25,0.08),0_12px_32px_-12px_rgba(28,27,25,0.25)]"
            style={{ width: stageWidth, height: stageHeight || 1 }}
          >
            <div
              ref={stageRef}
              style={{
                width: layoutWidth,
                height: contentHeight || 1,
                transform: `scale(${zoom})`,
                transformOrigin: "0 0",
              }}
            >
              <div ref={hostRef} className="osmd-host" style={{ width: layoutWidth }} />

              <svg
                ref={overlayRef}
                className={`no-touch absolute left-0 top-0 overflow-visible ${cursorClass}`}
                width={layoutWidth}
                height={contentHeight || 1}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onContextMenu={(e) => e.preventDefault()}
              >
                {/* Tramo de compases seleccionado (puede ser un pasaje). */}
                {selectionBands.map((band, index) => (
                  <rect
                    key={`sel-${index}`}
                    x={band.x - 2}
                    y={band.y - 4}
                    width={band.width + 4}
                    height={band.height + 8}
                    rx={4}
                    fill="#1f6feb"
                    fillOpacity={0.07}
                    stroke="#1f6feb"
                    strokeOpacity={0.35}
                    strokeWidth={1.5}
                    pointerEvents="none"
                  />
                ))}

                {/* Compás que está sonando. */}
                {playheadMeasure != null &&
                  boxes
                    .filter((b) => b.measureIndex === playheadMeasure)
                    .map((box) => (
                      <rect
                        key="playhead"
                        x={box.x - 2}
                        y={box.y - 4}
                        width={box.width + 4}
                        height={box.height + 8}
                        rx={4}
                        fill="#1a7f37"
                        fillOpacity={0.1}
                        stroke="#1a7f37"
                        strokeOpacity={0.5}
                        strokeWidth={1.5}
                        pointerEvents="none"
                      />
                    ))}

                {drawn.map((layer) => (
                  <g key={layer.id} opacity={layer.opacity}>
                    {layer.strokes.map((stroke) => {
                      if (erasingIds.has(stroke.id)) return null;
                      return (
                        <path
                          key={stroke.id}
                          d={pressureOutline(pointsOf(stroke), stroke.width)}
                          fill={stroke.color ?? layer.color}
                          fillOpacity={stroke.tool === "highlighter" ? 0.3 : 1}
                          style={
                            stroke.tool === "highlighter"
                              ? { mixBlendMode: "multiply" }
                              : undefined
                          }
                          pointerEvents="none"
                        />
                      );
                    })}
                  </g>
                ))}

                {/* Marca del trazo seleccionado, para poder moverlo de capa. */}
                {selectedStrokeId &&
                  drawn.map((layer) => {
                    const stroke = layer.strokes.find((s) => s.id === selectedStrokeId);
                    if (!stroke) return null;
                    return (
                      <path
                        key={`sel-${stroke.id}`}
                        d={pressureOutline(stroke.points, stroke.width)}
                        fill="none"
                        stroke="#1f6feb"
                        strokeWidth={1.5 / zoom}
                        strokeDasharray={`${4 / zoom} ${3 / zoom}`}
                        pointerEvents="none"
                      />
                    );
                  })}

                <path
                  ref={livePathRef}
                  d=""
                  fill={penColor ?? activeLayer?.color ?? "#1f6feb"}
                  fillOpacity={tool === "highlighter" ? 0.3 : 1}
                  style={
                    tool === "highlighter" ? { mixBlendMode: "multiply" } : undefined
                  }
                  pointerEvents="none"
                />

                <NoteMarks extent={extent} layers={drawn} zoom={zoom} />

                {drawn.flatMap((layer) =>
                  layer.pins.map((pin) => {
                    const selected = pin.id === selectedPinId;
                    // Un pin de una capa bloqueada se puede leer y seleccionar,
                    // pero no mover: es la misma regla que para los trazos.
                    const movable = tool === "select" && !layer.locked;
                    const at = pinAt(pin);
                    return (
                      <g
                        key={pin.id}
                        ref={(node) => {
                          if (node) pinNodes.current.set(pin.id, node);
                          else pinNodes.current.delete(pin.id);
                        }}
                        transform={`translate(${at.x}, ${at.y}) scale(${1 / zoom})`}
                        className={
                          tool === "select"
                            ? movable
                              ? "cursor-grab active:cursor-grabbing"
                              : "cursor-pointer"
                            : "cursor-pin"
                        }
                        onPointerDown={(event) => {
                          if (tool !== "select") return;
                          event.stopPropagation();
                          selectPin(pin.id);
                          if (!movable) return;
                          const point = toScore(event.clientX, event.clientY);
                          if (!point) return;
                          try {
                            event.currentTarget.setPointerCapture(event.pointerId);
                          } catch {
                            /* la captura es opcional */
                          }
                          pinDrag.current = {
                            id: pin.id,
                            offsetX: point.x - at.x,
                            offsetY: point.y - at.y,
                            fromX: at.x,
                            fromY: at.y,
                            x: at.x,
                            y: at.y,
                            moved: false,
                          };
                        }}
                      >
                        <title>
                          {layer.locked
                            ? "Comentario (la capa está bloqueada)"
                            : "Comentario: arrástralo para moverlo"}
                        </title>
                        <circle
                          r={selected ? 12 : 10}
                          fill={layer.color}
                          fillOpacity={pin.resolved ? 0.35 : 1}
                          stroke="#fff"
                          strokeWidth={2}
                        />
                        <text
                          y={4}
                          textAnchor="middle"
                          fontSize={11}
                          fill="#fff"
                          fontWeight={600}
                          pointerEvents="none"
                        >
                          {pin.messages.length}
                        </text>
                        {pin.resolved && (
                          <path
                            d="M -4 0 L -1 3.5 L 5 -3.5"
                            stroke="#fff"
                            strokeWidth={2}
                            fill="none"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            pointerEvents="none"
                          />
                        )}
                      </g>
                    );
                  }),
                )}
              </svg>
            </div>

            {draft && (
              <CommentComposer
                draft={draft}
                onCancel={() => setDraft(null)}
                onSubmit={(text, tag) => {
                  const id = addPin({
                    x: draft.x,
                    y: draft.y,
                    measureIndex: draft.measureIndex,
                    text,
                    tag,
                  });
                  setDraft(null);
                  if (id) selectPin(id);
                }}
              />
            )}
          </div>
        </div>

        {status === "loading" && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted">
            Dibujando la partitura…
          </div>
        )}

        {status === "error" && (
          <div className="absolute inset-0 flex items-center justify-center p-8">
            <div className="max-w-md rounded-xl border border-line bg-white p-5 text-sm">
              <p className="mb-1 font-medium">No se pudo dibujar la partitura</p>
              <p className="text-muted">{errorMessage}</p>
            </div>
          </div>
        )}

        {focusedPart && (
          <FocusPill name={focusedPart.name} onClear={() => setFocusedPartId(null)} />
        )}

        <ZoomPill
          zoom={zoom}
          onZoom={setZoom}
          // "Ajustar" encaja de verdad, aunque en un móvil eso signifique un
          // 30 %: para eso está el botón.
          onFit={() => {
            const next = fitZoom(0.3);
            if (next !== null) setZoom(next);
          }}
        />
      </div>

      <TransportBar />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Marcadores de compases anotados                                     */
/* ------------------------------------------------------------------ */

function NoteMarks({
  extent,
  layers,
  zoom,
}: {
  extent: ScoreExtent;
  layers: Layer[];
  zoom: number;
}) {
  const marks = useMemo(() => {
    const out: {
      key: string;
      partId: string | null;
      bands: { x: number; y: number; width: number; height: number }[];
      label: string;
      color: string;
    }[] = [];

    for (const layer of layers) {
      for (const note of layer.notes) {
        const range = noteRange(note);
        const partId = note.partId ?? null;
        const bands = spanBands(extent, range.from, range.to, partId);
        if (bands.length === 0) continue;
        out.push({
          key: `${layer.id}-${note.id}`,
          partId,
          bands,
          label: note.measureNumber,
          color: priorityColor(note.priority) ?? layer.color,
        });
      }
    }
    return out;
  }, [extent, layers]);

  return (
    <>
      {marks.map((mark) => {
        const last = mark.bands[mark.bands.length - 1];
        return (
          <g key={mark.key} pointerEvents="none">
            {mark.bands.map((band, index) => (
              <rect
                key={index}
                x={band.x}
                y={band.y - 3}
                width={band.width}
                height={band.height + 6}
                rx={3}
                fill={mark.color}
                fillOpacity={0.09}
                stroke={mark.color}
                strokeOpacity={0.35}
                strokeWidth={1}
              />
            ))}
            <g transform={`translate(${last.x + last.width - 6}, ${last.y - 8}) scale(${1 / zoom})`}>
              <circle r={8} fill={mark.color} opacity={0.92} />
              <text
                y={3.4}
                textAnchor="middle"
                fontSize={9}
                fontWeight={600}
                fill="#fff"
              >
                {mark.label.slice(0, 4)}
              </text>
            </g>
          </g>
        );
      })}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Subcomponentes                                                      */
/* ------------------------------------------------------------------ */

/**
 * Aviso de que la vista está centrada en una parte.
 *
 * Hace falta: al centrarse en el saxo, media plantilla desaparece, y sin decir
 * por qué ni ofrecer la vuelta eso se lee como una partitura rota.
 */
function FocusPill({ name, onClear }: { name: string; onClear: () => void }) {
  return (
    <div className="no-print pointer-events-auto absolute left-3 top-3 flex max-w-[calc(100%-1.5rem)] items-center gap-1.5 rounded-full border border-accent/40 bg-white/95 py-0.5 pl-2.5 pr-1 text-xs shadow-sm backdrop-blur">
      <span className="min-w-0 truncate">
        <span className="text-muted">Solo </span>
        <span className="font-medium">{name}</span>
      </span>
      <button
        onClick={onClear}
        className="touch-target shrink-0 rounded-full px-2 py-1 text-accent-deep hover:bg-accent/[0.08]"
      >
        Ver todo
      </button>
    </div>
  );
}

function ZoomPill({
  zoom,
  onZoom,
  onFit,
}: {
  zoom: number;
  onZoom: (value: number) => void;
  onFit: () => void;
}) {
  return (
    <div className="no-print pointer-events-auto absolute bottom-4 right-4 flex items-center gap-1 rounded-full border border-line bg-white/95 px-1.5 py-1 text-xs shadow-sm backdrop-blur">
      <button
        className="grid h-7 w-7 place-items-center rounded-full hover:bg-surface"
        onClick={() => onZoom(zoom - 0.1)}
        title="Alejar"
      >
        −
      </button>
      <span className="w-11 text-center tabular-nums text-muted">
        {Math.round(zoom * 100)}%
      </span>
      <button
        className="grid h-7 w-7 place-items-center rounded-full hover:bg-surface"
        onClick={() => onZoom(zoom + 0.1)}
        title="Acercar"
      >
        +
      </button>
      <div className="mx-1 h-4 w-px bg-line" />
      <button
        className="rounded-full px-2 py-1 hover:bg-surface"
        onClick={onFit}
        title="Ajustar el ancho de la partitura a la ventana"
      >
        Ajustar
      </button>
      <button
        className="rounded-full px-2 py-1 hover:bg-surface"
        onClick={() => onZoom(1)}
        title="Tamaño real"
      >
        100%
      </button>
    </div>
  );
}

function CommentComposer({
  draft,
  onSubmit,
  onCancel,
}: {
  draft: CommentDraft;
  onSubmit: (text: string, tag: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const [tag, setTag] = useState(COMMENT_TAGS[0]);

  return (
    <div
      className="absolute z-20 w-72 rounded-xl border border-line bg-white p-3 shadow-xl"
      style={{ left: draft.left + 12, top: draft.top + 12 }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="mb-2 flex items-center justify-between text-[11px] text-muted">
        <span>Compás {draft.measureNumber}</span>
        <button className="hover:text-ink" onClick={onCancel}>
          Cancelar
        </button>
      </div>
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder="Qué quieres recordar aquí…"
        className="w-full resize-none rounded-lg border border-line px-2 py-1.5 text-sm outline-none focus:border-accent"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim()) {
            onSubmit(text.trim(), tag);
          }
          if (e.key === "Escape") onCancel();
        }}
      />
      <div className="mt-2 flex items-center gap-2">
        <select
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          className="flex-1 rounded-lg border border-line bg-white px-2 py-1 text-xs outline-none focus:border-accent"
        >
          {COMMENT_TAGS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <button
          disabled={!text.trim()}
          onClick={() => onSubmit(text.trim(), tag)}
          className="rounded-lg bg-ink px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
        >
          Anclar
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

function pickPin(
  candidates: { pin: { id: string; x: number; y: number } }[],
  /** Posición resuelta de cada comentario, con la maquetación de ahora. */
  positions: Map<string, { x: number; y: number }>,
  point: { x: number; y: number },
  zoom: number,
): string | null {
  const threshold = 14 / zoom;
  let best: string | null = null;
  let bestDistance = threshold;
  for (const { pin } of candidates) {
    const at = positions.get(pin.id) ?? pin;
    const distance = Math.hypot(at.x - point.x, at.y - point.y);
    if (distance <= bestDistance) {
      bestDistance = distance;
      best = pin.id;
    }
  }
  return best;
}

/** Trazo que cae bajo el puntero, para poder moverlo de capa. */
function findStrokeAt(
  layers: Layer[],
  point: { x: number; y: number },
  zoom: number,
  /** Para resolver cada trazo desde su ancla antes de medir distancias. */
  extent: ScoreExtent,
): string | null {
  const slack = 6 / zoom;
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    if (layer.locked) continue;
    for (let j = layer.strokes.length - 1; j >= 0; j--) {
      const stroke = layer.strokes[j];
      const tolerance = slack + stroke.width / 2;
      const pts = strokePoints(stroke, extent);
      if (pts.length === 1) {
        if (Math.hypot(pts[0].x - point.x, pts[0].y - point.y) <= tolerance) {
          return stroke.id;
        }
        continue;
      }
      for (let k = 1; k < pts.length; k++) {
        if (
          distToSegment(point.x, point.y, pts[k - 1].x, pts[k - 1].y, pts[k].x, pts[k].y) <=
          tolerance
        ) {
          return stroke.id;
        }
      }
    }
  }
  return null;
}

function priorityColor(priority: number): string | null {
  switch (priority) {
    case 1:
      return "#9a6700";
    case 2:
      return "#d1242f";
    case 3:
      return "#a40e26";
    default:
      return null;
  }
}

