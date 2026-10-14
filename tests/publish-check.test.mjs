/**
 * Pruebas de la comprobación previa a la publicación (`tools/publish-check.mjs`).
 *
 * Lo que se prueba aquí es lo que no se puede arreglar después: una fuga que
 * sale publicada con el build en verde y una puerta de acceso apagada sin que
 * se note hasta que alguien abra la página. Dos regresiones concretas van
 * aparte porque ya costaron encontrar:
 *
 *   - `.env` aparece dentro de `process.env`, que está en cualquier bundle: no
 *     es una fuga, y si el patrón lo cazara, la comprobación fallaría siempre.
 *   - `apps-script/Code.gs` y el doble del backend llevan `SERVICE_KEY`,
 *     `SESSION_SECRET` y compañía de forma legítima: son el servidor, no una
 *     fuga, y por eso sólo se buscan esas cadenas en lo que se publica.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  basePathFromHtml,
  endpointFromBundle,
  findLeaks,
  puertaDeBuild,
  readRepoVariables,
} from "../tools/publish-check.mjs";

/** Un árbol de mentira con la forma de lo que se publica. */
async function arbol(ficheros) {
  const raiz = await mkdtemp(join(tmpdir(), "publish-check-"));
  for (const [ruta, contenido] of Object.entries(ficheros)) {
    const completa = join(raiz, ruta);
    await mkdir(join(completa, ".."), { recursive: true });
    await writeFile(completa, contenido);
  }
  return raiz;
}

