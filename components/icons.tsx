/**
 * Iconos en SVG en línea.
 *
 * A propósito NO usamos emoji: en Linux y en Windows aparecen como cajas
 * vacías en cuanto falta una fuente, y la barra de herramientas se vuelve
 * ilegible justo en los botones que más se usan.
 */

interface IconProps {
  size?: number;
  className?: string;
}

function base(size: number, className?: string) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
    "aria-hidden": true,
  };
}

export function PencilIcon({ size = 17, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M4 20h4l10.5-10.5a2.12 2.12 0 0 0-3-3L5 17v3Z" />
      <path d="M13.5 6.5l3 3" />
    </svg>
  );
}

export function HighlighterIcon({ size = 17, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M9 14 4.5 18.5" />
      <path d="M14.5 4.5 19.5 9.5 12 17H7.5L5 14.5 14.5 4.5Z" />
      <path d="M3 21h7" />
    </svg>
  );
}

export function EraserIcon({ size = 17, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M8.5 20H20" />
      <path d="M13.5 4.5 5 13l5.5 5.5 8.5-8.5L13.5 4.5Z" />
      <path d="M9 8.5 15.5 15" />
    </svg>
  );
}

export function CommentIcon({ size = 17, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M20 15a3 3 0 0 1-3 3H8l-4 3V6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v9Z" />
    </svg>
  );
}

export function MeasureNoteIcon({ size = 17, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M8 3v3M16 3v3M3.5 9.5h17" />
      <path d="M8 13h3M8 16.5h6" />
    </svg>
  );
}

export function CursorIcon({ size = 17, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M5.5 3.5 19 10.5l-5.8 1.9L10.6 19 5.5 3.5Z" />
    </svg>
  );
}

export function LockIcon({ size = 15, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <rect x="4.5" y="10.5" width="15" height="9.5" rx="2.5" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

export function UnlockIcon({ size = 15, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <rect x="4.5" y="10.5" width="15" height="9.5" rx="2.5" />
      <path d="M8 10.5V7.5a4 4 0 0 1 7.5-1.9" />
    </svg>
  );
}

export function EyeIcon({ size = 15, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function EyeOffIcon({ size = 15, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M4 4l16 16" />
      <path d="M9.6 6.1A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3.2 4.1" />
      <path d="M6.4 7.6A17.4 17.4 0 0 0 2.5 12S6 18.5 12 18.5c1 0 1.9-.2 2.7-.5" />
      <path d="M9.9 10a3 3 0 0 0 4.2 4.2" />
    </svg>
  );
}
