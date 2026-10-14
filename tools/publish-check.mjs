/**
 * Comprobación previa a la publicación: lo que se sube a GitHub, antes de que
 * se suba.
 *
 * El flujo comprueba el código (typecheck, lint, pruebas), pero hay tres cosas
 * que ninguna de esas comprobaciones toca y que arruinan una publicación en
 * silencio, porque el build sigue terminando en verde:
 *
 *   1. **Material privado publicado.** El bundle es estático y cualquiera lo
 *      lee sin autenticarse. Aquí se mira cada fichero de `out/` por si arrastra
 *      una llave del script de Apps Script o el resto de un fichero de entorno.
 *   2. **La puerta de acceso.** Se decide al construir (`LOGIN_REQUIRED`), así
 *      que una instalación publicada con `false` sale a la calle sin pantalla
 *      de acceso y no hay nada que lo delate hasta que alguien la abra.
 *   3. **La ruta base y la URL del backend.** Se incrustan al construir: si no
 *      cuadran con la URL publicada, el sitio sale sin estilos o sin backend y
 *      el flujo sigue en verde.
 *
 * Compila con las mismas variables que usará el flujo, comprueba las tres
 * cosas, sirve el resultado igual que lo servirá Pages y deja la lista de lo
 * que sólo se puede ver abriendo la página.
 *
 * Uso:
 *
 *   npm run publish:check
 *   npm run publish:check -- --sin-build      # comprueba out/ como está
 *   npm run publish:check -- --mock           # además enciende el doble
 *   npm run publish:check -- --sin-puerta     # publicación sin puerta (aviso)
 *
 * Con `GH_TOKEN` (o `--repo`) lee las variables del repositorio, que son las
 * que GitHub incrustará de verdad; sin ella usa las de este entorno y lo dice,
 * porque si no coinciden con las de *Settings → Variables*, el resultado no es
 * el de la publicación.
 */

import { execFileSync, spawn } from "node:child_process";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { createMockDrive } from "./mock-apps-script.mjs";

const RAIZ = resolve(import.meta.dirname, "..");

/* ------------------------------------------------------------------ */
/* Material privado que no puede salir publicado                       */
/* ------------------------------------------------------------------ */

/**
 * Marcas de material que vive en el servidor. Cualquiera de estas cadenas
 * dentro de `out/` es una fuga: el bundle se publica tal cual y se puede leer
 * sin autenticarse.
 *
 * No buscan la *configuración* —la URL del backend es pública y su sitio es
 * estar incrustada en el cliente—, sino la parte que protege: las llaves, los
 * nombres de las propiedades privadas del script y cualquier resto de servidor.
 *
 * Dos avisos que vienen de comprobarlo contra la aplicación real:
 *
 *   - `.env` no puede estar aquí: `process.env`, que está en cualquier bundle,
 *     lo contiene y el patrón fallaría siempre. Los ficheros se buscan por
 *     nombre.
 *   - `"USERS"` tampoco: la propia pantalla de ayuda habla de esa propiedad y
 *     la palabra se publica legítimamente. Lo que no puede salir es el
 *     contenido —`[{email, hash, active}]`—, y eso es `"hash":`.
 */
export const EXPECTED_SECRET_PATTERNS = [
  { name: "clave de servicio de Apps Script", pattern: "SERVICE_KEY" },
  { name: "secreto de sesiones", pattern: "SESSION_SECRET" },
  { name: "sal de contraseñas", pattern: "PASSWORD_SALT" },
  { name: "lista de usuarios guardada (USERS)", pattern: '"hash":' },
  { name: "llave privada", pattern: "PRIVATE KEY" },
  { name: "token de GitHub", pattern: "ghp_" },
];

/** Ficheros que no deberían estar en el repositorio ni llegar a compilar. */
const FICHEROS_PROHIBIDOS = [/^\.env(\..+)?$/, /\.pem$/, /\.p12$/, /\.key$/, /^id_[rd]sa/];

/** Extensiones que se leen como texto; el resto (imágenes, binarios) se saltan. */
const TEXTO = new Set([".js", ".mjs", ".cjs", ".css", ".html", ".htm", ".json", ".txt", ".xml", ".svg", ".map", ".webmanifest", ".md"]);

/** Carpetas que no interesan al recorrer el repositorio. */
const SIN_INTERES = new Set(["node_modules", ".git", ".next", "out"]);

/**
 * Recorre `dir` devolviendo rutas absolutas, sin bajar por las carpetas de
 * `excluir` (recorrer `node_modules` entero para descartarlo después es una
 * manera de que la comprobación tarde un minuto y no diga nada).
 */
