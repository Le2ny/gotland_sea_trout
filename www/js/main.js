import { downloadOcean, newerRunAvailable, TEMP_STEP_H } from './copernicus.js';
import { createFieldLayer, lutFromStops } from './fieldLayer.js';
import { makeSampler, direction, compass, barriersMatch, gridKey } from './field.js';
import { createCoastBackground, createCachedTileLayer } from './basemap.js';
import { downloadWeather } from './weather.js';
import { rankAll, bestTimes, exposure } from './ranking.js';
import { coastIndex, computeBarriers } from './geo.js';
import { fetchProtection, protectionAt, RULES_URL, HVMFS_URL, SEASON_NOTE } from './protection.js';
import * as store from './store.js';
import { initIntro, HOW_HTML } from './intro.js';

const $ = id => document.getElementById(id);
const H = 3600000;

// Web version (iPhone/Android browser): service worker so the app itself starts offline.
// Not needed inside the Android APK, where all files are bundled.
if ('serviceWorker' in navigator && !window.Capacitor?.isNativePlatform?.() && (location.protocol === 'https:' || location.hostname === 'localhost'))
  navigator.serviceWorker.register('sw.js').catch(e => console.warn('Service Worker:', e.message));

const fmtTime = ms => new Date(ms).toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const fmtHour = ms => new Date(ms).toLocaleString('de-DE', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
const fmtNum = (x, d = 2) => x.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const cls = sc => sc >= 75 ? 'b-good' : sc >= 60 ? 'b-mid' : 'b-low';
const hav = (a, b) => { const R = 6371000, p1 = a[0] * Math.PI / 180, p2 = b[0] * Math.PI / 180, dp = p2 - p1, dl = (b[1] - a[1]) * Math.PI / 180;
  return 2 * R * Math.asin(Math.sqrt(Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2)); };
const km = m => m < 1000 ? `${Math.round(m)} m` : `${fmtNum(m / 1000, 1)} km`;

const [palette, coast, bundledBarriers, builtinSpots, parking, bundledProtection] = await Promise.all(
  ['palette', 'coast', 'barriers', 'spots', 'parking', 'protection'].map(n => fetch(`data/${n}.json`).then(r => r.json())));
let coastIx = null; const ix = () => (coastIx ??= coastIndex(coast));

// ---------------------------------------------------------------- layers & colour scales
const rgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const SCALES = {
  current: { lut: Uint8ClampedArray.from(palette.colors.flat()), lo: 0, hi: palette.max },
  // colours of the original app (windColor/waveColor/tempColor/levelColor), as smooth scales
  wind: lutFromStops([[0, rgb('#dff2f1')], [8, rgb('#b7e4df')], [16, rgb('#80cfbd')], [24, rgb('#46b59c')], [33, rgb('#f0d95b')], [44, rgb('#f49b42')], [60, rgb('#d95545')]]),
  wave: lutFromStops([[0, rgb('#d9f1ee')], [0.35, rgb('#9bd8ce')], [0.7, rgb('#5fbea9')], [1.15, rgb('#f0d45f')], [2, rgb('#e36b4d')]]),
  temp: lutFromStops([[0, rgb('#1d3f8a')], [4, rgb('#275aa8')], [7.5, rgb('#2c7bb6')], [10.5, rgb('#73add1')], [13.5, rgb('#77c7b2')], [16, rgb('#f4d35e')], [18, rgb('#f28e55')], [21, rgb('#d94a3f')]]),
  level: lutFromStops([[-0.3, rgb('#5f87c9')], [-0.1, rgb('#7aaed6')], [0, rgb('#b5d6df')], [0.1, rgb('#f0d86a')], [0.3, rgb('#e27b4c')]]),
};
const LAYERS = {
  current: { name: 'Strömung', unit: 'm/s', fmt: v => fmtNum(v, 1) },
  wind: { name: 'Wind', unit: 'km/h', fmt: v => Math.round(v) },
  wave: { name: 'Welle', unit: 'm', fmt: v => fmtNum(v, 1) },
  temp: { name: 'Wasser', unit: '°C', fmt: v => Math.round(v) },
  level: { name: 'Wasserstand', unit: 'm', fmt: v => (v > 0 ? '+' : '') + fmtNum(v, 1) },
  turbidity: { name: 'Trübung (Satellit)', unit: 'FNU', fmt: v => v },
};

const map = L.map('map', { zoomControl: false }).setView([57.45, 18.6], 9);
const CachedTiles = createCachedTileLayer(L), CachedWMS = createCachedTileLayer(L, L.TileLayer.WMS);
new (createCoastBackground(L, coast))().addTo(map);
const ATTR = '© OpenStreetMap · Copernicus Marine Service · Open-Meteo';
const osm = new CachedTiles('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, maxNativeZoom: 19, attribution: ATTR });
const satellite = new CachedTiles('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 18, attribution: 'Bild © Esri · ' + ATTR });
map.createPane('depthPane').style.zIndex = 250;
const bathy = new CachedWMS('https://ows.emodnet-bathymetry.eu/wms', { pane: 'depthPane', layers: 'emodnet:mean_multicolour', format: 'image/png', transparent: true, opacity: .62, attribution: 'EMODnet Bathymetry' });
const TURB_LAYER = 'OCEANCOLOUR_BAL_BGC_HR_L3_NRT_009_202/cmems_obs_oc_bal_bgc_tur-spm-chl_nrt_l3-hr-mosaic_P1D-m_202107/TUR';
let turbidity = null;
const field = new (createFieldLayer(L, coast))().addTo(map);
map.createPane('protPane').style.zIndex = 420;
const protLayer = L.layerGroup(), parkLayer = L.layerGroup(), spotLayer = L.layerGroup(), customLayer = L.layerGroup(), homeLayer = L.layerGroup().addTo(map), gpsLayer = L.layerGroup().addTo(map);
window.__map = map; window.__field = field; // for tests

// ---------------------------------------------------------------- state
let ocean = null, weather = null, hour = 0, S = {}, ranking = [], protection = bundledProtection, customSpots = [], home = null, newer = null;
let settings = { sound: true, main: 'current', spots: true, custom: true, parking: false, protection: true, bathy: false, satellite: false, turbDays: 3 };
const allSpots = () => [...builtinSpots, ...customSpots];

async function barriersFor(grid) {
  if (barriersMatch(bundledBarriers, grid)) return bundledBarriers;
  const key = 'barriers:' + gridKey(grid);
  let b = await store.load(key).catch(() => null);
  if (!barriersMatch(b, grid)) {
    $('status').textContent = 'Neues Modellgitter – berechne Küstenbarrieren …';
    await new Promise(r => setTimeout(r, 30));
    b = computeBarriers(coast, grid); await store.save(key, b).catch(() => {});
  }
  return b;
}

async function show(o, w) {
  ocean = o;
  weather = w && w.times?.[0] === o.times[0] && w.times.length === o.times.length ? w : null;
  const bCur = await barriersFor(o.grid);
  const bTemp = gridKey(o.temp.grid) === gridKey(o.grid) ? bCur : await barriersFor(o.temp.grid);
  S = {
    current: makeSampler(o.grid, [o.u, o.v], bCur),
    level: makeSampler(o.grid, [o.sla], bCur),
    temp: makeSampler(o.temp.grid, [o.temp.data], bTemp),
    wind: weather ? makeSampler(weather.grid, [weather.wu, weather.wv, weather.gust], null) : null,
    wave: weather ? makeSampler(weather.grid, [weather.wh, weather.wdu, weather.wdv], null) : null,
  };
  // temperature: colour scale stretched over the range of this forecast (at least 4 °C wide)
  { let mn = Infinity, mx = -Infinity; for (const x of o.temp.data) if (x > -900 && x === x) { if (x < mn) mn = x; if (x > mx) mx = x; }
    if (mn < mx) { let lo = Math.floor(mn), hi = Math.ceil(mx); if (hi - lo < 4) { const c = (lo + hi) / 2; lo = Math.floor(c - 2); hi = lo + 4; }
      const cols = ['#1d3f8a', '#2c7bb6', '#73add1', '#77c7b2', '#f4d35e', '#f28e55', '#d94a3f'];
      SCALES.temp = lutFromStops(cols.map((c, i) => [lo + (hi - lo) * i / (cols.length - 1), rgb(c)])); } }
  hour = Math.max(0, Math.min(o.times.length - 1, Math.floor((Date.now() - o.times[0]) / H)));
  $('slider').max = o.times.length - 1; $('slider').value = hour; $('slider').disabled = false;
  update();
}

const tempIndex = k => { const t = ocean.times[k], tt = ocean.temp.times; let best = 0; for (let i = 1; i < tt.length; i++) if (Math.abs(tt[i] - t) < Math.abs(tt[best] - t)) best = i; return best; };

function fieldSpec() {
  if (!ocean) return null;
  const k = hour;
  switch (settings.main) {
    case 'current': return { sample: S.current, k, n: 2, value: o => Math.hypot(o[0], o[1]), scale: SCALES.current, alpha: 204, eraseLand: true,
      arrows: o => { const s = Math.hypot(o[0], o[1]); return s < 0.01 ? { calm: true } : { dx: o[0] / s, dy: o[1] / s }; } };
    case 'level': return { sample: S.level, k, n: 1, value: o => o[0], scale: SCALES.level, alpha: 200, eraseLand: true };
    case 'temp': return { sample: S.temp, k: tempIndex(k), n: 1, value: o => o[0], scale: SCALES.temp, alpha: 200, eraseLand: true };
    case 'wind': return S.wind && { sample: S.wind, k, n: 3, value: o => Math.hypot(o[0], o[1]), scale: SCALES.wind, alpha: 140, eraseLand: false,
      arrows: o => { const s = Math.hypot(o[0], o[1]); return s < 2 ? { calm: true } : { dx: o[0] / s, dy: o[1] / s }; } };
    case 'wave': return S.wave && { sample: S.wave, k, n: 3, value: o => o[0], scale: SCALES.wave, alpha: 200, eraseLand: true,
      arrows: o => { const s = Math.hypot(o[1], o[2]); return s < 1e-6 ? null : { dx: o[1] / s, dy: o[2] / s }; } };
    default: return null;
  }
}

function drawLegend() {
  const L_ = LAYERS[settings.main], c = $('legendBar').getContext('2d'), sc = SCALES[settings.main];
  c.clearRect(0, 0, 256, 10);
  if (sc) for (let i = 0; i < 256; i++) { c.fillStyle = `rgb(${sc.lut[i * 3]},${sc.lut[i * 3 + 1]},${sc.lut[i * 3 + 2]})`; c.fillRect(i, 0, 1, 10); }
  else { const g = c.createLinearGradient(0, 0, 256, 0); ['#04006a', '#3a1e8a', '#9b2b85', '#e1574b', '#fbb33d', '#fcfdbf'].forEach((col, i, a) => g.addColorStop(i / (a.length - 1), col)); c.fillStyle = g; c.fillRect(0, 0, 256, 10); }
  $('legendName').textContent = L_.name;
  $('legendLo').textContent = sc ? L_.fmt(sc.lo) : '0';
  $('legendHi').textContent = (sc ? L_.fmt(sc.hi) : '12') + ' ' + L_.unit;
  $('legendNote').textContent = settings.main === 'temp' ? `alle ${TEMP_STEP_H} h` : settings.main === 'turbidity' ? turbDate() : (settings.main === 'wind' || settings.main === 'wave') && ocean && !weather ? 'Wetter fehlt' : '';
}

function updateStatus() {
  if (!ocean) return;
  const ageH = (Date.now() - ocean.fetchedAt) / H, left = (ocean.times.at(-1) - Date.now()) / H;
  let t = `Prognose vom ${fmtTime(ocean.fetchedAt)}`;
  if (left < 0) t += ' · abgelaufen, bitte neu laden';
  else if (newer) t += ' · neue Prognose verfügbar';
  else if (ageH > 24) t += ' · älter als 24 h';
  if (!weather) t += ' · ohne Wetter';
  $('status').textContent = t;
  $('btnLoad').classList.toggle('pulse', !!newer || left < 0);
}

function update() {
  if (!ocean) return;
  $('timeLabel').textContent = fmtTime(ocean.times[hour]);
  updateStatus();
  field.setSpec(fieldSpec());
  drawLegend();
  ranking = rankAll(allSpots(), S.current, hour, getWeather);
  drawSpots();
  const sh = $('sheet');
  if (!sh.hidden && sh.dataset.mode === 'list') openList(sh.dataset.tab);
  if (!sh.hidden && sh.dataset.mode === 'spot') openSpot(sh.dataset.id);
}

// weather for a spot: own Open-Meteo request if available, otherwise from the weather grid / Copernicus
function getWeather(s, k) {
  const ws = weather?.spots.find(x => x.id === s.id);
  if (ws && (ws.wind[k] || ws.marine[k])) return { w: ws.wind[k], m: ws.marine[k], src: 'spot' };
  const o = [0, 0, 0], w = {}, m = {};
  if (S.wind?.(k, s.lat, s.lon, o)) { w.wind_speed_10m = Math.hypot(o[0], o[1]); w.wind_direction_10m = (direction(o[0], o[1]) + 180) % 360; if (o[2] > -900) w.wind_gusts_10m = o[2]; }
  for (let d = 0; d <= 3000; d += 500) {  // shore spots: nearest wave value within 3 km
    if (S.wave?.(k, s.lat + d / 111320, s.lon, o) || S.wave?.(k, s.lat - d / 111320, s.lon, o)) { m.wave_height = o[0]; if (Math.hypot(o[1], o[2]) > 1e-6) m.wave_direction = (direction(o[1], o[2]) + 180) % 360; break; }
  }
  if (ocean && S.temp?.(tempIndex(k), s.lat, s.lon, o)) m.sea_surface_temperature = o[0];
  return { w: Object.keys(w).length ? w : null, m: Object.keys(m).length ? m : null, src: 'grid' };
}

// ---------------------------------------------------------------- spots on the map
const badge = (txt, c, extra = '') => L.divIcon({ className: 'spotIcon', iconSize: [30, 30], html: `<div class="badge ${c} ${extra}">${txt}</div>` });
const toggle = (layer, on) => on ? layer.addTo(map) : layer.remove();
function drawSpots() {
  spotLayer.clearLayers(); customLayer.clearLayers();
  const rs = ranking.length ? ranking : allSpots().map(s => ({ spot: s, score: null }));
  for (const r of rs) {
    const custom = String(r.spot.id).startsWith('c');
    L.marker([r.spot.lat, r.spot.lon], { icon: badge(r.score ?? '–', r.score == null ? 'b-low' : cls(r.score), custom ? 'custom' : ''), title: r.spot.name, zIndexOffset: r.score ?? 0 })
      .on('click', () => openSpot(r.spot.id)).addTo(custom ? customLayer : spotLayer);
  }
  toggle(spotLayer, settings.spots); toggle(customLayer, settings.custom);
}

function drawHome() {
  homeLayer.clearLayers();
  if (home) L.marker([home.lat, home.lon], { icon: L.divIcon({ className: 'homeIcon', html: '🏠', iconSize: [28, 28] }), title: 'Ferienhaus' })
    .on('click', () => sheet('home', 'Ferienhaus', `<p>${fmtNum(home.lat, 5)}, ${fmtNum(home.lon, 5)}</p>
      <div class="sheetBtns"><button id="homeDel" class="secondary">Entfernen</button></div>`, null, () => {
      $('homeDel').onclick = async () => { home = null; await store.save('home', null); drawHome(); $('sheet').hidden = true; if (ocean) update(); };
    }))
    .addTo(homeLayer);
}

function drawParking() {
  parkLayer.clearLayers();
  const icon = L.divIcon({ className: 'parkIcon', html: 'P', iconSize: [20, 20] });
  for (const p of parking.items) L.marker([p.lat, p.lon], { icon, title: p.name })
    .bindPopup(`<b>${esc(p.name)}</b><br>${p.coast} m zur Küste${p.capacity ? ` · ${esc(p.capacity)} Plätze` : ''}${p.fee === 'yes' ? ' · gebührenpflichtig' : ''}${p.surface ? ` · ${esc(p.surface)}` : ''}
      <br><a href="https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}" target="_blank" rel="noopener">Navigation</a>`).addTo(parkLayer);
  if (drawParking.vis) map.off('zoomend', drawParking.vis);
  drawParking.vis = () => toggle(parkLayer, settings.parking && map.getZoom() >= 11);
  map.on('zoomend', drawParking.vis); drawParking.vis();
}

function drawProtection() {
  protLayer.clearLayers();
  L.geoJSON(protection, { pane: 'protPane', style: { color: '#c62828', weight: 2, fillColor: '#e53935', fillOpacity: .28, dashArray: '4 3' },
    onEachFeature: (f, l) => l.bindPopup(`<b>Schutzgebiet: ${esc(f.properties.name)}</b><br>${SEASON_NOTE}<br><small>${esc(f.properties.ref)}</small><br><a href="${RULES_URL}" target="_blank" rel="noopener">Regeln (Länsstyrelsen)</a>`) }).addTo(protLayer);
  toggle(protLayer, settings.protection);
}

const turbDate = () => new Date(Date.now() - settings.turbDays * 86400000).toISOString().slice(0, 10);
function applyOverlays() {
  if (settings.satellite) { osm.remove(); satellite.addTo(map); } else { satellite.remove(); osm.addTo(map); }
  toggle(bathy, settings.bathy);
  turbidity?.remove(); turbidity = null;
  if (settings.main === 'turbidity') {
    turbidity = new CachedTiles(`https://wmts.marine.copernicus.eu/teroWmts/?service=WMTS&version=1.0.0&request=GetTile&format=image%2Fpng&layer=${TURB_LAYER}&tilematrixset=EPSG:3857&tilematrix={z}&tilerow={y}&tilecol={x}&time=${encodeURIComponent(turbDate())}&STYLE=${encodeURIComponent('cmap:thermal,range=0/12,noClamp')}`,
      { pane: 'depthPane', opacity: .88, maxNativeZoom: 10, maxZoom: 18, attribution: 'Copernicus Marine · Sentinel-2 TUR' }).addTo(map);
  }
  toggle(spotLayer, settings.spots); toggle(customLayer, settings.custom); toggle(protLayer, settings.protection);
  drawParking();
  field.setSpec(fieldSpec()); drawLegend();
}

// ---------------------------------------------------------------- bottom sheet
function sheet(mode, title, html, id, after) {
  const sh = $('sheet'); sh.dataset.mode = mode; sh.dataset.id = id ?? '';
  $('sheetTitle').textContent = title; $('sheetBody').innerHTML = html; sh.hidden = false;
  after?.();
}
$('sheetClose').onclick = () => { $('sheet').hidden = true; };

function openList(tab = 'now') {
  if (!ocean) return sheet('list', 'Top-Spots', '<p>Zuerst im WLAN „Prognose laden“.</p>');
  const tabs = `<div class="tabs"><button data-tab="now" class="${tab === 'now' ? 'on' : ''}">Zur gewählten Stunde</button><button data-tab="best" class="${tab === 'best' ? 'on' : ''}">Beste Zeit (24 h)</button></div>`;
  const row = (r, pre, k) => {
    const dist = home ? ` · ${km(hav([home.lat, home.lon], [r.spot.lat, r.spot.lon]))} vom Haus` : '';
    return `<div class="spotRow" data-id="${esc(r.spot.id)}" ${k != null ? `data-k="${k}"` : ''}><div class="badge ${cls(r.score)} ${String(r.spot.id).startsWith('c') ? 'custom' : ''}">${r.score}</div>
      <div><b>${esc(r.spot.name)}</b><div class="why">${pre}${esc(r.reasons.join(' · ') || 'keine Pluspunkte')}${dist}</div></div></div>`;
  };
  let rows;
  if (tab === 'best') {
    const k1 = Math.min(ocean.times.length - 1, hour + 24);
    rows = bestTimes(allSpots(), S.current, hour, k1, getWeather).map(r => row(r, `<b>${fmtHour(ocean.times[r.k])}</b> · `, r.k)).join('');
  } else rows = ranking.map(r => row(r, '')).join('');
  sheet('list', tab === 'best' ? `Beste Zeit ab ${fmtHour(ocean.times[hour])}` : `Top-Spots · ${fmtTime(ocean.times[hour])}`, tabs + rows +
    `<p class="note">Bewertung wie in der Original-App (v6.2.4). Strömung aus denselben Copernicus-Daten wie die Karte.${weather ? '' : ' Wetter fehlt – Prognose neu laden.'}</p>`);
  $('sheet').dataset.tab = tab;
  $('sheetBody').querySelectorAll('.tabs button').forEach(b => b.onclick = () => openList(b.dataset.tab));
  $('sheetBody').querySelectorAll('.spotRow').forEach(el => el.onclick = () => {
    const s = allSpots().find(x => String(x.id) === el.dataset.id);
    map.setView([s.lat, s.lon], 13);
    if (el.dataset.k) setHour(+el.dataset.k);
    openSpot(s.id);
  });
}
$('btnSpots').onclick = () => openList('now');

function nearby(sample, k, s, o) {
  for (let d = 150; d <= 1500; d += 150) for (let a = 0; a < 360; a += 30)
    if (sample?.(k, s.lat + d * Math.cos(a * Math.PI / 180) / 111320, s.lon + d * Math.sin(a * Math.PI / 180) / (111320 * Math.cos(s.lat * Math.PI / 180)), o)) return true;
  return false;
}
function protectionNear(s) {
  const f = protectionAt(protection, s.lat, s.lon); if (f) return { f, inside: true };
  for (const [dy, dx] of [[.003, 0], [-.003, 0], [0, .005], [0, -.005]]) { const g = protectionAt(protection, s.lat + dy, s.lon + dx); if (g) return { f: g, inside: false }; }
  return null;
}

function openSpot(id) {
  const r = ranking.find(x => String(x.spot.id) === String(id));
  const s = r?.spot ?? allSpots().find(x => String(x.id) === String(id)); if (!s) return;
  const custom = String(s.id).startsWith('c');
  const row = (k, v) => `<dt>${k}</dt><dd>${v}</dd>`;
  let facts = '';
  if (r) {
    const w = r.w, m = r.m, c = r.cur;
    facts += row('Wind', w?.wind_speed_10m != null ? `${Math.round(w.wind_speed_10m)} km/h${w.wind_direction_10m != null ? ` aus ${compass(w.wind_direction_10m)} · ${exposure(s, w.wind_direction_10m)}` : ''}${w.wind_gusts_10m != null ? ` · Böen ${Math.round(w.wind_gusts_10m)}` : ''}` : '–');
    facts += row('Welle', m?.wave_height != null ? `${fmtNum(m.wave_height, 1)} m${m.wave_direction != null ? ` aus ${compass(m.wave_direction)}` : ''}` : '–');
    facts += row('Wasser', m?.sea_surface_temperature != null ? `${fmtNum(m.sea_surface_temperature, 1)} °C` : '–');
    facts += row('Strömung', c ? `${fmtNum(c.v, 2)} m/s (${fmtNum(c.v * 1.944, 1)} kn) nach ${compass(c.dir)}${c.dist ? ` · Modellwert ${c.dist} m vor dem Spot` : ''}` : 'keine Modelldaten');
    facts += row('Kante', c ? `${fmtNum(c.edge, 3)} m/s Unterschied (${c.edgePoints}/5 Punkte)` : '–');
    const o = [0];
    if (S.level?.(hour, s.lat, s.lon, o) || nearby(S.level, hour, s, o)) facts += row('Wasserstand', `${o[0] > 0 ? '+' : ''}${fmtNum(o[0] * 100, 0)} cm`);
    if (r.src === 'grid') facts += row('Quelle', 'Wetter aus dem Raster (Spot nach dem Laden angelegt)');
  }
  if (s.structure) facts += row('Grund', esc(s.structure));
  if (s.note) facts += row('Notiz', esc(s.note));
  facts += row('Küste schaut', `nach ${compass(s.facing)} (${s.facing}°)`);
  if (home) facts += row('Vom Haus', km(hav([home.lat, home.lon], [s.lat, s.lon])) + ' Luftlinie');
  const prot = protectionNear(s);
  const protTxt = prot ? `<p class="warn">⚠ ${prot.inside ? 'Liegt im' : 'Nahe am'} Schutzgebiet „${esc(prot.f.properties.name)}“. ${SEASON_NOTE}</p>`
    : s.protected ? `<p class="note">⚠ Bach-/Flussmündung in der Nähe (${esc(s.protected)}): Schonbereiche und -zeiten beachten.</p>` : '';
  const btns = `<div class="sheetBtns"><a href="https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}" target="_blank" rel="noopener">Navigation</a>
    ${custom ? '<button id="spEdit" class="secondary">Bearbeiten</button><button id="spDel" class="secondary">Löschen</button>' : ''}</div>`;
  sheet('spot', `${s.name}${r ? ` · ${r.score}/100` : ''}`, `${r ? `<div class="why">${esc(r.reasons.join(' · ') || 'keine Pluspunkte')}</div>` : ''}
    <dl class="facts">${facts}</dl>${protTxt}${btns}
    <p class="note">${ocean ? fmtTime(ocean.times[hour]) + ' · ' : ''}Spotbewertung ${s.rating}/5${custom ? ' · eigener Spot' : ''}</p>`, s.id, () => {
    if (!custom) return;
    $('spEdit').onclick = () => editCustom(s);
    $('spDel').onclick = async () => { if (!confirm(`„${s.name}“ löschen?`)) return; customSpots = customSpots.filter(x => x.id !== s.id); await saveCustom(); $('sheet').hidden = true; };
  });
}

// ---------------------------------------------------------------- custom spots & home
let mode = null;  // 'add' | 'home'
function setMode(m, msg) { mode = m; $('modeHint').hidden = !m; $('modeHint').textContent = msg || ''; $('sheet').hidden = true; }
$('modeHint').onclick = () => setMode(null);

function autoFacing(lat, lon) {  // which way the coast faces: mean direction towards the water within 400 m
  let x = 0, y = 0;
  for (let a = 0; a < 360; a += 15) {
    const la = lat + 400 * Math.cos(a * Math.PI / 180) / 111320, lo = lon + 400 * Math.sin(a * Math.PI / 180) / (111320 * Math.cos(lat * Math.PI / 180));
    if (!ix().onLand(lo, la)) { x += Math.sin(a * Math.PI / 180); y += Math.cos(a * Math.PI / 180); }
  }
  return x || y ? (Math.round(((Math.atan2(x, y) * 180 / Math.PI) + 360) % 360 / 5) * 5) % 360 : 270;
}

function editCustom(s) {
  const dirs = [...new Set([0, 45, 90, 135, 180, 225, 270, 315, s.facing])].sort((a, b) => a - b);
  sheet('edit', s.name ? 'Spot bearbeiten' : 'Neuer Spot', `<form id="cf" class="form">
    <label>Name<input name="name" required value="${esc(s.name || '')}"></label>
    <label>Notiz<textarea name="note" rows="2">${esc(s.note || '')}</textarea></label>
    <div class="formRow"><label>Bewertung<select name="rating">${[1, 2, 3, 4, 5].map(r => `<option value="${r}"${r === s.rating ? ' selected' : ''}>${'★'.repeat(r)}</option>`).join('')}</select></label>
    <label>Küste schaut nach<select name="facing">${dirs.map(d => `<option value="${d}"${d === s.facing ? ' selected' : ''}>${compass(d)} (${d}°)</option>`).join('')}</select></label></div>
    <button>Speichern</button></form><p class="note">Die Blickrichtung der Küste ist aus der Küstenlinie geschätzt – bitte prüfen. Sie bestimmt „auflandig/ablandig“.</p>`, s.id, () => {
    $('cf').onsubmit = async e => {
      e.preventDefault(); const f = new FormData(e.target);
      Object.assign(s, { name: f.get('name').trim(), note: f.get('note').trim(), rating: +f.get('rating'), facing: +f.get('facing') });
      if (!customSpots.includes(s)) customSpots.push(s);
      await saveCustom(); openSpot(s.id);
    };
  });
}
async function saveCustom() { await store.save('custom', customSpots); if (ocean) update(); else drawSpots(); }

map.on('click', async e => {
  const { lat, lng } = e.latlng;
  if (mode === 'add') { setMode(null); editCustom({ id: 'c' + Date.now(), name: '', note: '', lat: +lat.toFixed(5), lon: +lng.toFixed(5), rating: 3, facing: autoFacing(lat, lng) }); return; }
  if (mode === 'home') { setMode(null); home = { lat, lon: lng }; await store.save('home', home); drawHome(); if (ocean) update(); return; }
  popupAt(e.latlng);
});

function popupAt(ll) {
  const o = [0, 0, 0], lines = [];
  if (ocean) {
    if (S.current(hour, ll.lat, ll.lng, o)) { const s = Math.hypot(o[0], o[1]); lines.push(`Strömung <b>${fmtNum(s, 2)} m/s</b> (${fmtNum(s * 1.944, 1)} kn) nach ${compass(direction(o[0], o[1]))}`); }
    if (S.level(hour, ll.lat, ll.lng, o)) lines.push(`Wasserstand <b>${o[0] > 0 ? '+' : ''}${fmtNum(o[0] * 100, 0)} cm</b>`);
    if (S.temp(tempIndex(hour), ll.lat, ll.lng, o)) lines.push(`Wasser <b>${fmtNum(o[0], 1)} °C</b>`);
    if (S.wave?.(hour, ll.lat, ll.lng, o)) lines.push(`Welle <b>${fmtNum(o[0], 1)} m</b>${Math.hypot(o[1], o[2]) > 1e-6 ? ` aus ${compass((direction(o[1], o[2]) + 180) % 360)}` : ''}`);
    if (S.wind?.(hour, ll.lat, ll.lng, o)) lines.push(`Wind <b>${Math.round(Math.hypot(o[0], o[1]))} km/h</b> aus ${compass((direction(o[0], o[1]) + 180) % 360)}${o[2] > -900 ? ` · Böen ${Math.round(o[2])}` : ''}`);
  }
  const p = protectionAt(protection, ll.lat, ll.lng);
  if (p) lines.push(`<span class="warnTxt">⚠ Schutzgebiet ${esc(p.properties.name)}</span>`);
  if (!lines.length) lines.push(ocean ? 'Keine Modelldaten an dieser Stelle' : 'Noch keine Prognose geladen');
  L.popup().setLatLng(ll).setContent(lines.join('<br>') + (ocean ? `<br><small>${fmtTime(ocean.times[hour])}</small>` : '')).openOn(map);
}

// ---------------------------------------------------------------- GPS
let watchId = null, meMarker = null, meCircle = null, lastWarn = 0, centered = false;
$('btnGps').onclick = () => {
  if (!navigator.geolocation) return alert('Standort ist auf diesem Gerät nicht verfügbar.');
  if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; gpsLayer.clearLayers(); meMarker = meCircle = null; $('btnGps').classList.remove('on'); $('gpsWarn').hidden = true; return; }
  $('btnGps').classList.add('on'); centered = false;
  watchId = navigator.geolocation.watchPosition(pos => {
    const p = [pos.coords.latitude, pos.coords.longitude];
    if (!meMarker) { meCircle = L.circle(p, { radius: pos.coords.accuracy, weight: 1, color: '#1565c0', fillOpacity: .12 }).addTo(gpsLayer); meMarker = L.circleMarker(p, { radius: 8, color: '#fff', weight: 2, fillColor: '#1565c0', fillOpacity: 1 }).addTo(gpsLayer); }
    else { meMarker.setLatLng(p); meCircle.setLatLng(p).setRadius(pos.coords.accuracy); }
    if (!centered) { centered = true; map.setView(p, Math.max(map.getZoom(), 13)); }
    const f = protectionAt(protection, p[0], p[1]);
    $('gpsWarn').hidden = !f;
    if (f) { $('gpsWarn').textContent = `⚠ Du bist im Schutzgebiet „${f.properties.name}“. ${SEASON_NOTE}`; if (Date.now() - lastWarn > 600000) { lastWarn = Date.now(); navigator.vibrate?.([300, 150, 300]); } }
  }, err => { alert('Standort nicht verfügbar: ' + err.message); $('btnGps').classList.remove('on'); watchId = null; }, { enableHighAccuracy: true, maximumAge: 10000 });
};

// ---------------------------------------------------------------- layers sheet
$('btnLayers').onclick = () => {
  const radio = k => `<label class="opt"><input type="radio" name="main" value="${k}" ${settings.main === k ? 'checked' : ''}> ${LAYERS[k].name}</label>`;
  const check = (k, t, sub = '') => `<label class="opt"><input type="checkbox" data-k="${k}" ${settings[k] ? 'checked' : ''}> ${t}${sub ? ` <small>${sub}</small>` : ''}</label>`;
  sheet('layers', 'Ebenen', `<h4>Karte zeigt</h4>${['current', 'wind', 'wave', 'temp', 'level', 'turbidity'].map(radio).join('')}
    <div id="turbOpts" ${settings.main === 'turbidity' ? '' : 'hidden'}><label class="opt">Satellitenbild vom <select id="turbDays">${[1, 2, 3, 4, 5, 6, 7, 10, 14].map(d => `<option value="${d}" ${d === settings.turbDays ? 'selected' : ''}>${new Date(Date.now() - d * 86400000).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })}</option>`).join('')}</select></label>
    <p class="note">Sentinel-2, nur bei wolkenfreiem Himmel; leer = keine Messung. Braucht Internet (angesehene Kacheln bleiben gespeichert).</p></div>
    <h4>Dazu</h4>${check('spots', 'Spots')}${check('custom', 'Eigene Spots')}${check('protection', 'Schutzgebiete (amtlich)', `Stand ${new Date(protection.fetchedAt).toLocaleDateString('de-DE')}`)}${check('parking', 'Parkplätze nahe der Küste', 'ab Zoom 11')}
    ${check('bathy', 'Wassertiefe (EMODnet)', 'braucht Internet')}${check('satellite', 'Satellitenkarte', 'braucht Internet')}
    <p class="note">Strömung, Wasserstand, Wassertemperatur, Wind und Welle funktionieren nach „Prognose laden“ offline.</p>`, null, () => {
    $('sheetBody').querySelectorAll('input[name=main]').forEach(i => i.onchange = () => { settings.main = i.value; $('turbOpts').hidden = i.value !== 'turbidity'; saveSettings(); });
    $('sheetBody').querySelectorAll('input[data-k]').forEach(i => i.onchange = () => { settings[i.dataset.k] = i.checked; saveSettings(); });
    $('turbDays').onchange = e => { settings.turbDays = +e.target.value; saveSettings(); };
  });
};
function saveSettings() { store.save('settings', settings).catch(() => {}); applyOverlays(); }

