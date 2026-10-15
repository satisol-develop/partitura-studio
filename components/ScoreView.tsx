"use client";

import { useEffect, useRef, useState } from "react";

/** Una opción del menú de exportación: qué es y a dónde se lleva. */
function ExportItem({
  title,
  detail,
  onClick,
  ref,
}: {
  title: string;
  detail: string;
  onClick: () => void;
  ref?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={ref}
      onClick={onClick}
      className="block w-full rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-surface focus-visible:bg-surface"
    >
      <span className="block text-xs font-semibold">{title}</span>
      <span className="mt-0.5 block text-[11px] leading-relaxed text-muted">{detail}</span>
    </button>
  );
}
import AnnotationsPanel from "./AnnotationsPanel";
import LayerPanel from "./LayerPanel";
import ScoreCanvas from "./ScoreCanvas";
import Toolbar from "./Toolbar";
import {
  ArrowLeftIcon,
  ChevronDownIcon,
  DownloadIcon,
  FolderIcon,
  KeyboardIcon,
  LayersIcon,
  MeasureNoteIcon,
  SyncIcon,
} from "./icons";
import { downloadJson, downloadMusicXml } from "@/lib/files";
import { useStore } from "@/lib/store";

/**
 * ¿Cabe un panel al lado de la partitura? En una tableta vertical (834 px) no
 * caben los dos, así que el corte es el mismo que usa la maquetación: por
 * debajo de 1024 px los paneles se abren como cajón sobre la partitura.
 */
const fitsSidePanels = () =>
  typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches;

/**
 * Los atajos, en una lista.
 *
 * Existen desde el principio y están en la ayuda emergente de cada botón, pero
 * eso sólo sirve con ratón: los que no cuelgan de ningún botón —deshacer,
 * guardar, reproducir, el zoom— no había forma de descubrirlos en la interfaz.
 * Vive aquí, junto al componente que los registra, para que no se separen.
 */
const SHORTCUTS: { keys: string; label: string }[] = [
  { keys: "P", label: "Lápiz" },
  { keys: "H", label: "Resaltador" },
  { keys: "E", label: "Goma" },
  { keys: "C", label: "Comentario" },
  { keys: "N", label: "Nota de compás" },
  { keys: "V", label: "Seleccionar y mover" },
  { keys: "Espacio", label: "Reproducir o pausar" },
  { keys: "+", label: "Acercar" },
  { keys: "−", label: "Alejar" },
  { keys: "0", label: "Zoom al 100 %" },
  { keys: "Esc", label: "Quitar la selección" },
  { keys: "Ctrl+Z", label: "Deshacer" },
  { keys: "Ctrl+Shift+Z", label: "Rehacer" },
  { keys: "Ctrl+S", label: "Guardar ahora" },
];

