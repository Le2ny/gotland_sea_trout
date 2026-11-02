// Sampling the model grid. Rules (same spirit as the original app):
// - NoData (-999) is never treated as zero current
// - a value needs at least 2 valid neighbouring model points, otherwise: no value
// - u and v are interpolated separately, speed/direction are derived afterwards
// - exactly on a model grid point the original model value is returned
import { NODATA } from './copernicus.js';

export function makeSampler(f) {
  const lat0 = f.lat[0], lon0 = f.lon[0];
  const dlat = (f.lat[f.nr - 1] - lat0) / (f.nr - 1), dlon = (f.lon[f.nc - 1] - lon0) / (f.nc - 1);
  const plane = f.nr * f.nc;
  /** writes [u, v] into out and returns true, or returns false when there is no supported value */
  return function sample(k, lat, lon, out) {
    const fr = (lat - lat0) / dlat, fc = (lon - lon0) / dlon;
    if (!(fr >= 0 && fc >= 0 && fr <= f.nr - 1 && fc <= f.nc - 1)) return false;
    const r = Math.min(Math.floor(fr), f.nr - 2), c = Math.min(Math.floor(fc), f.nc - 2);
    const ar = fr - r, ac = fc - c, base = k * plane;
    let su = 0, sv = 0, sw = 0, n = 0;
    for (let i = 0; i < 4; i++) {
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
  };
}

/** "flows towards" direction in degrees (0 = north, 90 = east) */
export const direction = (u, v) => (Math.atan2(u, v) * 180 / Math.PI + 360) % 360;
export const compass = deg => ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8];
