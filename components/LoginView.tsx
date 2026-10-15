"use client";

import { useEffect, useRef, useState } from "react";
import { normalizeEndpoint } from "@/lib/drive";
import { LAYER_PALETTE } from "@/lib/types";
import { useStore } from "@/lib/store";
import { Logo, PaletteStrip } from "./Logo";
import {
  CheckIcon,
  CommentIcon,
  EyeIcon,
  EyeOffIcon,
  LayersIcon,
  MeasureNoteIcon,
} from "./icons";

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
    Icon: LayersIcon,
    titulo: "Capas independientes",
    texto: "Tu digitación, la corrección del director y el análisis armónico, sin pisarse.",
  },
  {
    color: LAYER_PALETTE[3],
    Icon: MeasureNoteIcon,
    titulo: "Datos por compás",
    texto: "Cifras, dinámica y prioridad de estudio, además de dibujar encima.",
  },
  {
    color: LAYER_PALETTE[1],
    Icon: CommentIcon,
    titulo: "Comentarios anclados",
    texto: "Un hilo de conversación en el punto exacto de la partitura.",
  },
];

/**
 * Pentagrama de fondo del panel de marca.
 *
 * Es decoración, no contenido: `aria-hidden` y en opacidad baja para que no
 * compita con el formulario. Sirve para que el panel oscuro se lea como una
 * partitura anotada —barras de compás, una banda de resaltador, un trazo y un
 * pin— en vez de como un rectángulo de color.
 */
