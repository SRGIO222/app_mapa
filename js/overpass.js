/* =====================================================================
   MapaVivo · Cliente de Overpass API (OpenStreetMap)
   ---------------------------------------------------------------------
   Busca puntos de interés reales alrededor de una coordenada sin
   necesidad de clave de API.

   Los servidores públicos de Overpass se saturan a menudo, así que se
   lanzan en cascada (hedged requests): el primero que responde gana y
   se cancelan los demás. Así una réplica lenta no bloquea la app.
   ===================================================================== */
window.OverpassAPI = (function () {
  'use strict';

  // Orden de preferencia. El primero suele ser el más rápido.
  const ENDPOINTS = [
    'https://overpass.openstreetmap.fr/api/interpreter',
    'https://overpass-api.de/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
  ];

  const REQUEST_TIMEOUT = 25000;  // por petición
  const HEDGE_DELAY = 2500;       // espera antes de probar el siguiente
  const TOTAL_TIMEOUT = 35000;    // límite global
  const RESULT_LIMIT = 1200;

  /* Convierte ['amenity','restaurant'] en ["amenity"="restaurant"] */
  function tagFilter(tag) {
    return `["${tag[0]}"="${tag[1]}"]`;
  }

  /* Construye una única consulta con la unión de todas las categorías */
  function buildQuery(categories, center, limit) {
    const max = limit || RESULT_LIMIT;
    const filters = new Set();
    for (const cat of categories) {
      for (const tag of cat.tags) filters.add(tagFilter(tag));
    }

    const around = `(around:${Math.round(center.radius)},${center.lat.toFixed(5)},${center.lng.toFixed(5)})`;
    const blocks = [];
    for (const filter of filters) {
      blocks.push(`node${filter}${around};`);
      blocks.push(`way${filter}${around};`);
      blocks.push(`relation${filter}${around};`);
    }

    return [
      '[out:json][timeout:25];',
      '(',
      '  ' + blocks.join('\n  '),
      ');',
      `out center ${max};`,
    ].join('\n');
  }

  /* Combina el aborto manual con un tiempo máximo nativo.
     AbortSignal.timeout no se ve afectado por el throttling de pestañas
     en segundo plano, así que evita que la app se quede "cargando". */
  function signalWithTimeout(controller, ms) {
    if (typeof AbortSignal !== 'undefined'
      && typeof AbortSignal.timeout === 'function'
      && typeof AbortSignal.any === 'function') {
      return AbortSignal.any([controller.signal, AbortSignal.timeout(ms)]);
    }
    setTimeout(() => controller.abort(), ms);
    return controller.signal;
  }

  /* Ejecuta la consulta contra varios servidores y devuelve el primero que responda */
  function run(query) {
    return new Promise((resolve, reject) => {
      const controllers = [];
      let settled = false;
      let started = 0;
      let failures = 0;
      let lastError = null;
      let hedgeTimer = null;
      let totalTimer = null;

      const cleanup = () => {
        if (hedgeTimer) clearInterval(hedgeTimer);
        if (totalTimer) clearTimeout(totalTimer);
        controllers.forEach((ctrl) => ctrl.abort());
      };

      const succeed = (json) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(json);
      };

      const fail = (error) => {
        if (settled) return;
        lastError = error;
        failures += 1;
        if (failures >= ENDPOINTS.length) {
          settled = true;
          cleanup();
          reject(normalizeError(lastError));
        }
      };

      const launch = () => {
        if (settled || started >= ENDPOINTS.length) return;
        const url = ENDPOINTS[started];
        started += 1;

        const controller = new AbortController();
        controllers.push(controller);

        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'data=' + encodeURIComponent(query),
          signal: signalWithTimeout(controller, REQUEST_TIMEOUT),
        })
          .then(async (res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = await res.json();
            if (!json || !Array.isArray(json.elements)) throw new Error('Respuesta inválida del servidor');
            succeed(json);
          })
          .catch(fail);
      };

      // Primero inmediato y luego uno más cada 2,5 s (hasta agotar la lista).
      launch();
      hedgeTimer = setInterval(launch, HEDGE_DELAY);

      totalTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('Los servidores de mapas tardaron demasiado en responder. Inténtalo de nuevo.'));
      }, TOTAL_TIMEOUT);
    });
  }

  function normalizeError(error) {
    if (!error) return new Error('No se pudo conectar con OpenStreetMap.');
    if (error.name === 'AbortError') {
      return new Error('El servidor de mapas no respondió a tiempo.');
    }
    if (/^HTTP 5/.test(error.message)) {
      return new Error('Los servidores de OpenStreetMap están saturados. Inténtalo en unos segundos.');
    }
    if (/Failed to fetch|NetworkError|ERR_/.test(error.message)) {
      return new Error('No se pudo conectar con OpenStreetMap. Comprueba tu conexión.');
    }
    return error;
  }

  /* Búsqueda de direcciones con Nominatim */
  async function geocode(text, signal) {
    const url = 'https://nominatim.openstreetmap.org/search'
      + '?format=jsonv2&limit=6&accept-language=es&q=' + encodeURIComponent(text);

    const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  return { buildQuery, run, geocode };
})();
