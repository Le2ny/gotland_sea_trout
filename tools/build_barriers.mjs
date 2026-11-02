// Precomputes, once on the PC, which model grid points may contribute to a position
// without the connecting line crossing the OSM coastline (and which are on land).
// Output: www/data/barriers.json, used by field.js at runtime as a simple lookup.
//
// Each model cell is split into S×S sub-areas (~150 m). For every sub-area centre a
// 16-bit mask stores which of the 4×4 surrounding model points are visible over water.
// Cells far from any coastline are omitted (= all candidates allowed).
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

// Candidates for a position in cell (r,c): model points rows r-1..r+2, cols c-1..c+2 (16 points),
// which covers every point within 1.5 grid spacings. Bit k <-> (r-1+(k>>2), c-1+(k&3)).
const cells = {}; let coastal = 0, landCells = 0;
const t0 = Date.now();
for (let r = 0; r < nr - 1; r++) for (let c = 0; c < nc - 1; c++) {
  const s = lat[r], n = lat[r + 1], w = lon[c], e = lon[c + 1];
  const cand = [];
  for (let k = 0; k < 16; k++) {
    const rr = r - 1 + (k >> 2), cc = c - 1 + (k & 3);
    cand.push(rr >= 0 && cc >= 0 && rr < nr && cc < nc && !cornerLand[rr * nc + cc] ? [lon[cc], lat[rr]] : null);
  }
  const ns = lat[Math.max(0, r - 1)], nn = lat[Math.min(nr - 1, r + 2)], nw = lon[Math.max(0, c - 1)], ne = lon[Math.min(nc - 1, c + 2)];
  const anyLand = cand.some((p, k) => { const rr = r - 1 + (k >> 2), cc = c - 1 + (k & 3); return rr >= 0 && cc >= 0 && rr < nr && cc < nc && cornerLand[rr * nc + cc]; });
  if (!hasSegments(ns, nw, nn, ne) && !anyLand) continue;              // open sea: all candidates usable
  if (!hasSegments(s, w, n, e) && onLand((w + e) / 2, (s + n) / 2)) { cells[r * (nc - 1) + c] = 'L'; landCells++; continue; } // inland
  coastal++;
  const m = new Uint16Array(S * S);
  for (let i = 0; i < S; i++) for (let j = 0; j < S; j++) {
    const y = s + (i + 0.5) / S * (n - s), x = w + (j + 0.5) / S * (e - w);
    if (onLand(x, y)) continue;
    let bits = 0;
    for (let k = 0; k < 16; k++) if (cand[k] && !crossesCoast(x, y, cand[k][0], cand[k][1])) bits |= 1 << k;
    m[i * S + j] = bits;
  }
  // Sub-areas whose centre is on land but which still contain water along the shore would
  // otherwise stay completely empty (blocky gaps). They take the mask of the nearest
  // sub-area in the same cell whose centre is in the water (land itself is cut out exactly
  // by the coastline when drawing). Only a single neighbour is used, never a union.
  const isLand = new Uint8Array(S * S);
  for (let i = 0; i < S; i++) for (let j = 0; j < S; j++) isLand[i * S + j] = onLand(w + (j + 0.5) / S * (e - w), s + (i + 0.5) / S * (n - s)) ? 1 : 0;
  const fixed = m.slice();
  for (let i = 0; i < S; i++) for (let j = 0; j < S; j++) {
    if (!isLand[i * S + j]) continue;
    let best = -1, bd = 9;
    for (let di = -2; di <= 2; di++) for (let dj = -2; dj <= 2; dj++) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= S || jj >= S || isLand[ii * S + jj]) continue;
      const d = di * di + dj * dj; if (d < bd) { bd = d; best = ii * S + jj; }
    }
    if (best >= 0) fixed[i * S + j] = m[best];
  }
  m.set(fixed);
  cells[r * (nc - 1) + c] = Buffer.from(m.buffer).toString('base64');
}
console.log(`${coastal} coastal cells, ${landCells} inland cells, ${((Date.now() - t0) / 1000).toFixed(1)} s`);

const out = { version: 2, radius: 1.5, S, nr, nc, lat0: lat[0], lon0: lon[0], latN: lat[nr - 1], lonN: lon[nc - 1],
  landCorners: Buffer.from(cornerLand).toString('base64'), cells,
  note: 'Coastline © OpenStreetMap contributors (ODbL). uint16 per sub-area: bit k = model point (row-1+(k>>2), col-1+(k&3)) reachable over water and not on land.' };
fs.writeFileSync(root + 'barriers.json', JSON.stringify(out));
console.log('barriers.json', Math.round(fs.statSync(root + 'barriers.json').size / 1024), 'KB');