async function listar(dir, excluir = new Set()) {
  const salidas = [];
  const pendientes = [dir];
  while (pendientes.length) {
    const actual = pendientes.pop();
    for (const entrada of await readdir(actual, { withFileTypes: true })) {
      if (entrada.isDirectory() && excluir.has(entrada.name)) continue;
      const completa = join(actual, entrada.name);
      if (entrada.isDirectory()) pendientes.push(completa);
      else salidas.push(completa);
    }
  }
  return salidas;
}

/**
 * Busca material privado en lo que se publica (`out/`) y, si se pasa la raíz,
 * también ficheros que no deberían estar en el repositorio: un `.env.local`
 * se compila en silencio y su contenido puede acabar incrustado en el bundle.
 *
 * Devuelve `[{ fichero, motivo, pedazo }]`, vacío si no hay nada.
 */
export async function findLeaks(publicDir, rootDir = null) {
  const fugas = [];

  for (const fichero of await listar(publicDir)) {
    const nombre = fichero.split(sep).pop();
    if (FICHEROS_PROHIBIDOS.some((re) => re.test(nombre))) {
      fugas.push({ fichero, motivo: "fichero de entorno o llave", pedazo: nombre });
      continue;
    }
    if (!TEXTO.has(extname(nombre).toLowerCase())) continue;
    let contenido;
    try {
      contenido = await readFile(fichero, "utf8");
    } catch {
      continue;
    }
    for (const { name, pattern } of EXPECTED_SECRET_PATTERNS) {
      const en = contenido.indexOf(pattern);
      if (en === -1) continue;
      fugas.push({ fichero, motivo: name, pedazo: muestra(contenido, en, pattern.length) });
    }
  }

  if (rootDir) {
    const raiz = resolve(rootDir);
    for (const fichero of await listar(raiz, SIN_INTERES)) {
      const nombre = fichero.split(sep).pop();
      if (FICHEROS_PROHIBIDOS.some((re) => re.test(nombre))) {
        fugas.push({ fichero, motivo: "fichero que no debería subir", pedazo: relative(raiz, fichero) });
      }
    }
  }

  return fugas;
}

/** Un trozo alrededor del hallazgo, para reconocerlo sin publicarlo entero. */
function muestra(texto, desde, largo) {
  const inicio = Math.max(0, desde - 30);
  const fin = Math.min(texto.length, desde + largo + 30);
  return texto.slice(inicio, fin).replace(/\s+/g, " ").trim();
}

/* ------------------------------------------------------------------ */
/* Variables del repositorio                                           */
/* ------------------------------------------------------------------ */

/**
 * Lee `DRIVE_ENDPOINT` y `LOGIN_REQUIRED` de donde las va a leer GitHub.
 *
 * Con token, de la API del repositorio (lo que de verdad se incrustará al
 * publicar). Sin token, del entorno, y entonces lo dice: si estas variables no
 * coinciden con las de *Settings → Actions → Variables*, esta comprobación no
 * está mirando la publicación.
 */
export async function readRepoVariables({ repo, token, env = process.env, fetchImpl = fetch }) {
  if (repo && token) {
    try {
      const respuesta = await fetchImpl(`https://api.github.com/repos/${repo}/actions/variables`, {
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/vnd.github+json",
          "user-agent": "publish-check",
        },
      });
      if (respuesta.ok) {
        const datos = await respuesta.json();
        const valores = Object.fromEntries((datos.variables ?? []).map((v) => [v.name, v.value]));
        return {
          endpoint: valores.DRIVE_ENDPOINT ?? "",
          loginRequired: valores.LOGIN_REQUIRED ?? "",
          origen: "variables del repositorio",
        };
      }
    } catch {
      /* sin red: se pasa al entorno y se avisa */
    }
  }
  return {
    endpoint: env.NEXT_PUBLIC_DRIVE_ENDPOINT ?? env.DRIVE_ENDPOINT ?? "",
    loginRequired: env.NEXT_PUBLIC_LOGIN_REQUIRED ?? env.LOGIN_REQUIRED ?? "",
    origen: "este entorno (sin GH_TOKEN no puedo leer las del repositorio)",
  };
}

/* ------------------------------------------------------------------ */
/* Lo que el artefacto lleva dentro                                    */
/* ------------------------------------------------------------------ */

