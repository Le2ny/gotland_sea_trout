// Real Copernicus data:
// 1) currents: at every valid model point in the water the original value comes out bit-exactly
// 2) sea level and temperature are downloaded and plausible; NoData never becomes 0
// 3) barriers: coverage and how often they change the result
import fs from 'node:fs'; import assert from 'node:assert/strict';
import { downloadOcean, NODATA } from '../www/js/copernicus.js';
import { makeSampler } from '../www/js/field.js';
globalThis.atob ??= s => Buffer.from(s, 'base64').toString('binary');
const barriers = JSON.parse(fs.readFileSync(new URL('../www/data/barriers.json', import.meta.url)));
const t0 = Date.now();
const o = await downloadOcean();
console.log(`download ${(o.bytes / 1e6).toFixed(1)} MB in ${((Date.now() - t0) / 1000).toFixed(0)} s; datasets ${o.datasets.cur}, ${o.datasets.hourly}; retires ${o.datasets.retires}`);
const g = o.grid, plane = g.nr * g.nc;
const withB = makeSampler(g, [o.u, o.v], barriers), noB = makeSampler(g, [o.u, o.v], null);
assert.ok(withB.hasBarriers, 'barriers must match the live model grid');
const land = Buffer.from(barriers.landCorners, 'base64'), uv = [0, 0], uv2 = [0, 0];
let exact = 0, missing = 0;
for (const k of [0, 36, o.times.length - 1]) for (let r = 0; r < g.nr; r++) for (let c = 0; c < g.nc; c++) {
  const i = k * plane + r * g.nc + c; if (o.u[i] === NODATA || land[r * g.nc + c]) continue;
  if (!withB(k, g.lat[r], g.lon[c], uv)) { missing++; continue; }
  assert.equal(Math.fround(uv[0]), o.u[i]); assert.equal(Math.fround(uv[1]), o.v[i]); exact++;
}
console.log(`currents: exact original values at ${exact} water model points (3 hours); ${missing} isolated`);
const stat = (a, n) => { let mn = Infinity, mx = -Infinity, cnt = 0; for (let i = 0; i < n; i++) if (a[i] !== NODATA && a[i] === a[i]) { cnt++; mn = Math.min(mn, a[i]); mx = Math.max(mx, a[i]); } return `${cnt} valid, ${mn.toFixed(3)}..${mx.toFixed(3)}`; };
console.log(`sea level (m), hour 0: ${stat(o.sla, plane)}`);
console.log(`temperature (°C), ${o.temp.times.length} steps every 3 h, first: ${stat(o.temp.data, o.temp.grid.nr * o.temp.grid.nc)}; same grid as currents: ${o.temp.grid.nr === g.nr && o.temp.grid.lat[0] === g.lat[0]}`);
for (const [name, arr] of [['sla', o.sla], ['temp', o.temp.data]]) { let zeros = 0; for (let i = 0; i < arr.length; i++) if (arr[i] === 0) zeros++; assert.ok(zeros < arr.length * 0.01, name + ': suspicious zeros'); }
let covered = 0, changed = 0, removed = 0, total = 0;
for (let r = 0; r < g.nr - 1; r += 0.13) for (let c = 0; c < g.nc - 1; c += 0.13) {
  const lat = g.lat[0] + r * (g.lat.at(-1) - g.lat[0]) / (g.nr - 1), lon = g.lon[0] + c * (g.lon.at(-1) - g.lon[0]) / (g.nc - 1);
  const a = withB(0, lat, lon, uv), b = noB(0, lat, lon, uv2);
  if (a) covered++; if (!b) continue; total++;
  if (!a) { removed++; continue; } if (Math.hypot(uv[0] - uv2[0], uv[1] - uv2[1]) > 1e-9) changed++;
}
console.log(`coverage ${covered}; barriers changed ${changed}, removed ${removed} of ${total}`);
fs.writeFileSync(new URL('./ocean-cache.json', import.meta.url), JSON.stringify({ ...o, u: [...o.u], v: [...o.v], sla: [...o.sla], temp: { ...o.temp, data: [...o.temp.data] } }));
