"use client";

import { useState } from "react";
import { EyeIcon, EyeOffIcon, LockIcon, UnlockIcon } from "./icons";
import { useStore } from "@/lib/store";
import { colorName, LAYER_PALETTE, type Layer } from "@/lib/types";

/**
 * El corazón de la propuesta: las anotaciones viven en capas, como las
 * canciones de una playlist. Puedes ocultar la capa del director para
 * estudiar con la tuya, o superponer tu digitación sobre la corrección
 * del profesor sin que una tape a la otra.
 */
export default function LayerPanel() {
  const layers = useStore((s) => s.doc?.layers ?? []);
  const activeLayerId = useStore((s) => s.activeLayerId);
  const soloActiveLayer = useStore((s) => s.soloActiveLayer);
  const setName = useStore((s) => s.updateLayer);
  const setActiveLayer = useStore((s) => s.setActiveLayer);
  const addLayer = useStore((s) => s.addLayer);
  const removeLayer = useStore((s) => s.removeLayer);
  const moveLayer = useStore((s) => s.moveLayer);
  const duplicateLayer = useStore((s) => s.duplicateLayer);
  const clearLayer = useStore((s) => s.clearLayer);
  const toggleSolo = useStore((s) => s.toggleSoloActiveLayer);

  const [editing, setEditing] = useState<string | null>(null);

  // Se pintan de arriba abajo en orden inverso al array: la última capa del
  // array es la que queda encima en el papel, así que debe salir primero.
  const ordered = [...layers].reverse();

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
          Capas
        </h2>
        <div className="flex items-center gap-1">
          <button
            onClick={toggleSolo}
            title="Mostrar sólo la capa activa"
            className={`rounded-md px-2 py-1 text-[11px] ${
              soloActiveLayer
                ? "bg-ink text-white"
                : "border border-line hover:bg-surface"
            }`}
          >
            Solo activa
          </button>
          <button
            onClick={() => addLayer()}
            title="Nueva capa"
            className="rounded-md border border-line px-2 py-1 text-[11px] hover:bg-surface"
          >
            + Añadir
          </button>
        </div>
      </div>

      <div className="thin-scroll flex-1 space-y-1.5 overflow-y-auto px-2 pb-3">
        {ordered.map((layer) => (
          <LayerRow
            key={layer.id}
            layer={layer}
            active={layer.id === activeLayerId}
            canDelete={layers.length > 1}
            editing={editing === layer.id}
            onStartEdit={() => setEditing(layer.id)}
            onStopEdit={() => setEditing(null)}
            onSelect={() => setActiveLayer(layer.id)}
            onRename={(name) => {
              setName(layer.id, { name });
              setEditing(null);
            }}
            onPatch={(patch) => setName(layer.id, patch)}
            onUp={() => moveLayer(layer.id, 1)}
            onDown={() => moveLayer(layer.id, -1)}
            onDuplicate={() => duplicateLayer(layer.id)}
            onClear={() => clearLayer(layer.id)}
            onDelete={() => removeLayer(layer.id)}
          />
        ))}
      </div>
    </div>
  );
}

