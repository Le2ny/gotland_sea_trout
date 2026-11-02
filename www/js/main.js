import { downloadForecast } from './copernicus.js';
import { createCurrentLayer } from './currentLayer.js';
import { makeSampler, direction, compass } from './field.js';
import * as store from './store.js';

const $ = id => document.getElementById(id);
const fmtTime = ms => new Date(ms).toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const fmtNum = (x, d = 2) => x.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });

const [palette, coast] = await Promise.all([
  fetch('data/palette.json').then(r => r.json()),
  fetch('data/coast.json').then(r => r.json()),
]);

// legend
{ const c = $('legendBar').getContext('2d'); palette.colors.forEach((col, i) => { c.fillStyle = `rgb(${col})`; c.fillRect(i * 120 / 256, 0, 1, 10); }); }

const map = L.map('map', { zoomControl: false, attributionControl: true }).setView([57.45, 18.6], 9);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 16, attribution: '© OpenStreetMap · Strömung: Copernicus Marine Service',
}).addTo(map);
const CurrentLayer = createCurrentLayer(L, palette, coast);
const layer = new CurrentLayer().addTo(map);
window.__map = map; window.__layer = layer; // for tests

let forecast = null, hour = 0, sampler = null;

function show(f) {
  forecast = f; sampler = makeSampler(f);
  const now = Date.now();
  hour = Math.max(0, Math.min(f.times.length - 1, Math.floor((now - f.times[0]) / 3600000)));
  $('slider').max = f.times.length - 1; $('slider').value = hour; $('slider').disabled = false;
  layer.setData(f, hour);
  updateLabels();
}

function updateLabels() {
  if (!forecast) return;
  $('timeLabel').textContent = fmtTime(forecast.times[hour]);
  const ageH = (Date.now() - forecast.fetchedAt) / 3600000;
  const left = (forecast.times.at(-1) - Date.now()) / 3600000;
  $('status').textContent = `Prognose geladen ${fmtTime(forecast.fetchedAt)}` +
    (left < 0 ? ' · abgelaufen, bitte neu laden' : ageH > 12 ? ' · älter als 12 h, neu laden empfohlen' : '');
}

$('slider').addEventListener('input', e => { hour = +e.target.value; layer.setHour(hour); updateLabels(); map.closePopup(); });

let timer = null;
$('btnPlay').addEventListener('click', () => {
  if (timer) { clearInterval(timer); timer = null; $('btnPlay').textContent = '▶'; return; }
  if (!forecast) return;
  $('btnPlay').textContent = '❚❚';
  timer = setInterval(() => {
    hour = (hour + 1) % forecast.times.length;
    $('slider').value = hour; layer.setHour(hour); updateLabels();
  }, 700);
});

map.on('click', e => {
  if (!forecast) return;
  const uv = [0, 0];
  const txt = sampler(hour, e.latlng.lat, e.latlng.lng, uv)
    ? (() => { const s = Math.hypot(...uv), d = direction(...uv);
        return `<b>${fmtNum(s, 2)} m/s</b> (${fmtNum(s * 1.944, 1)} kn)<br>fließt nach ${compass(d)} (${Math.round(d)}°)`; })()
    : 'Keine Modelldaten an dieser Stelle';
  L.popup().setLatLng(e.latlng).setContent(`${txt}<br><small>${fmtTime(forecast.times[hour])}</small>`).openOn(map);
});

$('btnLoad').addEventListener('click', async () => {
  const btn = $('btnLoad'); btn.disabled = true;
  $('progress').hidden = false; $('bar').style.width = '0';
  try {
    const f = await downloadForecast((d, n, b) => {
      $('bar').style.width = (100 * d / n) + '%';
      $('progressText').textContent = `${Math.round(100 * d / n)} % · ${fmtNum(b / 1e6, 1)} MB`;
    });
    $('progressText').textContent = 'Speichere …';
    await store.save('forecast', f);
    show(f);
    $('progressText').textContent = `Fertig: ${f.times.length} Stunden, ${fmtNum(f.bytes / 1e6, 1)} MB`;
    setTimeout(() => { $('progress').hidden = true; }, 2500);
  } catch (err) {
    $('progressText').textContent = 'Fehler: ' + err.message + ' – Internet prüfen und erneut versuchen.';
  } finally { btn.disabled = false; }
});

try {
  const f = await store.load('forecast');
  if (f) show(f); else $('status').textContent = 'Noch keine Prognose. Im WLAN „Prognose laden“ drücken.';
} catch (e) { $('status').textContent = 'Speicher nicht lesbar: ' + e.message; }
setInterval(updateLabels, 60000);
