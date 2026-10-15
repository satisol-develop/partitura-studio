"use client";

import { useEffect } from "react";

/**
 * Registra el service worker para que el sitio sea instalable (PWA).
 *
 * Dos detalles que no son menores:
 *
 * - La URL es relativa a la página (`./sw.js`), no absoluta: así funciona
 *   tanto si el sitio cuelga de la raíz como de una ruta
 *   (`usuario.github.io/repo/`), sin que haya que incrustar el `basePath`.
 * - Sólo en producción. En `next dev` hay que ver los cambios al recargar,
 *   y una caché por detrás los escondería.
 */

export default function PwaRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    const url = new URL("sw.js", document.baseURI).href;
    navigator.serviceWorker.register(url).catch(() => {
      // Sin service worker la aplicación funciona igual; no es un fallo que
      // merezca ni un aviso en pantalla.
    });
  }, []);

  return null;
}