// ---------------------------------------------------------------- more sheet
$('btnMore').onclick = () => sheet('more', 'Mehr', `<div class="actions">
  <button id="mAdd">＋ Eigenen Spot setzen</button>
  <button id="mHome">🏠 ${home ? 'Ferienhaus versetzen' : 'Ferienhaus setzen'}</button>
  <a href="${RULES_URL}" target="_blank" rel="noopener">⚠ Regeln & Schonzeiten (Länsstyrelsen)</a>
  <a href="${HVMFS_URL}" target="_blank" rel="noopener">§ Vorschrift HVMFS 2023:11 (PDF)</a>
  <button id="mExport">⇩ Eigene Spots sichern</button>
  <label class="fileBtn">⇧ Sicherung einlesen<input id="mImport" type="file" accept="application/json,.json" hidden></label>
  <button id="mHow">ⓘ So funktioniert's</button>
  <button id="mInfo">⏱ Wann wird was geladen?</button>
  <button id="mSources">© Quellen & Lizenzen</button></div>
  <p class="note">Schutzgebiete: ${SEASON_NOTE} Rechtlich maßgeblich ist die Vorschrift, nicht diese Karte.</p>`, null, () => {
  $('mAdd').onclick = () => setMode('add', 'Tippe auf die Karte, wo dein Spot liegt · hier tippen zum Abbrechen');
  $('mHome').onclick = () => setMode('home', 'Tippe auf die Position des Ferienhauses · hier tippen zum Abbrechen');
  $('mExport').onclick = exportBackup; $('mImport').onchange = importBackup;
  $('mInfo').onclick = openInfo; $('mSources').onclick = openSources; $('mHow').onclick = openHow;
});

