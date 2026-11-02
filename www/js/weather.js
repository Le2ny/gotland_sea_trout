// Open-Meteo, all locations per request (the API accepts comma-separated coordinate lists):
// - per spot: wind (km/h), gusts, waves, water temperature – same variables/units as the original app
// - a regular grid over Gotland for the wind and wave maps
import { NODATA } from './field.js';

const WIND = 'wind_speed_10m,wind_direction_10m,wind_gusts_10m';
const MARINE = 'wave_height,wave_direction,sea_surface_temperature';
export const WGRID = { south: 56.6, north: 58.3, west: 17.4, east: 20.1, dlat: 0.1, dlon: 0.15 };

async function json(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error('Open-Meteo HTTP ' + r.status);
  return r.json();
}
const iso = ms => new Date(ms).toISOString().slice(0, 16);
const range = times => `&start_hour=${iso(times[0])}&end_hour=${iso(times.at(-1))}&timezone=GMT&timeformat=unixtime`;
const asArr = d => Array.isArray(d) ? d : [d];

async function batch(points, times, kind) {
  const out = [];
  for (let i = 0; i < points.length; i += 200) {
    const p = points.slice(i, i + 200);
    const lats = p.map(x => x.lat.toFixed(4)).join(','), lons = p.map(x => x.lon.toFixed(4)).join(',');
    const url = kind === 'wind'
      ? `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&hourly=${WIND}&wind_speed_unit=kmh${range(times)}`
      : `https://marine-api.open-meteo.com/v1/marine?latitude=${lats}&longitude=${lons}&hourly=${MARINE}&cell_selection=sea${range(times)}`;
    const d = asArr(await json(url));
    if (d.length !== p.length) throw new Error('Open-Meteo: unvollständige Antwort');
    out.push(...d);
  }
  return out;
}

const pick = (d, vars, times) => times.map(t => {
  const i = d.hourly.time.indexOf(t / 1000);
  if (i < 0) return null;
  const o = {};
  for (const v of vars.split(',')) { const x = d.hourly[v]?.[i]; if (Number.isFinite(x)) o[v] = x; }
  return o;
});

/** spots: [{id,lat,lon}], times: UTC ms (full hours), isLand(lat,lon) for the wave grid */
export async function downloadWeather(spots, times, isLand) {
  // grid
  const glat = [], glon = [];
  for (let y = WGRID.south; y <= WGRID.north + 1e-9; y += WGRID.dlat) glat.push(+y.toFixed(4));
  for (let x = WGRID.west; x <= WGRID.east + 1e-9; x += WGRID.dlon) glon.push(+x.toFixed(4));
  const gpts = [];
  for (const lat of glat) for (const lon of glon) gpts.push({ lat, lon });
  const seaPts = gpts.map((p, i) => ({ ...p, i })).filter(p => !isLand(p.lat, p.lon));

  const [ws, ms, gw, gm] = await Promise.all([
    batch(spots, times, 'wind'), batch(spots, times, 'marine'), batch(gpts, times, 'wind'), batch(seaPts, times, 'marine'),
  ]);

  const plane = glat.length * glon.length, n = times.length;
  const wu = new Float32Array(n * plane).fill(NODATA), wv = new Float32Array(n * plane).fill(NODATA), gust = new Float32Array(n * plane).fill(NODATA);
  const wh = new Float32Array(n * plane).fill(NODATA), wdu = new Float32Array(n * plane).fill(NODATA), wdv = new Float32Array(n * plane).fill(NODATA);
  gw.forEach((d, i) => pick(d, WIND, times).forEach((o, k) => {
    if (!o || o.wind_speed_10m == null || o.wind_direction_10m == null) return;
    const a = o.wind_direction_10m * Math.PI / 180, s = o.wind_speed_10m;  // direction = "from"
    wu[k * plane + i] = -s * Math.sin(a); wv[k * plane + i] = -s * Math.cos(a);
    if (o.wind_gusts_10m != null) gust[k * plane + i] = o.wind_gusts_10m;
  }));
  gm.forEach((d, j) => pick(d, MARINE, times).forEach((o, k) => {
    if (!o || o.wave_height == null) return;
    const i = seaPts[j].i;
    wh[k * plane + i] = o.wave_height;
    if (o.wave_direction != null) { const a = o.wave_direction * Math.PI / 180; wdu[k * plane + i] = -Math.sin(a); wdv[k * plane + i] = -Math.cos(a); }
    else { wdu[k * plane + i] = 0; wdv[k * plane + i] = 0; }
  }));

  return {
    version: 2, fetchedAt: Date.now(), times,
    spots: spots.map((s, k) => ({ id: s.id, wind: pick(ws[k], WIND, times), marine: pick(ms[k], MARINE, times) })),
    grid: { nr: glat.length, nc: glon.length, lat: glat, lon: glon }, wu, wv, gust, wh, wdu, wdv,
  };
}
