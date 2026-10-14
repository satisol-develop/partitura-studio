"use client";

import { useEffect } from "react";
import DriveDialog from "./DriveDialog";
import LibraryView from "./LibraryView";
import LoginView from "./LoginView";
import ScoreView from "./ScoreView";
import { hasValidSession, loginRequired } from "@/lib/auth";
import { getSharedPlayer } from "@/lib/playback";
import { useStore } from "@/lib/store";
import type { ToolId } from "@/lib/types";

const TOOL_KEYS: Record<string, ToolId> = {
  p: "pencil",
  h: "highlighter",
  e: "eraser",
  c: "comment",
  n: "measure",
  v: "select",
};

export default function Workspace() {
  const ready = useStore((s) => s.ready);
  const doc = useStore((s) => s.doc);
  const refreshLibrary = useStore((s) => s.refreshLibrary);
  const refreshRemote = useStore((s) => s.refreshRemote);
  const restoreSession = useStore((s) => s.restoreSession);
  const saveNow = useStore((s) => s.saveNow);
  const auth = useStore((s) => s.auth);
  const localOnly = useStore((s) => s.localOnly);

  useEffect(() => {
    void refreshLibrary();
    // Una sesión guardada se comprueba contra el servidor en segundo plano: si
    // ya no vale, la aplicación volverá sola a la pantalla de acceso; si no hay
    // red, se sigue trabajando con lo que hay en este equipo.
    void restoreSession();
    // Y, si hay sesión, qué partituras hay en Drive: la biblioteca lo usa para
    // marcar «en Drive» desde el primer momento.
    void refreshRemote();
  }, [refreshLibrary, refreshRemote, restoreSession]);

  // Atajos de teclado: se ignoran mientras se escribe en un campo, porque
  // si no la "e" de "expresivo" activaría la goma y perderías el foco.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      if (typing) return;

      const mod = event.metaKey || event.ctrlKey;

      if (mod && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) useStore.getState().redo();
        else useStore.getState().undo();
        return;
      }
      if (mod && event.key.toLowerCase() === "y") {
        event.preventDefault();
        useStore.getState().redo();
        return;
      }
      if (mod && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void useStore.getState().saveNow();
        return;
      }
      if (mod) return;

      const state = useStore.getState();
      if (!state.doc) return;

      // Barra espaciadora: reproducir o pausar, como en cualquier reproductor.
      if (event.key === " ") {
        const player = getSharedPlayer();
        if (!state.timeline || state.timeline.notes.length === 0) return;
        event.preventDefault();
        if (state.isPlaying) {
          player.pause();
          state.setIsPlaying(false);
        } else {
          player.play();
          state.setIsPlaying(true);
        }
        return;
      }

      if (event.key === "Escape") {
        state.selectMeasure(null);
        state.selectPin(null);
        return;
      }
      if (event.key === "+" || event.key === "=") {
        state.setZoom(state.zoom + 0.1);
        return;
      }
      if (event.key === "-") {
        state.setZoom(state.zoom - 0.1);
        return;
      }
      if (event.key === "0") {
        state.setZoom(1);
        return;
      }

      const tool = TOOL_KEYS[event.key.toLowerCase()];
      if (tool) {
        event.preventDefault();
        state.setTool(tool);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Sin autoguardado pendiente al cerrar: el debounce de 900 ms podría dejar
  // fuera el último trazo. Si hay algo pendiente se guarda y, además, se pide
  // confirmación al navegador: guardar mientras se cierra la pestaña es una
  // carrera que no siempre se gana, y perder veinte compases anotados por
  // cerrar sin querer no es aceptable.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      void saveNow();
      if (!useStore.getState().pendingSave) return;
      event.preventDefault();
      // Navegadores antiguos exigen `returnValue` para mostrar el aviso.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      // Al salir, cortamos el audio: el motor no depende del árbol de React.
      getSharedPlayer().dispose();
    };
  }, [saveNow]);

  // Salida de emergencia que usa la barrera de errores: si una partitura
  // concreta revienta al dibujarse, volver a la biblioteca permite seguir
  // trabajando (y exportar lo demás) sin recargar la página.
  useEffect(() => {
    const reset = () => useStore.getState().closeScore();
    window.addEventListener("ps:reset-view", reset);
    return () => window.removeEventListener("ps:reset-view", reset);
  }, []);

  if (!ready) {
    return (
      <div
        className="grid min-h-screen place-items-center text-sm text-muted"
        role="status"
        aria-live="polite"
      >
        Cargando…
      </div>
    );
  }

  // La puerta. `loginRequired` decide si esta instalación la necesita y
  // `localOnly` es la única excepción: haber pedido expresamente ver lo que ya
  // está guardado en este equipo cuando no hay red para preguntar.
  const needsLogin =
    loginRequired(auth.endpoint.trim().length > 0) &&
    !hasValidSession(auth) &&
    !localOnly;

  if (needsLogin) return <LoginView />;

  return (
    <>
      {doc ? <ScoreView /> : <LibraryView />}
      {/* Los ajustes de Drive son del equipo, no de una partitura: se montan
          una sola vez, por encima de las dos vistas. */}
      <DriveDialog />
    </>
  );
}
