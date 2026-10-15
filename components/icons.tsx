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

/* ---------------------------------------------------------------- */
/* Iconos de la biblioteca y de la pantalla de acceso               */
/* ---------------------------------------------------------------- */

/** Importar: una flecha que entra en una bandeja. */
export function UploadIcon({ size = 17, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M12 15.5V4" />
      <path d="M7.5 8.5 12 4l4.5 4.5" />
      <path d="M4.5 15v3.5a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5V15" />
    </svg>
  );
}

/** Empezar de cero / añadir. */
export function PlusIcon({ size = 17, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/** Drive: una carpeta, que es lo que se comparte. */
export function FolderIcon({ size = 17, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h3.2a2 2 0 0 1 1.6.8l1 1.2H18a2.5 2.5 0 0 1 2.5 2.5v6.5A2.5 2.5 0 0 1 18 18.5H6A2.5 2.5 0 0 1 3.5 16v-8.5Z" />
    </svg>
  );
}

/** Eliminar. */
export function TrashIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M4 7h16" />
      <path d="M9.5 7V5.2A1.2 1.2 0 0 1 10.7 4h2.6a1.2 1.2 0 0 1 1.2 1.2V7" />
      <path d="M6.5 7l.8 11.2A1.9 1.9 0 0 0 9.2 20h5.6a1.9 1.9 0 0 0 1.9-1.8L17.5 7" />
      <path d="M10.5 11v5M13.5 11v5" />
    </svg>
  );
}

/** Partitura: corchea con su plica, la marca de una pieza en la lista. */
export function MusicIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M9 18V6.5l9-2v11.5" />
      <circle cx="6.5" cy="18" r="2.5" />
      <circle cx="15.5" cy="16" r="2.5" />
    </svg>
  );
}

/** Salir de la sesión. */
export function LogoutIcon({ size = 15, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M14 4.5h3.5a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5H14" />
      <path d="M10 8l-4 4 4 4" />
      <path d="M6 12h9" />
    </svg>
  );
}

/** Ejemplo / plantilla con la que empezar. */
export function SparkIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M12 4.5 13.6 9l4.4 1.6L13.6 12 12 16.5 10.4 12 6 10.6 10.4 9 12 4.5Z" />
      <path d="M18.5 4v2.4M17.3 5.2h2.4" />
    </svg>
  );
}

/** Capas, el eje de la aplicación. */
export function LayersIcon({ size = 17, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M12 4 3.5 8.5 12 13l8.5-4.5L12 4Z" />
      <path d="M3.5 13 12 17.5 20.5 13" />
    </svg>
  );
}

/** Comprobado: la marca de la buena señal, sin emoji. */
export function CheckIcon({ size = 14, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M5 12.5 10 17.5 19 7" />
    </svg>
  );
}

/* ---------------------------------------------------------------- */
/* Iconos del editor                                                 */
/* ---------------------------------------------------------------- */

export function UndoIcon({ size = 17, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M9 7.5H15a4.5 4.5 0 0 1 0 9h-1" />
      <path d="M11.5 4.5 9 7.5l2.5 3" />
    </svg>
  );
}

export function RedoIcon({ size = 17, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M15 7.5H9a4.5 4.5 0 0 0 0 9h1" />
      <path d="M12.5 4.5 15 7.5l-2.5 3" />
    </svg>
  );
}

export function CloseIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export function DownloadIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M12 4v10.5" />
      <path d="M7.5 10 12 14.5 16.5 10" />
      <path d="M4.5 17.5V19a1.5 1.5 0 0 0 1.5 1.5h12A1.5 1.5 0 0 0 19.5 19v-1.5" />
    </svg>
  );
}

/** Sincronizar: dos arcos en círculo, con la punta marcada. */
export function SyncIcon({ size = 15, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M19.5 12a7.5 7.5 0 0 1-12.8 5.3" />
      <path d="M4.5 12A7.5 7.5 0 0 1 17.3 6.7" />
      <path d="M17.6 3.2v3.5H14" />
      <path d="M6.4 20.8v-3.5H10" />
    </svg>
  );
}

export function SearchIcon({ size = 15, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </svg>
  );
}

/** Atajos de teclado: una tecla, que es de lo que va la ayuda. */
export function KeyboardIcon({ size = 15, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
      <path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M8 14h8" />
    </svg>
  );
}

export function ArrowLeftIcon({ size = 15, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M19 12H5" />
      <path d="M11 6 5 12l6 6" />
    </svg>
  );
}

export function ChevronDownIcon({ size = 14, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="m6 9.5 6 6 6-6" />
    </svg>
  );
}

/* Los tres del transporte van rellenos y sin trazo: en un botón pequeño, un
   contorno de play se lee peor que la silueta maciza. */

function solid(size: number, className?: string) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 12 12",
    fill: "currentColor",
    className,
    "aria-hidden": true,
  } as const;
}

export function PlayIcon({ size = 13, className }: IconProps) {
  return (
    <svg {...solid(size, className)}>
      <path d="M2.5 1.4 10.4 6l-7.9 4.6V1.4Z" />
    </svg>
  );
}

export function PauseIcon({ size = 13, className }: IconProps) {
  return (
    <svg {...solid(size, className)}>
      <rect x="2.2" y="1.4" width="3" height="9.2" rx="0.9" />
      <rect x="6.8" y="1.4" width="3" height="9.2" rx="0.9" />
    </svg>
  );
}

export function StopIcon({ size = 12, className }: IconProps) {
  return (
    <svg {...solid(size, className)}>
      <rect x="2" y="2" width="8" height="8" rx="1.4" />
    </svg>
  );
}
