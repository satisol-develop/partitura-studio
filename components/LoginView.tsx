"use client";

import { useEffect, useRef, useState } from "react";
import { normalizeEndpoint } from "@/lib/drive";
import { LAYER_PALETTE } from "@/lib/types";
import { useStore } from "@/lib/store";
import { Logo, PaletteStrip } from "./Logo";
import { EyeIcon, EyeOffIcon } from "./icons";

/**
 * Pantalla de acceso.
 *
 * Quién puede entrar lo decide el backend, no esta pantalla: aquí se piden
 * correo y contraseña y se manda la petición. Cualquiera puede saltarse este
 * componente y hablar con el script directamente — de hecho es una página
 * estática —, y lo que se encuentra es un servidor que no lee ni escribe nada
 * sin una sesión firmada. La puerta está en Drive.
 *
 * Lo que sí hace esta pantalla, y es la mitad de su trabajo, es explicar lo que
 * pasa cuando algo no funciona: «correo o contraseña incorrectos» no es lo
 * mismo que «no hay red», y la salida de emergencia sin conexión sólo aparece
 * cuando de verdad no se pudo preguntar al servidor.
 *
 * El diseño va en dos paneles porque son dos cosas distintas: a la izquierda lo
 * que es el programa —un pentagrama anotado, con sus tintas—, y a la derecha lo
 * único que se viene a hacer aquí, entrar. Es también la primera pantalla que
 * ve alguien a quien le han pasado el enlace, y era gris de arriba abajo.
 */

/**
 * Lo que se puede hacer dentro, con la tinta de la paleta que le corresponde.
 * Los colores no son adorno: son los mismos que aparecen en el panel de capas,
 * así que la portada no promete nada que no esté luego en el editor.
 */
const CAPACIDADES = [
  {
    color: LAYER_PALETTE[0],
    titulo: "Capas independientes",
    texto: "Tu digitación, la corrección del director y el análisis armónico, sin pisarse.",
  },
  {
    color: LAYER_PALETTE[3],
    titulo: "Datos por compás",
    texto: "Cifras, dinámica y prioridad de estudio, además de dibujar encima.",
  },
  {
    color: LAYER_PALETTE[1],
    titulo: "Comentarios anclados",
    texto: "Un hilo de conversación en el punto exacto de la partitura.",
  },
];

