/**
 * Marca de Partitura Studio.
 *
 * El símbolo es literalmente lo que hace el programa: un pentagrama con sus
 * cinco líneas y, encima, una anotación de cada tipo que se puede dejar en él
 *
 *   · la banda verde   = el subrayado de compás (color «verde análisis»)
 *   · el trazo azul    = la tinta a mano alzada («azul estudio»)
 *   · el punto rojo    = el pin de comentario («rojo correcciones»)
 *
 * Los tres colores NO son decorativos: salen de `LAYER_PALETTE`, las mismas
 * tintas que el usuario elige para sus capas. Así la marca y la aplicación no
 * pueden separarse con el tiempo — cambiar la paleta cambia el logotipo.
 *
 * Dos versiones, y no es capricho: sobre papel la placa va en tinta (`ink`) y
 * sobre el panel oscuro del acceso va en papel (`paper`), porque una placa
 * oscura sobre fondo oscuro deja de leerse.
 *
 * Si se cambia la geometría, hay que cambiarla también en `app/icon.svg`, que
 * es el favicon y no puede importar de aquí (es un archivo estático).
 */

import { LAYER_PALETTE } from "@/lib/types";

const INK = "#1c1b19";
const PAPER = "#fdfcfa";

/** Las cinco líneas del pentagrama, en coordenadas del lienzo de 48×48. */
const STAFF_LINES = [15, 19, 23, 27, 31];

interface MarkProps {
  /** `ink` para fondos claros, `paper` para fondos oscuros. */
  variant?: "ink" | "paper";
  size?: number;
  className?: string;
}

/**
 * El símbolo, sin nombre. Va `aria-hidden` a propósito: siempre acompaña al
 * nombre escrito, y anunciar dos veces «Partitura Studio» sobra.
 */
export function LogoMark({ variant = "ink", size = 40, className }: MarkProps) {
  // Sobre papel: placa de tinta con el pentagrama en claro. Sobre tinta, al
  // revés. Las tintas de anotación son las mismas en las dos versiones.
  const plate = variant === "paper" ? PAPER : INK;
  const staff = variant === "paper" ? INK : PAPER;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <rect width="48" height="48" rx="13" fill={plate} />

      <g stroke={staff} strokeOpacity="0.34" strokeWidth="1.3">
        {STAFF_LINES.map((y) => (
          <line key={y} x1="7.5" y1={y} x2="40.5" y2={y} />
        ))}
      </g>

      {/* Subrayado de compás: la banda del resaltador, por detrás del trazo. */}
      <rect
        x="8.5"
        y="20.6"
        width="15.5"
        height="4.6"
        rx="2.3"
        fill={LAYER_PALETTE[2]}
        opacity="0.75"
      />

      {/* Trazo a mano alzada: sube por el pentagrama como una línea melódica. */}
      <path
        d="M8.5 30.5c6 1.7 9.4-9.4 15.4-11.2"
        fill="none"
        stroke={LAYER_PALETTE[0]}
        strokeWidth="2.8"
        strokeLinecap="round"
      />

      {/* Pin de comentario, con su halo: ancla un hilo a un punto exacto. */}
      <circle cx="35" cy="27.5" r="6" fill="none" stroke={LAYER_PALETTE[1]} strokeWidth="1.5" opacity="0.45" />
      <circle cx="35" cy="27.5" r="3.5" fill={LAYER_PALETTE[1]} />
    </svg>
  );
}

interface LogoProps extends MarkProps {
  className?: string;
}

/**
 * Símbolo + nombre. El color del texto lo hereda del contenedor, así que la
 * misma pieza sirve en la cabecera clara y en el panel oscuro del acceso.
 */
export function Logo({ variant = "ink", size = 36, className = "" }: LogoProps) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <LogoMark variant={variant} size={size} />
      <span className="block leading-none">
        <span className="block text-[15px] font-semibold tracking-tight">Partitura</span>
        <span
          className={`mt-1 block text-[10px] font-semibold uppercase tracking-[0.22em] ${
            variant === "paper" ? "text-accent-light" : "text-accent-deep"
          }`}
        >
          Studio
        </span>
      </span>
    </span>
  );
}

/**
 * La paleta entera, en una tira. En el acceso hace un trabajo concreto: decir
 * de un vistazo que aquí se trabaja con tinta de color, no con una interfaz
 * gris. Es la misma lista que ofrece el panel de capas, en el mismo orden.
 */
export function PaletteStrip({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 ${className}`} aria-hidden="true">
      {LAYER_PALETTE.map((color) => (
        <span
          key={color}
          className="h-1.5 w-5 rounded-full"
          style={{ backgroundColor: color }}
        />
      ))}
    </span>
  );
}
