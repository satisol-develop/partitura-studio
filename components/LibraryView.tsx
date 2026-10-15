"use client";

import { useRef, useState } from "react";
import { DEMO_XML } from "@/lib/demo-score";
import { TRIO_XML } from "@/lib/demo-trio";
import { importScoreFile } from "@/lib/files";
import { useStore } from "@/lib/store";
import {
  countAnnotations,
  LAYER_PALETTE,
  makeLayer,
  uid,
  type ScoreDocument,
  type ScoreSummary,
} from "@/lib/types";
import { Logo, LogoMark, PaletteStrip } from "./Logo";
import {
  FolderIcon,
  LogoutIcon,
  MusicIcon,
  PencilIcon,
  SearchIcon,
  SparkIcon,
  TrashIcon,
  UploadIcon,
} from "./icons";

/**
 * Biblioteca: la pantalla que se ve al entrar, antes de abrir ninguna
 * partitura. Es el "panel de control" de la aplicación, así que carga el peso
 * visual que el editor no puede permitirse (ahí manda la música).
 *
 * Lo que se enseña de un vistazo: quién ha entrado, qué partituras hay (con su
 * origen y cuántas anotaciones llevan), y las tres formas de empezar —importar,
 * un ejemplo, o Drive—. Nada de esto cambia lo que se puede hacer: los mismos
 * botones de antes, sólo colocados y con relieve.
 */

/** Nombre legible del origen de un archivo, para la ficha de la tarjeta. */
const SOURCE_LABELS: Record<ScoreSummary["source"], string> = {
  demo: "Ejemplo",
  musicxml: "MusicXML",
  mxl: "MusicXML comprimido",
  midi: "MIDI",
};

/**
 * Aviso antes de reemplazar una partitura por una copia importada.
 *
 * Pone delante lo que hace falta para decidir: cuántas anotaciones tiene cada
 * una y de cuándo es cada una. Sin esos dos datos, «¿reemplazar?» es una
 * pregunta que no se puede contestar.
 */
function confirmOverwrite(
  existing: ScoreSummary,
  incoming: ScoreDocument,
  fileName: string,
): boolean {
  const date = (value: number) => new Date(value).toLocaleString("es-ES");
  return confirm(
    `Ya tienes «${existing.title}» en este equipo y la copia «${fileName}» lleva su mismo id.\n\n` +
      `En este equipo: ${existing.annotationCount} anotaciones, del ${date(existing.updatedAt)}\n` +
      `En la copia: ${countAnnotations(incoming.layers)} anotaciones, del ${date(incoming.meta.updatedAt)}\n\n` +
      "¿Reemplazar la que hay? Se perderá tal y como está ahora.",
  );
}

/**
 * Tinta de la tarjeta, derivada del id para que no baile al reordenar la lista.
 * Sale de la misma paleta que las capas, así que la biblioteca y el editor
 * hablan el mismo idioma de color.
 */
function accentFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return LAYER_PALETTE[hash % LAYER_PALETTE.length];
}

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
  const [query, setQuery] = useState("");

  const annotationTotal = library.reduce((acc, score) => acc + score.annotationCount, 0);
  const driveCount = library.filter((score) => remoteIds.has(score.id)).length;
  const syncing = syncStatus === "working";

  // Buscar por título, autor y origen: son los tres datos que se ven en la
  // ficha, así que es lo que uno espera poder escribir. Con pocas partituras
  // no hacía falta, pero la lista crece y hasta ahora no había forma de
  // encontrar una sin recorrerla entera.
  const needle = query.trim().toLowerCase();
  const visible = needle
    ? library.filter((score) =>
        `${score.title} ${score.composer} ${SOURCE_LABELS[score.source] ?? score.source}`
          .toLowerCase()
          .includes(needle),
      )
    : library;

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
        // Una copia .json conserva el id de su partitura, así que importarla
        // REEMPLAZA la que ya haya con ese id. Se pregunta antes: reemplazar en
        // silencio una partitura con más trabajo que la copia es perder trabajo,
        // y el aviso lleva los dos números para poder decidir.
        const existing = library.find((score) => score.id === doc.meta.id);
        if (existing && !confirmOverwrite(existing, doc, file.name)) continue;
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
    <div className="thin-scroll relative min-h-screen overflow-y-auto bg-surface">
      {/* Halo de fondo: le quita al gris de la superficie el aire de lienzo en
          blanco. No es clicable y no captura el puntero. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-80"
        style={{
          background: `radial-gradient(42rem 26rem at 78% -12%, ${LAYER_PALETTE[0]}1a, transparent 66%), radial-gradient(32rem 22rem at 4% 4%, ${LAYER_PALETTE[4]}14, transparent 62%)`,
        }}
      />

      {/* ------------------------------------------------- barra superior */}
      <header className="no-print sticky top-0 z-30 border-b border-line/70 bg-paper/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-2.5 sm:px-6">
          <Logo size={30} className="min-w-0" />

          <div className="ml-auto flex items-center gap-2">
            {authEmail ? (
              <span className="hidden items-center gap-2 rounded-full border border-line bg-white px-2.5 py-1 text-[11px] text-muted shadow-sm sm:flex">
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                <b className="max-w-[13rem] truncate font-medium text-ink">{authEmail}</b>
              </span>
            ) : (
              <span className="hidden rounded-full border border-line bg-white px-2.5 py-1 text-[11px] text-muted shadow-sm sm:inline">
                Sin sesión · sólo este equipo
              </span>
            )}

            <button
              onClick={() => setDrivePanelOpen(true)}
              title="Ajustes de sincronización con Drive"
              className={`touch-target flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium shadow-sm transition-colors ${
                syncStatus === "error"
                  ? "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                  : "border-line bg-white text-ink hover:bg-surface"
              }`}
            >
              <FolderIcon size={15} />
              <span className="hidden sm:inline">{syncing ? "Sincronizando…" : "Drive"}</span>
            </button>

            {authEmail && (
              <button
                onClick={doSignOut}
                title="Cerrar la sesión"
                aria-label="Cerrar la sesión"
                className="touch-target grid h-8 w-8 place-items-center rounded-xl border border-line bg-white text-muted shadow-sm transition-colors hover:text-ink"
              >
                <LogoutIcon size={15} />
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="relative mx-auto max-w-5xl px-4 pt-8 pb-20 sm:px-6">
        {/* ------------------------------------------------- cabecera */}
        <section className="rise-in relative overflow-hidden rounded-3xl border border-line bg-gradient-to-br from-white via-white to-surface p-5 shadow-card sm:p-8">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-0 w-56 opacity-70"
            style={{
              background: `radial-gradient(16rem 12rem at 100% 0%, ${LAYER_PALETTE[0]}18, transparent 70%)`,
            }}
          />
          <div className="relative max-w-2xl">
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-paper px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-accent" />
              Biblioteca
            </span>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:mt-4 sm:text-[2.5rem] sm:leading-[1.1]">
              Tus partituras
            </h1>
            <p className="mt-2.5 line-clamp-3 text-[13px] leading-relaxed text-muted sm:mt-3 sm:line-clamp-none sm:text-sm">
              Cada partitura tiene <b className="text-ink">capas independientes</b> de
              anotación: tu digitación, la corrección del director, el análisis
              armónico. Se ocultan, se reordenan y se recolorean por separado.
              Además de dibujar, cada compás admite datos estructurados y cada
              punto admite un hilo de comentarios.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 sm:mt-5">
              <PaletteStrip />
              <span className="text-[11px] text-muted">Ocho tintas, una por capa</span>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------- acciones */}
        <section className="mt-6 flex flex-wrap items-center gap-2.5">
          <button
            onClick={() => fileInput.current?.click()}
            disabled={busy}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-ink to-ink-soft px-4 py-3 text-sm font-semibold text-white shadow-[0_12px_24px_-14px_rgba(28,27,25,0.9)] transition-all hover:shadow-[0_16px_28px_-14px_rgba(28,27,25,0.95)] active:translate-y-px disabled:opacity-50 disabled:shadow-none sm:w-auto sm:py-2.5"
          >
            <UploadIcon size={16} />
            {busy ? "Importando…" : "Importar partitura"}
          </button>

          <button
            onClick={() => createDemo("solo")}
            className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-line bg-white px-3 py-3 text-sm font-medium shadow-sm transition-colors hover:bg-surface sm:min-h-0 sm:flex-none sm:px-3.5 sm:py-2.5"
          >
            <SparkIcon size={16} className="shrink-0 text-accent-deep" />
            <span className="sm:hidden">Piano solo</span>
            <span className="hidden truncate sm:inline">Ejemplo para piano solo</span>
          </button>

          <button
            onClick={() => createDemo("trio")}
            className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-line bg-white px-3 py-3 text-sm font-medium shadow-sm transition-colors hover:bg-surface sm:min-h-0 sm:flex-none sm:px-3.5 sm:py-2.5"
          >
            <SparkIcon size={16} className="shrink-0 text-accent-deep" />
            <span className="sm:hidden">Trío</span>
            <span className="hidden truncate sm:inline">Ejemplo para trío</span>
            <span className="hidden text-muted lg:inline">(saxo, piano, bajo)</span>
          </button>

          <input
            ref={fileInput}
            type="file"
            multiple
            accept=".musicxml,.xml,.mxl,.mid,.midi,.json"
            className="hidden"
            onChange={(e) => void handleFiles(e.target.files)}
          />

          <span className="w-full text-[11px] text-muted sm:w-auto">
            MusicXML · .mxl · MIDI · copia .json con tus capas
          </span>
        </section>

        {/* ------------------------------------------------- avisos */}
        {syncStatus === "error" && !saveError && (
          <div className="mt-6 flex flex-wrap items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-800">
            <span className="font-medium">La última sincronización con Drive falló.</span>
            <button
              onClick={() => setDrivePanelOpen(true)}
              className="rounded-md border border-red-300 bg-white px-2 py-0.5 hover:bg-red-100"
            >
              Ver ajustes
            </button>
          </div>
        )}

        {(error || saveError) && (
          <div
            role="alert"
            className="rise-in mt-6 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 shadow-sm"
          >
            {error || saveError}
          </div>
        )}
        {warnings.length > 0 && (
          <div className="rise-in mt-6 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 shadow-sm">
            <p className="mb-1 font-medium">Avisos de la importación</p>
            <ul className="list-disc space-y-0.5 pl-5">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        {/* ------------------------------------------------- resumen */}
        {library.length > 0 && (
          <dl className="mt-6 grid grid-cols-3 gap-2 sm:mt-7 sm:gap-3">
            {[
              { label: "Partituras", value: library.length, Icon: MusicIcon },
              { label: "Anotaciones", value: annotationTotal, Icon: PencilIcon },
              { label: "En Drive", value: driveCount, Icon: FolderIcon },
            ].map((stat) => (
              <div
                key={stat.label}
                className="rise-in flex items-center gap-2 rounded-2xl border border-line bg-white p-2.5 shadow-card sm:gap-3 sm:p-3"
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-accent/[0.08] text-accent-deep sm:h-9 sm:w-9">
                  <stat.Icon size={16} />
                </span>
                <span className="min-w-0">
                  <span className="block text-lg font-semibold leading-none tracking-tight sm:text-xl">
                    {stat.value}
                  </span>
                  <span className="mt-1 block truncate text-[11px] text-muted">
                    {stat.label}
                  </span>
                </span>
              </div>
            ))}
          </dl>
        )}

        {/* ------------------------------------------------- lista */}
        <div className="mt-7 flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="text-sm font-semibold tracking-tight">
            {library.length > 0 ? "Partituras recientes" : "Empezar"}
          </h2>
          {library.length > 0 && (
            <>
              <span className="text-[11px] text-muted">
                {needle ? `${visible.length} de ${library.length}` : library.length}{" "}
                {library.length === 1 ? "partitura" : "partituras"}
              </span>
              <label className="relative ml-auto flex w-full items-center sm:w-72">
                <span className="sr-only">Buscar en la biblioteca</span>
                <SearchIcon
                  size={15}
                  className="pointer-events-none absolute left-2.5 text-muted"
                />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar por título o autor…"
                  className="w-full rounded-xl border border-line bg-white py-2 pr-3 pl-8 text-sm outline-none transition-colors focus:border-accent"
                />
              </label>
            </>
          )}
        </div>

        {library.length === 0 ? (
          <div className="rise-in mt-3 rounded-3xl border border-dashed border-line bg-white/70 p-10 text-center shadow-card">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-line bg-surface">
              <LogoMark size={30} />
            </span>
            <p className="mt-4 text-sm font-medium">Todavía no hay partituras</p>
            <p className="mx-auto mt-1.5 max-w-sm text-xs leading-relaxed text-muted">
              Importa un MusicXML, un MIDI o un .mxl, o empieza con uno de los
              ejemplos de arriba para probar las capas.
            </p>
          </div>
        ) : visible.length === 0 ? (
          <div className="rise-in mt-3 rounded-3xl border border-dashed border-line bg-white/70 p-10 text-center shadow-card">
            <p className="text-sm font-medium">Ninguna partitura coincide</p>
            <p className="mx-auto mt-1.5 max-w-sm text-xs leading-relaxed text-muted">
              No hay nada que contenga «{query.trim()}» en el título, el autor ni
              el origen.
            </p>
            <button
              onClick={() => setQuery("")}
              className="mt-4 rounded-xl border border-line bg-white px-3 py-2 text-sm font-medium transition-colors hover:bg-surface"
            >
              Ver todas
            </button>
          </div>
        ) : (
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {visible.map((score) => {
              const accent = accentFor(score.id);
              const inDrive = remoteIds.has(score.id);
              return (
                <li key={score.id} className="rise-in">
                  <div className="group relative flex items-stretch overflow-hidden rounded-2xl border border-line bg-white shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lift">
                    {/* Lomo de color: el color de la tarjeta, como el de una capa. */}
                    <span
                      aria-hidden="true"
                      className="w-1.5 shrink-0"
                      style={{ backgroundColor: accent }}
                    />
                    <button
                      onClick={() => void openScore(score.id)}
                      className="flex min-w-0 flex-1 items-center gap-3.5 px-4 py-4 text-left"
                    >
                      <span
                        aria-hidden="true"
                        className="grid h-11 w-11 shrink-0 place-items-center rounded-xl"
                        style={{ backgroundColor: `${accent}1f`, color: accent }}
                      >
                        <MusicIcon size={20} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-2">
                          <span className="truncate text-sm font-semibold">
                            {score.title}
                          </span>
                          {score.composer && (
                            <span className="truncate text-xs text-muted">
                              {score.composer}
                            </span>
                          )}
                        </span>
                        <span className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-muted">
                          <span className="rounded-md bg-surface px-1.5 py-0.5 font-medium text-ink/70">
                            {SOURCE_LABELS[score.source] ?? score.source}
                          </span>
                          <span>
                            {score.annotationCount}{" "}
                            {score.annotationCount === 1 ? "anotación" : "anotaciones"}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>
                            {new Date(score.updatedAt).toLocaleDateString("es-ES")}
                          </span>
                          {inDrive && (
                            <span
                              className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-700"
                              title="Esta partitura está en tu Drive"
                            >
                              <span
                                aria-hidden="true"
                                className="h-1.5 w-1.5 rounded-full bg-emerald-500"
                              />
                              en Drive
                            </span>
                          )}
                        </span>
                      </span>
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`¿Eliminar “${score.title}” y sus anotaciones?`)) {
                          void removeScore(score.id);
                        }
                      }}
                      title={`Eliminar “${score.title}”`}
                      aria-label={`Eliminar “${score.title}”`}
                      className="touch-visible my-3 mr-3 grid w-9 shrink-0 place-items-center self-center rounded-xl text-muted opacity-0 transition group-hover:opacity-100 hover:bg-red-50 hover:text-red-600 focus-visible:opacity-100"
                    >
                      <TrashIcon size={16} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <p className="mt-10 flex items-start gap-2 text-[11px] leading-relaxed text-muted">
          <FolderIcon size={14} className="mt-0.5 shrink-0" />
          <span>
            Todo se guarda primero <b className="text-ink">en este navegador</b>, así
            que la aplicación funciona sin conexión y nada sale del equipo si no lo
            pides. Con <b className="text-ink">Drive</b> puede además sincronizarse con
            una carpeta de tu Google Drive (tus anotaciones y el MusicXML de cada
            partitura), y la copia .json sigue estando ahí para llevarte las capas a
            mano.
          </span>
        </p>
      </main>
    </div>
  );
}