export default function LoginView() {
  const auth = useStore((s) => s.auth);
  const busy = useStore((s) => s.authBusy);
  const error = useStore((s) => s.authError);
  const setEndpoint = useStore((s) => s.setEndpoint);
  const enterLocalOnly = useStore((s) => s.enterLocalOnly);
  const doSignIn = useStore((s) => s.signIn);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);
  const [endpointDraft, setEndpointDraft] = useState(auth.endpoint);
  const [endpointError, setEndpointError] = useState("");
  // Sólo se ofrece entrar sin conexión si el fallo fue de red: si el servidor
  // contestó «esa contraseña no es», no hay nada que saltarse.
  const [offline, setOffline] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Si ya hay URL (fijada al construir o guardada), el foco va al correo.
    if (auth.endpoint) emailRef.current?.focus();
  }, [auth.endpoint]);

  const needsEndpoint = !auth.endpoint.trim();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setOffline(false);

    // La URL sólo se toca si hace falta: si viene fijada, no se revalida en
    // cada intento (y un fallo de formato no debería bloquear el acceso).
    if (needsEndpoint) {
      try {
        setEndpoint(normalizeEndpoint(endpointDraft));
        setEndpointError("");
      } catch (e) {
        setEndpointError(e instanceof Error ? e.message : String(e));
        return;
      }
    }

    const ok = await doSignIn(email, password);
    if (!ok) {
      const message = useStore.getState().authError;
      setOffline(/No se pudo contactar|no respondió a tiempo/i.test(message));
    }
  };

  return (
    <div className="app-height safe-top safe-bottom thin-scroll overflow-y-auto bg-paper lg:grid lg:grid-cols-[1.05fr_1fr]">
      {/* ------------------------------------------------ panel de marca */}
      <section className="relative isolate overflow-hidden bg-gradient-to-br from-ink to-ink-soft px-6 pt-8 pb-7 text-paper lg:flex lg:flex-col lg:justify-between lg:px-12 lg:py-14">
        {/* Un resplandor en dos tintas de la paleta: da profundidad sin
            competir con el formulario, que es lo que hay que leer. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 opacity-[0.5]"
          style={{
            background: `radial-gradient(38rem 26rem at 12% -8%, ${LAYER_PALETTE[0]}33, transparent 62%), radial-gradient(30rem 22rem at 92% 108%, ${LAYER_PALETTE[5]}26, transparent 60%)`,
          }}
        />

        <div>
          <Logo variant="paper" size={40} />

          <h1 className="mt-7 max-w-md text-3xl font-semibold tracking-tight text-balance lg:mt-10 lg:text-4xl">
            Anota la música, no la página
          </h1>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-paper/70">
            Todo lo que marcas —trazos, cifras y comentarios— queda en capas
            separadas, encima del MusicXML original. El archivo sigue intacto.
          </p>

          {/* En un móvil, la lista se come la pantalla antes de llegar al
              formulario; a partir de tableta es donde aporta. */}
          <ul className="mt-8 hidden max-w-md space-y-4 lg:block">
            {CAPACIDADES.map((capacidad) => (
              <li key={capacidad.titulo} className="flex gap-3">
                <span
                  aria-hidden="true"
                  className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: capacidad.color }}
                />
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium">
                    {capacidad.titulo}
                  </span>
                  <span className="block text-xs leading-relaxed text-paper/60">
                    {capacidad.texto}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-8 lg:mt-0">
          <PaletteStrip />
          <p className="mt-2 text-[11px] leading-relaxed text-paper/55">
            Ocho tintas, una por capa. Se ocultan, se reordenan y se recolorean
            por separado.
          </p>
        </div>
      </section>

      {/* --------------------------------------------------- formulario */}
      <section className="flex flex-1 items-start justify-center px-6 py-10 lg:items-center lg:px-12">
        <div className="w-full max-w-sm">
          <header className="mb-5">
            <h2 className="text-xl font-semibold tracking-tight">Entrar</h2>
            <p className="mt-1.5 text-xs leading-relaxed text-muted">
              El acceso lo concede quien administra la instalación: hay una
              lista de correos autorizados y no se puede entrar con otro.
            </p>
          </header>

          <form
            onSubmit={submit}
            className="space-y-3.5 rounded-2xl border border-line bg-white p-4 shadow-[0_1px_2px_rgba(28,27,25,0.04),0_12px_28px_-18px_rgba(28,27,25,0.25)]"
          >
            {needsEndpoint && (
              <div className="space-y-1.5">
                <label
                  htmlFor="acceso-servidor"
                  className="block text-[11px] font-medium uppercase tracking-wide text-muted"
                >
                  Dirección del servidor
                </label>
                <input
                  id="acceso-servidor"
                  value={endpointDraft}
                  onChange={(e) => setEndpointDraft(e.target.value)}
                  spellCheck={false}
                  autoComplete="off"
                  inputMode="url"
                  aria-invalid={endpointError ? true : undefined}
                  aria-describedby={endpointError ? "error-servidor" : "ayuda-servidor"}
                  placeholder="https://script.google.com/macros/s/…/exec"
                  className="w-full rounded-xl border border-line bg-paper px-3 py-2.5 font-mono text-xs outline-none focus:border-accent"
                />
                {endpointError ? (
                  <p
                    id="error-servidor"
                    className="text-[11px] leading-relaxed text-red-800"
                  >
                    {endpointError}
                  </p>
                ) : (
                  <p id="ayuda-servidor" className="text-[11px] leading-relaxed text-muted">
                    Te la da Apps Script al publicar la aplicación web (termina
                    en /exec). Suele venir ya rellena.
                  </p>
                )}
              </div>
            )}

            {/* Etiquetas con `htmlFor` en vez de envolver el campo: dentro de
                un `label` no puede haber otro elemento interactivo, y el
                campo de la contraseña lleva el botón de verla dentro. */}
            <div className="space-y-1.5">
              <label
                htmlFor="acceso-correo"
                className="block text-[11px] font-medium uppercase tracking-wide text-muted"
              >
                Correo
              </label>
              <input
                id="acceso-correo"
                ref={emailRef}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                required
                className="w-full rounded-xl border border-line bg-paper px-3 py-2.5 text-sm outline-none focus:border-accent"
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="acceso-contrasena"
                className="block text-[11px] font-medium uppercase tracking-wide text-muted"
              >
                Contraseña
              </label>
              {/* El botón de ver la contraseña va dentro del campo: es donde se
                  busca, y así no hay que salir del formulario para comprobar
                  lo que se ha escrito. */}
              <span className="relative block">
                <input
                  id="acceso-contrasena"
                  type={reveal ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                  className="w-full rounded-xl border border-line bg-paper px-3 py-2.5 pr-11 text-sm outline-none focus:border-accent"
                />
                <button
                  type="button"
                  onClick={() => setReveal((value) => !value)}
                  aria-pressed={reveal}
                  aria-label={reveal ? "Ocultar la contraseña" : "Mostrar la contraseña"}
                  className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-xl text-muted hover:text-ink"
                >
                  {reveal ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
                </button>
              </span>
            </div>

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-xl bg-accent-deep px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-deep-hover disabled:opacity-60"
            >
              {busy ? "Comprobando…" : "Entrar"}
            </button>

            {/* El error se anuncia en el momento (`alert`), no como nota al
                margen: es la única señal de que el intento ha fallado, y quien
                use lector de pantalla no ve el color. */}
            {error && !busy && (
              <p
                role="alert"
                className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[11px] leading-relaxed text-red-900"
              >
                <span
                  aria-hidden="true"
                  className="mt-px grid h-4 w-4 shrink-0 place-items-center rounded-full bg-red-700 text-[10px] font-bold text-white"
                >
                  !
                </span>
                <span>{error}</span>
              </p>
            )}

            <p role="status" aria-live="polite" className="min-h-4 text-[11px] text-muted">
              {busy ? "Hablando con el servidor…" : ""}
            </p>
          </form>

          {offline && (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-3">
              <p className="text-[11px] leading-relaxed text-amber-900">
                No se ha podido preguntar al servidor. Si ya has entrado antes en
                este equipo, tus partituras siguen guardadas aquí y puedes
                trabajar con ellas sin conexión; volver a Drive es cosa de entrar
                de nuevo cuando haya red.
              </p>
              <button
                onClick={enterLocalOnly}
                className="mt-2 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
              >
                Ver lo guardado en este equipo
              </button>
            </div>
          )}

          <p className="mt-6 text-[11px] leading-relaxed text-muted">
            Tus anotaciones se guardan primero en este navegador, así que puedes
            anotar sin conexión. La sesión es para leer y escribir la carpeta
            compartida de Drive.
          </p>
        </div>
      </section>
    </div>
  );
}
