// Coastline geometry shared by the app and the build tools:
// - spatial index over the OSM coastline segments
// - land test, "does a line cross the coast", distance to the coast
// - computeBarriers(): which model points may contribute to a position (see field.js)
//
// Runs in the browser and in Node. Coastline © OpenStreetMap contributors (ODbL).

export function coastIndex(coast, B = 0.005) {
  const X1 = [], Y1 = [], X2 = [], Y2 = [];
  for (const r of coast.rings) for (let i = 0; i + 3 < r.length; i += 2) { X1.push(r[i]); Y1.push(r[i + 1]); X2.push(r[i + 2]); Y2.push(r[i + 3]); }
  const NS = X1.length, cv = coast.coverage, W = cv.west, S0 = cv.south;
  const BX = Math.ceil((cv.east - W) / B), BY = Math.ceil((cv.north - S0) / B);
  const buckets = Array.from({ length: BX * BY }, () => []), bands = Array.from({ length: BY }, () => []);
  const bx = x => Math.min(BX - 1, Math.max(0, Math.floor((x - W) / B))), by = y => Math.min(BY - 1, Math.max(0, Math.floor((y - S0) / B)));
  for (let s = 0; s < NS; s++) {
    for (let yy = by(Math.min(Y1[s], Y2[s])); yy <= by(Math.max(Y1[s], Y2[s])); yy++) {
      bands[yy].push(s);
      for (let xx = bx(Math.min(X1[s], X2[s])); xx <= bx(Math.max(X1[s], X2[s])); xx++) buckets[yy * BX + xx].push(s);
    }
  }
  const orient = (ax, ay, bx_, by_, cx, cy) => Math.sign((bx_ - ax) * (cy - ay) - (by_ - ay) * (cx - ax));
  const stamp = new Int32Array(NS); let gen = 0;

  /** true if the straight line p→q touches or crosses the coastline (conservative) */
  function crossesCoast(px, py, qx, qy) {
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
  /** even-odd ray cast to the east */
  function onLand(x, y) {
    if (x < W || y < S0 || x > cv.east || y > cv.north) return false;
    let inside = false;
    for (const s of bands[by(y)]) {
      const y1 = Y1[s], y2 = Y2[s];
      if ((y1 > y) !== (y2 > y)) { const xc = X1[s] + (y - y1) / (y2 - y1) * (X2[s] - X1[s]); if (xc > x) inside = !inside; }
    }
    return inside;
  }
  function hasSegments(s, w, n, e) {
    for (let yy = by(s); yy <= by(n); yy++) for (let xx = bx(w); xx <= bx(e); xx++) if (buckets[yy * BX + xx].length) return true;
    return false;
  }
  /** approximate distance in metres to the nearest coastline vertex/segment, searched up to maxM */
  function distToCoast(lat, lon, maxM = 2000) {
    const mLat = 111320, mLon = 111320 * Math.cos(lat * Math.PI / 180);
    const rLat = maxM / mLat, rLon = maxM / mLon;
    let best = Infinity; gen++;
    for (let yy = by(lat - rLat); yy <= by(lat + rLat); yy++) for (let xx = bx(lon - rLon); xx <= bx(lon + rLon); xx++)
      for (const s of buckets[yy * BX + xx]) {
        if (stamp[s] === gen) continue; stamp[s] = gen;
        const ax = (X1[s] - lon) * mLon, ay = (Y1[s] - lat) * mLat, cx = (X2[s] - lon) * mLon, cy = (Y2[s] - lat) * mLat;
        const dx = cx - ax, dy = cy - ay, l2 = dx * dx + dy * dy;
        const t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
        const d = Math.hypot(ax + t * dx, ay + t * dy); if (d < best) best = d;
      }
    return best;
  }
  return { crossesCoast, onLand, hasSegments, distToCoast, segments: NS };
}

/** Point in polygon (GeoJSON-style rings [[lon,lat],...]), even-odd over all rings. */
export function inRings(rings, lon, lat) {
  let inside = false;
  for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const toB64 = bytes => {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
  let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

/**
 * Barrier masks for a model grid {lat[], lon[], nr, nc}.
 * Each cell is split into S×S sub-areas (~150 m); for every sub-area a 16-bit mask stores which
 * of the 4×4 surrounding model points (all points within 1.5 grid spacings) are reachable over
 * water and not on land. Cells far from the coast are omitted (= everything allowed).
 */
export function computeBarriers(coast, grid, S = 12) {
  const { lat, lon, nr, nc } = grid, ix = coastIndex(coast);
  const cornerLand = new Uint8Array(nr * nc);
  for (let r = 0; r < nr; r++) for (let c = 0; c < nc; c++) cornerLand[r * nc + c] = ix.onLand(lon[c], lat[r]) ? 1 : 0;
  const cells = {};
  for (let r = 0; r < nr - 1; r++) for (let c = 0; c < nc - 1; c++) {
    const s = lat[r], n = lat[r + 1], w = lon[c], e = lon[c + 1];
    const cand = [];
    let anyLand = false;
    for (let k = 0; k < 16; k++) {
      const rr = r - 1 + (k >> 2), cc = c - 1 + (k & 3);
      const inGrid = rr >= 0 && cc >= 0 && rr < nr && cc < nc;
      if (inGrid && cornerLand[rr * nc + cc]) anyLand = true;
      cand.push(inGrid && !cornerLand[rr * nc + cc] ? [lon[cc], lat[rr]] : null);
    }
    const ns = lat[Math.max(0, r - 1)], nn = lat[Math.min(nr - 1, r + 2)], nw = lon[Math.max(0, c - 1)], ne = lon[Math.min(nc - 1, c + 2)];
    if (!ix.hasSegments(ns, nw, nn, ne) && !anyLand) continue;
    if (!ix.hasSegments(s, w, n, e) && ix.onLand((w + e) / 2, (s + n) / 2)) { cells[r * (nc - 1) + c] = 'L'; continue; }
    const m = new Uint16Array(S * S), isLand = new Uint8Array(S * S);
    for (let i = 0; i < S; i++) for (let j = 0; j < S; j++) {
      const y = s + (i + 0.5) / S * (n - s), x = w + (j + 0.5) / S * (e - w);
      if (ix.onLand(x, y)) { isLand[i * S + j] = 1; continue; }
      let bits = 0;
      for (let k = 0; k < 16; k++) if (cand[k] && !ix.crossesCoast(x, y, cand[k][0], cand[k][1])) bits |= 1 << k;
      m[i * S + j] = bits;
    }
    // shoreline sub-areas whose centre is on land take the mask of the nearest water sub-area
    // in the same cell (never a union); land itself is cut out exactly when drawing
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
    cells[r * (nc - 1) + c] = toB64(new Uint8Array(fixed.buffer));
  }
  return { version: 2, radius: 1.5, S, nr, nc, lat0: lat[0], lon0: lon[0], latN: lat[nr - 1], lonN: lon[nc - 1],
    landCorners: toB64(cornerLand), cells,
    note: 'Coastline © OpenStreetMap contributors (ODbL). uint16 per sub-area: bit k = model point (row-1+(k>>2), col-1+(k&3)) reachable over water and not on land.' };
}