async function exportBackup() {
  const data = JSON.stringify({ app: 'gotland-sea-trout', version: 1, customSpots, home }, null, 2);
  const file = new File([data], 'gotland-sea-trout-spots.json', { type: 'application/json' });
  try { if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: 'Gotland Sea Trout – eigene Spots' }); return; } } catch (e) { if (e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
async function importBackup(e) {
  try {
    const d = JSON.parse(await e.target.files[0].text());
    const list = (d.customSpots || []).filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lon) && s.name);
    let added = 0;
    for (const s of list) if (!customSpots.some(x => x.id === s.id)) { customSpots.push({ rating: 3, facing: 270, ...s, id: String(s.id).startsWith('c') ? s.id : 'c' + s.id }); added++; }
    if (d.home && Number.isFinite(d.home.lat)) { home = d.home; await store.save('home', home); drawHome(); }
    await saveCustom(); alert(`${added} Spot(s) übernommen.`);
  } catch (err) { alert('Datei nicht lesbar: ' + err.message); }
}

function openInfo() {
  sheet('info', 'Wann wird was geladen?', `
  <p><b>Nur wenn du „Prognose laden“ drückst.</b> Die App lädt nie heimlich im Hintergrund. Danach läuft alles offline.</p>
  <dl class="facts">
    <dt>Strömung, Wasserstand</dt><dd>Copernicus, alle 15 min gerechnet; die App nimmt jede volle Stunde · ~84 MB</dd>
    <dt>Wassertemperatur</dt><dd>Copernicus, alle ${TEMP_STEP_H} h (ändert sich langsam) · ~7 MB</dd>
    <dt>Wind, Welle</dt><dd>Open-Meteo, stündlich, Raster + jeder Spot · ~2 MB</dd>
    <dt>Schutzgebiete</dt><dd>Länsstyrelsen, bei jedem Laden aufgefrischt</dd>
    <dt>Küste, Spots, Parkplätze</dt><dd>stecken in der App, brauchen kein Internet</dd>
    <dt>Kartenbild, Tiefe, Satellit, Trübung</dt><dd>nur online; was du angesehen hast, bleibt gespeichert</dd>
  </dl>
  <p><b>Warum nicht jede Minute laden?</b> Die Daten ändern sich nicht so oft:</p>
  <ul>
    <li>Copernicus rechnet die Ostsee-Prognose <b>zweimal am Tag</b> neu (Lauf 00 UTC: 10 Tage voraus, Lauf 12 UTC: 6 Tage). Zwischen zwei Läufen kommt Minute für Minute exakt dasselbe heraus.</li>
    <li>Die Wettermodelle hinter Open-Meteo werden alle paar Stunden neu gerechnet.</li>
    <li>Jedes Neuladen kostet rund 90 MB und Akku – am Strand im Mobilnetz unnötig.</li>
    <li>Die Zeit läuft trotzdem mit: Beim Öffnen springt die App automatisch zur aktuellen Stunde der gespeicherten Prognose.</li>
  </ul>
  <p><b>Empfehlung:</b> morgens im WLAN laden (frischer Nachtlauf), bei Bedarf abends noch einmal. Die App prüft beim Start mit wenigen Bytes, ob Copernicus einen neueren Lauf hat, und zeigt das oben an. Älter als 24 h wird markiert, nach 72 h ist die Prognose abgelaufen.</p>
  ${ocean ? `<p class="note">Datensatz: ${esc(ocean.datasets?.cur)}${ocean.datasets?.retires ? ` (wird bei Copernicus am ${new Date(ocean.datasets.retires).toLocaleDateString('de-DE')} abgeschaltet – die App wechselt dann automatisch auf die neue Version)` : ''}</p>` : ''}`);
}
function openHow() { sheet('how', "So funktioniert's", HOW_HTML); }
function openSources() {
  sheet('sources', 'Quellen & Lizenzen', `<ul class="src">
  <li><b>Strömung, Wasserstand, Wassertemperatur:</b> E.U. Copernicus Marine Service, BALTICSEA_ANALYSISFORECAST_PHY_003_006</li>
  <li><b>Trübung:</b> Copernicus Marine, OCEANCOLOUR_BAL_BGC_HR_L3_NRT_009_202 (Sentinel-2)</li>
  <li><b>Wind, Welle:</b> Open-Meteo.com (CC BY 4.0)</li>
  <li><b>Karte, Küste, Parkplätze:</b> © OpenStreetMap contributors (ODbL)</li>
  <li><b>Schutzgebiete:</b> Länsstyrelsen, Svenska fiskeregler</li>
  <li><b>Wassertiefe:</b> EMODnet Bathymetry · <b>Satellitenkarte:</b> Esri World Imagery</li>
  <li><b>Spots & Bewertung:</b> Gotland Sea Trout v6.2.4 (Omssen)</li></ul>
  <p class="note">Modellprognosen, keine Messungen. Kein Ersatz für Seekarte, Wetterwarnung oder geltende Vorschriften.</p>`);
}

