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
export function scoreDetailed(w, m, s, currentCtx = null) {
  let n = 28 + s.rating * 5, reasons = [];
  if (w?.wind_speed_10m >= 8 && w.wind_speed_10m <= 26) { n += 10; reasons.push('brauchbarer Wind'); }
  if (w?.wind_direction_10m != null) { const d = angleDiff(s.facing, w.wind_direction_10m); if (d <= 75) { n += 9; reasons.push('Wind zur Küste passend'); } else if (d > 150) n -= 7; }
  if (m?.wave_height >= .2 && m.wave_height <= 1.05) { n += 10; reasons.push('passende Welle'); }
  if (m?.sea_surface_temperature >= 4 && m.sea_surface_temperature <= 14) { n += 8; reasons.push('passende Wassertemperatur'); }
  const cv = currentCtx?.v ?? m?.ocean_current_velocity, cd = currentCtx?.dir ?? m?.ocean_current_direction;
  if (cv != null) {
    if (cv >= .12 && cv <= .65) { n += 13; reasons.push('leichte–mäßige Strömung'); }
    else if (cv > .65 && cv <= .9) { n += 7; reasons.push('deutliche Strömung'); }
    else if (cv < .05) n -= 4;
    if (cd != null) { const rel = angleDiff(s.facing, cd); if (rel >= 50 && rel <= 130) { n += 9; reasons.push('Strömung längs/schräg zur Küste'); } else if (rel > 145) n += 3; }
    if (currentCtx?.edge >= .06) { n += 12; reasons.push('Strömungskante im Umfeld'); }
  }
  return { score: Math.max(0, Math.min(100, Math.round(n))), reasons };
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

export function rankAll(spots, sample, k, weather) {
  return spots.map((s, i) => {
    const w = weather?.spots[i]?.wind[k] ?? null, m = weather?.spots[i]?.marine[k] ?? null;
    const cur = sample ? currentContext(sample, k, s) : null;
    return { spot: s, w, m, cur, ...scoreDetailed(w, m, s, cur) };
  }).sort((a, b) => b.score - a.score);
}
