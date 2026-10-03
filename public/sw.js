/*
 * Service worker de CocheraFlow.
 *
 * El original cacheaba `/` e `/index.html` con un CACHE_NAME fijo y sin handler
 * `activate`, así que después de cada deploy los operadores quedaban clavados
 * en la versión vieja para siempre: sin forma de actualizar.
 *
 * Ahora:
 *  - el nombre de cache lleva versión, y `activate` borra las anteriores,
 *  - las navegaciones (el shell de la SPA) usan network-first con fallback,
 *    para que un deploy nuevo se vea de inmediato,
 *  - los assets con hash de Vite se cachean agresivamente, porque su nombre ya
 *    cambia cuando cambia el contenido.
 */

const VERSION = 'v2';
const CACHE = `cocheraflow-${VERSION}`;

const SHELL = ['/', '/index.html', '/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      // Un fallo puntual al precargar no debe impedir la instalación.
      .catch(() => undefined)
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // La API vive en el mismo origen y siempre debe ir a red: sirve datos en vivo
  // y maneja la sesión. Nunca cachear.
  if (url.pathname.startsWith('/api/')) return;

  // Navegaciones (SPA): red primero, shell offline como respaldo.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copia = response.clone();
          void caches.open(CACHE).then((cache) => cache.put('/index.html', copia));
          return response;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Assets con hash de Vite (`index-abc123.js`): cache-first, ya son inmutables.
  const esAssetHasheado = /\/assets\/.+\-[A-Za-z0-9_]{8,}\.[a-z0-9]+$/.test(url.pathname);
  if (esAssetHasheado) {
    event.respondWith(
      caches.match(request).then((cacheado) => {
        if (cacheado) return cacheado;
        return fetch(request).then((response) => {
          if (response.ok) {
            const copia = response.clone();
            void caches.open(CACHE).then((cache) => cache.put(request, copia));
          }
          return response;
        });
      })
    );
  }
  // El resto (CSS, fuentes, /src/* en dev) va a red sin cachear.
});