test("ninguna llave del servidor dentro de lo que se publica", async () => {
  const out = await arbol({
    "index.html": '<script src="/repo/_next/static/chunks/app.js"></script>',
    "_next/static/chunks/app.js": 'const endpoint="https://script.google.com/macros/s/ABC/exec";process.env.NEXT_PUBLIC_FOO;',
  });
  try {
    assert.deepEqual(await findLeaks(out), []);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("`process.env` no es una fuga: el patrón `.env` la cazaría siempre", async () => {
  const out = await arbol({
    "index.html": "<!doctype html>",
    // Esto está en cualquier bundle de Next: `.env` está dentro de `process.env`.
    "_next/static/chunks/app.js": "const a=process.env.NEXT_PUBLIC_X;const b=JSON.parse(process.env.NEXT_PUBLIC_Y??'{}');",
  });
  try {
    assert.deepEqual(await findLeaks(out), [], "un bundle normal tiene que pasar limpio");
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("cada marca de material privado se detecta por su nombre", async () => {
  const esperados = {
    SERVICE_KEY: "clave de servicio de Apps Script",
    SESSION_SECRET: "secreto de sesiones",
    PASSWORD_SALT: "sal de contraseñas",
    '"hash":': "lista de usuarios guardada (USERS)",
    "PRIVATE KEY": "llave privada",
    "ghp_": "token de GitHub",
  };
  for (const [marca, nombre] of Object.entries(esperados)) {
    const out = await arbol({ "index.html": "<!doctype html>", "_next/chunks/a.js": `var x="${marca}AAAA";` });
    try {
      const fugas = await findLeaks(out);
      assert.equal(fugas.length, 1, `tenía que detectar ${marca}`);
      assert.equal(fugas[0].motivo, nombre);
      assert.ok(fugas[0].fichero.endsWith("a.js"));
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  }
});

test("la palabra USERS de la ayuda no es fuga; el contenido de la lista sí", async () => {
  // `components/DriveDialog.tsx` habla de la propiedad `USERS` en su ayuda,
  // así que esa palabra se publica legítimamente. Lo que no puede salir es la
  // lista: `[{email, hash, active}]`, que es como la serializa el script.
  const ayuda = await arbol({
    "index.html": "<!doctype html>",
    "_next/chunks/a.js": '(0,a.jsx)("code",{children:"USERS"}),"."]',
  });
  try {
    assert.deepEqual(await findLeaks(ayuda), [], "la ayuda no es una fuga");
  } finally {
    await rm(ayuda, { recursive: true, force: true });
  }

  const lista = await arbol({
    "index.html": "<!doctype html>",
    "_next/chunks/a.js": '[{"email":"ana@ejemplo.com","hash":"a91f3c","active":true}]',
  });
  try {
    const fugas = await findLeaks(lista);
    assert.equal(fugas.length, 1, "la lista de usuarios sí lo es");
    assert.equal(fugas[0].motivo, "lista de usuarios guardada (USERS)");
  } finally {
    await rm(lista, { recursive: true, force: true });
  }
});

test("un .env publicado se detecta aunque su contenido sea limpio", async () => {
  const out = await arbol({ "index.html": "<!doctype html>", ".env.local": "ALGO=1" });
  try {
    const fugas = await findLeaks(out);
    assert.equal(fugas.length, 1);
    assert.match(fugas[0].motivo, /entorno|llave/);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("el código del servidor no cuenta como fuga de la raíz", async () => {
  // Es la forma real del repositorio: el script de Apps Script y el doble del
  // backend llevan esas cadenas porque eso es lo que hacen.
  const raiz = await arbol({
    "out/index.html": '<script src="/repo/_next/static/chunks/app.js"></script>',
    "out/_next/static/chunks/app.js": "process.env.NEXT_PUBLIC_FOO;",
    "apps-script/Code.gs": 'const SERVICE_KEY="SERVICE_KEY";const SESSION_SECRET="SESSION_SECRET";const PASSWORD_SALT="PASSWORD_SALT";',
    "tools/mock-apps-script.mjs": "const DEFAULT_SESSION_SECRET='x';",
    "node_modules/sin-importancia/index.js": "SERVICE_KEY PASSWORD_SALT",
  });
  try {
    assert.deepEqual(await findLeaks(join(raiz, "out"), raiz), []);
  } finally {
    await rm(raiz, { recursive: true, force: true });
  }
});

test("un .env en la raíz se ve: se compila en silencio y se incrusta", async () => {
  const raiz = await arbol({
    "out/index.html": "<!doctype html>",
    ".env.local": "NEXT_PUBLIC_DRIVE_ENDPOINT=https://ejemplo",
  });
  try {
    const fugas = await findLeaks(join(raiz, "out"), raiz);
    assert.equal(fugas.length, 1);
    assert.ok(fugas[0].pedazo.includes(".env.local"));
  } finally {
    await rm(raiz, { recursive: true, force: true });
  }
});

test("la ruta base sale del HTML exportado, no de suposiciones", () => {
  assert.equal(basePathFromHtml('<link href="/partitura-studio/_next/static/chunks/a.css">'), "/partitura-studio");
  assert.equal(basePathFromHtml('<script src="/_next/static/chunks/a.js"></script>'), "", "sitio de usuario: sin prefijo");
  assert.equal(basePathFromHtml("<html></html>"), "");
});

test("la URL del backend se encuentra en el bundle o no está", () => {
  const conUrl = 'const u="https://script.google.com/macros/s/AKfycb123-x_Y/exec";';
  assert.equal(endpointFromBundle(conUrl), "https://script.google.com/macros/s/AKfycb123-x_Y/exec");
  assert.equal(endpointFromBundle("const u='';process.env.X;"), null);
});

test("la puerta se decide como en lib/auth.ts: sólo `false` la quita", () => {
  assert.equal(puertaDeBuild("false").puesta, false);
  assert.equal(puertaDeBuild(" FALSE ").puesta, false, "ni mayúsculas ni espacios la reactivan");
  assert.equal(puertaDeBuild("").puesta, true, "variable en blanco: puesta");
  assert.equal(puertaDeBuild(undefined).puesta, true, "sin crear: puesta");
  assert.equal(puertaDeBuild("true").puesta, true);
  assert.equal(puertaDeBuild("¡quién sabe!").puesta, true, "valor desconocido: no quita la puerta");
});

test("con token se leen las variables del repositorio; sin él, las del entorno", async () => {
  const conToken = await readRepoVariables({
    repo: "satisol-develop/partitura-studio",
    token: "token-de-prueba",
    env: { NEXT_PUBLIC_DRIVE_ENDPOINT: "https://del-entorno" },
    fetchImpl: async () =>
      new Response(JSON.stringify({ total_count: 2, variables: [{ name: "DRIVE_ENDPOINT", value: "https://del-repo" }, { name: "LOGIN_REQUIRED", value: "true" }] })),
  });
  assert.equal(conToken.endpoint, "https://del-repo");
  assert.equal(conToken.loginRequired, "true");
  assert.match(conToken.origen, /repositorio/);

  const sinToken = await readRepoVariables({ repo: "a/b", token: "", env: { NEXT_PUBLIC_DRIVE_ENDPOINT: "https://del-entorno" } });
  assert.equal(sinToken.endpoint, "https://del-entorno");
  assert.match(sinToken.origen, /entorno/, "tiene que decir que no está mirando el repositorio");

  const denegado = await readRepoVariables({
    repo: "a/b",
    token: "que-no-sirve",
    env: { LOGIN_REQUIRED: "false" },
    fetchImpl: async () => new Response("{}", { status: 401 }),
  });
  assert.equal(denegado.loginRequired, "false", "un token sin permisos no rompe: cae al entorno");
  assert.match(denegado.origen, /entorno/);
});