function StaffBackdrop() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 640 360"
      preserveAspectRatio="xMidYMid slice"
      className="pointer-events-none absolute inset-x-0 bottom-0 h-[58%] w-full"
    >
      <g stroke={LAYER_PALETTE[0]} strokeOpacity="0.22" strokeWidth="1.4">
        {[120, 136, 152, 168, 184].map((y) => (
          <line key={y} x1="-20" y1={y} x2="660" y2={y} />
        ))}
      </g>
      {/* Barras de compás. */}
      <g stroke={LAYER_PALETTE[0]} strokeOpacity="0.2" strokeWidth="1.6">
        {[40, 240, 440, 620].map((x) => (
          <line key={x} x1={x} y1="112" x2={x} y2="192" />
        ))}
      </g>
      {/* Banda de resaltador sobre un tramo. */}
      <rect x="244" y="150" width="190" height="20" rx="10" fill={LAYER_PALETTE[2]} opacity="0.16" />
      {/* Trazo a mano alzada. */}
      <path
        d="M46 176c40 12 62-52 104-58 46-6 60 34 104 26 40-8 56-44 96-40"
        fill="none"
        stroke={LAYER_PALETTE[0]}
        strokeOpacity="0.5"
        strokeWidth="3"
        strokeLinecap="round"
      />
      {/* Pin de comentario. */}
      <circle cx="462" cy="158" r="16" fill="none" stroke={LAYER_PALETTE[1]} strokeOpacity="0.32" strokeWidth="2" />
      <circle cx="462" cy="158" r="8" fill={LAYER_PALETTE[1]} opacity="0.55" />
    </svg>
  );
}

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
      <section className="relative isolate overflow-hidden bg-gradient-to-br from-ink via-ink to-ink-soft px-6 pt-9 pb-8 text-paper lg:flex lg:flex-col lg:justify-between lg:px-12 lg:py-14">
        {/* Un resplandor en dos tintas de la paleta: da profundidad sin
            competir con el formulario, que es lo que hay que leer. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background: `radial-gradient(40rem 28rem at 8% -10%, ${LAYER_PALETTE[0]}40, transparent 62%), radial-gradient(32rem 24rem at 96% 112%, ${LAYER_PALETTE[5]}30, transparent 58%), radial-gradient(24rem 18rem at 82% 8%, ${LAYER_PALETTE[2]}1f, transparent 60%)`,
          }}
        />
        <StaffBackdrop />
        {/* Rejilla finísima: quita el aire de superficie plana sin dibujar nada
            que se pueda confundir con contenido. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 opacity-[0.06]"
          style={{
            backgroundImage:
              "linear-gradient(to right, #ffffff 1px, transparent 1px), linear-gradient(to bottom, #ffffff 1px, transparent 1px)",
            backgroundSize: "26px 26px",
          }}
        />

        <div className="relative">
          <Logo variant="paper" size={42} />

          <span className="mt-8 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-accent-light">
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-accent-light" />
            Anotación musical por capas
          </span>

          <h1 className="mt-4 max-w-md bg-gradient-to-br from-paper via-paper to-paper/60 bg-clip-text text-3xl font-semibold tracking-tight text-balance text-transparent lg:text-[2.7rem] lg:leading-[1.08]">
            Anota la música, no la página
          </h1>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-paper/70">
            Todo lo que marcas —trazos, cifras y comentarios— queda en capas
            separadas, encima del MusicXML original. El archivo sigue intacto.
          </p>

          {/* En un móvil, la lista se come la pantalla antes de llegar al
              formulario; a partir de tableta es donde aporta. */}
          <ul className="mt-8 hidden max-w-md space-y-2.5 lg:block">
            {CAPACIDADES.map((capacidad) => (
              <li
                key={capacidad.titulo}
                className="flex gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3 transition-colors hover:border-white/20 hover:bg-white/[0.07]"
              >
                <span
                  aria-hidden="true"
                  className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-white/10"
                  style={{ backgroundColor: `${capacidad.color}2e`, color: capacidad.color }}
                >
                  <capacidad.Icon size={16} />
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium">
                    {capacidad.titulo}
                  </span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-paper/60">
                    {capacidad.texto}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative mt-9 lg:mt-0">
          <PaletteStrip />
          <p className="mt-2 max-w-sm text-[11px] leading-relaxed text-paper/55">
            Ocho tintas, una por capa. Se ocultan, se reordenan y se recolorean
            por separado.
          </p>
        </div>
      </section>

      {/* --------------------------------------------------- formulario */}
      <section className="relative flex flex-1 items-start justify-center overflow-hidden px-6 py-10 lg:items-center lg:px-12">
        {/* El lado claro también respira: un halo tenue de acento detrás de la
            tarjeta, que es la única cosa con relieve de este panel. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 opacity-70"
          style={{
            background: `radial-gradient(30rem 22rem at 78% -6%, ${LAYER_PALETTE[0]}14, transparent 64%), radial-gradient(26rem 20rem at 6% 106%, ${LAYER_PALETTE[4]}12, transparent 60%)`,
          }}
        />
        <div className="rise-in w-full max-w-sm">
          <header className="mb-5">
            <h2 className="text-2xl font-semibold tracking-tight">Entrar</h2>
            <p className="mt-1.5 text-xs leading-relaxed text-muted">
              El acceso lo concede quien administra la instalación: hay una
              lista de correos autorizados y no se puede entrar con otro.
            </p>
          </header>

          <form
            onSubmit={submit}
            className="relative space-y-3.5 overflow-hidden rounded-2xl border border-line bg-white p-4 shadow-lift"
          >
            {/* Filete de acento: la firma de la marca sobre la tarjeta. */}
            <span
              aria-hidden="true"
              className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-accent via-accent-light to-accent"
            />
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
              className="mt-1 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-accent to-accent-deep px-4 py-2.5 text-sm font-semibold text-white shadow-[0_10px_22px_-12px_rgba(24,88,196,0.85)] transition-all hover:from-accent-deep hover:to-accent-deep-hover hover:shadow-[0_14px_26px_-12px_rgba(24,88,196,0.9)] active:translate-y-px disabled:opacity-60 disabled:shadow-none"
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

          <ul className="mt-6 space-y-2 text-[11px] leading-relaxed text-muted">
            <li className="flex items-start gap-2">
              <CheckIcon size={13} className="mt-0.5 shrink-0 text-accent-deep" />
              <span>
                Se guarda primero <b className="text-ink">en este navegador</b>,
                así que puedes anotar sin conexión.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <CheckIcon size={13} className="mt-0.5 shrink-0 text-accent-deep" />
              <span>
                La sesión es sólo para leer y escribir la carpeta compartida de
                Drive.
              </span>
            </li>
          </ul>
        </div>
      </section>
    </div>
  );
}
