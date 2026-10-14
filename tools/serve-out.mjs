import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { createServer } from "node:http";

/**
 * Servidor de ficheros para probar el artefacto exportado (`out/`) tal y como
 * lo servirá GitHub Pages: sin proceso de Node detrás, resolviendo `/ruta/` a
 * `/ruta/index.html` y con el `basePath` delante.
 *
 * No es una utilidad de desarrollo del día a día (para eso está `npm run dev`):
 * existe para poder comprobar de verdad que la exportación estática funciona,
 * que es justo lo que no se ve en el build.
 *
 * Uso:  node tools/serve-out.mjs [puerto] [basePath]
 */

const port = Number(process.argv[2] ?? 4173);
const basePath = (process.argv[3] ?? "").replace(/\/$/, "");
const root = resolve(process.cwd(), "out");

if (!existsSync(root)) {
  console.error("No existe out/. Ejecuta antes: npm run build");
  process.exit(1);
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
};

createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  let pathname = decodeURIComponent(url.pathname);

  if (basePath) {
    if (pathname !== basePath && !pathname.startsWith(`${basePath}/`)) {
      response.writeHead(404, { "content-type": "text/plain" });
      response.end(`Fuera del basePath ${basePath}`);
      return;
    }
    pathname = pathname.slice(basePath.length) || "/";
  }

  // Sin escapar de la raíz: cualquier `..` se resuelve y se recorta.
  const target = resolve(join(root, normalize(pathname)));
  if (target !== root && !target.startsWith(root + sep)) {
    response.writeHead(403, { "content-type": "text/plain" });
    response.end("Prohibido");
    return;
  }

  const candidates = [target, `${target}.html`, join(target, "index.html")];
  const file = candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile());

  if (!file) {
    const notFound = join(root, "404.html");
    const body = existsSync(notFound) ? createReadStream(notFound) : null;
    response.writeHead(404, { "content-type": "text/html; charset=utf-8" });
    if (body) body.pipe(response);
    else response.end("No encontrado");
    return;
  }

  response.writeHead(200, {
    "content-type": TYPES[extname(file)] ?? "application/octet-stream",
    "cache-control": "no-cache",
  });
  createReadStream(file).pipe(response);
}).listen(port, () => {
  console.log(`Estático en http://localhost:${port}${basePath}/ (raíz: ${root})`);
});
