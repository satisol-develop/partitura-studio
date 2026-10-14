"use client";

import { useEffect, useRef, useState } from "react";
import { getSharedPlayer } from "@/lib/playback";
import { useStore } from "@/lib/store";

function formatTime(seconds: number) {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const total = Math.floor(safe);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}

/**
 * Transporte de reproducción.
 *
 * La barra de progreso se refresca con `requestAnimationFrame` y guarda el
 * tiempo en su propio estado: si pusiéramos el tiempo en el store, cada
 * fotograma re-renderizaría la partitura entera y el dibujo se notaría lento.
 */
export default function TransportBar() {
  const timeline = useStore((s) => s.timeline);
  const isPlaying = useStore((s) => s.isPlaying);
  const followPlayhead = useStore((s) => s.followPlayhead);
  const playheadMeasure = useStore((s) => s.playheadMeasure);
  const setFollowPlayhead = useStore((s) => s.setFollowPlayhead);
  const animatedRef = useRef<number | null>(null);
  // Arranca con el tiempo real del motor en vez de con 0: si la partitura se
  // acaba de cargar y ya se había buscado una posición, el valor es el bueno.
  const [time, setTime] = useState(() => getSharedPlayer().currentTime);

  // El reloj de la barra sólo corre mientras suena. Pausar, detener y buscar
  // ya actualizan el tiempo desde sus propios manejadores, así que no hace
  // falta tocar el estado dentro del efecto (lo que provocaría renders en
  // cascada).
  useEffect(() => {
    if (!isPlaying) return;
    const loop = () => {
      setTime(getSharedPlayer().currentTime);
      animatedRef.current = requestAnimationFrame(loop);
    };
    animatedRef.current = requestAnimationFrame(loop);
    return () => {
      if (animatedRef.current !== null) cancelAnimationFrame(animatedRef.current);
    };
  }, [isPlaying]);

  // Detener o cargar otra partitura devuelve el contador a cero.
  useEffect(() => {
    const reset = () => setTime(getSharedPlayer().currentTime);
    window.addEventListener("ps:playback-reset", reset);
    return () => window.removeEventListener("ps:playback-reset", reset);
  }, []);

  if (!timeline) return null;

  const total = timeline.duration;
  const progress = total > 0 ? Math.min(1, time / total) : 0;
  const hasNotes = timeline.notes.length > 0;

  // Los callbacks (playhead y cursor) los registra el lienzo, que es quien
  // tiene la instancia de OSMD; aquí sólo se manda el transporte.
  const play = () => {
    getSharedPlayer().play();
    useStore.getState().setIsPlaying(true);
  };

  const pause = () => {
    getSharedPlayer().pause();
    useStore.getState().setIsPlaying(false);
    setTime(getSharedPlayer().currentTime);
  };

  const stop = () => {
    const player = getSharedPlayer();
    player.stop();
    player.resetCursorTracking();
    useStore.getState().setIsPlaying(false);
    useStore.getState().setPlayheadMeasure(null);
    setTime(0);
    window.dispatchEvent(new Event("ps:playback-reset"));
  };

  const seek = (value: number) => {
    const player = getSharedPlayer();
    player.seek(value);
    setTime(value);
    if (useStore.getState().isPlaying) window.dispatchEvent(new Event("ps:playback-seek"));
  };

  return (
    <div className="no-print flex items-center gap-3 border-t border-line bg-white px-3 py-2 text-xs">
      <div className="flex items-center gap-1">
        <button
          onClick={isPlaying ? pause : play}
          disabled={!hasNotes}
          title={isPlaying ? "Pausa (espacio)" : "Reproducir el contenido del XML"}
          className="grid h-8 w-8 place-items-center rounded-full bg-ink text-white disabled:opacity-40"
        >
          {isPlaying ? (
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
              <rect x="1.5" y="1" width="3" height="10" fill="currentColor" />
              <rect x="7.5" y="1" width="3" height="10" fill="currentColor" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
              <path d="M2 1l9 5-9 5V1Z" fill="currentColor" />
            </svg>
          )}
          <span className="sr-only">{isPlaying ? "Pausa" : "Reproducir"}</span>
        </button>
        <button
          onClick={stop}
          disabled={!hasNotes}
          title="Detener y volver al principio"
          className="grid h-8 w-8 place-items-center rounded-full border border-line hover:bg-surface disabled:opacity-40"
        >
          <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden>
            <rect x="1.5" y="1.5" width="9" height="9" fill="currentColor" />
          </svg>
          <span className="sr-only">Detener</span>
        </button>
      </div>

      <span className="w-10 tabular-nums text-muted">{formatTime(time)}</span>

      <input
        type="range"
        min={0}
        max={Math.max(0.1, total)}
        step={0.05}
        value={time}
        onChange={(e) => seek(Number(e.target.value))}
        className="h-1 flex-1 cursor-pointer"
        aria-label="Posición de reproducción"
      />
      <span className="w-10 tabular-nums text-muted">{formatTime(total)}</span>

      <span className="hidden text-muted sm:block">
        {timeline.notes.length} notas · {Math.round(timeline.tempo)} BPM
      </span>

      {playheadMeasure != null && (
        <span className="hidden rounded-md bg-surface px-2 py-1 tabular-nums text-muted md:block">
          compás {playheadMeasure + 1}
        </span>
      )}

      <label
        className="flex cursor-pointer items-center gap-1.5 text-muted"
        title="Desplazar la partitura para seguir lo que suena"
      >
        <input
          type="checkbox"
          checked={followPlayhead}
          onChange={(e) => setFollowPlayhead(e.target.checked)}
          className="h-3.5 w-3.5"
        />
        Seguir
      </label>

      <div className="w-16 text-right">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-75"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}