/** `/partitura-studio` a partir de las rutas del HTML exportado, o `""`. */
export function basePathFromHtml(html) {
  const enlace = html.match(/(?:href|src)="([^"]+_next\/)/);
  if (!enlace) return "";
  const ruta = enlace[1];
  return ruta.startsWith("/") ? ruta.slice(0, ruta.indexOf("/_next/")) : "";
}

/** La URL del backend incrustada en el bundle, o `null` si no la hay. */
export function endpointFromBundle(js) {
  const url = js.match(/https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec/);
  return url ? url[0] : null;
}

/**
 * Qué hará la puerta de acceso con este `LOGIN_REQUIRED`. Es la misma regla que
 * `loginRequired()` en `lib/auth.ts`, leída aquí sin navegador para poder
 * comprobarla antes de publicar.
 */
export function puertaDeBuild(valor) {
  const flag = String(valor ?? "").trim().toLowerCase();
  if (flag === "false") return { puesta: false, detalle: "`false`: sin pantalla de acceso" };
  if (flag === "true") return { puesta: true, detalle: "`true`: siempre se pide" };
  if (flag) return { puesta: true, detalle: `"${flag}" (no reconocido: se pide)` };
  return { puesta: true, detalle: "sin crear: se pide acceso por defecto" };
}

/* ------------------------------------------------------------------ */
/* Humo del servidor estático                                         */
/* ------------------------------------------------------------------ */

/**
 * Sirve `out/` con `tools/serve-out.mjs` y comprueba lo que Pages servirá: el
 * HTML en su ruta, sus recursos con el prefijo correcto, la raíz a 404 en un
 * sitio de proyecto y el `.nojekyll` publicado. Devuelve comprobaciones.
 */
async function comprobarServido({ basePath, puerto }) {
  const comprobaciones = [];
  const hijo = spawn(process.execPath, [join(RAIZ, "tools", "serve-out.mjs"), String(puerto), basePath], {
    cwd: RAIZ,
    stdio: "ignore",
    windowsHide: true,
  });
  try {
    const url = `http://127.0.0.1:${puerto}${basePath}/`;
    const vivo = await esperar(async () => (await fetch(url)).ok, 40, 150);
    comprobaciones.push(["el servidor responde en su ruta", vivo]);
    if (!vivo) return comprobaciones;

    const pagina = await fetch(url);
    const html = await pagina.text();
    comprobaciones.push([
      "index.html responde 200 y como texto",
      pagina.status === 200 && (pagina.headers.get("content-type") ?? "").includes("text/html"),
    ]);
    comprobaciones.push(["enlaza sus recursos bajo la ruta publicada", html.includes(`${basePath}/_next/`)]);
    comprobaciones.push(["tiene título", /<title>[^<]+<\/title>/.test(html)]);

    if (basePath) {
      const raiz = await fetch(`http://127.0.0.1:${puerto}/`);
      comprobaciones.push(["la raíz da 404 (es un sitio de proyecto)", raiz.status === 404]);
    }

    const recurso = html.match(/src="([^"]+_next\/static\/[^"]+\.js)"/);
    if (recurso) {
      const pedida = await fetch(`http://127.0.0.1:${puerto}${recurso[1]}`);
      comprobaciones.push([
        "su JavaScript se sirve con el tipo correcto",
        pedida.status === 200 && (pedida.headers.get("content-type") ?? "").includes("javascript"),
      ]);
    }

    const nojekyll = await fetch(`${url}.nojekyll`);
    comprobaciones.push([".nojekyll está publicado", nojekyll.status === 200]);
  } finally {
    hijo.kill();
  }
  return comprobaciones;
}

/* ------------------------------------------------------------------ */
/* Auxiliares                                                          */
/* ------------------------------------------------------------------ */

async function esperar(fn, intentos, espera) {
  for (let i = 0; i < intentos; i++) {
    try {
      if (await fn()) return true;
    } catch {
      /* aún no está */
    }
    await new Promise((r) => setTimeout(r, espera));
  }
  return false;
}

const si = (ok) => (ok ? "✔" : "✖");
const enAmarillo = (texto) => console.log(`\x1b[33m${texto}\x1b[0m`);
const enRojo = (texto) => console.log(`\x1b[31m${texto}\x1b[0m`);

/** Puerto libre cualquiera, para no pisar un servidor que ya esté corriendo. */
async function puertoLibre() {
  const { createServer } = await import("node:net");
  const servidor = createServer();
  // `listen()` es asíncrono: `address()` devuelve `null` hasta que el puerto
  // está reservado, y leerlo antes es la forma de que la comprobación muera
  // con un error que no dice nada.
  await new Promise((ok, mal) => {
    servidor.once("error", mal);
    servidor.listen(0, "127.0.0.1", ok);
  });
  const puerto = servidor.address().port;
  await new Promise((ok) => servidor.close(ok));
  return puerto;
}