function LayerRow({
  layer,
  active,
  canDelete,
  editing,
  onStartEdit,
  onStopEdit,
  onSelect,
  onRename,
  onPatch,
  onUp,
  onDown,
  onDuplicate,
  onClear,
  onDelete,
}: {
  layer: Layer;
  active: boolean;
  canDelete: boolean;
  editing: boolean;
  onStartEdit: () => void;
  onStopEdit: () => void;
  onSelect: () => void;
  onRename: (name: string) => void;
  onPatch: (patch: Partial<Layer>) => void;
  onUp: () => void;
  onDown: () => void;
  onDuplicate: () => void;
  onClear: () => void;
  onDelete: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const total = layer.strokes.length + layer.pins.length + layer.notes.length;

  return (
    <div
      onClick={onSelect}
      className={`group cursor-pointer rounded-xl border p-2 transition ${
        active
          ? "border-accent/60 bg-accent/[0.06]"
          : "border-line bg-white hover:border-line/80"
      }`}
    >
      <div className="flex items-center gap-1.5">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPatch({ visible: !layer.visible });
          }}
          title={layer.visible ? "Ocultar capa" : "Mostrar capa"}
          aria-pressed={layer.visible}
          className={`grid h-6 w-6 shrink-0 place-items-center rounded ${
            layer.visible ? "text-ink" : "text-muted"
          } hover:bg-surface`}
        >
          {layer.visible ? <EyeIcon /> : <EyeOffIcon />}
        </button>

        <span
          className="h-3.5 w-3.5 shrink-0 rounded-full"
          style={{ background: layer.color }}
          title={colorName(layer.color)}
          aria-hidden
        />

        {/* Activar la capa también con el teclado (Enter o espacio), no sólo
            pulsando la fila: el doble clic sigue sirviendo para renombrar. */}
        {editing ? (
          <input
            autoFocus
            defaultValue={layer.name}
            onBlur={(e) => onRename(e.target.value.trim() || layer.name)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onRename(e.currentTarget.value.trim() || layer.name);
              if (e.key === "Escape") onStopEdit();
            }}
            onClick={(e) => e.stopPropagation()}
            className="min-w-0 flex-1 rounded border border-line px-1 py-0.5 text-sm outline-none focus:border-accent"
          />
        ) : (
          <button
            onClick={onSelect}
            onDoubleClick={onStartEdit}
            aria-current={active ? "true" : undefined}
            className={`min-w-0 flex-1 truncate text-left text-sm ${
              layer.visible ? "" : "text-muted line-through"
            }`}
            title="Pulsa para activarla; doble clic para renombrar"
          >
            {layer.name}
          </button>
        )}

        <span className="shrink-0 text-[11px] tabular-nums text-muted">{total}</span>

        <button
          onClick={(e) => {
            e.stopPropagation();
            onPatch({ locked: !layer.locked });
          }}
          title={layer.locked ? "Desbloquear" : "Bloquear (evita ediciones)"}
          className={`grid h-6 w-6 shrink-0 place-items-center rounded hover:bg-surface ${
            layer.locked
              ? "text-ink"
              : "touch-visible text-muted opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          }`}
        >
          {layer.locked ? <LockIcon /> : <UnlockIcon />}
        </button>

        <button
          onClick={(e) => {
            e.stopPropagation();
            setMenu((v) => !v);
          }}
          className="touch-visible grid h-6 w-6 shrink-0 place-items-center rounded text-sm leading-none text-muted opacity-0 hover:bg-surface group-hover:opacity-100 focus-visible:opacity-100"
          title="Más opciones"
          aria-expanded={menu}
          aria-label="Más opciones de la capa"
        >
          ⋯
        </button>
      </div>

      {menu && (
        <div
          className="mt-2 space-y-1 border-t border-line pt-2 text-xs"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-1 pb-1">
            {LAYER_PALETTE.map((color) => (
              <button
                key={color}
                onClick={() => onPatch({ color })}
                aria-label={`Color ${colorName(color)}`}
                aria-pressed={layer.color === color}
                className={`h-4 w-4 rounded-full border ${
                  layer.color === color ? "ring-2 ring-offset-1 ring-ink" : "border-line"
                }`}
                style={{ background: color }}
                title={colorName(color)}
              />
            ))}
          </div>

          <label className="flex items-center gap-2 text-muted">
            Opacidad
            <input
              type="range"
              min={0.15}
              max={1}
              step={0.05}
              value={layer.opacity}
              onChange={(e) => onPatch({ opacity: Number(e.target.value) })}
              className="flex-1"
            />
            <span className="tabular-nums">{Math.round(layer.opacity * 100)}%</span>
          </label>

          <div className="flex flex-wrap gap-1 pt-1">
            <MenuButton onClick={onUp}>Subir</MenuButton>
            <MenuButton onClick={onDown}>Bajar</MenuButton>
            <MenuButton onClick={onDuplicate}>Duplicar</MenuButton>
            <MenuButton
              onClick={() => {
                if (confirm(`¿Vaciar “${layer.name}”? Se pierden sus anotaciones.`)) {
                  onClear();
                }
              }}
            >
              Vaciar
            </MenuButton>
            <MenuButton
              danger
              disabled={!canDelete}
              onClick={() => {
                if (
                  confirm(
                    `¿Eliminar la capa “${layer.name}” con sus ${total} anotaciones?`,
                  )
                ) {
                  onDelete();
                }
              }}
            >
              Eliminar
            </MenuButton>
          </div>
        </div>
      )}
    </div>
  );
}

function MenuButton({
  children,
  onClick,
  danger,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md border border-line px-2 py-1 disabled:opacity-40 ${
        danger ? "text-red-600 hover:bg-red-50" : "hover:bg-surface"
      }`}
    >
      {children}
    </button>
  );
}
