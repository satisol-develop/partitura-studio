"use client";

import { useEffect, useRef, useState } from "react";
import { hasValidSession } from "@/lib/auth";
import { BUILD_ENDPOINT, normalizeEndpoint } from "@/lib/drive";
import { useStore } from "@/lib/store";
import { CloseIcon, SyncIcon } from "./icons";

/**
 * Ajustes de la sincronización con Drive.
 *
 * Ya no hay campo de «token»: con login, la aplicación no maneja ninguna llave
 * del servidor. Lo único que se guarda es la dirección de la implementación y
 * la sesión que devuelve al entrar, y esa sesión no se escribe a mano nunca.
 *
 * El cuerpo vive en un componente aparte que sólo existe mientras el diálogo
 * está abierto. Es a propósito: así el borrador de la dirección nace al abrirlo
 * y muere al cerrarlo, en vez de tener que ir sincronizándolo con el store
 * desde un efecto (que además de ser un lío provoca renders en cascada).
 */
export default function DriveDialog() {
  const open = useStore((s) => s.drivePanelOpen);
  if (!open) return null;
  return <DriveDialogBody />;
}

function DriveDialogBody() {
  const auth = useStore((s) => s.auth);
  const status = useStore((s) => s.syncStatus);
  const message = useStore((s) => s.syncMessage);
  const lastSyncAt = useStore((s) => s.lastSyncAt);
  const autoSync = useStore((s) => s.autoSync);
  const remote = useStore((s) => s.remote);
  const setEndpoint = useStore((s) => s.setEndpoint);
  const setDrivePanelOpen = useStore((s) => s.setDrivePanelOpen);
  const setAutoSync = useStore((s) => s.setAutoSync);
  const testDrive = useStore((s) => s.testDrive);
  const syncNow = useStore((s) => s.syncNow);
  const doSignOut = useStore((s) => s.signOut);

  const [endpointDraft, setEndpointDraft] = useState(auth.endpoint);
  const [localError, setLocalError] = useState("");
  const panelRef = useRef<HTMLDivElement | null>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const restoreFocusTo = useRef<HTMLElement | null>(null);

  // Al abrir: recordar dónde estaba el foco, llevarlo al primer campo y
  // devolverlo al cerrar. Sin esto, cerrar el diálogo deja a quien navega con
  // teclado al principio del documento.
  useEffect(() => {
    restoreFocusTo.current = document.activeElement as HTMLElement | null;
    firstFieldRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      restoreFocusTo.current?.focus?.();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setDrivePanelOpen(false);
        return;
      }
      // Foco atrapado: `Tab` no debe salirse a la interfaz de detrás.
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [setDrivePanelOpen]);

  const signedIn = hasValidSession(auth);

  const applyEndpoint = (): boolean => {
    setLocalError("");
    try {
      const normalized = normalizeEndpoint(endpointDraft);
      setEndpointDraft(normalized);
      setEndpoint(normalized);
      return true;
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
      return false;
    }
  };

  const statusStyles: Record<string, string> = {
    idle: "border-line bg-surface text-muted",
    working: "border-accent/40 bg-accent/[0.06] text-accent",
    error: "border-red-200 bg-red-50 text-red-700",
  };

  return (
    <div className="no-print fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6">
      <div
        className="absolute inset-0 bg-ink/45 backdrop-blur-[2px]"
        onClick={() => setDrivePanelOpen(false)}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drive-dialog-title"
        className="rise-in thin-scroll relative max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-line bg-white p-4 shadow-pop sm:rounded-3xl sm:p-5"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 id="drive-dialog-title" className="text-base font-semibold tracking-tight">
              Sincronización con Drive
            </h2>
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted">
              Las anotaciones y el MusicXML de cada partitura se guardan en una
              carpeta de Google Drive. Quién puede entrar lo decide el servidor
              con la lista de correos autorizados.
            </p>
          </div>
          <button
            onClick={() => setDrivePanelOpen(false)}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-line bg-white text-muted transition-colors hover:bg-surface hover:text-ink"
            aria-label="Cerrar ajustes"
            title="Cerrar"
          >
            <CloseIcon size={15} />
          </button>
        </div>

        <div className="space-y-3">
          {signedIn ? (
            <div className="rounded-xl border border-line bg-surface p-3">
              <p className="text-xs">
                Has entrado como <b>{auth.email}</b>.
              </p>
              <p className="mt-0.5 text-[11px] text-muted">
                Sesión válida hasta el{" "}
                {new Date(auth.expiresAt).toLocaleDateString("es-ES", {
                  day: "2-digit",
                  month: "long",
                  year: "numeric",
                })}
                .
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  onClick={() => void testDrive()}
                  disabled={status === "working"}
                  className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-medium transition-colors hover:bg-surface disabled:opacity-50"
                >
                  Probar conexión
                </button>
                <button
                  onClick={() => void syncNow()}
                  disabled={status === "working"}
                  className="flex items-center gap-1.5 rounded-lg bg-gradient-to-b from-ink to-ink-soft px-3 py-1.5 text-xs font-semibold text-white shadow-[0_8px_18px_-12px_rgba(28,27,25,0.9)] transition-all disabled:opacity-40 disabled:shadow-none"
                >
                  <SyncIcon size={13} className={status === "working" ? "animate-spin" : undefined} />
                  {status === "working" ? "Sincronizando…" : "Sincronizar ahora"}
                </button>
                <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted">
                  <input
                    type="checkbox"
                    checked={autoSync}
                    onChange={(e) => setAutoSync(e.target.checked)}
                    className="h-3.5 w-3.5"
                  />
                  Sincronizar solo
                </label>
                <button
                  onClick={() => {
                    doSignOut();
                    setDrivePanelOpen(false);
                  }}
                  className="ml-auto rounded-lg border border-line bg-white px-2 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50"
                >
                  Salir
                </button>
              </div>
            </div>
          ) : (
            <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] leading-relaxed text-amber-900">
              No hay sesión: las partituras de este equipo se pueden usar, pero
              no se sincronizan con Drive. Sal y entra con tu correo para
              volver a la carpeta compartida.
            </p>
          )}

          <label className="block space-y-1">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted">
              Dirección del servidor
            </span>
            <input
              ref={firstFieldRef}
              value={endpointDraft}
              onChange={(e) => setEndpointDraft(e.target.value)}
              onBlur={() => {
                if (endpointDraft.trim() !== auth.endpoint) applyEndpoint();
              }}
              spellCheck={false}
              autoComplete="off"
              inputMode="url"
              placeholder="https://script.google.com/macros/s/…/exec"
              className="w-full rounded-lg border border-line px-2 py-1.5 font-mono text-xs outline-none focus:border-accent"
            />
            <span className="block text-[11px] leading-relaxed text-muted">
              {BUILD_ENDPOINT
                ? "Viene fijada al publicar el sitio; sólo hay que cambiarla si mueves la implementación."
                : "Cópiala de Apps Script al publicar la aplicación web (termina en /exec)."}
            </span>
          </label>

          {localError && (
            <p
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700"
            >
              {localError}
            </p>
          )}

          <div
            className={`rounded-xl border p-2.5 text-xs ${statusStyles[status] ?? statusStyles.idle}`}
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            <p>{message || "Nada pendiente."}</p>
            {lastSyncAt && (
              <p className="mt-1 opacity-80">
                Última sincronización:{" "}
                {new Date(lastSyncAt).toLocaleString("es-ES", {
                  day: "2-digit",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            )}
            {signedIn && (
              <p className="mt-1 opacity-80">
                En Drive ahora mismo: {remote.length}{" "}
                {remote.length === 1 ? "partitura" : "partituras"}.
              </p>
            )}
          </div>

          <details className="rounded-lg border border-line bg-surface p-2 text-xs">
            <summary className="cursor-pointer font-medium">
              Cómo se administra el acceso
            </summary>
            <ol className="mt-2 list-decimal space-y-1 pl-5 leading-relaxed text-muted">
              <li>
                Quien administra la instalación abre el proyecto de Apps Script y
                ejecuta{" "}
                <code>generarUsuario(&quot;correo@ejemplo.com&quot;, &quot;contraseña&quot;)</code>.
              </li>
              <li>
                Copia la línea que sale en el registro dentro de la propiedad{" "}
                <code>USERS</code>.
              </li>
              <li>
                Para retirar el acceso:{" "}
                <code>desactivarUsuario(&quot;correo@ejemplo.com&quot;)</code> (sus
                sesiones mueren en la siguiente petición), o{" "}
                <code>revocarSesiones()</code> para echar a todo el mundo.
              </li>
            </ol>
            <p className="mt-2 leading-relaxed text-muted">
              La aplicación no guarda ninguna contraseña ni ninguna llave del
              servidor: sólo la sesión firmada que devuelve el script.
            </p>
          </details>

          <p className="text-[11px] leading-relaxed text-muted">
            Todo se guarda primero <b>en este equipo</b>, así que la aplicación
            funciona sin conexión; Drive es la copia compartida. Si la misma
            partitura cambia en dos sitios, gana la versión más reciente y se te
            avisa del conflicto.
          </p>
        </div>
      </div>
    </div>
  );
}
