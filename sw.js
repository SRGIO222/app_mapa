/* =====================================================================
   MapaVivo · Service Worker (PWA)
   ---------------------------------------------------------------------
   - Guarda la "carcasa" de la app para que abra sin conexión.
   - Cachea las teselas del mapa que ya has visto (hasta 400).
   - Los datos de Overpass/Nominatim siempre van a la red (en vivo).
   Al cambiar archivos de la app, sube VERSION para invalidar la caché.
   ===================================================================== */
'use strict';

const VERSION = 'v4';
const SHELL_CACHE = `mapavivo-shell-${VERSION}`;
const TILE_CACHE = `mapavivo-tiles-${VERSION}`;
const TILE_MAX = 400;

const CORE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/categories.js',
  './js/openhours.js',
  './js/overpass.js',
  './js/app.js',
  './vendor/leaflet/leaflet.css',
  './vendor/leaflet/leaflet.js',
  './vendor/leaflet/images/marker-icon.png',
  './vendor/leaflet/images/marker-icon-2x.png',
  './vendor/leaflet/images/marker-shadow.png',
  './vendor/leaflet/images/layers.png',
  './vendor/leaflet/images/layers-2x.png',
  './vendor/leaflet-markercluster/MarkerCluster.css',
  './vendor/leaflet-markercluster/MarkerCluster.Default.css',
  './vendor/leaflet-markercluster/leaflet.markercluster.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon-180.png',
];

/* ---------- Instalación ---------- */
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // addAll falla entero si un recurso falla: los añadimos uno a uno.
    await Promise.all(CORE.map((url) => cache.add(url).catch(() => {})));
    await self.skipWaiting();
  })());
});

/* ---------- Activación ---------- */
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key !== SHELL_CACHE && key !== TILE_CACHE)
        .map((key) => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

/* ---------- Estrategias ---------- */
async function networkFirst(req, fallbackUrl) {
  const cache = await caches.open(SHELL_CACHE);
  let res = null;
  try {
    res = await fetch(req);
    if (res && res.ok) {
      cache.put(fallbackUrl, res.clone());
      return res;
    }
  } catch (err) {
    res = null;
  }

  // Sin red, o el servidor responde un error (502, 503…): usamos la copia.
  const cached = await cache.match(fallbackUrl);
  if (cached) return cached;
  if (res) return res;

  return new Response('Sin conexión', {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

async function networkFirstAsset(req) {
  const cache = await caches.open(SHELL_CACHE);
  let res = null;
  try {
    res = await fetch(req);
    if (res && res.ok) {
      cache.put(req, res.clone());
      return res;
    }
  } catch (err) {
    res = null;
  }

  const cached = await cache.match(req);
  if (cached) return cached;
  return res || Response.error();
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(req);
  const network = fetch(req)
    .then((res) => {
      if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
      return res;
    })
    .catch(() => null);
  return cached || (await network) || Response.error();
}

async function trimCache(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= max) return;
  await Promise.all(keys.slice(0, keys.length - max).map((key) => cache.delete(key)));
}

async function tileStrategy(req) {
  const cache = await caches.open(TILE_CACHE);
  const cached = await cache.match(req);
  if (cached) return cached;

  try {
    const res = await fetch(req);
    if (res && (res.ok || res.type === 'opaque')) {
      cache.put(req, res.clone());
      trimCache(TILE_CACHE, TILE_MAX);
    }
    return res;
  } catch (err) {
    return new Response('', { status: 504, statusText: 'Tile offline' });
  }
}

/* ---------- Fetch ---------- */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Datos en vivo: nunca desde caché
  if (url.hostname.includes('overpass') || url.hostname.includes('nominatim')) return;

  // Teselas del mapa
  if (url.hostname.endsWith('tile.openstreetmap.org')) {
    event.respondWith(tileStrategy(req));
    return;
  }

  // Navegación: red primero, luego versión guardada
  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req, './index.html'));
    return;
  }

  // Recursos propios
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirstAsset(req));
    return;
  }

  // CDN externos (Leaflet, etc.)
  event.respondWith(staleWhileRevalidate(req));
});
