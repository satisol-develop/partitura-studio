"use client";

import { useMemo, useState } from "react";
import { CloseIcon } from "./icons";
import { collectNotes, collectPins, useStore } from "@/lib/store";
import {
  EMPTY_FIELDS,
  noteRange,
  rangeLabel,
  rangesOverlap,
  type Layer,
  type MeasureNote,
  type Pin,
  type Priority,
} from "@/lib/types";

const DYNAMICS = ["pp", "p", "mp", "mf", "f", "ff", "cresc.", "dim."];
const ARTICULATIONS = [
  "staccato",
  "legato",
  "acento",
  "marcato",
  "tenuto",
  "fermata",
];
const PRIORITIES: { value: Priority; label: string; color: string }[] = [
  { value: 0, label: "Sin marcar", color: "#a8a29e" },
  { value: 1, label: "Repasar", color: "#9a6700" },
  { value: 2, label: "Importante", color: "#d1242f" },
  { value: 3, label: "Crítico", color: "#a40e26" },
];

export default function AnnotationsPanel({ onClose }: { onClose?: () => void } = {}) {
  const [tab, setTab] = useState<"measure" | "comments">("measure");

  // Navegación entre pestañas con las flechas, como cualquier tablist: si no,
  // con el teclado hay que tabular por todos los controles del panel para
  // cambiar de pestaña.
  const onTabKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    setTab((current) => (current === "measure" ? "comments" : "measure"));
  };

  return (
    <div className="flex h-full flex-col">
      <PartsSection />
      {/* La fila envuelve al `tablist` en vez de meter el botón dentro: un
          tablist sólo puede contener pestañas. */}
      <div className="flex items-center gap-1 border-b border-line bg-surface/50 px-2 py-1.5">
        <div
          role="tablist"
          aria-label="Secciones del panel de anotaciones"
          className="flex items-center gap-1"
          onKeyDown={onTabKeyDown}
        >
          <TabButton
            id="tab-compases"
            panelId="panel-compases"
            active={tab === "measure"}
            onClick={() => setTab("measure")}
          >
            Compases
          </TabButton>
          <TabButton
            id="tab-comentarios"
            panelId="panel-comentarios"
            active={tab === "comments"}
            onClick={() => setTab("comments")}
          >
            Comentarios
          </TabButton>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            title="Cerrar el panel"
            aria-label="Cerrar el panel de anotaciones"
            className="touch-target ml-auto grid h-7 w-7 place-items-center rounded-lg border border-line bg-white text-muted transition-colors hover:text-ink"
          >
            <CloseIcon size={15} />
          </button>
        )}
      </div>
      <SelectedStrokeCard />
      <div
        className="thin-scroll flex-1 overflow-y-auto"
        role="tabpanel"
        id={tab === "measure" ? "panel-compases" : "panel-comentarios"}
        aria-labelledby={tab === "measure" ? "tab-compases" : "tab-comentarios"}
        tabIndex={0}
      >
        {tab === "measure" ? <MeasureTab /> : <CommentsTab />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Plantilla                                                           */
/* ------------------------------------------------------------------ */

/**
 * La plantilla de la partitura. Silenciar una parte no es un adorno: en un
 * trío de saxo + piano + bajo, para estudiar tu voz lo que quieres es oír las
 * otras dos, y eso es exactamente lo que hace esto.
 */
function PartsSection() {
  const parts = useStore((s) => s.parts);
  const mutedParts = useStore((s) => s.mutedParts);
  const togglePartMuted = useStore((s) => s.togglePartMuted);
  const targetPartId = useStore((s) => s.targetPartId);
  const setTargetPartId = useStore((s) => s.setTargetPartId);
  const [open, setOpen] = useState(true);

  // Con una sola parte no hay nada que elegir, así que lo resumimos en una fila.
  const single = parts.length <= 1;

  return (
    <div className="border-b border-line bg-white">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-left transition-colors hover:bg-surface/60"
      >
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">
          Plantilla
        </span>
        <span className="flex items-center gap-2 text-[11px] text-muted">
          {parts.length === 0
            ? "—"
            : single
              ? parts[0].name
              : `${parts.length} partes`}
          <span aria-hidden>{open ? "▾" : "▸"}</span>
        </span>
      </button>

      {open && parts.length > 0 && (
        <div className="space-y-1 px-2 pb-2">
          {parts.map((part) => {
            const muted = mutedParts.includes(part.id);
            const targeted = targetPartId === part.id;
            return (
              <div
                key={part.id}
                className={`flex items-center gap-1.5 rounded-xl border px-2 py-1.5 text-xs transition-all ${
                  targeted
                    ? "border-accent/60 bg-accent/[0.06] shadow-[0_1px_2px_rgba(28,27,25,0.05)]"
                    : "border-line bg-white hover:shadow-card"
                }`}
              >
                <button
                  onClick={() =>
                    setTargetPartId(targetPartId === part.id ? null : part.id)
                  }
                  title="Atribuir las anotaciones nuevas a esta parte"
                  className="min-w-0 flex-1 truncate text-left"
                >
                  <span className="block truncate font-medium">{part.name}</span>
                  <span className="block text-[10px] text-muted">
                    {part.staffIndices.length} pentagrama
                    {part.staffIndices.length === 1 ? "" : "s"}
                    {targeted ? " · anotando aquí" : ""}
                  </span>
                </button>
                <button
                  onClick={() => togglePartMuted(part.id)}
                  title={muted ? "Volver a sonar" : "Silenciar al reproducir"}
                  className={`shrink-0 rounded-md border px-2 py-0.5 text-[10px] ${
                    muted
                      ? "border-amber-300 bg-amber-100 text-amber-900"
                      : "border-line hover:bg-surface"
                  }`}
                >
                  {muted ? "silenciada" : "suena"}
                </button>
              </div>
            );
          })}
          {targetPartId && (
            <p className="px-1 pt-1 text-[10px] leading-relaxed text-muted">
              Las anotaciones nuevas se atribuyen a{" "}
              <b>{parts.find((p) => p.id === targetPartId)?.name}</b>. Pulsa otra vez
              para volver a toda la plantilla.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function TabButton({
  id,
  panelId,
  active,
  onClick,
  children,
}: {
  id: string;
  panelId: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      role="tab"
      id={id}
      aria-selected={active}
      aria-controls={panelId}
      // Sólo la pestaña activa entra en el orden de tabulación: es lo que
      // espera quien navega con teclado, y las flechas cambian de pestaña.
      tabIndex={active ? 0 : -1}
      onClick={onClick}
      className={`rounded-lg px-3 py-1 text-xs font-medium transition-all ${
        active
          ? "bg-gradient-to-b from-ink to-ink-soft text-white shadow-[0_6px_14px_-8px_rgba(28,27,25,0.9)]"
          : "text-muted hover:bg-surface hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Notas por compás                                                    */
/* ------------------------------------------------------------------ */

function MeasureTab() {
  const layers = useStore((s) => s.doc?.layers ?? []);
  const activeLayerId = useStore((s) => s.activeLayerId);
  const selectedMeasures = useStore((s) => s.selectedMeasures);
  const measureNumbers = useStore((s) => s.measureNumbers);
  const targetPartId = useStore((s) => s.targetPartId);
  const parts = useStore((s) => s.parts);
  const selectMeasure = useStore((s) => s.selectMeasure);
  const selectMeasureRange = useStore((s) => s.selectMeasureRange);
  const setActiveLayer = useStore((s) => s.setActiveLayer);
  const upsert = useStore((s) => s.upsertMeasureNote);
  const remove = useStore((s) => s.removeMeasureNoteRange);

  const activeLayer = layers.find((l) => l.id === activeLayerId) ?? null;
  const notes = useMemo(() => collectNotes(layers), [layers]);

  const current = useMemo(() => {
    if (!selectedMeasures || !activeLayer) return undefined;
    return activeLayer.notes.find((n) => {
      const r = noteRange(n);
      return (
        r.from === selectedMeasures.from &&
        r.to === selectedMeasures.to &&
        (n.partId ?? null) === targetPartId
      );
    });
  }, [activeLayer, selectedMeasures, targetPartId]);

  // Un mismo pasaje puede estar anotado en otra capa, en otro tramo o para otro
  // instrumento. Si no lo avisáramos, el formulario saldría vacío y parecería
  // que se han perdido los datos.
  const elsewhere = useMemo(() => {
    if (!selectedMeasures) return [];
    return notes.filter(({ note }) => {
      const r = noteRange(note);
      if (!rangesOverlap(r, selectedMeasures)) return false;
      return !(
        r.from === selectedMeasures.from &&
        r.to === selectedMeasures.to &&
        (note.partId ?? null) === targetPartId
      );
    });
  }, [notes, selectedMeasures, targetPartId]);

  if (!selectedMeasures || !activeLayer) {
    return (
      <div className="space-y-3 p-3">
        <EmptyHint>
          Elige <b>Nota de compás</b> y haz clic en un compás. Para un pasaje
          entero, <b>arrastra</b> por encima de varios compases, o mantén{" "}
          <b>Mayús</b> al hacer clic para extender el tramo.
        </EmptyHint>
        <NoteList
          notes={notes}
          measureNumbers={measureNumbers}
          partName={(id) => parts.find((p) => p.id === id)?.name ?? null}
          onSelect={({ note, layer }) => {
            setActiveLayer(layer.id);
            const r = noteRange(note);
            useStore.getState().setTargetPartId(note.partId ?? null);
            selectMeasureRange({ from: r.from, to: r.to });
          }}
          selected={null}
          selectedPart={null}
        />
      </div>
    );
  }

  const { from, to } = selectedMeasures;
  const label = rangeLabel(from, to, measureNumbers);
  const fields = current?.fields ?? EMPTY_FIELDS;
  const locked = activeLayer.locked;
  const partName = targetPartId
    ? (parts.find((p) => p.id === targetPartId)?.name ?? "parte")
    : null;

  const patch = (
    next: Partial<typeof EMPTY_FIELDS> & { priority?: Priority; tags?: string[] },
  ) => upsert({ from, to, label, partId: targetPartId }, next);

  return (
    <div className="space-y-4 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">
            {from === to ? `Compás ${label}` : `Compases ${label}`}
          </h3>
          <p className="text-[11px] text-muted">
            {partName ? (
              <>
                para <b>{partName}</b>
              </>
            ) : (
              "toda la plantilla"
            )}{" "}
            · capa <span style={{ color: activeLayer.color }}>{activeLayer.name}</span>
            {locked && " · bloqueada"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {current && !locked && (
            <button
              onClick={() => remove(from, to, targetPartId)}
              className="rounded-md border border-line px-2 py-1 text-[11px] text-red-600 hover:bg-red-50"
            >
              Borrar
            </button>
          )}
          <button
            onClick={() => selectMeasure(null)}
            className="rounded-md border border-line px-2 py-1 text-[11px] hover:bg-surface"
          >
            Cerrar
          </button>
        </div>
      </div>

      {from !== to && (
        <p className="rounded-lg bg-surface px-2.5 py-2 text-[11px] leading-relaxed text-muted">
          Anotación de tramo: cubre {to - from + 1} compases. Sirve para
          indicaciones que duran («aquí entra el tema», «bajar dinámica hasta la
          letra B»).
        </p>
      )}

      {elsewhere.length > 0 && (
        <div className="space-y-1.5 rounded-lg border border-amber-200 bg-amber-50 p-2.5">
          <p className="text-[11px] leading-relaxed text-amber-900">
            Este pasaje ya está anotado en otro sitio:
          </p>
          <div className="flex flex-wrap gap-1">
            {elsewhere.slice(0, 6).map(({ note, layer }) => {
              const r = noteRange(note);
              const owner = note.partId
                ? (parts.find((p) => p.id === note.partId)?.name ?? "parte")
                : "toda la plantilla";
              return (
                <button
                  key={`${layer.id}-${note.id}`}
                  onClick={() => {
                    setActiveLayer(layer.id);
                    useStore.getState().setTargetPartId(note.partId ?? null);
                    selectMeasureRange({ from: r.from, to: r.to });
                  }}
                  className="rounded-md border border-amber-300 bg-white px-2 py-0.5 text-[11px] hover:bg-amber-100"
                >
                  {rangeLabel(r.from, r.to, measureNumbers)} · {layer.name} ·{" "}
                  {owner}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <Field label="Prioridad de estudio">
        <div className="flex flex-wrap gap-1">
          {PRIORITIES.map((p) => (
            <button
              key={p.value}
              disabled={locked}
              onClick={() => patch({ priority: p.value })}
              className={`rounded-full border px-2 py-1 text-[11px] font-medium transition-all disabled:opacity-50 ${
                (current?.priority ?? 0) === p.value
                  ? "border-transparent text-white shadow-[0_4px_10px_-6px_rgba(28,27,25,0.9)]"
                  : "border-line bg-white hover:bg-surface"
              }`}
              style={
                (current?.priority ?? 0) === p.value ? { background: p.color } : undefined
              }
            >
              {p.label}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Dinámica">
        <ChipRow
          options={DYNAMICS}
          value={fields.dynamics}
          disabled={locked}
          onChange={(dynamics) => patch({ dynamics })}
        />
      </Field>

      <Field label="Articulación">
        <ChipRow
          options={ARTICULATIONS}
          value={fields.articulation}
          disabled={locked}
          onChange={(articulation) => patch({ articulation })}
        />
      </Field>

      <Field label="Digitación / posición">
        <TextInput
          value={fields.fingering}
          disabled={locked}
          placeholder="3-2-1, IV, 2ª cuerda…"
          onChange={(fingering) => patch({ fingering })}
        />
      </Field>

      <Field label="Técnica">
        <TextInput
          value={fields.technique}
          disabled={locked}
          placeholder="arco abajo, plectro, pedal…"
          onChange={(technique) => patch({ technique })}
        />
      </Field>

      <Field label="Análisis armónico">
        <TextInput
          value={fields.harmony}
          disabled={locked}
          placeholder="I – V7 – vi"
          onChange={(harmony) => patch({ harmony })}
        />
      </Field>

      <Field label="Nota">
        <textarea
          value={fields.text}
          disabled={locked}
          rows={3}
          placeholder="Qué pasa en este pasaje…"
          onChange={(e) => patch({ text: e.target.value })}
          className="w-full resize-none rounded-lg border border-line px-2 py-1.5 text-sm outline-none focus:border-accent disabled:bg-surface"
        />
      </Field>

      <Field label="Etiquetas">
        <TextInput
          value={(current?.tags ?? []).join(", ")}
          disabled={locked}
          placeholder="examen, sección B"
          onChange={(value) =>
            patch({
              tags: value
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean),
            })
          }
        />
      </Field>

      <NoteList
        notes={notes}
        measureNumbers={measureNumbers}
        partName={(id) => parts.find((p) => p.id === id)?.name ?? null}
        onSelect={({ note, layer }) => {
          setActiveLayer(layer.id);
          const r = noteRange(note);
          useStore.getState().setTargetPartId(note.partId ?? null);
          selectMeasureRange({ from: r.from, to: r.to });
        }}
        selected={{ from, to }}
        selectedPart={targetPartId}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Comentarios                                                         */
/* ------------------------------------------------------------------ */

function CommentsTab() {
  const layers = useStore((s) => s.doc?.layers ?? []);
  const measureNumbers = useStore((s) => s.measureNumbers);
  const selectedPinId = useStore((s) => s.selectedPinId);
  const selectPin = useStore((s) => s.selectPin);
  const pins = useMemo(() => collectPins(layers), [layers]);
  const selected = pins.find((p) => p.pin.id === selectedPinId);

  return (
    <div className="space-y-3 p-3">
      {selected ? (
        <PinThread pin={selected.pin} layer={selected.layer} />
      ) : (
        <EmptyHint>
          Ancla un comentario con la herramienta <b>Comentario</b> y quedará
          fijado al punto exacto de la partitura, no a la página.
        </EmptyHint>
      )}

      <div className="space-y-1.5">
        <h3 className="px-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
          {pins.length} comentario{pins.length === 1 ? "" : "s"}
        </h3>
        {pins.map(({ pin, layer }) => (
          <button
            key={pin.id}
            onClick={() => selectPin(pin.id)}
            className={`block w-full rounded-xl border p-2 text-left transition-all ${
              pin.id === selectedPinId
                ? "border-accent/60 bg-accent/[0.06] shadow-[0_1px_2px_rgba(28,27,25,0.05)]"
                : "border-line bg-white hover:-translate-y-px hover:shadow-card"
            }`}
          >
            <div className="mb-0.5 flex items-center gap-1.5 text-[11px] text-muted">
              <span className="h-2 w-2 rounded-full" style={{ background: layer.color }} />
              <span>
                Compás{" "}
                {pin.measureIndex == null
                  ? "—"
                  : rangeLabel(pin.measureIndex, pin.measureIndex, measureNumbers)}
              </span>
              <span>·</span>
              <span>{pin.messages[0]?.tag}</span>
              {pin.resolved && <span className="ml-auto text-green-700">resuelto</span>}
            </div>
            <p
              className={`line-clamp-2 text-sm ${pin.resolved ? "text-muted line-through" : ""}`}
            >
              {pin.messages[0]?.text}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}

function PinThread({ pin, layer }: { pin: Pin; layer: Layer }) {
  const addPinMessage = useStore((s) => s.addPinMessage);
  const togglePinResolved = useStore((s) => s.togglePinResolved);
  const removePin = useStore((s) => s.removePin);
  const [reply, setReply] = useState("");

  return (
    <div className="rounded-2xl border border-line bg-white p-3 shadow-card">
      <div className="mb-2 flex items-center gap-2 text-[11px] text-muted">
        <span className="h-2.5 w-2.5 rounded-full ring-1 ring-inset ring-black/10" style={{ background: layer.color }} />
        <span>{layer.name}</span>
        <span>·</span>
        <span>compás {pin.measureIndex == null ? "—" : pin.measureIndex + 1}</span>
        <label className="ml-auto flex items-center gap-1">
          <input
            type="checkbox"
            checked={pin.resolved}
            onChange={() => togglePinResolved(pin.id)}
            className="h-3.5 w-3.5"
          />
          resuelto
        </label>
      </div>

      <div className="space-y-2">
        {pin.messages.map((message) => (
          <div key={message.id} className="rounded-lg bg-surface px-2 py-1.5">
            <div className="text-[10px] uppercase tracking-wide text-muted">
              {message.tag} ·{" "}
              {new Date(message.createdAt).toLocaleString("es-ES", {
                day: "2-digit",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </div>
            <p className={`text-sm ${pin.resolved ? "opacity-60" : ""}`}>
              {message.text}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-2 flex items-center gap-1">
        <input
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder="Responder…"
          onKeyDown={(e) => {
            if (e.key === "Enter" && reply.trim()) {
              addPinMessage(pin.id, reply.trim(), pin.messages[0]?.tag ?? "nota");
              setReply("");
            }
          }}
          className="min-w-0 flex-1 rounded-lg border border-line px-2 py-1.5 text-sm outline-none focus:border-accent"
        />
        <button
          onClick={() => {
            if (!reply.trim()) return;
            addPinMessage(pin.id, reply.trim(), pin.messages[0]?.tag ?? "nota");
            setReply("");
          }}
          className="rounded-lg border border-line px-2 py-1.5 text-xs hover:bg-surface"
        >
          Enviar
        </button>
        <button
          onClick={() => removePin(pin.id)}
          disabled={layer.locked}
          className="rounded-lg border border-line px-2 py-1.5 text-xs text-red-600 hover:bg-red-50 disabled:opacity-40"
        >
          Eliminar
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Trazo seleccionado                                                  */
/* ------------------------------------------------------------------ */

/**
 * Un trazo dibujado pertenece a la capa en la que se pintó. Poder moverlo
 * después es lo que convierte las capas en algo utilizable de verdad: la
 * corrección que hiciste en tu capa puede pasar a la del director sin
 * volver a trazarla.
 */
function SelectedStrokeCard() {
  const layers = useStore((s) => s.doc?.layers ?? []);
  const selectedStrokeId = useStore((s) => s.selectedStrokeId);
  const moveStrokeToLayer = useStore((s) => s.moveStrokeToLayer);
  const selectStroke = useStore((s) => s.selectStroke);

  if (!selectedStrokeId) return null;
  const owner = layers.find((l) => l.strokes.some((x) => x.id === selectedStrokeId));
  const stroke = owner?.strokes.find((x) => x.id === selectedStrokeId);
  if (!owner || !stroke) return null;

  const targets = layers.filter((l) => l.id !== owner.id && !l.locked && l.visible);

  return (
    <div className="border-b border-line bg-accent/[0.05] p-3">
      <div className="mb-2 flex items-center gap-2 text-[11px] text-muted">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: owner.color }} />
        <span className="font-medium text-ink">Trazo seleccionado</span>
        <span>· {stroke.tool === "highlighter" ? "resaltador" : "lápiz"}</span>
        <span>· {stroke.points.length} pt</span>
        <button
          onClick={() => selectStroke(null)}
          className="ml-auto rounded border border-line px-1.5 py-0.5 hover:bg-white"
        >
          Quitar
        </button>
      </div>
      <label className="flex items-center gap-2 text-[11px] text-muted">
        Mover a
        <select
          value=""
          disabled={targets.length === 0}
          onChange={(e) => {
            if (!e.target.value) return;
            moveStrokeToLayer(stroke.id, e.target.value);
            selectStroke(null);
          }}
          className="min-w-0 flex-1 rounded-lg border border-line bg-white px-2 py-1 text-xs text-ink outline-none focus:border-accent disabled:opacity-50"
        >
          <option value="">
            {targets.length === 0 ? "No hay otra capa disponible" : "Elige una capa…"}
          </option>
          {targets.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </label>
      <p className="mt-2 text-[10px] leading-relaxed text-muted">
        Va en «{owner.name}». Selecciona trazos con la herramienta Seleccionar.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Piezas compartidas                                                  */
/* ------------------------------------------------------------------ */

function NoteList({
  notes,
  measureNumbers,
  partName,
  onSelect,
  selected,
  selectedPart,
}: {
  notes: { note: MeasureNote; layer: Layer }[];
  measureNumbers: string[];
  partName: (partId: string) => string | null;
  onSelect: (entry: { note: MeasureNote; layer: Layer }) => void;
  selected: { from: number; to: number } | null;
  selectedPart: string | null;
}) {
  if (notes.length === 0) return null;
  return (
    <div className="space-y-1.5 pt-1">
      <h3 className="px-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
        {notes.length} pasaje{notes.length === 1 ? "" : "s"} anotado
        {notes.length === 1 ? "" : "s"}
      </h3>
      {notes.map(({ note, layer }) => {
        const r = noteRange(note);
        const isSelected =
          selected != null &&
          r.from === selected.from &&
          r.to === selected.to &&
          (note.partId ?? null) === selectedPart;
        const summary =
          note.fields.text ||
          [
            note.fields.dynamics,
            note.fields.articulation,
            note.fields.fingering,
            note.fields.harmony,
          ]
            .filter(Boolean)
            .join(" · ") ||
          "(sin texto)";
        return (
          <button
            key={`${layer.id}-${note.id}`}
            onClick={() => onSelect({ note, layer })}
            className={`flex w-full items-start gap-2 rounded-xl border p-2 text-left transition-all ${
              isSelected
                ? "border-accent/60 bg-accent/[0.06] shadow-[0_1px_2px_rgba(28,27,25,0.05)]"
                : "border-line bg-white hover:-translate-y-px hover:shadow-card"
            }`}
          >
            <span
              className="mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold text-white"
              style={{ background: layer.color }}
            >
              {rangeLabel(r.from, r.to, measureNumbers)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{summary}</span>
              <span className="block text-[10px] text-muted">
                {layer.name}
                {note.partId ? ` · ${partName(note.partId) ?? "parte"}` : ""}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted">
        {label}
      </div>
      {children}
    </div>
  );
}

function ChipRow({
  options,
  value,
  onChange,
  disabled,
}: {
  options: string[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((option) => {
        const active = value === option;
        return (
          <button
            key={option}
            disabled={disabled}
            onClick={() => onChange(active ? "" : option)}
            className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors disabled:opacity-50 ${
              active
                ? "border-transparent bg-ink text-white shadow-[0_4px_10px_-6px_rgba(28,27,25,0.9)]"
                : "border-line bg-white hover:bg-surface"
            }`}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <input
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-line px-2 py-1.5 text-sm outline-none focus:border-accent disabled:bg-surface"
    />
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-line bg-white/60 p-3 text-xs leading-relaxed text-muted">
      {children}
    </p>
  );
}