async function existe(ruta) {
  try {
    await stat(ruta);
    return true;
  } catch {
    return false;
  }
}

/** El JavaScript del bundle donde vive lo incrustado. */
async function buscarJs(dir) {
  for (const fichero of await listar(dir)) {
    if (extname(fichero) !== ".js") continue;
    const texto = await readFile(fichero, "utf8");
    if (texto.includes("script.google.com") || texto.includes("LOGIN_REQUIRED")) return texto;
  }
  return "";
}

/** Así lo resuelve `actions/configure-pages` en un sitio de proyecto. */
function basePathPrevisto(repo) {
  if (!repo) return "";
  const [, nombre] = repo.split("/");
  return nombre && !nombre.endsWith(".github.io") ? `/${nombre}` : "";
}

/** Repositorio desde `--repo`, `GITHUB_REPOSITORY` o el remoto de git. */
function repoActual(explicito, env = process.env) {
  if (explicito) return explicito;
  if (env.GITHUB_REPOSITORY) return env.GITHUB_REPOSITORY;
  try {
    const url = execFileSync("git", ["config", "--get", "remote.origin.url"], { cwd: RAIZ, encoding: "utf8" }).trim();
    const [owner, nombre] = url.replace(/\.git$/, "").split(/[/@]/).slice(-2);
    return owner && nombre ? `${owner}/${nombre}` : "";
  } catch {
    return "";
  }
}

/* ------------------------------------------------------------------ */
/* Programa principal                                                  */
/* ------------------------------------------------------------------ */

function leerArgs(argv) {
  const args = { build: true, servir: true, mock: false, puerta: true, repo: "", puerto: 0, token: "" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--sin-build") args.build = false;
    else if (arg === "--sin-servir") args.servir = false;
    else if (arg === "--mock") args.mock = true;
    else if (arg === "--sin-puerta") args.puerta = false;
    else if (arg === "--repo") args.repo = argv[++i] ?? "";
    else if (arg === "--puerto") args.puerto = Number(argv[++i]) || 0;
    else if (arg === "--token") args.token = argv[++i];
  }
  return args;
}

