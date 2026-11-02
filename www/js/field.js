// Sampling the model grid. Rules (same spirit as the original app):
// - NoData (-999) is never treated as zero current
// - model points on land and points whose connecting line crosses the coastline are not used
//   (precomputed in data/barriers.json by tools/build_barriers.mjs)
// - a value needs at least 2 usable neighbouring model points, otherwise: no value
// - u and v are interpolated separately, speed/direction are derived afterwards
// - exactly on a model grid point the original model value is returned
import { NODATA } from './copernicus.js';

function decodeBarriers(b, f) {
  if (!b) return null;
  const same = (x, y) => Math.abs(x - y) < 1e-5;
  if (b.nr !== f.nr || b.nc !== f.nc || !same(b.lat0, f.lat[0]) || !same(b.lon0, f.lon[0]) || !same(b.latN, f.lat.at(-1)) || !same(b.lonN, f.lon.at(-1))) {
    console.warn('barriers.json passt nicht zum Modellgitter – Küstenbarrieren deaktiviert');
    return null;
  }
  const cells = new Array((b.nr - 1) * (b.nc - 1)).fill(null);
  const LAND = new Uint8Array(b.S * b.S);  // all zero = nothing allowed
  for (const [k, v] of Object.entries(b.cells)) cells[+k] = v === 'L' ? LAND : Uint8Array.from(atob(v), ch => ch.charCodeAt(0));
  return { S: b.S, cells };
}

export function makeSampler(f, barriersJson) {
  // locate cells with the real coordinate arrays (the grid is not perfectly regular in float32)
  const LAT = Float64Array.from(f.lat), LON = Float64Array.from(f.lon);
  const locate = (a, x) => {  // returns fractional index, or -1 outside
    const n = a.length;
    if (!(x >= a[0] && x <= a[n - 1])) return -1;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (a[mid] <= x) lo = mid; else hi = mid; }
    return lo + (x - a[lo]) / (a[lo + 1] - a[lo]);
  };
  const plane = f.nr * f.nc, bar = decodeBarriers(barriersJson, f);
  /** writes [u, v] into out and returns true, or returns false when there is no supported value */
  function sample(k, lat, lon, out) {
    const fr = locate(LAT, lat), fc = locate(LON, lon);
    if (fr < 0 || fc < 0) return false;
    const r = Math.min(Math.floor(fr), f.nr - 2), c = Math.min(Math.floor(fc), f.nc - 2);
    const ar = fr - r, ac = fc - c, base = k * plane;
    let allowed = 15;
    if (bar) {
      const m = bar.cells[r * (f.nc - 1) + c];
      if (m) { const S = bar.S; allowed = m[Math.min(S - 1, Math.floor(ar * S)) * S + Math.min(S - 1, Math.floor(ac * S))]; }
    }
    let su = 0, sv = 0, sw = 0, n = 0;
    for (let i = 0; i < 4; i++) {
      if (!(allowed & (1 << i))) continue;
      const idx = base + (r + (i >> 1)) * f.nc + c + (i & 1);
      const u = f.u[idx];
      if (u === NODATA) continue;
      n++;
      const w = ((i >> 1) ? ar : 1 - ar) * ((i & 1) ? ac : 1 - ac);
      if (w > 0) { su += w * u; sv += w * f.v[idx]; sw += w; }
    }
    if (n < 2 || sw === 0) return false;
    out[0] = su / sw; out[1] = sv / sw;
    return true;
  }
  sample.hasBarriers = !!bar;
  return sample;
}

/** "flows towards" direction in degrees (0 = north, 90 = east) */
export const direction = (u, v) => (Math.atan2(u, v) * 180 / Math.PI + 360) % 360;
export const compass = deg => ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8];
