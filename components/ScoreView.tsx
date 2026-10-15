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
  const setMeta = useStore((s) => s.setMeta);
  const layersButton = useRef<HTMLButtonElement | null>(null);
  const inspectorButton = useRef<HTMLButtonElement | null>(null);
  // Menú de exportación: son dos cosas distintas y cada una se lleva a un sitio
  // distinto (las capas a otra aplicación, el MusicXML a otro editor de
  // partituras), así que no caben en un solo botón que adivine cuál quieres.
  const [exportOpen, setExportOpen] = useState(false);
  const exportBox = useRef<HTMLDivElement | null>(null);
  const exportToggle = useRef<HTMLButtonElement | null>(null);
  const exportFirst = useRef<HTMLButtonElement | null>(null);

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
        setShowInspector(false);
        inspectorButton.current?.focus();
      } else if (showLayers) {
        setShowLayers(false);
        layersButton.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showLayers, showInspector]);

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
      <header className="no-print safe-top safe-x flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line bg-white px-3 py-2 shadow-[0_1px_2px_rgba(28,27,25,0.04)]">
        <button
          onClick={() => {
            void saveNow();
            closeScore();
          }}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-surface"
          title="Volver a la biblioteca"
        >
          <ArrowLeftIcon size={14} />
          Biblioteca
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
          className={`flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
            showLayers
              ? "border-accent/50 bg-accent/[0.08] text-accent-deep"
              : "border-line bg-white hover:bg-surface"
          }`}
          title="Capas de anotación"
        >
          <LayersIcon size={14} />
          Capas
        </button>
        <button
          ref={inspectorButton}
          onClick={() => setShowInspector((v) => !v)}
          aria-expanded={showInspector}
          aria-controls="panel-anotaciones"
          className={`flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
            showInspector
              ? "border-accent/50 bg-accent/[0.08] text-accent-deep"
              : "border-line bg-white hover:bg-surface"
          }`}
          title="Anotaciones, plantilla y comentarios"
        >
          <MeasureNoteIcon size={14} />
          Anotaciones
        </button>
        <button
          onClick={() => setDrivePanelOpen(true)}
          className={`flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
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
          <FolderIcon size={14} />
          {syncStatus === "working" ? "Drive…" : syncStatus === "error" ? "Drive !" : "Drive"}
        </button>
        <button
          onClick={() => void syncNow()}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-line bg-white text-muted transition-colors hover:text-ink"
          title="Sincronizar ahora (sube lo cambiado y baja lo que haya en Drive)"
          hidden={!syncMessage}
        >
          <SyncIcon size={14} className={syncStatus === "working" ? "animate-spin" : undefined} />
          <span className="sr-only">Sincronizar ahora</span>
        </button>
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
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
              exportOpen
                ? "border-accent/50 bg-accent/[0.08] text-accent-deep"
                : "border-line bg-white hover:bg-surface"
            }`}
            title="Descargar esta partitura"
          >
            <DownloadIcon size={14} />
            Exportar
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

      <div className="relative flex min-h-0 flex-1">
        {showLayers && (
          <>
            <div
              className="absolute inset-0 z-20 bg-ink/25 lg:hidden"
              onClick={() => setShowLayers(false)}
              aria-hidden
            />
            <aside
              id="panel-capas"
              aria-label="Capas de anotación"
              className="no-print absolute inset-y-0 left-0 z-30 flex w-72 shrink-0 flex-col overflow-hidden border-r border-line bg-white shadow-pop lg:static lg:z-auto lg:shadow-none"
            >
              <LayerPanel />
            </aside>
          </>
        )}

        <main className="flex min-w-0 flex-1 flex-col">
          <ScoreCanvas />
        </main>

        {showInspector && (
          <>
            <div
              className="absolute inset-0 z-20 bg-ink/25 lg:hidden"
              onClick={() => setShowInspector(false)}
              aria-hidden
            />
            <aside
              id="panel-anotaciones"
              aria-label="Anotaciones, plantilla y comentarios"
              className="no-print absolute inset-y-0 right-0 z-30 flex w-80 shrink-0 flex-col overflow-hidden border-l border-line bg-white shadow-pop lg:static lg:z-auto lg:shadow-none"
            >
              <AnnotationsPanel />
            </aside>
          </>
        )}
      </div>
    </div>
  );
}