async function main() {
  const args = leerArgs(process.argv.slice(2));
  const env = process.env;
  const repo = repoActual(args.repo, env);
  const token = args.token || env.GH_TOKEN || env.GITHUB_TOKEN || "";
  let fallos = 0;

  console.log("\nComprobación previa a la publicación");
  console.log("=".repeat(46));
  if (repo) console.log(`repositorio      ${repo}`);

  const variables = await readRepoVariables({ repo, token, env });
  const puerta = puertaDeBuild(variables.loginRequired);
  console.log(`variables         ${variables.origen}`);
  console.log(`  DRIVE_ENDPOINT  ${variables.endpoint || "(vacía: la pantalla pedirá la dirección)"}`);
  console.log(`  LOGIN_REQUIRED  ${variables.loginRequired || "(sin crear)"} → ${puerta.detalle}`);

  if (!puerta.puesta) {
    if (args.puerta) {
      fallos++;
      enRojo(`${si(false)} la puerta de acceso está apagada: este artefacto publicaría sin pantalla de acceso.`);
      console.log("   Si es una instalación de una sola persona, relanza con --sin-puerta para que no lo sea un fallo.");
    } else {
      enAmarillo(`${si(true)} sin puerta, a propósito (--sin-puerta).`);
    }
  } else {
    console.log(`${si(true)} puerta de acceso: ${puerta.detalle}`);
  }

  /* 1. Compilar exactamente como lo hará el flujo. */
  if (args.build) {
    console.log("\nCompilando con las variables de la publicación…");
    const entorno = {
      ...env,
      PAGES_BASE_PATH: env.PAGES_BASE_PATH ?? basePathPrevisto(repo),
      NEXT_PUBLIC_DRIVE_ENDPOINT: variables.endpoint,
      NEXT_PUBLIC_LOGIN_REQUIRED: variables.loginRequired,
    };
    try {
      // Next directamente, no `npm run build`: en Windows lanzar un `.cmd`
      // desde Node exige `shell: true`, que reintenta con comillas en los
      // caminos. Es el mismo binario que ejecuta npm, con el mismo entorno.
      execFileSync(process.execPath, [join(RAIZ, "node_modules", "next", "dist", "bin", "next"), "build"], {
        cwd: RAIZ,
        env: entorno,
        stdio: "pipe",
        encoding: "utf8",
      });
      console.log(`${si(true)} build`);
    } catch (error) {
      fallos++;
      enRojo(`${si(false)} build falló:`);
      console.log(String(error.stdout ?? error.message).split("\n").slice(-12).join("\n"));
      return fallos;
    }
  }

  const out = join(RAIZ, "out");
  if (!(await existe(join(out, "index.html")))) {
    fallos++;
    enRojo(`${si(false)} no hay out/index.html: no hay nada que comprobar.`);
    return fallos;
  }

  /* 2. Material privado publicado. */
  const fugas = await findLeaks(out, RAIZ);
  if (fugas.length) {
    fallos++;
    enRojo(`${si(false)} material privado en lo que se publica:`);
    for (const f of fugas.slice(0, 8)) console.log(`   ${relative(RAIZ, f.fichero)} — ${f.motivo}: ${f.pedazo}`);
    if (fugas.length > 8) console.log(`   … y ${fugas.length - 8} más`);
  } else {
    console.log(`${si(true)} ninguna llave, .env ni resto de servidor en lo publicado`);
  }

  /* 3. Ruta base, endpoint y .nojekyll. */
  const html = await readFile(join(out, "index.html"), "utf8");
  const basePath = basePathFromHtml(html);
  const previsto = basePathPrevisto(repo);
  const rutaOk = !repo || basePath === previsto;
  console.log(`${si(rutaOk)} ruta base ${basePath || "(vacía: sitio de usuario)"}${rutaOk ? "" : ` — el sitio publicará en ${previsto}`}`);
  if (!rutaOk) fallos++;

  const endpoint = endpointFromBundle(await buscarJs(out));
  console.log(`${si(true)} endpoint ${endpoint ?? "sin incrustar (la pantalla pedirá la dirección)"}`);

  if (!(await existe(join(out, ".nojekyll")))) {
    // El flujo lo crea después de compilar; reproducimos su paso para que lo
    // servido aquí sea idéntico a lo publicado.
    await writeFile(join(out, ".nojekyll"), "");
    enAmarillo(`${si(true)} .nojekyll creado como lo hace el flujo (no existía en out/ local)`);
  } else {
    console.log(`${si(true)} .nojekyll`);
  }

  /* 4. Servir y comprobar lo que Pages servirá. */
  if (args.servir) {
    const puerto = args.puerto || (await puertoLibre());
    const comprobaciones = await comprobarServido({ basePath, puerto });
    for (const [texto, ok] of comprobaciones) {
      console.log(`${si(ok)} ${texto}`);
      if (!ok) fallos++;
    }

    console.log(`\nServido en http://localhost:${puerto}${basePath}/`);
    if (args.mock) {
      const doble = await createMockDrive({ port: 0 });
      console.log(`Doble del backend en ${doble.url} (sólo para esta comprobación):`);
      for (const cuenta of doble.accounts) console.log(`  ${cuenta.email} · ${cuenta.password}${cuenta.active ? "" : " (desactivado)"}`);
    }
    console.log("\nLo que sólo se puede comprobar abriendo la página:");
    console.log("  1. Debe salir «Entrar». Si no sale, la puerta no está puesta.");
    console.log("  2. Con una contraseña equivocada: «Correo o contraseña incorrectos».");
    console.log("  3. Con un correo que no está en la lista: el mismo mensaje, sin decir si existe.");
    console.log("  4. Entra, crea una partitura y bórrala.");
    console.log("  5. «Sincronizar ahora» y comprueba la carpeta «Partitura Studio» en Drive.");
    console.log("  6. En una ventana privada, sin sesión, la lista vuelve a empezar por «Entrar».");
    if (process.stdin.isTTY && !env.CI) await esperarEnter();
  }

  console.log(`\n${fallos ? `${fallos} comprobación(es) fallida(s)` : "Todo en verde: se puede publicar."}`);
  return fallos;
}

function esperarEnter() {
  return new Promise((ok) => {
    console.log("\nPulsa Enter para terminar…");
    process.stdin.once("data", () => ok());
    process.stdin.resume();
  });
}

/* Se ejecuta sólo si lo llaman directamente, no al importarlo desde las pruebas. */
const ejecutadoDirectamente = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (ejecutadoDirectamente) {
  main()
    .then((fallos) => process.exit(fallos ? 1 : 0))
    .catch((error) => {
      enRojo(`\nNo se pudo completar la comprobación: ${error.message}`);
      process.exit(2);
    });
}
