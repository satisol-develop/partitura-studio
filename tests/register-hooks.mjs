/**
 * Enganches de resolución que hacen que Node pueda cargar el código de `lib/`
 * tal cual, sin duplicar ni tocar el de producción.
 *
 * **1. Rutas relativas sin extensión (`./types`, `./drive`).** El proyecto usa
 * `moduleResolution: "bundler"`: los módulos se nombran sin extensión y ya hay
 * quien la resuelve (Next/Webpack). Node en modo ESM no busca `.ts`, así que
 * aquí se le enseña a hacer lo mismo que hace el empaquetador: probar `.ts` y
 * `index.ts`. Sin esto habría que escribir `./types.ts` en el código real, que
 * es ajeno a la aplicación y sólo sirve para el cargador de las pruebas.
 *
 * **2. `@tonejs/midi`.** El paquete no publica campo `exports`, así que cada
 * entorno elige un fichero:
 *   - `main`   → `build/Midi.js`, un paquete UMD minificado del que el cargador
 *     de Node no puede deducir los export con nombre: `import { Midi }` falla
 *     con "Named export 'Midi' not found".
 *   - `module` → `dist/Midi.js`, la salida de `tsc` en CommonJS
 *     (`exports.Midi = Midi`), sí analizable. Es el que usa el empaquetador,
 *     o sea el que se ejecuta en el navegador.
 *
 * Uso: `npm test` ya lo carga (`node --import ./tests/register-hooks.mjs`).
 */

import { existsSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const toneMidi = require.resolve("@tonejs/midi/dist/Midi.js");

const EXTENSIONS = [".ts", ".tsx", ".mjs", ".js", "/index.ts", "/index.tsx"];

function firstExisting(url) {
  for (const extension of EXTENSIONS) {
    const candidate = new URL(url.href + extension);
    if (existsSync(fileURLToPath(candidate))) return candidate.href;
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@tonejs/midi") {
      return { url: pathToFileURL(toneMidi).href, shortCircuit: true };
    }

    const relative = specifier.startsWith("./") || specifier.startsWith("../");
    const hasExtension = /\.[cm]?[jt]sx?$/.test(specifier);
    if (relative && !hasExtension && context.parentURL) {
      const resolved = firstExisting(new URL(specifier, context.parentURL));
      if (resolved) return { url: resolved, shortCircuit: true };
    }

    return nextResolve(specifier, context);
  },
});

if (process.env.RESOLVE_HOOKS_DEBUG) {
  console.log(`@tonejs/midi → ${toneMidi}`);
}
