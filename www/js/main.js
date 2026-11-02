import { downloadForecast } from './copernicus.js';
import { createCurrentLayer } from './currentLayer.js';
import { makeSampler, direction, compass } from './field.js';
import { createCoastBackground, createCachedTileLayer } from './basemap.js';
import { downloadWeather } from './weather.js';
import { rankAll, exposure } from './ranking.js';
import * as store from './store.js';

const $ = id => document.getElementById(id);
const introShownAt = performance.now();

// Web version (iPhone/Android browser): service worker so the app itself starts offline.
// Not needed inside the Android APK, where all files are bundled.
if ('serviceWorker' in navigator && !window.Capacitor?.isNativePlatform?.() && (location.protocol === 'https:' || location.hostname === 'localhost'))
  navigator.serviceWorker.register('sw.js').catch(e => console.warn('Service Worker:', e.message));
const fmtTime = ms => new Date(ms).toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const fmtNum = (x, d = 2) => x.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const cls = sc => sc >= 75 ? 'b-good' : sc >= 60 ? 'b-mid' : 'b-low';

const [palette, coast, barriers, spots] = await Promise.all(
  ['palette', 'coast', 'barriers', 'spots'].map(n => fetch(`data/${n}.json`).then(r => r.json())));

// legend
{ const c = $('legendBar').getContext('2d'); palette.colors.forEach((col, i) => { c.fillStyle = `rgb(${col})`; c.fillRect(i, 0, 1, 10); }); }

// --- map
const map = L.map('map', { zoomControl: false }).setView([57.45, 18.6], 9);
new (createCoastBackground(L, coast))().addTo(map);
new (createCachedTileLayer(L))('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 17, maxNativeZoom: 19, attribution: '© OpenStreetMap · Strömung © Copernicus Marine Service · Wetter Open-Meteo',
}).addTo(map);
const layer = new (createCurrentLayer(L, palette, coast))().addTo(map);
const spotLayer = L.layerGroup().addTo(map);
window.__map = map; window.__layer = layer; // for tests

// --- state
let forecast = null, weather = null, hour = 0, sampler = null, ranking = [];

function show(f, w) {
  forecast = f; weather = w && w.times.length === f.times.length && w.times[0] === f.times[0] ? w : null;
  sampler = makeSampler(f, barriers);
  hour = Math.max(0, Math.min(f.times.length - 1, Math.floor((Date.now() - f.times[0]) / 3600000)));
  $('slider').max = f.times.length - 1; $('slider').value = hour; $('slider').disabled = false;
  layer.setData(f, hour, sampler);
  update();
}

function setHour(k) { hour = k; $('slider').value = k; layer.setHour(k); update(); }

function updateStatus() {
  const ageH = (Date.now() - forecast.fetchedAt) / 3600000, left = (forecast.times.at(-1) - Date.now()) / 3600000;
  $('status').textContent = `Prognose vom ${fmtTime(forecast.fetchedAt)}` +
    (left < 0 ? ' · abgelaufen, bitte neu laden' : ageH > 12 ? ' · älter als 12 h' : '') +
    (weather ? '' : ' · ohne Wetter');
}

function update() {
  if (!forecast) return;
  $('timeLabel').textContent = fmtTime(forecast.times[hour]);
  updateStatus();
  ranking = rankAll(spots, sampler, hour, weather);
  drawSpots();
  if (!$('sheet').hidden && $('sheet').dataset.mode === 'list') openList();
  if (!$('sheet').hidden && $('sheet').dataset.mode === 'spot') openSpot(+$('sheet').dataset.id);
}

function drawSpots() {
  spotLayer.clearLayers();
  for (const r of ranking) {
    const icon = L.divIcon({ className: 'spotIcon', iconSize: [30, 30], html: `<div class="badge ${cls(r.score)}">${r.score}</div>` });
    L.marker([r.spot.lat, r.spot.lon], { icon, title: r.spot.name, zIndexOffset: r.score })
      .on('click', () => openSpot(r.spot.id)).addTo(spotLayer);
  }
}

// --- bottom sheet
function sheet(mode, title, html, id) {
  $('sheet').dataset.mode = mode; $('sheet').dataset.id = id ?? '';
  $('sheetTitle').textContent = title; $('sheetBody').innerHTML = html; $('sheet').hidden = false;
}
$('sheetClose').onclick = () => { $('sheet').hidden = true; };

function openList() {
  if (!forecast) return sheet('list', 'Top-Spots', '<p>Zuerst „Prognose laden“.</p>');
  const rows = ranking.map(r => `<div class="spotRow" data-id="${r.spot.id}"><div class="badge ${cls(r.score)}">${r.score}</div>
    <div><b>${esc(r.spot.name)}</b><div class="why">${esc(r.reasons.join(' · ') || 'keine Pluspunkte')}</div></div></div>`).join('');
  sheet('list', `Top-Spots · ${fmtTime(forecast.times[hour])}`, rows +
    `<p class="note">Bewertung wie in der Original-App (v6.2.4). Strömung aus denselben Copernicus-Daten wie die Karte.${weather ? '' : ' Wetterdaten fehlen – Prognose neu laden.'}</p>`);
  $('sheetBody').querySelectorAll('.spotRow').forEach(el => el.onclick = () => {
    const s = spots.find(x => x.id === +el.dataset.id); map.setView([s.lat, s.lon], 13); openSpot(s.id);
  });
}
$('btnSpots').onclick = openList;

