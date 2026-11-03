// Spot ranking. scoreDetailed() is taken unchanged from the original app (v6.2.4).
// Difference: current speed/direction/edge now come from the same Copernicus data
// as the map (no separate 130 point requests, no silent fallback to another model).
import { direction } from './field.js';

export function angleDiff(a, b) { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); }
export function exposure(s, d) {
  if (d == null) return '–';
  const x = angleDiff(s.facing, d);
  return x <= 35 ? 'auflandig' : x <= 80 ? 'schräg auflandig' : x <= 120 ? 'seitlich' : 'ablandig';
}

// --- original scoring (unchanged logic)
export const MODEL_VERSION = 'GST-Heuristik v6.2.4 (unverändert, nicht validiert)';
/** original scoring, unchanged in logic; additionally returns the points per factor (parts) for transparency */
export function scoreDetailed(w, m, s, currentCtx = null) {
  let n = 28 + s.rating * 5; const reasons = [], parts = [{ label: `Grundwert + Spotbewertung ${s.rating}★`, pts: n }];
  const add = (pts, label, reason = true) => { n += pts; parts.push({ label, pts }); if (reason && pts > 0) reasons.push(label); };
  if (w?.wind_speed_10m >= 8 && w.wind_speed_10m <= 26) add(10, 'brauchbarer Wind');
  if (w?.wind_direction_10m != null) { const d = angleDiff(s.facing, w.wind_direction_10m); if (d <= 75) add(9, 'Wind zur Küste passend'); else if (d > 150) add(-7, 'ablandiger Wind', false); }
  if (m?.wave_height >= .2 && m.wave_height <= 1.05) add(10, 'passende Welle');
  if (m?.sea_surface_temperature >= 4 && m.sea_surface_temperature <= 14) add(8, 'passende Wassertemperatur');
  const cv = currentCtx?.v ?? m?.ocean_current_velocity, cd = currentCtx?.dir ?? m?.ocean_current_direction;
  if (cv != null) {
    if (cv >= .12 && cv <= .65) add(13, 'leichte–mäßige Strömung');
    else if (cv > .65 && cv <= .9) add(7, 'deutliche Strömung');
    else if (cv < .05) add(-4, 'kaum Strömung', false);
    if (cd != null) { const rel = angleDiff(s.facing, cd); if (rel >= 50 && rel <= 130) add(9, 'Strömung längs/schräg zur Küste'); else if (rel > 145) add(3, 'Strömung auflandig', false); }
    if (currentCtx?.edge >= .06) add(12, 'Strömungskante im Umfeld');
  }
  const raw = Math.round(n);
  return { score: Math.max(0, Math.min(100, raw)), raw, reasons, parts };
}

// --- current context from the Copernicus field
const OFFS = [[0, 0], [.006, 0], [-.006, 0], [0, .010], [0, -.010]];  // same 5 positions as the original

/** Value at the spot; if the spot itself (on the shoreline) has no model support,
 *  the nearest supported point within 2 km is used and its distance reported. */
function nearestSupported(sample, k, s, uv) {
  if (sample(k, s.lat, s.lon, uv)) return { lat: s.lat, lon: s.lon, dist: 0 };
  const mPerLat = 111320, mPerLon = 111320 * Math.cos(s.lat * Math.PI / 180);
  for (let d = 150; d <= 2000; d += 150) for (let a = 0; a < 360; a += 15) {
    const lat = s.lat + d * Math.cos(a * Math.PI / 180) / mPerLat, lon = s.lon + d * Math.sin(a * Math.PI / 180) / mPerLon;
    if (sample(k, lat, lon, uv)) return { lat, lon, dist: d };
  }
  return null;
}

export function currentContext(sample, k, s) {
  const uv = [0, 0], at = nearestSupported(sample, k, s, uv);
  if (!at) return null;
  const v = Math.hypot(uv[0], uv[1]), dir = direction(uv[0], uv[1]);
  const vals = [];
  for (const [dy, dx] of OFFS) if (sample(k, s.lat + dy, s.lon + dx, uv)) vals.push(Math.hypot(uv[0], uv[1]));
  return { v, dir, dist: at.dist, edge: vals.length ? Math.max(...vals) - Math.min(...vals) : 0, edgePoints: vals.length };
}

/** getWeather(spot, k) → { w, m } in the units of the original app (wind km/h, waves m, SST °C) */
export function rankAll(spots, sample, k, getWeather) {
  return spots.map(s => {
    const { w = null, m = null, src = null } = getWeather ? getWeather(s, k) || {} : {};
    const cur = sample ? currentContext(sample, k, s) : null;
    return { spot: s, w, m, src, cur, ...scoreDetailed(w, m, s, cur) };
  }).sort((a, b) => b.score - a.score);
}

/** best hour per spot within [k0, k1] */
export function bestTimes(spots, sample, k0, k1, getWeather) {
  const best = new Map();
  for (let k = k0; k <= k1; k++) for (const r of rankAll(spots, sample, k, getWeather)) {
    const b = best.get(r.spot.id);
    if (!b || r.score > b.score) best.set(r.spot.id, { ...r, k });
  }
  return [...best.values()].sort((a, b) => b.score - a.score || a.k - b.k);
}
