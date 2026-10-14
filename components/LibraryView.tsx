"use client";

import { useRef, useState } from "react";
import { DEMO_XML } from "@/lib/demo-score";
import { TRIO_XML } from "@/lib/demo-trio";
import { importScoreFile } from "@/lib/files";
import { useStore } from "@/lib/store";
import { makeLayer, uid, type ScoreDocument } from "@/lib/types";
import { Logo } from "./Logo";

export default function LibraryView() {
  const library = useStore((s) => s.library);
  const openScore = useStore((s) => s.openScore);
  const createScore = useStore((s) => s.createScore);
  const removeScore = useStore((s) => s.removeScore);
  const remote = useStore((s) => s.remote);
  const syncStatus = useStore((s) => s.syncStatus);
  const saveError = useStore((s) => s.saveError);
  const setDrivePanelOpen = useStore((s) => s.setDrivePanelOpen);
  const authEmail = useStore((s) => s.auth.email);
  const doSignOut = useStore((s) => s.signOut);
  const remoteIds = new Set(remote.map((summary) => summary.id));
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError("");
    setWarnings([]);
    const collected: string[] = [];
    try {
      for (const file of Array.from(files)) {
        const { doc, warnings: fileWarnings } = await importScoreFile(file);
        collected.push(...fileWarnings);
        await createScore(doc);
        await openScore(doc.meta.id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo importar el archivo.");
    } finally {
      if (collected.length > 0) setWarnings(collected);
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const createDemo = async (variant: "solo" | "trio") => {
    const layer = makeLayer("Mis anotaciones", 0);
    const now = Date.now();
    const doc: ScoreDocument = {
      meta: {
        id: uid("score"),
        title: variant === "trio" ? "Tres voces" : "Estudio en Do mayor",
        composer: "Anónimo",
        instrumentation: variant === "trio" ? "Saxo alto, piano y bajo" : "Piano",
        source: "demo",
        createdAt: now,
        updatedAt: now,
      },
      xml: variant === "trio" ? TRIO_XML : DEMO_XML,
      layers: [layer],
      activeLayerId: layer.id,
    };
    await createScore(doc);
    await openScore(doc.meta.id);
  };

  return (
    <div className="thin-scroll min-h-screen overflow-y-auto bg-surface">
      <div className="mx-auto max-w-4xl px-6 py-14">
        <header className="mb-10">
          <Logo size={34} className="mb-3" />
          <h1 className="text-3xl font-semibold tracking-tight">
            Anota la música, no la página
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">
            Cada partitura tiene <b>capas independientes</b> de anotación: tu
            digitación, la corrección del director, el análisis armónico. Se
            ocultan, se reordenan y se recolorean por separado. Además de
            dibujar, cada compás admite datos estructurados y cada punto
            admite un hilo de comentarios.
          </p>
        </header>

        <div className="mb-8 flex flex-wrap items-center gap-2">
          <button
            onClick={() => fileInput.current?.click()}
            disabled={busy}
            className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? "Importando…" : "Importar partitura"}
          </button>
          <button
            onClick={() => createDemo("solo")}
            className="rounded-lg border border-line bg-white px-4 py-2 text-sm hover:bg-surface"
          >
            Ejemplo para piano solo
          </button>
          <button
            onClick={() => createDemo("trio")}
            className="rounded-lg border border-line bg-white px-4 py-2 text-sm hover:bg-surface"
          >
            Ejemplo para trío (saxo, piano, bajo)
          </button>
          <input
            ref={fileInput}
            type="file"
            multiple
            accept=".musicxml,.xml,.mxl,.mid,.midi,.json"
            className="hidden"
            onChange={(e) => void handleFiles(e.target.files)}
          />
          <button
            onClick={() => setDrivePanelOpen(true)}
            className="rounded-lg border border-line bg-white px-4 py-2 text-sm hover:bg-surface"
          >
            {syncStatus === "working" ? "Sincronizando…" : "Drive…"}
          </button>
          <span className="text-xs text-muted">
            MusicXML · .mxl · MIDI · copia .json con tus capas
          </span>
        </div>

        {(authEmail || syncStatus === "error") && (
          <div className="mb-6 flex flex-wrap items-center gap-2 text-[11px] text-muted">
            {authEmail && (
              <span>
                Sesión iniciada como <b className="text-ink">{authEmail}</b>.
              </span>
            )}
            {authEmail ? (
              <button
                onClick={doSignOut}
                className="rounded-md border border-line px-2 py-0.5 hover:bg-white"
              >
                Salir
              </button>
            ) : (
              <span>
                Sin sesión: se trabaja con lo guardado en este equipo y no se
                sincroniza con Drive.
              </span>
            )}
          </div>
        )}

        {(error || saveError) && (
          <div
            role="alert"
            className="mb-6 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
          >
            {error || saveError}
          </div>
        )}
        {warnings.length > 0 && (
          <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <p className="mb-1 font-medium">Avisos de la importación</p>
            <ul className="list-disc space-y-0.5 pl-5">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        {library.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line bg-white/60 p-10 text-center">
            <p className="text-sm text-muted">
              Todavía no hay partituras. Importa un MusicXML o empieza con el
              ejemplo para probar las capas.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {library.map((score) => (
              <li key={score.id}>
                <div className="group flex items-center gap-3 rounded-xl border border-line bg-white px-4 py-3 transition hover:border-line hover:shadow-sm">
                  <button
                    onClick={() => void openScore(score.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="truncate text-sm font-medium">
                        {score.title}
                      </span>
                      {score.composer && (
                        <span className="truncate text-xs text-muted">
                          {score.composer}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted">
                      <span>
                        {score.annotationCount}{" "}
                        {score.annotationCount === 1 ? "anotación" : "anotaciones"} · origen{" "}
                        {score.source} · modificada{" "}
                        {new Date(score.updatedAt).toLocaleDateString("es-ES")}
                      </span>
                      {remoteIds.has(score.id) && (
                        <span
                          className="rounded bg-accent/[0.08] px-1.5 py-0.5 font-medium text-accent"
                          title="Esta partitura está en tu Drive"
                        >
                          en Drive
                        </span>
                      )}
                    </div>
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`¿Eliminar “${score.title}” y sus anotaciones?`)) {
                        void removeScore(score.id);
                      }
                    }}
                    className="touch-visible rounded-md px-2 py-1 text-xs text-muted opacity-0 transition group-hover:opacity-100 hover:bg-red-50 hover:text-red-600 focus-visible:opacity-100"
                  >
                    Eliminar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-10 text-[11px] leading-relaxed text-muted">
          Todo se guarda primero <b>en este navegador</b>, así que la aplicación
          funciona sin conexión y nada sale del equipo si no lo pides. Con
          <b> Drive…</b> puede además sincronizarse con una carpeta de tu Google
          Drive (tus anotaciones y el MusicXML de cada partitura), y la copia
          .json sigue estando ahí para llevarte las capas a mano.
        </p>
      </div>
    </div>
  );
}