// ---------------------------------------------------------------- timeline
function setHour(k) { hour = k; $('slider').value = k; update(); }
$('slider').addEventListener('input', e => { setHour(+e.target.value); map.closePopup(); });
let timer = null;
$('btnPlay').addEventListener('click', () => {
  if (timer) { clearInterval(timer); timer = null; $('btnPlay').textContent = '▶'; return; }
  if (!ocean) return;
  $('btnPlay').textContent = '❚❚';
  timer = setInterval(() => setHour((hour + 1) % ocean.times.length), 700);
});

// ---------------------------------------------------------------- download
$('btnLoad').addEventListener('click', async () => {
  const btn = $('btnLoad'); btn.disabled = true;
  $('progress').hidden = false; $('bar').style.width = '0';
  const msg = t => { $('progressText').textContent = t; };
  try {
    const o = await downloadOcean((d, n, b) => { $('bar').style.width = (90 * d / n) + '%'; msg(`Meer-Prognose ${Math.round(100 * d / n)} % · ${fmtNum(b / 1e6, 1)} MB`); });
    msg('Wind & Welle …');
    let w = null, wErr = '';
    try { w = await downloadWeather(allSpots(), o.times, (lat, lon) => ix().onLand(lon, lat)); } catch (e) { wErr = e.message; }
    msg('Schutzgebiete …');
    try { const p = await fetchProtection(); protection = p; await store.save('protection', p); drawProtection(); } catch { /* keep bundled/stored */ }
    msg('Speichere …');
    await store.save('ocean', o); if (w) await store.save('weather', w);
    newer = null; await show(o, w);
    $('bar').style.width = '100%';
    msg(`Fertig: ${o.times.length} Stunden · ${fmtNum(o.bytes / 1e6, 0)} MB` + (wErr ? ` · Wetter fehlgeschlagen (${wErr})` : ''));
    setTimeout(() => { $('progress').hidden = true; }, wErr ? 6000 : 2500);
  } catch (err) {
    msg('Fehler: ' + err.message + ' – Internet prüfen und erneut versuchen.');
  } finally { btn.disabled = false; }
});

