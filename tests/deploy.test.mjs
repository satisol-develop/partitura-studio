/**
 * Pruebas del flujo de publicación (`.github/workflows/deploy.yml`).
 *
 * Publicar es la parte del proyecto que nadie mira hasta que falla: un paso
 * borrado, un `uses` que apunta a una rama en vez de a un tag o un artefacto
 * mal puesto no se notan en local, se notan cuando el sitio ya no se publica (o
 * peor: cuando se publica algo distinto de lo que se ha probado).
 *
 * Estas comprobaciones se leen del propio YAML —no del texto a ojo—, así que
 * valen también para pillar un archivo que ha dejado de ser YAML válido.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { load } from "js-yaml";

const workflow = load(readFileSync(".github/workflows/deploy.yml", "utf8"));
const build = workflow.jobs.build;
const deploy = workflow.jobs.deploy;
const guide = readFileSync("DESPLIEGUE.md", "utf8");
const project = JSON.parse(readFileSync("package.json", "utf8"));
/** El `.gitignore` sin comentarios ni líneas vacías: son las reglas de verdad. */
const ignored = readFileSync(".gitignore", "utf8")
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#"));

/** Posición de un paso dentro de un job, por su `uses` o por su `run`. */
function stepIndex(job, needle) {
  return job.steps.findIndex(
    (step) =>
      (step.uses ?? "").includes(needle) ||
      (step.run ?? "").includes(needle) ||
      (step.name ?? "").includes(needle),
  );
}

test("el flujo se publica al empujar a main y también a mano", () => {
  const push = workflow.on.push;
  assert.ok(push, "tiene que publicarse al empujar");
  assert.ok(
    push.branches.includes("main"),
    "la rama del proyecto es main; otro nombre no dispararía nada",
  );
  // `workflow_dispatch:` sin valor es `null` al leerlo, no `true`: lo que
  // importa es que la clave esté, que es lo que habilita el botón de Actions.
  assert.ok(
    "workflow_dispatch" in workflow.on,
    "y poder lanzarlo a mano desde Actions",
  );
});

test("el flujo tiene los permisos que exige Pages, y ninguno más", () => {
  // `deploy-pages` necesita `pages: write` e `id-token: write`; el token OIDC
  // es lo que le permite publicar sin una llave guardada en el repositorio.
  assert.equal(workflow.permissions.contents, "read");
  assert.equal(workflow.permissions.pages, "write");
  assert.equal(workflow.permissions["id-token"], "write");
});

test("se comprueba antes de publicar: typecheck, lint y test, en ese orden", () => {
  const typecheck = stepIndex(build, "npm run typecheck");
  const lint = stepIndex(build, "npm run lint");
  const tests = stepIndex(build, "npm test");
  const construir = stepIndex(build, "Construir el sitio estático");

  assert.ok(typecheck >= 0, "falta el typecheck");
  assert.ok(lint >= 0, "falta el lint");
  assert.ok(tests >= 0, "faltan las pruebas");
  assert.ok(construir > tests, "el build tiene que ir después de las tres comprobaciones");
  assert.ok(typecheck < lint && lint < tests, "y en el orden en que se leen");
});

test("la publicación sale del árbol bloqueado, no de lo que haya ese día", () => {
  assert.ok(
    build.steps.some((step) => step.run === "npm ci"),
    "con `npm install` cada publicación podría compilar dependencias distintas",
  );
});

test("el flujo usa la versión de Node que exige el proyecto", () => {
  // Si `engines` sube y el flujo se queda atrás (o al revés), el fallo aparece
  // en la publicación, no en local: aquí se compila con la versión de cada uno.
  const exigido = String(project.engines.node).match(/\d+/)?.[0];
  const enFlujo = build.steps.find((step) => step.uses?.includes("setup-node"));
  assert.equal(String(enFlujo.with["node-version"]), exigido);
  assert.ok(guide.includes(`Node ${exigido}`), "y la guía tiene que decir lo mismo");
});

test("lo que el flujo y la guía dan por hecho está en el repositorio", () => {
  // Todo esto se usa *durante* la publicación: sin el candado, `npm ci` no
  // arranca; sin los enganches ni el doble del backend, `npm test` falla.
  const necesarios = [
    "package-lock.json",
    "tests/register-hooks.mjs",
    "tools/mock-apps-script.mjs",
    "apps-script/Code.gs",
    "DESPLIEGUE.md",
  ];
  for (const ruta of necesarios) {
    assert.ok(existsSync(ruta), `falta ${ruta}, y el flujo cuenta con él`);
  }
  // Y el candado tiene que poder subirse: si el `.gitignore` lo excluyera, el
  // repositorio se vería igual y la publicación fallaría en el primer paso.
  assert.equal(
    ignored.includes("package-lock.json"),
    false,
    "`npm ci` exige que el candado esté en el repositorio",
  );
});

