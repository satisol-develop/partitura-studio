/**
 * Service worker de Partitura Studio.
 *
 * La aplicación es un sitio estático: todo lo suyo (partituras y anotaciones)
 * vive en IndexedDB, así que una vez cargada funciona sin conexión. Lo que
 * hace falta aquí es que la primera carga quede guardada en caché y que las
 * actualizaciones no se queden congeladas.
 *
 * Dos reglas y ninguna más:
 *
 * - `/​_next/static/` lleva el hash de la compilación en el nombre, así que es
 *   inmutable: caché primero, y si no está, red. Es lo que hace que la app
 *   abra al instante la segunda vez.
 * - Todo lo demás (HTML, manifest, iconos) va a red primero y sólo cae en la
 *   caché si no hay red. Con eso, un `git push` nuevo se ve siempre que se
 *   pueda, y sin conexión se sirve lo último que se llegó a cargar.
 *
 * Sin precache al instalar: no se sabe qué basePath lleva la compilación, y
 * una lista de URLs a mano se rompe en cuanto cambia el build.
 */

const CACHE = "partitura-studio-v1";
const IMMUTABLE = /\/_next\/static\//;

self.addEventListener("install", () => {
  // La nueva versión manda ya, sin esperar a que se cierren las pestañas.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  // El backend de Apps Script es de otro origen: fuera del alcance de la caché.
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (IMMUTABLE.test(url.pathname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const hit = await cache.match(request);
        if (hit) return hit;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const response = await fetch(request);
        // `basic` descarta las redirecciones opacas y las respuestas parciales.
        if (response.ok && response.type === "basic") {
          cache.put(request, response.clone());
        }
        return response;
      } catch {
        const hit = await cache.match(request);
        if (hit) return hit;
        // Navegación sin red y sin nada en caché: la aplicación entera, que es
        // una sola página, para que no salga la página de error del navegador.
        if (request.mode === "navigate") {
          const shell = await cache.match(
            new URL("./", self.registration.scope).href,
          );
          if (shell) return shell;
        }
        return new Response("Estás sin conexión.", {
          status: 503,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }
    })(),
  );
});