// ---------------------------------------------------------------- start: everything from the phone's storage
try {
  const [o, w, st, cs, hm, pr] = await Promise.all(['ocean', 'weather', 'settings', 'custom', 'home', 'protection'].map(k => store.load(k).catch(() => null)));
  if (st) settings = { ...settings, ...st };
  if (Array.isArray(cs)) customSpots = cs;
  if (hm) home = hm;
  if (pr?.features?.length && Date.parse(pr.fetchedAt) > Date.parse(protection.fetchedAt)) protection = pr;
  drawHome(); drawProtection(); applyOverlays();
  if (o?.version === 2) await show(o, w);
  else { drawSpots(); $('status').textContent = 'Noch keine Prognose. Im WLAN „Prognose laden“ drücken.'; $('btnLoad').classList.add('pulse'); }
  if (o?.version === 2 && navigator.onLine) newerRunAvailable(o.fetchedAt).then(n => { newer = n; updateStatus(); });
} catch (e) { $('status').textContent = 'Fehler beim Start: ' + e.message; console.error(e); }
setInterval(() => ocean && updateStatus(), 60000);
initIntro({
  coast, fishSvg: await fetch('icon.svg').then(r => r.text()).catch(() => '🐟'),
  getTopTwo: () => ranking.slice(0, 2).map(r => ({ id: r.spot.id, name: r.spot.name, score: r.score })),
  openSpot: id => { const s = allSpots().find(x => String(x.id) === String(id)); if (s) { map.setView([s.lat, s.lon], 13); openSpot(id); } },
  showHow: openHow, soundOn: () => settings.sound !== false, setSound: on => { settings.sound = on; store.save('settings', settings).catch(() => {}); },
});
