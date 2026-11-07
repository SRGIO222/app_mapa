/* =====================================================================
   MapaVivo · Lógica principal
   ---------------------------------------------------------------------
   - Mapa Leaflet + OpenStreetMap (sin API key)
   - Geolocalización del navegador
   - Puntos de interés reales vía Overpass API
   - Marcadores con emoji por categoría y agrupación (clusters)
   ===================================================================== */
(function () {
  'use strict';

  /* ───────────────────────── Utilidades ───────────────────────── */
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const CATEGORIES = window.CATEGORIES;
  const CAT_BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));
  const CACHE = new Map();          // cacheKey → lista de lugares
  const CACHE_MAX = 80;

  const EARTH_R = 6371000;

  function distanceM(a, b) {
    const rad = (d) => (d * Math.PI) / 180;
    const dLat = rad(b.lat - a.lat);
    const dLng = rad(b.lng - a.lng);
    const s = Math.sin(dLat / 2) ** 2
      + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  function formatDistance(m) {
    if (!isFinite(m)) return '';
    if (m < 1000) return `${Math.max(5, Math.round(m / 5) * 5)} m`;
    const km = m / 1000;
    return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
  }

  function formatRadius(m) {
    return m < 1000 ? `${m} m` : `${m / 1000} km`;
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  /* ───────────────────────── Favoritos y caché local ───────────────────────── */
  const FAV_KEY = 'mv-favs';
  const FAV_MAX = 200;
  const OFFLINE_KEY = 'mv-offline-v1';
  const RECENT_KEY = 'mv-recent';
  const RECENT_MAX = 6;

  // Solo guardamos las etiquetas que la app necesita para mostrar la ficha.
  const KEEP_TAGS = [
    'name', 'name:es', 'brand', 'amenity', 'tourism', 'shop', 'leisure',
    'railway', 'highway', 'public_transport', 'natural', 'cuisine',
    'opening_hours', 'phone', 'contact:phone', 'website', 'contact:website',
    'url', 'addr:street', 'addr:housenumber', 'addr:place', 'addr:city',
    'addr:suburb',
  ];

  function pickTags(tags) {
    const out = {};
    if (!tags) return out;
    for (const key of KEEP_TAGS) {
      if (tags[key] != null) out[key] = tags[key];
    }
    return out;
  }

  function favoriteSnapshot(place) {
    return {
      id: place.id,
      osmType: place.osmType,
      osmId: place.osmId,
      name: place.name,
      lat: place.lat,
      lng: place.lng,
      catId: place.catId,
      kind: place.kind,
      address: place.address,
      tags: pickTags(place.tags),
      savedAt: Date.now(),
    };
  }

  function loadFavorites() {
    const map = new Map();
    try {
      const list = JSON.parse(localStorage.getItem(FAV_KEY) || '[]');
      if (!Array.isArray(list)) return map;
      for (const place of list) {
        if (place && place.id && isFinite(place.lat) && isFinite(place.lng)) {
          map.set(place.id, place);
        }
      }
    } catch (error) { /* almacenamiento no disponible */ }
    return map;
  }

  function persistFavorites() {
    try {
      localStorage.setItem(FAV_KEY, JSON.stringify([...state.favorites.values()]));
    } catch (error) {
      toast('No se pudieron guardar los favoritos (almacenamiento lleno).', 'err', 5000);
    }
  }

  function compactPlace(place) {
    return {
      id: place.id,
      osmType: place.osmType,
      osmId: place.osmId,
      name: place.name,
      lat: place.lat,
      lng: place.lng,
      catId: place.catId,
      kind: place.kind,
      address: place.address,
      tags: pickTags(place.tags),
    };
  }

  function loadOffline() {
    try {
      const data = JSON.parse(localStorage.getItem(OFFLINE_KEY) || 'null');
      if (!data || !data.cats || !data.center) return null;
      return data;
    } catch (error) {
      return null;
    }
  }

  function saveOffline(center) {
    const cats = {};
    let total = 0;

    for (const [id, places] of state.places) {
      if (!state.active.has(id)) continue;
      const sample = places.slice(0, 120).map(compactPlace);
      cats[id] = sample;
      total += sample.length;
      if (total >= 1200) break;
    }

    try {
      localStorage.setItem(OFFLINE_KEY, JSON.stringify({
        savedAt: Date.now(),
        center: { lat: center.lat, lng: center.lng },
        radius: state.radius,
        cats,
      }));
    } catch (error) {
      try { localStorage.removeItem(OFFLINE_KEY); } catch (ignored) { /* sin espacio */ }
    }
  }

  function openStatus(place) {
    if (!window.OpenHours || !place || !place.tags) return null;
    return window.OpenHours.status(place.tags.opening_hours);
  }

  function openLabel(status) {
    return status === 'open' ? 'Abierto' : status === 'closed' ? 'Cerrado' : '';
  }

  function walkingMinutes(meters) {
    return Math.max(1, Math.round(meters / 80)); // ~4,8 km/h
  }

  function placeDistance(place) {
    const base = state.user || state.searchCenter;
    if (base) return distanceM(base, place);
    return isFinite(place.distance) ? place.distance : 0;
  }

  function visiblePlaces(catId) {
    const places = state.places.get(catId) || [];
    if (!state.openOnly) return places;
    return places.filter((place) => openStatus(place) !== 'closed');
  }

  function formatSavedAt(timestamp) {
    try {
      return new Date(timestamp).toLocaleString('es-ES', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
      });
    } catch (error) {
      return '';
    }
  }

  /* ───────────────────────── Estado ───────────────────────── */
  const storedTheme = localStorage.getItem('mv-theme');
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;

  const state = {
    theme: storedTheme || (prefersDark ? 'dark' : 'light'),
    active: new Set(),
    radius: 1000,
    user: null,              // { lat, lng, accuracy }
    searchCenter: null,      // { lat, lng }
    follow: true,
    warnedNoGeo: false,
    watching: false,
    loading: false,
    error: null,
    reqToken: 0,
    places: new Map(),       // catId → lugares
    groups: new Map(),       // catId → cluster group
    appliedKey: new Map(),   // catId → clave de caché aplicada
    markers: new Map(),      // placeId → marker
    markerIds: new Map(),    // catId → Set(placeId)
    searchMarker: null,
    tiles: {},

    view: 'nearby',          // 'nearby' | 'favs'
    openOnly: localStorage.getItem('mv-open-only') === '1',
    favorites: loadFavorites(), // id → lugar guardado
    favLayer: null,
    favMarkers: new Map(),   // placeId → marker de favorito
    offline: false,
    offlineAt: 0,
  };

  let map = null;
  let userMarker = null;
  let accuracyCircle = null;

  function cacheKey(catId, center, radius) {
    return `${catId}|${center.lat.toFixed(3)},${center.lng.toFixed(3)}|${radius}`;
  }

  function mapCenter() {
    const c = map.getCenter();
    return { lat: c.lat, lng: c.lng };
  }

  /* ───────────────────────── Mapa ───────────────────────── */
  function initMap() {
    map = L.map('map', {
      zoomControl: false,
      worldCopyJump: true,
      zoomSnap: 0.5,
    }).setView([40.4168, -3.7038], 14);

    L.control.zoom({ position: 'topright' }).addTo(map);
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);

    state.tiles.base = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    }).addTo(map);
  }

  function applyTheme(theme) {
    if (theme !== 'light' && theme !== 'dark') theme = 'light';
    state.theme = theme;
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('mv-theme', theme);

    const btn = $('#btn-theme');
    btn.textContent = theme === 'dark' ? '☀️' : '🌙';
    btn.title = theme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro';
  }

  /* ───────────────────────── Ubicación del usuario ───────────────────────── */
  function updateUserMarker() {
    if (!state.user) return;
    const ll = [state.user.lat, state.user.lng];
    const radius = Math.max(15, Math.min(state.user.accuracy || 30, 500));

    if (!userMarker) {
      userMarker = L.marker(ll, {
        icon: L.divIcon({
          className: 'me-wrap',
          html: '<div class="me"><span class="me-pulse"></span><span class="me-dot"></span></div>',
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        }),
        interactive: false,
        keyboard: false,
        zIndexOffset: 1000,
      }).addTo(map);

      accuracyCircle = L.circle(ll, {
        radius,
        color: '#2f7bff',
        weight: 1,
        fillColor: '#2f7bff',
        fillOpacity: 0.1,
        interactive: false,
      }).addTo(map);
    } else {
      userMarker.setLatLng(ll);
      accuracyCircle.setLatLng(ll).setRadius(radius);
    }
  }

  function initGeo(manual) {
    if (!navigator.geolocation) {
      toast('Tu navegador no permite geolocalización. Busca una dirección.', 'err', 6000);
      return;
    }
    const btn = $('#btn-locate');
    btn.classList.add('is-busy');

    navigator.geolocation.getCurrentPosition(
      (pos) => { btn.classList.remove('is-busy'); onPosition(pos, true); },
      (err) => { btn.classList.remove('is-busy'); onGeoError(err); },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: manual ? 0 : 60000 }
    );
  }

  function startWatch() {
    if (state.watching || !navigator.geolocation) return;
    state.watching = true;
    navigator.geolocation.watchPosition(
      (pos) => onPosition(pos, false),
      () => { /* silencioso: ya avisamos en el primer intento */ },
      { enableHighAccuracy: true, timeout: 30000, maximumAge: 15000 }
    );
  }

  function onPosition(pos, isRequest) {
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    const accuracy = pos.coords.accuracy;
    const hadUser = !!state.user;

    state.user = { lat, lng, accuracy };
    updateUserMarker();

    const here = { lat, lng };

    if (!hadUser) {
      state.follow = true;
      state.searchCenter = { ...here };
      map.flyTo([lat, lng], Math.max(map.getZoom(), 16), { duration: 0.9 });
      loadActive({ center: here });
      startWatch();
    } else if (state.follow) {
      map.panTo([lat, lng], { animate: true });
      const moved = state.searchCenter ? distanceM(state.searchCenter, here) : Infinity;
      if (moved > Math.max(400, state.radius * 0.5)) loadActive({ center: here });
    }

    if (isRequest && hadUser) toast('Ubicación actualizada 📍', 'ok', 2000);
  }

  function onGeoError(err) {
    let msg;
    if (location.protocol === 'file:') {
      msg = 'Los navegadores bloquean la ubicación en archivos locales. Abre la app con «iniciar.bat» (localhost) para permitirla.';
    } else if (err && err.code === 1) {
      msg = 'Has bloqueado la ubicación. Búscala escribiendo una dirección o pulsa «Buscar en esta zona».';
    } else if (err && err.code === 3) {
      msg = 'La ubicación tardó demasiado. Inténtalo de nuevo o busca una dirección.';
    } else {
      msg = 'No se pudo obtener tu ubicación. Busca una dirección para empezar.';
    }
    toast(msg, 'warn', 6500);
  }

  /* ───────────────────────── Categorías (UI) ───────────────────────── */
  function renderCategories() {
    const wrap = $('#cats');
    const frag = document.createDocumentFragment();

    for (const cat of CATEGORIES) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cat';
      btn.dataset.id = cat.id;
      btn.style.setProperty('--c', cat.color);
      btn.setAttribute('aria-pressed', 'false');
      btn.title = cat.label;

      const emoji = document.createElement('span');
      emoji.className = 'cat-emoji';
      emoji.textContent = cat.emoji;

      const label = document.createElement('span');
      label.className = 'cat-label';
      label.textContent = cat.label;

      const count = document.createElement('span');
      count.className = 'cat-count';

      btn.append(emoji, label, count);
      btn.addEventListener('click', () => toggleCategory(cat.id));
      frag.appendChild(btn);
    }
    wrap.replaceChildren(frag);
  }

  function syncCategoryUI() {
    $$('#cats .cat').forEach((btn) => {
      const id = btn.dataset.id;
      const on = state.active.has(id);
      const count = visiblePlaces(id).length;
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');

      const badge = btn.querySelector('.cat-count');
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.classList.toggle('has', on && count > 0);
    });
  }

  function syncRadiusUI() {
    $$('.seg button').forEach((btn) => {
      btn.classList.toggle('on', parseInt(btn.dataset.r, 10) === state.radius);
    });
  }

  function persistCategories() {
    localStorage.setItem('mv-cats', JSON.stringify([...state.active]));
  }

  function restoreCategories() {
    // Atajos del manifest: ?cat=restaurant, ?cat=pharmacy, ?cat=fuel…
    const fromUrl = new URLSearchParams(location.search).get('cat');
    if (fromUrl && CAT_BY_ID.has(fromUrl)) {
      state.active = new Set([fromUrl]);
      persistCategories();
      return;
    }

    let ids = null;
    try {
      ids = JSON.parse(localStorage.getItem('mv-cats') || 'null');
    } catch (e) { ids = null; }

    if (!Array.isArray(ids)) ids = ['restaurant'];
    for (const id of ids) {
      if (CAT_BY_ID.has(id)) state.active.add(id);
    }
  }

  function toggleCategory(id) {
    if (state.view === 'favs') setView('nearby', true);

    if (state.active.has(id)) {
      state.active.delete(id);
      const group = state.groups.get(id);
      if (group && map.hasLayer(group)) map.removeLayer(group);
    } else {
      state.active.add(id);
    }

    if (!state.user && !state.searchCenter && !state.warnedNoGeo) {
      state.warnedNoGeo = true;
      toast('Mostrando la zona del mapa. Pulsa 🎯 o busca tu ciudad para ver lugares cerca de ti.', 'info', 6000);
    }

    persistCategories();
    syncCategoryUI();

    if (state.active.size) loadActive();
    else { renderList(); updatePill(); }
  }

  function clearAll() {
    state.active.clear();
    state.groups.forEach((group) => {
      if (map.hasLayer(group)) map.removeLayer(group);
      group.clearLayers();
    });
    state.places.clear();
    state.appliedKey.clear();
    state.markers.clear();
    state.markerIds.clear();
    state.error = null;
    state.reqToken += 1;

    persistCategories();
    syncCategoryUI();
    renderList();
    updatePill();
    toast('Mapa limpio', 'ok', 1800);
  }

  /* ───────────────────────── Carga de datos ───────────────────────── */
  async function loadActive(options) {
    const opts = options || {};
    const cats = [...state.active]
      .map((id) => CAT_BY_ID.get(id))
      .filter(Boolean)
      .sort((a, b) => CATEGORIES.indexOf(a) - CATEGORIES.indexOf(b));

    if (!cats.length) { renderList(); updatePill(); return; }

    const base = opts.center || state.searchCenter || state.user || mapCenter();
    const center = { lat: base.lat, lng: base.lng };
    state.searchCenter = { ...center };

    const pending = [];
    for (const cat of cats) {
      const key = cacheKey(cat.id, center, state.radius);
      if (!opts.force && state.appliedKey.get(cat.id) === key && state.groups.has(cat.id)) continue;
      const cached = opts.force ? null : CACHE.get(key);
      if (cached) applyCategory(cat, cached, center);
      else pending.push(cat);
    }

    if (!pending.length) { renderList(); updatePill(); return; }

    const token = ++state.reqToken;
    state.loading = true;
    state.error = null;
    syncLoadingUI();
    renderList();

    const slowTimer = setTimeout(() => {
      if (token === state.reqToken && state.loading) {
        toast('Los servidores de mapas van lentos. Un momento…', 'warn', 5000);
      }
    }, 9000);

    try {
      const query = OverpassAPI.buildQuery(pending, {
        lat: center.lat,
        lng: center.lng,
        radius: state.radius,
      });
      const data = await OverpassAPI.run(query);
      if (token !== state.reqToken) return;

      const buckets = classifyElements(data.elements, pending);
      for (const cat of pending) {
        const places = buckets.get(cat.id) || [];
        CACHE.set(cacheKey(cat.id, center, state.radius), places);
        if (CACHE.size > CACHE_MAX) CACHE.delete(CACHE.keys().next().value);
        applyCategory(cat, places, center);
      }

      state.offline = false;
      state.offlineAt = 0;
      saveOffline(center);

      if (!data.elements.length) {
        toast('No se han encontrado lugares de estas categorías en la zona.', 'warn', 4200);
      }
    } catch (err) {
      if (token !== state.reqToken) return;

      // Sin conexión (o servidores caídos): recuperamos los últimos resultados.
      const offline = loadOffline();
      let usedOffline = false;

      if (offline) {
        const near = distanceM(center, offline.center) <= Math.max(offline.radius || 0, 3000);
        if (near) {
          for (const cat of pending) {
            const places = offline.cats[cat.id];
            if (places && places.length) {
              applyCategory(cat, places, center);
              usedOffline = true;
            }
          }
        }
      }

      if (usedOffline) {
        state.offline = true;
        state.offlineAt = offline.savedAt || 0;
        state.error = null;
        toast('Sin conexión: mostrando los últimos lugares guardados.', 'warn', 6500);
      } else {
        state.error = err && err.message ? err.message : 'Error desconocido';
        console.error('[MapaVivo]', err);
      }
    } finally {
      clearTimeout(slowTimer);
      if (token === state.reqToken) {
        state.loading = false;
        syncLoadingUI();
        renderList();
        updatePill();
      }
    }
  }

  function syncLoadingUI() {
    $('#btn-reload').classList.toggle('spin', state.loading);
  }

  function classifyElements(elements, cats) {
    const buckets = new Map(cats.map((c) => [c.id, []]));
    const seen = new Set();
    const ordered = [...cats].sort((a, b) => CATEGORIES.indexOf(a) - CATEGORIES.indexOf(b));

    for (const el of elements) {
      const tags = el.tags || {};
      const lat = el.lat != null ? el.lat : el.center && el.center.lat;
      const lng = el.lon != null ? el.lon : el.center && el.center.lon;
      if (lat == null || lng == null) continue;

      const uid = `${el.type}/${el.id}`;
      if (seen.has(uid)) continue;

      const cat = ordered.find((c) => c.tags.some((t) => tags[t[0]] === t[1]));
      if (!cat) continue;

      seen.add(uid);
      buckets.get(cat.id).push(makePlace(el, tags, lat, lng, cat.id));
    }

    return buckets;
  }

  function makePlace(el, tags, lat, lng, catId) {
    const kind = window.describePlace(tags);
    const name = tags['name:es'] || tags.name || tags.brand || kind;

    return {
      id: `${el.type}/${el.id}`,
      osmType: el.type,
      osmId: el.id,
      name,
      lat,
      lng,
      tags,
      catId,
      kind,
      address: window.formatAddress(tags),
      distance: 0,
    };
  }

  function applyCategory(cat, places, center) {
    const group = ensureGroup(cat);

    const previous = state.markerIds.get(cat.id);
    if (previous) {
      for (const id of previous) state.markers.delete(id);
    }

    group.clearLayers();
    const enriched = places.map((p) => ({ ...p, distance: distanceM(center, p) }));
    state.places.set(cat.id, enriched);

    // Con el filtro «Abierto» activo solo pintamos los que no constan cerrados.
    const visible = state.openOnly
      ? enriched.filter((place) => openStatus(place) !== 'closed')
      : enriched;
    const ids = new Set();

    for (const place of visible) {
      const marker = buildMarker(place);
      ids.add(place.id);
      state.markers.set(place.id, marker);
      group.addLayer(marker);
    }

    state.markerIds.set(cat.id, ids);
    state.appliedKey.set(cat.id, cacheKey(cat.id, center, state.radius));

    const shouldShow = state.active.has(cat.id) && state.view === 'nearby';
    if (shouldShow) {
      if (!map.hasLayer(group)) group.addTo(map);
    } else if (map.hasLayer(group)) {
      map.removeLayer(group);
    }

    syncCategoryUI();
  }

  function ensureGroup(cat) {
    if (state.groups.has(cat.id)) return state.groups.get(cat.id);

    let group;
    if (typeof L.markerClusterGroup === 'function') {
      group = L.markerClusterGroup({
        disableClusteringAtZoom: 17,
        maxClusterRadius: 52,
        showCoverageOnHover: false,
        spiderfyOnMaxZoom: true,
        iconCreateFunction: (cluster) => clusterIcon(cluster.getChildCount(), cat.color),
      });
    } else {
      group = L.layerGroup();
    }

    state.groups.set(cat.id, group);
    return group;
  }

  function clusterIcon(count, color) {
    return L.divIcon({
      className: 'cluster-wrap',
      html: `<div class="cluster" style="--c:${color}">${count > 999 ? '999+' : count}</div>`,
      iconSize: [42, 42],
      iconAnchor: [21, 21],
    });
  }

  /* ───────────────────────── Marcadores y popups ───────────────────────── */
  function buildMarker(place) {
    const cat = CAT_BY_ID.get(place.catId);
    const icon = L.divIcon({
      className: 'pin-wrap',
      html: `<div class="pin" style="--pin:${cat.color}"><span>${cat.emoji}</span></div>`,
      iconSize: [40, 48],
      iconAnchor: [20, 44],
      popupAnchor: [0, -42],
    });

    const marker = L.marker([place.lat, place.lng], {
      icon,
      title: place.name,
      alt: place.name,
      riseOnHover: true,
    });

    marker.bindPopup(() => popupNode(place), {
      maxWidth: 300,
      minWidth: 250,
      className: 'mv-popup',
      autoPanPadding: [28, 28],
    });

    marker.on('click', () => highlightItem(place.id));
    return marker;
  }

  function popupNode(place) {
    const cat = CAT_BY_ID.get(place.catId);
    const root = document.createElement('div');
    root.className = 'pop';

    const head = document.createElement('div');
    head.className = 'pop-head';

    const emoji = document.createElement('span');
    emoji.className = 'pop-emoji';
    emoji.style.setProperty('--c', cat.color);
    emoji.textContent = cat.emoji;

    const titles = document.createElement('div');
    titles.className = 'pop-titles';

    const title = document.createElement('h3');
    title.className = 'pop-title';
    title.textContent = place.name;

    const kind = document.createElement('div');
    kind.className = 'pop-kind';
    kind.textContent = place.kind;

    titles.append(title, kind);
    head.append(emoji, titles);
    root.appendChild(head);

    const meta = document.createElement('div');
    meta.className = 'pop-meta';

    meta.appendChild(popRow('📍', place.address || 'Sin dirección registrada'));

    let dist = place.distance;
    let label = 'del centro de búsqueda';
    if (state.user) {
      dist = distanceM(state.user, place);
      label = 'de ti';
    }
    meta.appendChild(popRow('🧭', `${formatDistance(dist)} ${label}`));

    if (isFinite(dist) && dist <= 8000) {
      meta.appendChild(popRow('🚶', `${walkingMinutes(dist)} min a pie, aprox.`));
    }

    const status = openStatus(place);
    if (status) {
      meta.appendChild(popRow(
        status === 'open' ? '🟢' : '🔴',
        status === 'open' ? 'Abierto ahora' : 'Cerrado ahora'
      ));
    }

    if (place.tags.opening_hours) {
      meta.appendChild(popRow('🕒', place.tags.opening_hours));
    }

    const phone = place.tags.phone || place.tags['contact:phone'];
    if (phone) {
      const row = document.createElement('div');
      row.className = 'pop-row';
      const ico = document.createElement('span');
      ico.className = 'pop-ico';
      ico.textContent = '📞';
      const link = document.createElement('a');
      link.href = 'tel:' + phone.replace(/\s+/g, '');
      link.textContent = phone;
      row.append(ico, link);
      meta.appendChild(row);
    }

    const web = place.tags.website || place.tags['contact:website'] || place.tags.url;
    if (web) {
      const row = document.createElement('div');
      row.className = 'pop-row';
      const ico = document.createElement('span');
      ico.className = 'pop-ico';
      ico.textContent = '🌐';
      const link = document.createElement('a');
      link.href = web;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = web.replace(/^https?:\/\//, '').replace(/\/$/, '');
      row.append(ico, link);
      meta.appendChild(row);
    }

    root.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'pop-actions';

    const route = document.createElement('a');
    route.href = `https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lng}`;
    route.target = '_blank';
    route.rel = 'noopener noreferrer';
    route.textContent = 'Cómo llegar';

    const fav = makeFavButton(place);

    const share = document.createElement('button');
    share.type = 'button';
    share.className = 'ghost';
    share.textContent = '↗ Compartir';
    share.addEventListener('click', () => sharePlace(place));

    const osm = document.createElement('a');
    osm.className = 'ghost';
    osm.href = `https://www.openstreetmap.org/${place.osmType}/${place.osmId}`;
    osm.target = '_blank';
    osm.rel = 'noopener noreferrer';
    osm.textContent = 'Ver en OSM';

    actions.append(route, fav, share, osm);
    root.appendChild(actions);

    return root;
  }

  function makeFavButton(place) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.id = place.id;
    btn.className = 'ghost';

    const paint = () => {
      const on = state.favorites.has(place.id);
      btn.classList.toggle('on', on);
      btn.textContent = on ? '★ Guardado' : '☆ Guardar';
    };

    btn.addEventListener('click', () => {
      toggleFavorite(place);
      paint();
    });

    paint();
    return btn;
  }

  function popRow(icon, text) {
    const row = document.createElement('div');
    row.className = 'pop-row';
    const ico = document.createElement('span');
    ico.className = 'pop-ico';
    ico.textContent = icon;
    const span = document.createElement('span');
    span.textContent = text;
    row.append(ico, span);
    return row;
  }

  /* ───────────────────────── Lista lateral ───────────────────────── */
  function renderList() {
    const listEl = $('#list');
    const titleEl = $('#list-title');
    const subEl = $('#list-sub');

    if (state.view === 'favs') {
      renderFavoritesList(listEl, titleEl, subEl);
      return;
    }

    const cats = [...state.active].map((id) => CAT_BY_ID.get(id)).filter(Boolean);
    titleEl.textContent = cats.length === 1 ? cats[0].label : (cats.length ? `${cats.length} categorías` : 'Lugares');

    if (state.error) {
      subEl.textContent = '';
      listEl.replaceChildren(
        stateBlock('📡', 'No se pudieron cargar los lugares', state.error, {
          label: 'Reintentar',
          onClick: () => loadActive({ force: true }),
        })
      );
      return;
    }

    if (!cats.length) {
      subEl.textContent = '';
      listEl.replaceChildren(
        stateBlock('🧭', 'Elige qué quieres ver', 'Toca una o varias categorías y aparecerán en el mapa con su emoji.')
      );
      return;
    }

    const byId = new Map();
    let hiddenClosed = 0;

    for (const cat of cats) {
      for (const place of state.places.get(cat.id) || []) {
        if (state.openOnly && openStatus(place) === 'closed') {
          hiddenClosed += 1;
          continue;
        }
        if (!byId.has(place.id)) byId.set(place.id, place);
      }
    }
    const all = [...byId.values()].sort((a, b) => a.distance - b.distance);

    if (!all.length && state.loading) {
      subEl.textContent = 'Buscando…';
      listEl.replaceChildren(skeletonBlock());
      return;
    }

    if (!all.length) {
      subEl.textContent = state.searchCenter ? `Radio ${formatRadius(state.radius)}` : '';
      listEl.replaceChildren(
        state.openOnly && hiddenClosed
          ? stateBlock('🟢', 'Todo cerrado ahora', `Los ${hiddenClosed} lugares encontrados constan como cerrados. Desactiva el filtro «Abierto» para verlos.`)
          : state.searchCenter
            ? stateBlock('🔍', 'Nada por aquí', 'No hay lugares de este tipo en la zona. Prueba a ampliar el radio o a mover el mapa y pulsa «Buscar en esta zona».')
            : stateBlock('📍', 'Dinos dónde estás', 'Pulsa el botón 🎯 para usar tu ubicación o escribe una dirección o ciudad en el buscador.')
      );
      return;
    }

    subEl.textContent = `${all.length} ${all.length === 1 ? 'lugar' : 'lugares'} · ${formatRadius(state.radius)}`;

    const frag = document.createDocumentFragment();

    if (state.offline) {
      const note = document.createElement('div');
      note.className = 'offline-note';
      const strong = document.createElement('strong');
      strong.textContent = '📴 Sin conexión. ';
      note.append(
        strong,
        document.createTextNode(
          `Mostrando los últimos resultados guardados${state.offlineAt ? ` (${formatSavedAt(state.offlineAt)})` : ''}.`
        )
      );
      frag.appendChild(note);
    }

    if (state.openOnly && hiddenClosed) {
      const note = document.createElement('p');
      note.className = 'list-note';
      note.textContent = `🟢 Filtro «Abierto»: ${hiddenClosed} lugares cerrados ocultos.`;
      frag.appendChild(note);
    }

    for (const place of all.slice(0, 200)) frag.appendChild(listItem(place));

    if (all.length > 200) {
      const note = document.createElement('p');
      note.className = 'list-note';
      note.textContent = `Mostrando los 200 más cercanos de ${all.length}.`;
      frag.appendChild(note);
    }

    listEl.replaceChildren(frag);
  }

  function renderFavoritesList(listEl, titleEl, subEl) {
    titleEl.textContent = 'Favoritos';

    const base = state.user || state.searchCenter;
    const all = [...state.favorites.values()]
      .map((place) => ({ ...place, distance: base ? distanceM(base, place) : 0 }))
      .sort((a, b) => a.distance - b.distance);

    subEl.textContent = all.length
      ? `${all.length} ${all.length === 1 ? 'guardado' : 'guardados'}`
      : '';

    if (!all.length) {
      listEl.replaceChildren(
        stateBlock('★', 'Aún no tienes favoritos', 'Toca la estrella ☆ de un lugar para guardarlo aquí y tenerlo siempre a mano, incluso sin conexión.')
      );
      return;
    }

    const frag = document.createDocumentFragment();
    for (const place of all) frag.appendChild(listItem(place));
    listEl.replaceChildren(frag);
  }

  function listItem(place) {
    const cat = CAT_BY_ID.get(place.catId) || CATEGORIES[0];

    const item = document.createElement('div');
    item.className = 'item';
    item.dataset.id = place.id;
    item.setAttribute('role', 'listitem');
    item.tabIndex = 0;

    const emoji = document.createElement('span');
    emoji.className = 'item-emoji';
    emoji.style.setProperty('--c', cat.color);
    emoji.textContent = cat.emoji;

    const main = document.createElement('span');
    main.className = 'item-main';

    const name = document.createElement('span');
    name.className = 'item-name';
    name.textContent = place.name;

    const meta = document.createElement('span');
    meta.className = 'item-meta';

    const dist = isFinite(place.distance) ? place.distance : placeDistance(place);
    meta.textContent = [place.kind, formatDistance(dist)].filter(Boolean).join(' · ');

    const status = openStatus(place);
    if (status) {
      meta.appendChild(document.createTextNode(' · '));
      const badge = document.createElement('span');
      badge.className = status === 'open' ? 'open-ok' : 'open-no';
      badge.textContent = openLabel(status);
      meta.appendChild(badge);
    }

    main.append(name, meta);

    const star = document.createElement('button');
    star.type = 'button';
    star.className = 'fav-btn';
    star.dataset.id = place.id;
    star.title = 'Guardar en favoritos';
    star.setAttribute('aria-label', 'Guardar en favoritos');
    star.textContent = state.favorites.has(place.id) ? '★' : '☆';
    if (state.favorites.has(place.id)) star.classList.add('on');
    star.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleFavorite(place);
    });

    const arrow = document.createElement('span');
    arrow.className = 'item-arrow';
    arrow.textContent = '›';

    item.append(emoji, main, star, arrow);
    item.addEventListener('click', () => focusPlace(place));
    item.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        focusPlace(place);
      }
    });

    return item;
  }

  function focusPlace(place) {
    state.follow = false;
    map.flyTo([place.lat, place.lng], Math.max(map.getZoom(), 17), { duration: 0.7 });
    map.once('moveend', () => {
      const marker = state.markers.get(place.id) || state.favMarkers.get(place.id);
      if (marker) marker.openPopup();
    });
    highlightItem(place.id);
    closeSheet();
  }

  function highlightItem(id) {
    $$('#list .item').forEach((el) => el.classList.toggle('sel', el.dataset.id === id));
    const item = document.querySelector(`#list .item[data-id="${id}"]`);
    if (item) item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  /* ───────────────────────── Favoritos ───────────────────────── */
  function toggleFavorite(place) {
    if (state.favorites.has(place.id)) {
      state.favorites.delete(place.id);
      toast('Quitado de favoritos', 'ok', 1800);
    } else {
      if (state.favorites.size >= FAV_MAX) {
        toast(`Puedes guardar hasta ${FAV_MAX} favoritos. Quita alguno para añadir más.`, 'warn', 4500);
        return;
      }
      state.favorites.set(place.id, favoriteSnapshot(place));
      toast('Guardado en favoritos ★', 'ok', 1800);
    }

    persistFavorites();
    syncFavUI();

    if (state.view === 'favs') {
      renderFavMarkers();
      renderList();
    }
  }

  function syncFavUI() {
    const count = $('#fav-count');
    if (count) count.textContent = String(state.favorites.size);

    $$('#list .fav-btn').forEach((btn) => {
      const on = state.favorites.has(btn.dataset.id);
      btn.classList.toggle('on', on);
      btn.textContent = on ? '★' : '☆';
      btn.title = on ? 'Quitar de favoritos' : 'Guardar en favoritos';
      btn.setAttribute('aria-label', btn.title);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function ensureFavLayer() {
    if (!state.favLayer) state.favLayer = L.layerGroup();
    return state.favLayer;
  }

  function renderFavMarkers() {
    const layer = ensureFavLayer();
    layer.clearLayers();
    state.favMarkers.clear();

    const base = state.user || state.searchCenter;
    const places = [...state.favorites.values()]
      .map((place) => ({ ...place, distance: base ? distanceM(base, place) : 0 }))
      .sort((a, b) => a.distance - b.distance);

    for (const place of places) {
      const cat = CAT_BY_ID.get(place.catId) || CATEGORIES[0];
      const marker = L.marker([place.lat, place.lng], {
        icon: L.divIcon({
          className: 'pin-wrap',
          html: `<div class="pin pin-fav" style="--pin:${cat.color}"><span>★</span></div>`,
          iconSize: [40, 48],
          iconAnchor: [20, 44],
          popupAnchor: [0, -42],
        }),
        title: place.name,
        alt: place.name,
        riseOnHover: true,
        zIndexOffset: 500,
      });

      marker.bindPopup(() => popupNode(place), {
        maxWidth: 300,
        minWidth: 250,
        className: 'mv-popup',
        autoPanPadding: [28, 28],
      });
      marker.on('click', () => highlightItem(place.id));

      state.favMarkers.set(place.id, marker);
      layer.addLayer(marker);
    }

    if (state.view === 'favs' && !map.hasLayer(layer)) layer.addTo(map);
  }

  function setView(view, silent) {
    state.view = view === 'favs' ? 'favs' : 'nearby';

    const nearbyBtn = $('#tab-nearby');
    const favsBtn = $('#tab-favs');
    nearbyBtn.classList.toggle('on', state.view === 'nearby');
    favsBtn.classList.toggle('on', state.view === 'favs');
    nearbyBtn.setAttribute('aria-selected', state.view === 'nearby' ? 'true' : 'false');
    favsBtn.setAttribute('aria-selected', state.view === 'favs' ? 'true' : 'false');

    if (state.view === 'favs') {
      state.groups.forEach((group) => {
        if (map.hasLayer(group)) map.removeLayer(group);
      });
      renderFavMarkers();
      const layer = ensureFavLayer();
      if (!map.hasLayer(layer)) layer.addTo(map);
    } else {
      if (state.favLayer && map.hasLayer(state.favLayer)) map.removeLayer(state.favLayer);
      state.groups.forEach((group, id) => {
        if (state.active.has(id) && !map.hasLayer(group)) group.addTo(map);
      });
    }

    updatePill();
    if (!silent) renderList();
  }

  /* ───────────────────────── Filtro «Abierto» ───────────────────────── */
  function syncOpenUI() {
    const btn = $('#btn-open-now');
    if (!btn) return;
    btn.classList.toggle('on', state.openOnly);
    btn.setAttribute('aria-pressed', state.openOnly ? 'true' : 'false');
    btn.title = state.openOnly
      ? 'Mostrando solo lugares abiertos ahora (toca para ver todos)'
      : 'Ocultar los lugares cerrados ahora';
  }

  function toggleOpenOnly() {
    state.openOnly = !state.openOnly;
    try { localStorage.setItem('mv-open-only', state.openOnly ? '1' : '0'); } catch (error) { /* sin almacenamiento */ }

    syncOpenUI();

    const center = state.searchCenter || state.user || (map ? mapCenter() : null);
    if (center) {
      for (const [id, places] of state.places) {
        const cat = CAT_BY_ID.get(id);
        if (cat) applyCategory(cat, places, center);
      }
    }

    if (state.view === 'favs') renderFavMarkers();
    renderList();
    syncCategoryUI();

    toast(
      state.openOnly
        ? 'Mostrando solo lugares abiertos ahora (según OpenStreetMap).'
        : 'Mostrando todos los lugares.',
      'ok',
      2600
    );
  }

  /* ───────────────────────── Compartir ───────────────────────── */
  async function sharePlace(place) {
    const url = `https://www.openstreetmap.org/${place.osmType}/${place.osmId}`;
    const text = `${place.name} · ${place.kind}${place.address ? ` · ${place.address}` : ''}`;

    if (navigator.share) {
      try {
        await navigator.share({ title: place.name, text, url });
        return;
      } catch (error) {
        if (error && error.name === 'AbortError') return;
      }
    }

    const payload = `${text}\n${url}`;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(payload);
        toast('Enlace copiado al portapapeles ✅', 'ok', 3200);
        return;
      }
      throw new Error('Sin portapapeles');
    } catch (error) {
      const area = document.createElement('textarea');
      area.value = payload;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();

      let copied = false;
      try { copied = document.execCommand('copy'); } catch (ignored) { copied = false; }
      document.body.removeChild(area);

      toast(
        copied ? 'Enlace copiado al portapapeles ✅' : 'No se pudo compartir en este dispositivo.',
        copied ? 'ok' : 'err',
        3600
      );
    }
  }

  /* ───────────────────────── Búsquedas recientes ───────────────────────── */
  function loadRecent() {
    try {
      const list = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
      return Array.isArray(list) ? list : [];
    } catch (error) {
      return [];
    }
  }

  function pushRecent(result) {
    const lat = parseFloat(result.lat);
    const lng = parseFloat(result.lon);
    if (!isFinite(lat) || !isFinite(lng)) return;

    const item = {
      name: result.name || (result.display_name || '').split(',')[0] || 'Lugar',
      display_name: result.display_name || '',
      lat,
      lon: lng,
      at: Date.now(),
    };

    const list = loadRecent().filter((entry) => (
      entry.display_name !== item.display_name
      || Math.abs(entry.lat - item.lat) > 1e-5
      || Math.abs(entry.lon - item.lon) > 1e-5
    ));
    list.unshift(item);

    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)));
    } catch (error) { /* sin almacenamiento */ }
  }

  function renderRecent() {
    const sug = $('#suggest');
    const list = loadRecent();

    if (!list.length) { hideSuggest(); return; }

    sug.replaceChildren();
    const head = document.createElement('div');
    head.className = 'sug-head';
    head.textContent = 'Búsquedas recientes';
    sug.appendChild(head);

    for (const result of list) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sug';
      btn.setAttribute('role', 'option');

      const name = document.createElement('span');
      name.className = 'sug-name';
      name.textContent = result.name;

      const detail = document.createElement('small');
      detail.textContent = result.display_name || '';

      btn.append(name, detail);
      btn.addEventListener('click', () => selectResult(result));
      sug.appendChild(btn);
    }

    sug.hidden = false;
  }

  function stateBlock(emoji, title, text, action) {
    const box = document.createElement('div');
    box.className = 'state';

    const icon = document.createElement('div');
    icon.className = 'big';
    icon.textContent = emoji;

    const h = document.createElement('strong');
    h.textContent = title;

    const p = document.createElement('p');
    p.textContent = text;

    box.append(icon, h, p);

    if (action) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'state-btn';
      btn.textContent = action.label;
      btn.addEventListener('click', action.onClick);
      box.appendChild(btn);
    }
    return box;
  }

  function skeletonBlock() {
    const box = document.createElement('div');
    box.className = 'skeleton';
    for (let i = 0; i < 7; i += 1) {
      const row = document.createElement('div');
      row.className = 'sk-row';
      row.innerHTML = '<span class="sk-square"></span><span class="sk-lines"><span></span><span></span></span>';
      box.appendChild(row);
    }
    return box;
  }

  /* ───────────────────────── Buscador de direcciones ───────────────────────── */
  let searchTimer = null;
  let searchController = null;

  function initSearch() {
    const input = $('#q');
    const clear = $('#btn-clear-q');

    input.addEventListener('focus', () => {
      if (!input.value.trim()) renderRecent();
    });

    input.addEventListener('input', () => {
      const q = input.value.trim();
      clear.hidden = !q;
      clearTimeout(searchTimer);

      if (q.length < 3) { hideSuggest(); return; }
      searchTimer = setTimeout(() => runSearch(q), 450);
    });

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        const first = $('#suggest .sug');
        if (first) first.click();
      } else if (event.key === 'Escape') {
        hideSuggest();
      }
    });

    clear.addEventListener('click', () => {
      input.value = '';
      clear.hidden = true;
      input.focus();
      renderRecent();
    });
  }

  async function runSearch(query) {
    if (searchController) searchController.abort();
    searchController = new AbortController();
    const controller = searchController;

    try {
      const results = await OverpassAPI.geocode(query, controller.signal);
      if (controller.signal.aborted) return;
      renderSuggestions(results);
    } catch (err) {
      if (err.name !== 'AbortError') hideSuggest();
    }
  }

  function renderSuggestions(results) {
    const sug = $('#suggest');
    sug.replaceChildren();

    if (!results || !results.length) { sug.hidden = true; return; }

    for (const result of results) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sug';
      btn.setAttribute('role', 'option');

      const name = document.createElement('span');
      name.className = 'sug-name';
      name.textContent = result.name || (result.display_name || '').split(',')[0];

      const detail = document.createElement('small');
      detail.textContent = result.display_name || '';

      btn.append(name, detail);
      btn.addEventListener('click', () => selectResult(result));
      sug.appendChild(btn);
    }
    sug.hidden = false;
  }

  function hideSuggest() {
    $('#suggest').hidden = true;
  }

  function selectResult(result) {
    const lat = parseFloat(result.lat);
    const lng = parseFloat(result.lon);
    if (!isFinite(lat) || !isFinite(lng)) return;

    hideSuggest();
    pushRecent(result);
    setView('nearby', true);

    const input = $('#q');
    input.value = result.name || (result.display_name || '').split(',')[0];
    state.follow = false;

    if (state.searchMarker) map.removeLayer(state.searchMarker);

    const label = document.createElement('div');
    label.className = 'pop';
    const strong = document.createElement('strong');
    strong.textContent = result.display_name || 'Resultado';
    label.appendChild(strong);

    state.searchMarker = L.marker([lat, lng], {
      icon: L.divIcon({
        className: 'pin-wrap',
        html: '<div class="pin" style="--pin:#6d5efc"><span>📍</span></div>',
        iconSize: [40, 48],
        iconAnchor: [20, 44],
        popupAnchor: [0, -42],
      }),
      title: result.display_name || 'Resultado',
      zIndexOffset: 800,
    }).addTo(map);

    state.searchMarker.bindPopup(label);
    map.flyTo([lat, lng], 16, { duration: 0.8 });
    input.blur();
    closeSheet();

    loadActive({ center: { lat, lng } });
  }

  /* ───────────────────────── UI auxiliar ───────────────────────── */
  let toastTimer = null;

  function toast(message, kind, ms) {
    const el = $('#toast');
    el.textContent = message;
    el.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = 'toast'; }, ms || 4200);
  }

  function openSheet() { document.body.classList.add('sheet-open'); }
  function closeSheet() { document.body.classList.remove('sheet-open'); }

  function updatePill() {
    const btn = $('#search-here');
    if (state.view === 'favs' || !state.active.size || !state.searchCenter) {
      btn.classList.remove('show');
      return;
    }
    const d = distanceM(state.searchCenter, mapCenter());
    btn.classList.toggle('show', d > Math.min(900, state.radius * 0.7));
  }

  /* ───────────────────────── Eventos generales ───────────────────────── */
  function bindUI() {
    $('#btn-theme').addEventListener('click', () => {
      applyTheme(state.theme === 'dark' ? 'light' : 'dark');
    });

    $('#btn-locate').addEventListener('click', () => {
      state.follow = true;
      initGeo(true);
    });

    $('#btn-menu').addEventListener('click', openSheet);
    $('#btn-close').addEventListener('click', closeSheet);
    $('#backdrop').addEventListener('click', closeSheet);

    $('#btn-reload').addEventListener('click', () => loadActive({ force: true }));
    $('#btn-clear').addEventListener('click', clearAll);

    $('#tab-nearby').addEventListener('click', () => setView('nearby'));
    $('#tab-favs').addEventListener('click', () => {
      setView('favs');
      syncFavUI();
    });
    $('#btn-open-now').addEventListener('click', toggleOpenOnly);

    $('#search-here').addEventListener('click', () => {
      state.follow = false;
      loadActive({ center: mapCenter() });
    });

    $$('.seg button').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.radius = parseInt(btn.dataset.r, 10);
        syncRadiusUI();
        loadActive({ force: true });
      });
    });

    map.on('dragstart', () => { state.follow = false; });
    map.on('moveend', updatePill);
    map.on('click', hideSuggest);

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { hideSuggest(); closeSheet(); }
    });

    window.addEventListener('offline', () => toast('Sin conexión a internet. Algunos datos podrían no cargar.', 'warn', 6000));
    window.addEventListener('online', () => toast('Conexión restablecida ✅', 'ok', 2500));
  }

  /* ───────────────────────── Instalación (PWA) ───────────────────────── */
  let deferredPrompt = null;

  function isStandalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
      || window.navigator.standalone === true;
  }

  function initInstall() {
    const btn = $('#btn-install');
    if (!btn || isStandalone()) return;

    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      deferredPrompt = event;
      btn.textContent = '📲 Instalar en el móvil';
      btn.hidden = false;
    });

    btn.addEventListener('click', async () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        try { await deferredPrompt.userChoice; } catch (e) { /* ignorado */ }
        deferredPrompt = null;
        btn.hidden = true;
        return;
      }

      const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
      toast(
        ios
          ? 'En Safari: toca «Compartir» (□↑) y elige «Añadir a pantalla de inicio».'
          : 'Abre el menú del navegador y elige «Instalar app» o «Añadir a pantalla de inicio».',
        'info',
        9000
      );
    });

    // iOS no dispara beforeinstallprompt: mostramos la ayuda directamente.
    if (/iphone|ipad|ipod/i.test(navigator.userAgent)) {
      btn.textContent = '📲 Añadir a pantalla de inicio';
      btn.hidden = false;
    }

    window.addEventListener('appinstalled', () => {
      btn.hidden = true;
      toast('¡MapaVivo instalada! 🎉', 'ok', 3000);
    });
  }

  function initServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol === 'file:') return;

    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch((err) => {
        console.warn('[MapaVivo] No se pudo registrar el service worker:', err);
      });
    });
  }

  /* ───────────────────────── Arranque ───────────────────────── */
  function init() {
    if (!window.L) {
      document.body.innerHTML = '<p style="padding:24px;font-family:sans-serif">No se pudo cargar Leaflet. Comprueba tu conexión a internet y recarga la página.</p>';
      return;
    }

    initMap();
    renderCategories();
    restoreCategories();
    applyTheme(state.theme);
    syncRadiusUI();
    bindUI();
    initSearch();
    syncCategoryUI();
    syncOpenUI();
    syncFavUI();
    renderList();
    updatePill();

    // La ubicación se pide sola al abrir; si falla, se puede buscar o usar el mapa.
    initGeo(false);
    initInstall();
    initServiceWorker();

    // Pequeño hook de depuración / integración.
    window.MapaVivo = {
      map,
      state,
      loadActive,
      refresh: () => loadActive({ force: true }),
    };
  }

  init();
})();
