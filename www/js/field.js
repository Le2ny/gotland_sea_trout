// Sampling gridded data, following the rules of the original app (v6.2.4):
// - all valid grid points within 1.5 grid spacings contribute, with positive,
//   distance-dependent weights (modified Shepard: w = ((R-d)/(R·d))², exact at grid points,
//   smoothly falling to 0 at the radius)
// - NoData (-999 / NaN) is never treated as zero
// - with barriers: grid points on land and points whose connecting line crosses the OSM
//   coastline are not used (see geo.js computeBarriers)
// - at least 2 usable grid points are required, otherwise: no value
// - every component (e.g. u and v) is interpolated separately; speed/direction come afterwards
export const NODATA = -999;
const R = 1.5, R2 = R * R;

export const gridKey = g => `${g.nr}x${g.nc}:${g.lat[0].toFixed(5)},${g.lon[0].toFixed(5)}:${g.lat.at(-1).toFixed(5)},${g.lon.at(-1).toFixed(5)}`;

export function barriersMatch(b, grid) {
  const same = (x, y) => Math.abs(x - y) < 1e-5;
  return !!b && b.version === 2 && b.nr === grid.nr && b.nc === grid.nc && same(b.lat0, grid.lat[0]) && same(b.lon0, grid.lon[0])
    && same(b.latN, grid.lat.at(-1)) && same(b.lonN, grid.lon.at(-1));
}

function decodeBarriers(b, grid) {
  if (!barriersMatch(b, grid)) return null;
  const dec = s => Uint8Array.from(atob(s), ch => ch.charCodeAt(0));
  const cells = new Array((b.nr - 1) * (b.nc - 1)).fill(null);
  const LAND = new Uint16Array(b.S * b.S);
  for (const [k, v] of Object.entries(b.cells)) cells[+k] = v === 'L' ? LAND : new Uint16Array(dec(v).buffer);
  return { S: b.S, cells, land: dec(b.landCorners) };
}

/**
 * grid: {nr, nc, lat[], lon[]}; arrays: [Float32Array] with layout [step][row][col];
 * barriers: barriers.json for this grid or null.
 * Returns sample(step, lat, lon, out) → true and out[i] = component i, or false.
 */
export function makeSampler(grid, arrays, barriers) {
  const LAT = Float64Array.from(grid.lat), LON = Float64Array.from(grid.lon), nr = grid.nr, nc = grid.nc;
  const locate = (a, x) => {  // fractional index (real coordinate arrays), or -1 outside
    const n = a.length;
    if (!(x >= a[0] && x <= a[n - 1])) return -1;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (a[mid] <= x) lo = mid; else hi = mid; }
    return lo + (x - a[lo]) / (a[lo + 1] - a[lo]);
  };
  const plane = nr * nc, bar = decodeBarriers(barriers, grid), m = arrays.length;
  const acc = new Float64Array(m);
  const valid = x => x !== NODATA && x === x;

  function sample(k, lat, lon, out) {
    const fr = locate(LAT, lat), fc = locate(LON, lon);
    if (fr < 0 || fc < 0) return false;
    const r = Math.min(Math.floor(fr), nr - 2), c = Math.min(Math.floor(fc), nc - 2);
    let allowed = 0xffff;
    if (bar) {
      const cell = bar.cells[r * (nc - 1) + c];
      if (cell) { const S = bar.S; allowed = cell[Math.min(S - 1, Math.floor((fr - r) * S)) * S + Math.min(S - 1, Math.floor((fc - c) * S))]; }
    }
    const base = k * plane;
    let sw = 0, n = 0, exact = -1; acc.fill(0);
    for (let b = 0; b < 16; b++) {
      const rr = r - 1 + (b >> 2), cc = c - 1 + (b & 3);
      if (rr < 0 || cc < 0 || rr >= nr || cc >= nc) continue;
      const dr = fr - rr, dc = fc - cc, d2 = dr * dr + dc * dc;
      if (d2 >= R2) continue;
      // a grid point in the water always counts at its own position
      if (!(allowed & (1 << b)) && !(d2 < 1e-18 && bar && !bar.land[rr * nc + cc])) continue;
      const idx = base + rr * nc + cc;
      if (!valid(arrays[0][idx])) continue;
      n++;
      if (d2 < 1e-18) { exact = idx; continue; }
      const d = Math.sqrt(d2), w = ((R - d) / (R * d)) ** 2;
      for (let i = 0; i < m; i++) acc[i] += w * arrays[i][idx];
      sw += w;
    }
    if (n < 2) return false;
    if (exact >= 0) { for (let i = 0; i < m; i++) out[i] = arrays[i][exact]; return true; }
    if (sw === 0) return false;
    for (let i = 0; i < m; i++) out[i] = acc[i] / sw;
    return true;
  }
  sample.hasBarriers = !!bar;
  sample.steps = arrays[0].length / plane;
  return sample;
}

/** "flows/blows towards" direction in degrees (0 = north, 90 = east) */
export const direction = (u, v) => (Math.atan2(u, v) * 180 / Math.PI + 360) % 360;
export const compass = deg => ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8];
