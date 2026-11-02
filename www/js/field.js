// Sampling the model grid, following the rules of the original app (v6.2.4):
// - all valid model points within 1.5 grid spacings contribute, with positive,
//   distance-dependent weights (modified Shepard: w = ((R-d)/(R·d))², exact at model points,
//   smoothly falling to 0 at the radius)
// - NoData (-999) is never treated as zero current
// - model points on land and points whose connecting line crosses the OSM coastline are not used
//   (precomputed in data/barriers.json by tools/build_barriers.mjs)
// - at least 2 usable model points are required, otherwise: no value
// - u and v are interpolated separately, speed/direction are derived afterwards
import { NODATA } from './copernicus.js';

const R = 1.5, R2 = R * R;

function decodeBarriers(b, f) {
  if (!b) return null;
  const same = (x, y) => Math.abs(x - y) < 1e-5;
  if (b.version !== 2 || b.nr !== f.nr || b.nc !== f.nc || !same(b.lat0, f.lat[0]) || !same(b.lon0, f.lon[0]) || !same(b.latN, f.lat.at(-1)) || !same(b.lonN, f.lon.at(-1))) {
    console.warn('barriers.json passt nicht zum Modellgitter – Küstenbarrieren deaktiviert');
    return null;
  }
  const cells = new Array((b.nr - 1) * (b.nc - 1)).fill(null);
  const LAND = new Uint16Array(b.S * b.S);  // all zero = nothing allowed
  for (const [k, v] of Object.entries(b.cells)) {
    if (v === 'L') { cells[+k] = LAND; continue; }
    const bytes = Uint8Array.from(atob(v), ch => ch.charCodeAt(0));
    cells[+k] = new Uint16Array(bytes.buffer);
  }
  const land = Uint8Array.from(atob(b.landCorners), ch => ch.charCodeAt(0));
  return { S: b.S, cells, land };
}

export function makeSampler(f, barriersJson) {
  // locate cells with the real coordinate arrays (the grid is not perfectly regular in float32)
  const LAT = Float64Array.from(f.lat), LON = Float64Array.from(f.lon);
  const locate = (a, x) => {  // fractional index, or -1 outside
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
    let allowed = 0xffff;
    if (bar) {
      const m = bar.cells[r * (f.nc - 1) + c];
      if (m) { const S = bar.S; allowed = m[Math.min(S - 1, Math.floor((fr - r) * S)) * S + Math.min(S - 1, Math.floor((fc - c) * S))]; }
    }
    const base = k * plane;
    let su = 0, sv = 0, sw = 0, n = 0, exact = -1;
    for (let b = 0; b < 16; b++) {
      const rr = r - 1 + (b >> 2), cc = c - 1 + (b & 3);
      if (rr < 0 || cc < 0 || rr >= f.nr || cc >= f.nc) continue;
      const dr = fr - rr, dc = fc - cc, d2 = dr * dr + dc * dc;
      if (d2 >= R2) continue;
      // a model point in the water always counts at its own position
      if (!(allowed & (1 << b)) && !(d2 < 1e-18 && bar && !bar.land[rr * f.nc + cc])) continue;
      const idx = base + rr * f.nc + cc, u = f.u[idx];
      if (u === NODATA) continue;
      n++;
      if (d2 < 1e-18) { exact = idx; continue; }
      const d = Math.sqrt(d2), w = ((R - d) / (R * d)) ** 2;
      su += w * u; sv += w * f.v[idx]; sw += w;
    }
    if (n < 2) return false;
    if (exact >= 0) { out[0] = f.u[exact]; out[1] = f.v[exact]; return true; }
    if (sw === 0) return false;
    out[0] = su / sw; out[1] = sv / sw;
    return true;
  }
  sample.hasBarriers = !!bar;
  return sample;
}

/** "flows towards" direction in degrees (0 = north, 90 = east) */
export const direction = (u, v) => (Math.atan2(u, v) * 180 / Math.PI + 360) % 360;
export const compass = deg => ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8];
