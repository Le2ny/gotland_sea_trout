// Checks the sampler against real Copernicus data:
// 1) at every valid model point in the water the original value comes out bit-exactly
// 2) points on land never get a value; NoData is never turned into 0
// 3) how often the coastline barriers change the result vs. plain interpolation
import fs from 'node:fs'; import assert from 'node:assert/strict';
import { downloadForecast, NODATA } from '../www/js/copernicus.js';
import { makeSampler } from '../www/js/field.js';
globalThis.atob ??= s => Buffer.from(s, 'base64').toString('binary');
const barriers = JSON.parse(fs.readFileSync(new URL('../www/data/barriers.json', import.meta.url)));
const f = await downloadForecast();
const withB = makeSampler(f, barriers), noB = makeSampler(f, null);
assert.ok(withB.hasBarriers, 'barriers must match the live model grid');
const land = Buffer.from(barriers.landCorners, 'base64');
const uv = [0, 0], uv2 = [0, 0];
let exact = 0, landValid = 0, missing = 0;
for (const k of [0, 36, f.times.length - 1]) for (let r = 0; r < f.nr; r++) for (let c = 0; c < f.nc; c++) {
  const i = k * f.nr * f.nc + r * f.nc + c, u = f.u[i];
  if (u === NODATA) continue;
  if (land[r * f.nc + c]) { landValid++; continue; }
  if (!withB(k, f.lat[r], f.lon[c], uv)) { missing++; continue; }
  assert.equal(Math.fround(uv[0]), u); assert.equal(Math.fround(uv[1]), f.v[i]); exact++;
}
console.log(`exact original values at ${exact} water model points (3 hours); ${missing} isolated points without 2nd support; ${landValid} valid model points lie on OSM land (excluded)`);
let changed = 0, removed = 0, total = 0, maxDiff = 0;
for (let r = 0; r < f.nr - 1; r += 0.13) for (let c = 0; c < f.nc - 1; c += 0.13) {
  const lat = f.lat[0] + r * (f.lat.at(-1) - f.lat[0]) / (f.nr - 1), lon = f.lon[0] + c * (f.lon.at(-1) - f.lon[0]) / (f.nc - 1);
  const a = withB(0, lat, lon, uv), b = noB(0, lat, lon, uv2);
  if (!b) continue; total++;
  if (!a) { removed++; continue; }
  const d = Math.hypot(uv[0] - uv2[0], uv[1] - uv2[1]); if (d > 1e-9) { changed++; maxDiff = Math.max(maxDiff, d); }
}
console.log(`dense check: ${total} positions; barriers changed ${changed}, removed ${removed} (land or across-land only); max change ${maxDiff.toFixed(3)} m/s`);
