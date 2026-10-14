import type { NextConfig } from "next";

/**
 * Publicación como sitio estático (GitHub Pages).
 *
 * La aplicación no tiene servidor: todo vive en el navegador (IndexedDB, y
 * opcionalmente Drive a través de Apps Script), así que no necesita proceso de
 * Node en producción. `output: "export"` genera `out/` con HTML, CSS y JS.
 *
 * `basePath` es obligatorio cuando el sitio cuelga de una ruta
 * (`usuario.github.io/repo/`) y debe estar vacío cuando cuelga de la raíz
 * (`usuario.github.io`). Como se incrusta en los paquetes del cliente, se fija
 * al construir: el flujo de trabajo de Pages pasa el valor ya resuelto en
 * `PAGES_BASE_PATH` (salida de `actions/configure-pages`).
 *
 * No se usa `assetPrefix`: `basePath` ya prefija las rutas de la aplicación y
 * los recursos que genera Next, y añadir los dos duplicaría el prefijo.
 */
const basePath = process.env.PAGES_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  output: "export",
  basePath,
  reactStrictMode: true,
  // Con `export` no hay servidor que resuelva `/ruta` a `/ruta.html`; el índice
  // por carpeta (`/ruta/index.html`) es lo que sirven bien Pages y cualquier
  // servidor de ficheros.
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