export default function ScoreView() {
  const doc = useStore((s) => s.doc);
  const closeScore = useStore((s) => s.closeScore);
  const saveNow = useStore((s) => s.saveNow);
  const saving = useStore((s) => s.saving);
  const syncStatus = useStore((s) => s.syncStatus);
  const syncMessage = useStore((s) => s.syncMessage);
  const setDrivePanelOpen = useStore((s) => s.setDrivePanelOpen);
  const syncNow = useStore((s) => s.syncNow);
  const saveError = useStore((s) => s.saveError);
  const authEmail = useStore((s) => s.auth.email);
  // Fuera de una pantalla grande los dos paneles empiezan cerrados: si no, el
  // cajón taparía la partitura en cuanto se abre un documento.
  const [showLayers, setShowLayers] = useState(fitsSidePanels);
  const [showInspector, setShowInspector] = useState(fitsSidePanels);
  // Si los paneles van al lado o dentro de un cajón no es sólo una diferencia
  // de CSS: de ella depende que el foco tenga que entrar y quedar atrapado.
  // Al lado, el foco va donde el usuario quiera; en cajón, es un diálogo y el
  // fondo no debe ser alcanzable. Se mantiene en estado para que el JSX pueda
  // aplicarlo (los `lg:` de Tailwind y este `matchMedia` usan el mismo corte).
  const [sideBySide, setSideBySide] = useState(fitsSidePanels);
  const setMeta = useStore((s) => s.setMeta);
  const layersButton = useRef<HTMLButtonElement | null>(null);
  const inspectorButton = useRef<HTMLButtonElement | null>(null);
  const layersPanel = useRef<HTMLElement | null>(null);
  const inspectorPanel = useRef<HTMLElement | null>(null);
  // A quién devolver el foco al cerrar. Se guarda en un ref y no se enfoca al
  // momento porque el disparador está inerte mientras el cajón está abierto:
  // hay que esperar a que el fondo deje de estarlo (el efecto de abajo).
  const returnFocusTo = useRef<HTMLElement | null>(null);

  const drawerOpen = !sideBySide && (showLayers || showInspector);
  // Menú de exportación: son dos cosas distintas y cada una se lleva a un sitio
  // distinto (las capas a otra aplicación, el MusicXML a otro editor de
  // partituras), así que no caben en un solo botón que adivine cuál quieres.
  const [exportOpen, setExportOpen] = useState(false);
  const exportBox = useRef<HTMLDivElement | null>(null);
  const exportToggle = useRef<HTMLButtonElement | null>(null);
  const exportFirst = useRef<HTMLButtonElement | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const shortcutsBox = useRef<HTMLDivElement | null>(null);
  const shortcutsToggle = useRef<HTMLButtonElement | null>(null);
  const shortcutsPanel = useRef<HTMLDivElement | null>(null);

  // Al girar la tableta o cambiar el tamaño de la ventana, los paneles se
  // ponen como toca en la maquetación nueva: abiertos al lado cuando caben y
  // cerrados cuando pasan a ser cajón. Sólo se toca al cruzar ese umbral, así
  // que la elección del usuario se respeta mientras el tamaño no cambie de
  // categoría.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    let last = mq.matches;
    const sync = () => {
      // Sólo se actúa al cambiar de tipo de maquetación: cualquier otro
      // redimensionado deja los paneles como los dejó el usuario.
      if (mq.matches === last) return;
      last = mq.matches;
      setShowLayers(mq.matches);
      setShowInspector(mq.matches);
      setSideBySide(mq.matches);
    };
    // Los dos avisos, porque no todos los entornos que redimensionan la vista
    // emiten el cambio de la media query. `sync` es idempotente.
    mq.addEventListener("change", sync);
    window.addEventListener("resize", sync);
    return () => {
      mq.removeEventListener("change", sync);
      window.removeEventListener("resize", sync);
    };
  }, []);

  // En modo cajón, `Escape` cierra el panel y devuelve el foco a su botón.
  // Sin lo segundo, quien navega con el teclado se queda con el foco en un
  // panel que ya no se ve, y el siguiente `Tab` no lleva a ninguna parte.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || fitsSidePanels()) return;
      if (showInspector) {
        returnFocusTo.current = inspectorButton.current;
        setShowInspector(false);
      } else if (showLayers) {
        returnFocusTo.current = layersButton.current;
        setShowLayers(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showLayers, showInspector]);

  // En cajón, al abrir el foco entra en el panel: si se quedara en el disparador
  // (ahora inerte), quien navega con teclado no tendría dónde ir.
  useEffect(() => {
    if (sideBySide) return;
    const panel = showInspector ? inspectorPanel.current : showLayers ? layersPanel.current : null;
    if (!panel) return;
    const first = panel.querySelector<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    (first ?? panel).focus();
  }, [showLayers, showInspector, sideBySide]);

  // Y al cerrarlo el foco vuelve a su botón, ya sin el `inert` puesto.
  useEffect(() => {
    if (sideBySide || showLayers || showInspector) return;
    const target = returnFocusTo.current;
    if (!target) return;
    returnFocusTo.current = null;
    target.focus();
  }, [showLayers, showInspector, sideBySide]);

  // El cajón es un diálogo: `Tab` no puede salirse a la interfaz de detrás.
  useEffect(() => {
    if (sideBySide) return;
    const panel = showInspector ? inspectorPanel.current : showLayers ? layersPanel.current : null;
    if (!panel) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      const inside = active != null && panel.contains(active);
      if (!event.shiftKey && (!inside || active === last)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && (!inside || active === first)) {
        event.preventDefault();
        last.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [showLayers, showInspector, sideBySide]);

  // El menú de exportación se cierra al pulsar fuera y con `Escape`, y en ese
  // caso el foco vuelve a su botón: un desplegable que se queda abierto tapando
  // la partitura mientras sigues dibujando es peor que no tenerlo.
  useEffect(() => {
    if (!exportOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setExportOpen(false);
      exportToggle.current?.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (exportBox.current?.contains(event.target as Node)) return;
      setExportOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [exportOpen]);

  // La ayuda de atajos se cierra igual que el menú de exportar, y el foco entra
  // en el panel para poder leerlo con el teclado (no hay nada que tabular
  // dentro, así que se enfoca el panel y no su primer elemento).
  useEffect(() => {
    if (!shortcutsOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setShortcutsOpen(false);
      shortcutsToggle.current?.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (shortcutsBox.current?.contains(event.target as Node)) return;
      setShortcutsOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    shortcutsPanel.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [shortcutsOpen]);

  if (!doc) return null;

  const annotationCount = doc.layers.reduce(
    (acc, l) => acc + l.strokes.length + l.pins.length + l.notes.length,
    0,
  );

  return (
    <div className="app-height flex w-full flex-col overflow-hidden bg-surface">
      {/* La cabecera se reparte en dos líneas en un móvil: los botones arriba y
          el título debajo, a ancho completo. Apretujado en una sola línea el
          título quedaba en «T…» y el compositor en «A…». */}
      <header
        inert={drawerOpen}
        className="no-print safe-top safe-x flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line bg-white px-3 py-2 shadow-[0_1px_2px_rgba(28,27,25,0.04)]"
      >
        <button
          onClick={() => {
            void saveNow();
            closeScore();
          }}
          className="touch-target flex shrink-0 items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-surface"
          title="Volver a la biblioteca"
        >
          <ArrowLeftIcon size={15} />
          <span className="hidden sm:inline">Biblioteca</span>
          <span className="sr-only sm:hidden">Volver a la biblioteca</span>
        </button>

        <div className="order-last min-w-0 basis-full sm:order-none sm:flex-1 sm:basis-0">
          <input
            value={doc.meta.title}
            onChange={(e) => setMeta({ title: e.target.value })}
            className="w-full truncate rounded px-1 text-sm font-medium outline-none hover:bg-surface focus:bg-surface"
          />
          <input
            value={doc.meta.composer}
            placeholder="Compositor"
            onChange={(e) => setMeta({ composer: e.target.value })}
            className="w-full truncate rounded px-1 text-[11px] text-muted outline-none hover:bg-surface focus:bg-surface"
          />
        </div>

        <span className="hidden text-[11px] text-muted xl:block">
          {annotationCount}{" "}
          {annotationCount === 1 ? "anotación" : "anotaciones"}
          {saving && " · guardando…"}
        </span>

        {/* El estado del guardado se anuncia a los lectores de pantalla: en
            una aplicación donde se dibuja en vez de escribir, no hay otro
            momento en que el usuario sepa que su trabajo está a salvo. */}
        <span className="sr-only" role="status" aria-live="polite">
          {saving ? "Guardando cambios" : "Cambios guardados"}
        </span>

        <button
          ref={layersButton}
          onClick={() => setShowLayers((v) => !v)}
          aria-expanded={showLayers}
          aria-controls="panel-capas"
          className={`touch-target flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
            showLayers
              ? "border-accent/50 bg-accent/[0.08] text-accent-deep"
              : "border-line bg-white hover:bg-surface"
          }`}
          title="Capas de anotación"
        >
          <LayersIcon size={15} />
          <span className="hidden sm:inline">Capas</span>
          <span className="sr-only sm:hidden">Capas de anotación</span>
        </button>
        <button
          ref={inspectorButton}
          onClick={() => setShowInspector((v) => !v)}
          aria-expanded={showInspector}
          aria-controls="panel-anotaciones"
          className={`touch-target flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
            showInspector
              ? "border-accent/50 bg-accent/[0.08] text-accent-deep"
              : "border-line bg-white hover:bg-surface"
          }`}
          title="Anotaciones, plantilla y comentarios"
        >
          <MeasureNoteIcon size={15} />
          <span className="hidden sm:inline">Anotaciones</span>
          <span className="sr-only sm:hidden">Anotaciones, plantilla y comentarios</span>
        </button>
        <button
          onClick={() => setDrivePanelOpen(true)}
          className={`touch-target flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
            syncStatus === "error"
              ? "border-red-300 bg-red-50 text-red-700"
              : "border-line bg-white hover:bg-surface"
          }`}
          title={
            syncMessage
              ? `Drive: ${syncMessage}`
              : authEmail
                ? `Sincronizado como ${authEmail}`
                : "Sincronizar con Drive"
          }
        >
          <FolderIcon size={15} />
          <span className="hidden sm:inline">
            {syncStatus === "working" ? "Drive…" : syncStatus === "error" ? "Drive !" : "Drive"}
          </span>
          <span className="sr-only sm:hidden">Drive</span>
        </button>
        <button
          onClick={() => void syncNow()}
          className="touch-target grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-line bg-white text-muted transition-colors hover:text-ink"
          title="Sincronizar ahora (sube lo cambiado y baja lo que haya en Drive)"
          hidden={!syncMessage}
        >
          <SyncIcon size={14} className={syncStatus === "working" ? "animate-spin" : undefined} />
          <span className="sr-only">Sincronizar ahora</span>
        </button>
        <div className="relative shrink-0" ref={shortcutsBox}>
          <button
            ref={shortcutsToggle}
            onClick={() => setShortcutsOpen((v) => !v)}
            aria-expanded={shortcutsOpen}
            aria-haspopup="true"
            className={`touch-target flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
              shortcutsOpen
                ? "border-accent/50 bg-accent/[0.08] text-accent-deep"
                : "border-line bg-white hover:bg-surface"
            }`}
            title="Atajos de teclado"
          >
            <KeyboardIcon size={15} />
            <span className="hidden sm:inline">Atajos</span>
            <span className="sr-only sm:hidden">Atajos de teclado</span>
          </button>

          {shortcutsOpen && (
            <div
              ref={shortcutsPanel}
              tabIndex={-1}
              role="region"
              aria-label="Atajos de teclado"
              // En un móvil el botón no está pegado al borde derecho (la fila
              // lleva más botones), así que anclar el panel a su derecha lo
              // sacaba de la pantalla por la izquierda. Ahí va fijo abajo, como
              // una hoja; desde tableta vuelve a colgar del botón.
              className="rise-in fixed inset-x-3 bottom-3 z-50 max-h-[70dvh] overflow-y-auto rounded-2xl border border-line bg-white p-2 shadow-pop sm:absolute sm:inset-x-auto sm:top-full sm:right-0 sm:bottom-auto sm:mt-1.5 sm:max-h-none sm:w-72 sm:overflow-visible"
            >
              <ul className="thin-scroll max-h-[55vh] space-y-0.5 overflow-y-auto">
                {SHORTCUTS.map((shortcut) => (
                  <li
                    key={shortcut.keys}
                    className="flex items-center justify-between gap-3 rounded-lg px-1.5 py-1"
                  >
                    <span className="text-xs text-muted">{shortcut.label}</span>
                    <kbd className="shrink-0 rounded-md border border-line bg-surface px-1.5 py-0.5 font-sans text-[11px] font-medium text-ink">
                      {shortcut.keys}
                    </kbd>
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 border-t border-line px-1.5 pt-1.5 text-[11px] leading-relaxed text-muted">
                No actúan mientras escribes en un campo de texto.
              </p>
            </div>
          )}
        </div>

        <div className="relative shrink-0" ref={exportBox}>
          <button
            ref={exportToggle}
            onClick={() => setExportOpen((v) => !v)}
            onKeyDown={(event) => {
              // Abrir con la flecha hacia abajo es lo que se espera de un
              // desplegable; el foco va al primer elemento, no al menú.
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setExportOpen(true);
                requestAnimationFrame(() => exportFirst.current?.focus());
              }
            }}
            aria-expanded={exportOpen}
            aria-haspopup="true"
            className={`touch-target flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
              exportOpen
                ? "border-accent/50 bg-accent/[0.08] text-accent-deep"
                : "border-line bg-white hover:bg-surface"
            }`}
            title="Descargar esta partitura"
          >
            <DownloadIcon size={15} />
            <span className="hidden sm:inline">Exportar</span>
            <span className="sr-only sm:hidden">Exportar</span>
            <ChevronDownIcon size={13} className={exportOpen ? "rotate-180" : ""} />
          </button>

          {exportOpen && (
            // Es un desplegable, no un `menu` de ARIA: no hay navegación con
            // flechas dentro, así que prometer ese rol sería mentir. Con `Tab`
            // se recorre, que es como funciona de verdad.
            <div className="rise-in absolute right-0 top-full z-40 mt-1.5 w-72 rounded-xl border border-line bg-white p-1 shadow-pop">
              <ExportItem
                ref={exportFirst}
                title="Copia de la partitura (.json)"
                detail="El documento entero: capas, anotaciones y el XML dentro. Sirve para volver a abrirlo aquí."
                onClick={() => {
                  downloadJson(doc);
                  setExportOpen(false);
                }}
              />
              <ExportItem
                title="Solo el MusicXML (.musicxml)"
                detail="La música, sin tus anotaciones. Es lo que se abre en otro editor de partituras."
                onClick={() => {
                  downloadMusicXml(doc);
                  setExportOpen(false);
                }}
              />
            </div>
          )}
        </div>
      </header>

      {/* La barra y el aviso quedan inertes con el cajón abierto: es lo que hace
          que el cajón sea un diálogo de verdad y no un panel flotante encima de
          una interfaz que sigue respondiendo por detrás. */}
      <div inert={drawerOpen} className="shrink-0">
      {saveError && (
        <div
          role="alert"
          className="no-print flex items-start gap-2 border-b border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800"
        >
          <span
            aria-hidden
            className="mt-px grid h-4 w-4 shrink-0 place-items-center rounded-full bg-red-700 text-[10px] font-bold text-white"
          >
            !
          </span>
          <p className="min-w-0 flex-1 leading-relaxed">{saveError}</p>
        </div>
      )}

      <Toolbar />
      </div>

      <div className="relative flex min-h-0 flex-1">
        {showLayers && (
          <>
            <div
              className="absolute inset-0 z-20 bg-ink/25 lg:hidden"
              onClick={() => {
                returnFocusTo.current = layersButton.current;
                setShowLayers(false);
              }}
              aria-hidden
            />
            <aside
              ref={layersPanel}
              id="panel-capas"
              aria-label="Capas de anotación"
              role={sideBySide ? undefined : "dialog"}
              aria-modal={sideBySide ? undefined : true}
              tabIndex={-1}
              className="no-print absolute inset-y-0 left-0 z-30 flex w-72 shrink-0 flex-col overflow-hidden border-r border-line bg-white shadow-pop lg:static lg:z-auto lg:shadow-none"
            >
              <LayerPanel
                onClose={
                  sideBySide
                    ? undefined
                    : () => {
                        returnFocusTo.current = layersButton.current;
                        setShowLayers(false);
                      }
                }
              />
            </aside>
          </>
        )}

        <main inert={drawerOpen} className="flex min-w-0 flex-1 flex-col">
          <ScoreCanvas />
        </main>

        {showInspector && (
          <>
            <div
              className="absolute inset-0 z-20 bg-ink/25 lg:hidden"
              onClick={() => {
                returnFocusTo.current = inspectorButton.current;
                setShowInspector(false);
              }}
              aria-hidden
            />
            <aside
              ref={inspectorPanel}
              id="panel-anotaciones"
              aria-label="Anotaciones, plantilla y comentarios"
              role={sideBySide ? undefined : "dialog"}
              aria-modal={sideBySide ? undefined : true}
              tabIndex={-1}
              className="no-print absolute inset-y-0 right-0 z-30 flex w-80 shrink-0 flex-col overflow-hidden border-l border-line bg-white shadow-pop lg:static lg:z-auto lg:shadow-none"
            >
              <AnnotationsPanel
                onClose={
                  sideBySide
                    ? undefined
                    : () => {
                        returnFocusTo.current = inspectorButton.current;
                        setShowInspector(false);
                      }
                }
              />
            </aside>
          </>
        )}
      </div>
    </div>
  );
}