test("el repositorio no lleva dentro la compilación ni el estado local", () => {
  // `out/` se sube solo, y una copia compilada en el repositorio publica rutas
  // y paquetes de otra máquina que dejan de ser los que se compilan.
  for (const patron of ["node_modules/", ".next/", "out/"]) {
    assert.ok(ignored.includes(patron), `falta ${patron} en .gitignore`);
  }
  assert.ok(
    ignored.includes(".freebuff/"),
    "el estado del entorno de trabajo no es del proyecto y no se sube",
  );
});

test("la ruta base del sitio la resuelve configure-pages y llega al build", () => {
  const configurar = stepIndex(build, "configure-pages");
  const construir = stepIndex(build, "Construir el sitio estático");
  assert.ok(configurar >= 0 && configurar < construir);

  const entorno = build.steps[construir].env;
  // En un sitio de proyecto la aplicación cuelga de `/repo/`; el `basePath` se
  // incrusta al construir, así que este valor es lo único que hace que los
  // estilos y el JavaScript carguen en su ruta.
  assert.equal(entorno.PAGES_BASE_PATH, "${{ steps.pages.outputs.base_path }}");
});

test("lo que se sube es out/ y queda marcado como «sin Jekyll»", () => {
  const subir = build.steps.find((step) => step.uses?.includes("upload-pages-artifact"));
  assert.equal(subir.with.path, "./out");
  assert.ok(
    build.steps.some((step) => (step.run ?? "").includes("out/.nojekyll")),
    "sin .nojekyll, Jekyll ignora _next/ y el sitio sale sin estilos",
  );
  // `.nojekyll` empieza por punto: es un archivo oculto, y la acción los deja
  // fuera del artefacto por defecto (`include-hidden-files: false` desde la
  // v5). Sin esta opción el `touch` se queda en el runner, el archivo no llega
  // al sitio y el paso termina en verde igualmente.
  assert.equal(
    subir.with["include-hidden-files"],
    true,
    "el artefacto tiene que incluir los archivos ocultos, o .nojekyll no viaja",
  );
});

test("el despliegue depende del build y publica en el entorno de Pages", () => {
  assert.deepEqual(deploy.needs, "build");
  assert.equal(deploy.environment.name, "github-pages");
  assert.ok(deploy.steps.some((step) => step.uses?.includes("deploy-pages")));
});

test("todas las acciones van fijadas a un tag mayor, no a una rama", () => {
  const acciones = [...build.steps, ...deploy.steps]
    .map((step) => step.uses)
    .filter(Boolean);
  assert.ok(acciones.length >= 5);
  for (const accion of acciones) {
    assert.match(
      accion,
      /^[\w-]+\/[\w-]+@v\d+$/,
      `«${accion}» tiene que estar fijada a un tag mayor (por ejemplo @v7)`,
    );
  }
});

test("el sitio publicado no lleva ningún secreto dentro", () => {
  const texto = JSON.stringify(workflow);
  // El bundle es estático y cualquiera puede leerlo: una llave incrustada al
  // construir quedaría publicada. La URL del backend entra como *variable*
  // pública, y la aplicación no maneja ninguna llave (el login vive en el
  // script de Apps Script).
  assert.equal(texto.includes("secrets."), false);
  assert.equal(
    build.steps[stepIndex(build, "Construir el sitio estático")].env
      .NEXT_PUBLIC_DRIVE_ENDPOINT,
    "${{ vars.DRIVE_ENDPOINT }}",
  );
  assert.equal(
    build.steps[stepIndex(build, "Construir el sitio estático")].env
      .NEXT_PUBLIC_LOGIN_REQUIRED,
    "${{ vars.LOGIN_REQUIRED }}",
  );
});

test("los nombres que documenta la guía son los que lee el flujo", () => {
  // Si alguien renombra una variable en el flujo (o en la guía), quien siga los
  // pasos creará una variable que no sirve para nada y el sitio saldrá sin
  // backend, sin ningún mensaje que lo explique.
  const variables = ["DRIVE_ENDPOINT", "LOGIN_REQUIRED"];
  for (const nombre of variables) {
    assert.ok(
      JSON.stringify(workflow).includes(`vars.${nombre}`),
      `el flujo debería leer ${nombre}`,
    );
    assert.ok(
      guide.includes(nombre),
      `la guía de despliegue debería nombrar ${nombre}`,
    );
  }
});
