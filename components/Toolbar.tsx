"use client";

import {
  CommentIcon,
  CursorIcon,
  EraserIcon,
  HighlighterIcon,
  MeasureNoteIcon,
  PencilIcon,
} from "./icons";
import { useStore } from "@/lib/store";
import { colorName, LAYER_PALETTE, type ToolId } from "@/lib/types";

const TOOLS: {
  id: ToolId;
  label: string;
  hint: string;
  Icon: (props: { size?: number }) => React.ReactElement;
}[] = [
  { id: "pencil", label: "Lápiz", hint: "Lápiz (P)", Icon: PencilIcon },
  { id: "highlighter", label: "Resaltador", hint: "Resaltador (H)", Icon: HighlighterIcon },
  { id: "eraser", label: "Goma", hint: "Goma (E)", Icon: EraserIcon },
  { id: "comment", label: "Comentario", hint: "Anclar comentario (C)", Icon: CommentIcon },
  { id: "measure", label: "Nota de compás", hint: "Nota estructurada de compás (N)", Icon: MeasureNoteIcon },
  { id: "select", label: "Seleccionar", hint: "Seleccionar y mover (V)", Icon: CursorIcon },
];

export default function Toolbar() {
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  const penColor = useStore((s) => s.penColor);
  const setPenColor = useStore((s) => s.setPenColor);
  const penWidth = useStore((s) => s.penWidth);
  const setPenWidth = useStore((s) => s.setPenWidth);
  const markerWidth = useStore((s) => s.markerWidth);
  const setMarkerWidth = useStore((s) => s.setMarkerWidth);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const activeLayer = useStore((s) =>
    s.doc?.layers.find((l) => l.id === s.activeLayerId),
  );

  const inkTool = tool === "pencil" || tool === "highlighter";
  const width = tool === "highlighter" ? markerWidth : penWidth;
  const setWidth = tool === "highlighter" ? setMarkerWidth : setPenWidth;

  return (
    <div className="no-print flex flex-wrap items-center gap-2 border-b border-line bg-white/80 px-3 py-2 backdrop-blur">
      <div className="flex items-center rounded-lg border border-line bg-white p-0.5">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            title={t.hint}
            onClick={() => setTool(t.id)}
            className={`touch-target grid h-8 w-9 place-items-center rounded-md text-sm transition ${
              tool === t.id
                ? "bg-ink text-white"
                : "hover:bg-surface text-ink/80"
            }`}
            aria-pressed={tool === t.id}
          >
            <t.Icon />
            <span className="sr-only">{t.label}</span>
          </button>
        ))}
      </div>

      {inkTool && (
        // En un móvil esta caja no cabe en la línea de la barra: se le da la
        // línea entera y, si aun así sobra anchura, se puede deslizar en
        // horizontal en vez de quedarse cortada por el borde.
        <div className="flex w-full min-w-0 items-center gap-2 overflow-x-auto rounded-lg border border-line bg-white px-2 py-1 sm:w-auto">
          <div className="flex shrink-0 items-center gap-1">
            <button
              title="Usar el color de la capa activa"
              aria-label={`Usar el color de la capa activa (${activeLayer?.name ?? "—"})`}
              aria-pressed={penColor === null}
              onClick={() => setPenColor(null)}
              className={`touch-dot h-5 w-5 shrink-0 rounded-full border ${
                penColor === null
                  ? "ring-2 ring-offset-1 ring-ink"
                  : "border-line"
              }`}
              style={{ background: activeLayer?.color ?? "#1f6feb" }}
            />
            {LAYER_PALETTE.map((color) => (
              <button
                key={color}
                title={color}
                aria-label={`Tinta ${colorName(color)}`}
                aria-pressed={penColor === color}
                onClick={() => setPenColor(color)}
                className={`touch-dot h-5 w-5 shrink-0 rounded-full border ${
                  penColor === color
                    ? "ring-2 ring-offset-1 ring-ink"
                    : "border-line"
                }`}
                style={{ background: color }}
              />
            ))}
          </div>
          <div className="mx-1 h-5 w-px shrink-0 bg-line" />
          <label className="flex shrink-0 items-center gap-2 text-xs text-muted">
            {/* En un móvil la palabra “Grosor” es lo único prescindible de la
                fila, y sin ella la fila entera cabe sin deslizar. Sigue en el
                documento para los lectores de pantalla. */}
            <span className="sr-only sm:not-sr-only">Grosor</span>
            <input
              type="range"
              min={tool === "highlighter" ? 6 : 0.8}
              max={tool === "highlighter" ? 40 : 8}
              step={tool === "highlighter" ? 1 : 0.2}
              value={width}
              onChange={(e) => setWidth(Number(e.target.value))}
              className="w-24 max-sm:w-16"
              aria-label="Grosor del trazo"
            />
            <span className="w-8 tabular-nums">{width.toFixed(1)}</span>
          </label>
        </div>
      )}

      <div className="flex items-center rounded-lg border border-line bg-white p-0.5">
        <button
          onClick={undo}
          disabled={!canUndo}
          title="Deshacer (Ctrl+Z)"
          aria-label="Deshacer"
          className="touch-target grid h-8 w-9 place-items-center rounded-md text-base hover:bg-surface disabled:opacity-30"
        >
          <span aria-hidden>↶</span>
        </button>
        <button
          onClick={redo}
          disabled={!canRedo}
          title="Rehacer (Ctrl+Shift+Z)"
          aria-label="Rehacer"
          className="touch-target grid h-8 w-9 place-items-center rounded-md text-base hover:bg-surface disabled:opacity-30"
        >
          <span aria-hidden>↷</span>
        </button>
      </div>

      {inkTool && (
        <span
          className="ml-auto hidden text-xs text-muted sm:block"
          title={
            activeLayer?.locked
              ? "La capa activa está bloqueada"
              : "Los trazos se guardan en la capa activa"
          }
        >
          {activeLayer?.locked
            ? `“${activeLayer.name}” está bloqueada`
            : `Dibujando en “${activeLayer?.name ?? "—"}”`}
        </span>
      )}
    </div>
  );
}
