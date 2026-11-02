// Precomputes, once on the PC, which model grid points may contribute to a position
// without the connecting line crossing the OSM coastline (and which are on land).
// Output: www/data/barriers.json, used by field.js at runtime as a simple lookup.
//
// Each model cell (4 corner points) is split into S×S sub-areas (~150 m). For every
// sub-area centre a 4-bit mask stores which corners are visible over water.
// Cells far from any coastline are omitted (= all four corners allowed).
//
// Usage: node tools/build_barriers.mjs
import fs from 'node:fs';
import { fetchGrid } from '../www/js/copernicus.js';

const S = 12, B = 0.005;  // sub-areas per cell edge, bucket size in degrees
const root = new URL('../www/data/', import.meta.url).pathname;
const coast = JSON.parse(fs.readFileSync(root + 'coast.json', 'utf8'));
const grid = await fetchGrid();
const { lat, lon, nr, nc } = grid;
console.log(`grid ${nr}x${nc}`);

// --- segments + bucket index
const X1 = [], Y1 = [], X2 = [], Y2 = [];
for (const r of coast.rings) for (let i = 0; i + 3 < r.length; i += 2) { X1.push(r[i]); Y1.push(r[i + 1]); X2.push(r[i + 2]); Y2.push(r[i + 3]); }
const NS = X1.length, W = coast.coverage.west, So = coast.coverage.south;
const BX = Math.ceil((coast.coverage.east - W) / B), BY = Math.ceil((coast.coverage.north - So) / B);
const buckets = Array.from({ length: BX * BY }, () => []);
const bx = x => Math.min(BX - 1, Math.max(0, Math.floor((x - W) / B))), by = y => Math.min(BY - 1, Math.max(0, Math.floor((y - So) / B)));
for (let s = 0; s < NS; s++) {
  for (let yy = by(Math.min(Y1[s], Y2[s])); yy <= by(Math.max(Y1[s], Y2[s])); yy++)
    for (let xx = bx(Math.min(X1[s], X2[s])); xx <= bx(Math.max(X1[s], X2[s])); xx++) buckets[yy * BX + xx].push(s);
}
console.log(`${NS} coast segments indexed`);

const orient = (ax, ay, bx_, by_, cx, cy) => Math.sign((bx_ - ax) * (cy - ay) - (by_ - ay) * (cx - ax));
const stamp = new Int32Array(NS); let gen = 0;
function crossesCoast(px, py, qx, qy) {  // touching counts as crossing (conservative)
  gen++;
  for (let yy = by(Math.min(py, qy)); yy <= by(Math.max(py, qy)); yy++)
    for (let xx = bx(Math.min(px, qx)); xx <= bx(Math.max(px, qx)); xx++)
      for (const s of buckets[yy * BX + xx]) {
        if (stamp[s] === gen) continue; stamp[s] = gen;
        const o1 = orient(px, py, qx, qy, X1[s], Y1[s]), o2 = orient(px, py, qx, qy, X2[s], Y2[s]);
        const o3 = orient(X1[s], Y1[s], X2[s], Y2[s], px, py), o4 = orient(X1[s], Y1[s], X2[s], Y2[s], qx, qy);
        if (o1 !== o2 && o3 !== o4) return true;
        if (o1 === 0 && o2 === 0 && Math.max(X1[s], X2[s]) >= Math.min(px, qx) && Math.min(X1[s], X2[s]) <= Math.max(px, qx)
            && Math.max(Y1[s], Y2[s]) >= Math.min(py, qy) && Math.min(Y1[s], Y2[s]) <= Math.max(py, qy)) return true;
      }
  return false;
}

// point in land: even-odd ray cast towards east over segments in the point's latitude band
const bands = Array.from({ length: BY }, () => []);
for (let s = 0; s < NS; s++) for (let yy = by(Math.min(Y1[s], Y2[s])); yy <= by(Math.max(Y1[s], Y2[s])); yy++) bands[yy].push(s);
function onLand(x, y) {
  if (x < W || y < So || x > coast.coverage.east || y > coast.coverage.north) return false;
  let inside = false;
  for (const s of bands[by(y)]) {
    const y1 = Y1[s], y2 = Y2[s];
    if ((y1 > y) !== (y2 > y)) { const xc = X1[s] + (y - y1) / (y2 - y1) * (X2[s] - X1[s]); if (xc > x) inside = !inside; }
  }
  return inside;
}

const cornerLand = new Uint8Array(nr * nc);
for (let r = 0; r < nr; r++) for (let c = 0; c < nc; c++) cornerLand[r * nc + c] = onLand(lon[c], lat[r]) ? 1 : 0;

const hasSegments = (s, w, n, e) => {
  for (let yy = by(s); yy <= by(n); yy++) for (let xx = bx(w); xx <= bx(e); xx++) if (buckets[yy * BX + xx].length) return true;
  return false;
};

const cells = {}; let coastal = 0, landCells = 0;
const t0 = Date.now();
for (let r = 0; r < nr - 1; r++) for (let c = 0; c < nc - 1; c++) {
  const s = lat[r], n = lat[r + 1], w = lon[c], e = lon[c + 1];
  const corners = [[w, s], [e, s], [w, n], [e, n]];  // bit i: row offset i>>1, col offset i&1 (same as field.js)
  const anyLandCorner = [0, 1, 2, 3].some(i => cornerLand[(r + (i >> 1)) * nc + c + (i & 1)]);
  if (!hasSegments(s, w, n, e) && !anyLandCorner) continue;               // open sea: all corners allowed
  if (!hasSegments(s, w, n, e) && cornerLand[r * nc + c]) { cells[r * (nc - 1) + c] = 'L'; landCells++; continue; } // inland
  coastal++;
  const m = new Uint8Array(S * S);
  for (let i = 0; i < S; i++) for (let j = 0; j < S; j++) {
    const y = s + (i + 0.5) / S * (n - s), x = w + (j + 0.5) / S * (e - w);
    if (onLand(x, y)) continue;
    let bits = 0;
    for (let k = 0; k < 4; k++) {
      if (cornerLand[(r + (k >> 1)) * nc + c + (k & 1)]) continue;
      if (!crossesCoast(x, y, corners[k][0], corners[k][1])) bits |= 1 << k;
    }
    m[i * S + j] = bits;
  }
  cells[r * (nc - 1) + c] = Buffer.from(m).toString('base64');
}
console.log(`${coastal} coastal cells, ${landCells} inland cells, ${((Date.now() - t0) / 1000).toFixed(1)} s`);

const out = { version: 1, S, nr, nc, lat0: lat[0], lon0: lon[0], latN: lat[nr - 1], lonN: lon[nc - 1],
  landCorners: Buffer.from(cornerLand).toString('base64'), cells,
  note: 'Coastline © OpenStreetMap contributors (ODbL). bit k of a sub-area = corner (row+(k>>1), col+(k&1)) reachable over water.' };
fs.writeFileSync(root + 'barriers.json', JSON.stringify(out));
console.log('barriers.json', Math.round(fs.statSync(root + 'barriers.json').size / 1024), 'KB');