function openSpot(id) {
  const r = ranking.find(x => x.spot.id === id); if (!r) return;
  const s = r.spot, w = r.w, m = r.m, c = r.cur;
  const row = (k, v) => `<dt>${k}</dt><dd>${v}</dd>`;
  let facts = '';
  facts += row('Wind', w?.wind_speed_10m != null ? `${Math.round(w.wind_speed_10m)} km/h${w.wind_direction_10m != null ? ` aus ${compass(w.wind_direction_10m)} · ${exposure(s, w.wind_direction_10m)}` : ''}${w.wind_gusts_10m != null ? ` · Böen ${Math.round(w.wind_gusts_10m)}` : ''}` : '–');
  facts += row('Welle', m?.wave_height != null ? `${fmtNum(m.wave_height, 1)} m` : '–');
  facts += row('Wasser', m?.sea_surface_temperature != null ? `${fmtNum(m.sea_surface_temperature, 1)} °C` : '–');
  facts += row('Strömung', c ? `${fmtNum(c.v, 2)} m/s (${fmtNum(c.v * 1.944, 1)} kn) nach ${compass(c.dir)}${c.dist ? ` · Modellwert ${c.dist} m vor dem Spot` : ''}` : 'keine Modelldaten');
  facts += row('Kante', c ? `${fmtNum(c.edge, 3)} m/s Unterschied (${c.edgePoints}/5 Punkte)` : '–');
  facts += row('Grund', esc(s.structure));
  facts += row('Küste schaut', `nach ${compass(s.facing)} (${s.facing}°)`);
  const prot = s.protected ? `<p class="note">⚠ Bach-/Flussmündung in der Nähe (${esc(s.protected)}): Schonbereiche und -zeiten beachten.</p>` : '';
  sheet('spot', `${s.name} · ${r.score}/100`, `
    <div class="why">${esc(r.reasons.join(' · ') || 'keine Pluspunkte')}</div>
    <dl class="facts">${facts}</dl>${prot}
    <div class="sheetBtns"><a href="https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}" target="_blank" rel="noopener">Navigation</a></div>
    <p class="note">${fmtTime(forecast.times[hour])} · Spotbewertung ${s.rating}/5</p>`, id);
}

// --- timeline
$('slider').addEventListener('input', e => { setHour(+e.target.value); map.closePopup(); });
let timer = null;
$('btnPlay').addEventListener('click', () => {
  if (timer) { clearInterval(timer); timer = null; $('btnPlay').textContent = '▶'; return; }
  if (!forecast) return;
  $('btnPlay').textContent = '❚❚';
  timer = setInterval(() => setHour((hour + 1) % forecast.times.length), 700);
});

// --- tap on water: current at that point
map.on('click', e => {
  if (!forecast) return;
  const uv = [0, 0];
  const txt = sampler(hour, e.latlng.lat, e.latlng.lng, uv)
    ? (() => { const s = Math.hypot(...uv), d = direction(...uv);
        return `<b>${fmtNum(s, 2)} m/s</b> (${fmtNum(s * 1.944, 1)} kn)<br>fließt nach ${compass(d)} (${Math.round(d)}°)`; })()
    : 'Keine Modelldaten an dieser Stelle';
  L.popup().setLatLng(e.latlng).setContent(`${txt}<br><small>${fmtTime(forecast.times[hour])}</small>`).openOn(map);
});

// --- download
$('btnLoad').addEventListener('click', async () => {
  const btn = $('btnLoad'); btn.disabled = true;
  $('progress').hidden = false; $('bar').style.width = '0';
  try {
    const f = await downloadForecast((d, n, b) => {
      $('bar').style.width = (95 * d / n) + '%';
      $('progressText').textContent = `Strömung ${Math.round(100 * d / n)} % · ${fmtNum(b / 1e6, 1)} MB`;
    });
    $('progressText').textContent = 'Wetter für die Spots …';
    let w = null, wErr = '';
    try { w = await downloadWeather(spots, f.times); } catch (e) { wErr = e.message; }
    $('progressText').textContent = 'Speichere …';
    await store.save('forecast', f);
    if (w) await store.save('weather', w);
    show(f, w);
    $('bar').style.width = '100%';
    $('progressText').textContent = `Fertig: ${f.times.length} Stunden, ${fmtNum(f.bytes / 1e6, 1)} MB` + (wErr ? ` · Wetter fehlgeschlagen (${wErr})` : '');
    setTimeout(() => { $('progress').hidden = true; }, wErr ? 6000 : 2500);
  } catch (err) {
    $('progressText').textContent = 'Fehler: ' + err.message + ' – Internet prüfen und erneut versuchen.';
  } finally { btn.disabled = false; }
});

// --- start: use what is stored on the phone
try {
  const [f, w] = await Promise.all([store.load('forecast'), store.load('weather')]);
  if (f) show(f, w); else {
    $('status').textContent = 'Noch keine Prognose. Im WLAN „Prognose laden“ drücken.';
    for (const s of spots) L.marker([s.lat, s.lon], { title: s.name, icon: L.divIcon({ className: 'spotIcon', iconSize: [30, 30], html: '<div class="badge b-low">–</div>' }) }).addTo(spotLayer);
  }
} catch (e) { $('status').textContent = 'Speicher nicht lesbar: ' + e.message; }
setInterval(() => forecast && updateStatus(), 60000);
setTimeout(() => { $('intro').classList.add('gone'); setTimeout(() => $('intro').remove(), 700); }, Math.max(0, 1400 - (performance.now() - introShownAt)));
