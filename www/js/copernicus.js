// Copernicus Baltic Sea forecast (BALTICSEA_ANALYSISFORECAST_PHY_003_006), fetched directly
// from the public ARCO Zarr stores – no account, no server of our own.
//
// Only the Gotland rows are downloaded: every chunk is Blosc-compressed in independent
// 512 KB blocks, so an HTTP range request for the header plus the needed blocks is enough.
// Values are bit-identical to decoding the full chunk (verified 2026-11-02).
//
// Dataset versions change (202411 is retired on 2027-01-12, 202611 released 2026-11-24).
// discoverDatasets() reads the official STAC catalogue and picks the newest released
// version, so the app keeps working without an update.

const STAC = 'https://stac.marine.copernicus.eu/metadata/BALTICSEA_ANALYSISFORECAST_PHY_003_006/';
const FALLBACK = {
  cur: { id: 'cmems_mod_bal_phy_anfc_PT15M-i_202411', url: 'https://s3.waw3-1.cloudferro.com/mdl-arco-time-001/arco/BALTICSEA_ANALYSISFORECAST_PHY_003_006/cmems_mod_bal_phy_anfc_PT15M-i_202411/timeChunked.zarr' },
  hourly: { id: 'cmems_mod_bal_phy_anfc_PT1H-i_202411', url: 'https://s3.waw3-1.cloudferro.com/mdl-arco-time-002/arco/BALTICSEA_ANALYSISFORECAST_PHY_003_006/cmems_mod_bal_phy_anfc_PT1H-i_202411/timeChunked.zarr' },
};
export const BBOX = { south: 56.6, north: 58.3, west: 17.4, east: 20.1 };
export const NODATA = -999;
export const HOURS = 72;
export const TEMP_STEP_H = 3;  // water temperature changes slowly: every 3 h saves ~2/3 of its download

async function get(url, range) {
  const headers = range ? { Range: `bytes=${range[0]}-${range[1]}` } : {};
  const r = await fetch(url, { headers, cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status} für ${url.split('/').slice(-2).join('/')}`);
  const buf = new Uint8Array(await r.arrayBuffer());
  if (range && r.status !== 206 && buf.length !== range[1] - range[0] + 1) throw new Error('Server ignoriert Range-Anfrage');
  return buf;
}

// ---- Blosc 1 + LZ4 decoder (what these datasets use: lz4, byte shuffle, split streams)
function lz4Block(src, outLen) {
  const dst = new Uint8Array(outLen); let i = 0, o = 0;
  while (i < src.length) {
    const tok = src[i++]; let lit = tok >> 4;
    if (lit === 15) { let b; do { b = src[i++]; lit += b; } while (b === 255); }
    dst.set(src.subarray(i, i + lit), o); i += lit; o += lit;
    if (i >= src.length) break;
    const off = src[i] | (src[i + 1] << 8); i += 2;
    let ml = tok & 15;
    if (ml === 15) { let b; do { b = src[i++]; ml += b; } while (b === 255); }
    ml += 4;
    for (let s = o - off, e = o + ml; o < e;) dst[o++] = dst[s++];
  }
  if (o !== outLen) throw new Error('LZ4: falsche Blocklänge');
  return dst;
}

function header(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const flags = b[2], ts = b[3], nbytes = dv.getUint32(4, true), bsize = dv.getUint32(8, true), cbytes = dv.getUint32(12, true);
  if (((flags >> 5) & 7) !== 1 && !(flags & 2)) throw new Error('Unerwarteter Blosc-Kompressor');
  const n = Math.ceil(nbytes / bsize), starts = [];
  for (let j = 0; j < n; j++) starts.push(dv.getInt32(16 + 4 * j, true));
  starts.push(cbytes);
  return { flags, ts, nbytes, bsize, starts };
}

function decodeBlock(h, j, comp) {
  const bsz = Math.min(h.bsize, h.nbytes - j * h.bsize);
  let raw;
  if (h.flags & 2) raw = comp.slice(0, bsz);
  else {
    const leftover = bsz < h.bsize, split = !(h.flags & 0x10);  // blosc1 never splits the trailing short block
    const ns = split && !leftover && bsz / h.ts >= 128 ? h.ts : 1, sl = bsz / ns;
    raw = new Uint8Array(bsz); const dv = new DataView(comp.buffer, comp.byteOffset, comp.byteLength);
    let p = 0;
    for (let s = 0; s < ns; s++) {
      const cs = dv.getInt32(p, true); p += 4;
      const seg = comp.subarray(p, p + cs); p += cs;
      raw.set(cs === sl ? seg : lz4Block(seg, sl), s * sl);
    }
  }
  if ((h.flags & 1) && h.ts > 1) {
    const n = Math.floor(bsz / h.ts), out = new Uint8Array(bsz);
    for (let k = 0; k < h.ts; k++) for (let i = 0; i < n; i++) out[i * h.ts + k] = raw[k * n + i];
    out.set(raw.subarray(n * h.ts), n * h.ts);
    raw = out;
  }
  return raw;
}

function decodeFull(b) {
  const h = header(b), out = new Uint8Array(h.nbytes);
  for (let j = 0; j < h.starts.length - 1; j++)
    out.set(decodeBlock(h, j, b.subarray(h.starts[j], h.starts[j + 1])), j * h.bsize);
  return out;
}

// ---- dataset discovery
async function datasetInfo(id) {
  const d = await (await fetch(`${STAC}${id}/dataset.stac.json`, { cache: 'no-store' })).json();
  const p = d.properties || {}, now = Date.now();
  const released = !p.admp_released_date || Date.parse(p.admp_released_date) <= now;
  const retired = p.admp_retired_date && Date.parse(p.admp_retired_date) <= now;
  const url = d.assets?.timeChunked?.href;
  return released && !retired && url ? { id, url, retires: p.admp_retired_date || null } : null;
}

/** Newest released, not retired version of the 15-min and the hourly dataset. */
export async function discoverDatasets() {
  try {
    const prod = await (await fetch(STAC + 'product.stac.json', { cache: 'no-store' })).json();
    const ids = prod.links.filter(l => l.rel === 'item').map(l => l.href.split('/')[0]);
    const pick = async re => {
      const cands = ids.filter(i => re.test(i)).sort().reverse();  // newest version first (…_YYYYMM)
      for (const id of cands) { try { const x = await datasetInfo(id); if (x) return x; } catch { /* try next */ } }
      return null;
    };
    const [cur, hourly] = await Promise.all([pick(/^cmems_mod_bal_phy_anfc_PT15M-i_\d{6}$/), pick(/^cmems_mod_bal_phy_anfc_PT1H-i_\d{6}$/)]);
    return { cur: cur || FALLBACK.cur, hourly: hourly || FALLBACK.hourly };
  } catch {
    return { ...FALLBACK };
  }
}

/** Model grid of the Gotland window from a dataset (real coordinate arrays, not reconstructed). */
export async function fetchGrid(ds, g = get) {
  const meta = JSON.parse(new TextDecoder().decode(await g(ds.url + '/.zmetadata'))).metadata;
  const lat = new Float32Array(decodeFull(await g(ds.url + '/latitude/0')).buffer, 0, meta['latitude/.zarray'].shape[0]);
  const lon = new Float32Array(decodeFull(await g(ds.url + '/longitude/0')).buffer, 0, meta['longitude/.zarray'].shape[0]);
  const NLAT = lat.length, NLON = lon.length;
  const r0 = lat.findIndex(v => v >= BBOX.south), r1 = lat.findLastIndex(v => v <= BBOX.north);
  const c0 = lon.findIndex(v => v >= BBOX.west), c1 = lon.findLastIndex(v => v <= BBOX.east);
  // time axis (days since 1900-01-01), regular steps; read the last chunk
  const tz = meta['time/.zarray'], NT = tz.shape[0], TC = tz.chunks[0];
  const tv = new Float64Array(decodeFull(await g(`${ds.url}/time/${Math.floor((NT - 1) / TC)}`)).buffer);
  const toMs = d => Date.UTC(1900, 0, 1) + Math.round(d * 86400000);
  const stepMs = toMs(tv[1]) - toMs(tv[0]), lastMs = toMs(tv[(NT - 1) % TC]);
  return { ds, meta, NLAT, NLON, r0, r1, c0, c1, nr: r1 - r0 + 1, nc: c1 - c0 + 1, NT, stepMs, lastMs,
    lat: Array.from(lat.subarray(r0, r1 + 1)), lon: Array.from(lon.subarray(c0, c1 + 1)) };
}

const indexOf = (grid, ms) => (grid.NT - 1) - Math.round((grid.lastMs - ms) / grid.stepMs);

/** Surface level index for 4-D variables (time, elevation, lat, lon). */
async function surfaceLevel(grid, g) {
  const dims = grid.meta['elevation/.zarray'];
  if (!dims) return 0;
  const el = new Float32Array(decodeFull(await g(grid.ds.url + '/elevation/0')).buffer, 0, dims.shape[0]);
  let best = 0; for (let i = 1; i < el.length; i++) if (Math.abs(el[i]) < Math.abs(el[best])) best = i;
  return best;
}

/** Task list that fills dst[k*plane …] with the Gotland window of `name` at time index idx[k]. */
function seriesTasks(grid, name, idx, dst, g, level = 0) {
  const za = grid.meta[`${name}/.zarray`];
  if (!za || za.dtype !== '<f4') throw new Error(`Copernicus-Variable ${name} fehlt oder hat ein anderes Format`);
  const nd = za.shape.length, CT = za.chunks[0], { NLAT, NLON, r0, r1, c0, nr, nc } = grid, plane = nr * nc;
  if (za.chunks[nd - 2] !== NLAT || za.chunks[nd - 1] !== NLON || (nd === 4 && za.chunks[1] !== 1)) throw new Error('Copernicus-Datenlayout hat sich geändert');
  return idx.map((t, k) => async () => {
    const key = nd === 4 ? `${Math.floor(t / CT)}.${level}.0.0` : `${Math.floor(t / CT)}.0.0`;
    const url = `${grid.ds.url}/${name}/${key}`, ti = t % CT;
    const h = header(await g(url, [0, 255]));
    const lo = (ti * NLAT * NLON + r0 * NLON) * 4, hi = (ti * NLAT * NLON + (r1 + 1) * NLON) * 4 - 1;
    const j0 = Math.floor(lo / h.bsize), j1 = Math.floor(hi / h.bsize);
    const comp = await g(url, [h.starts[j0], h.starts[j1 + 1] - 1]);
    const raw = new Uint8Array((j1 - j0 + 1) * h.bsize); let p = 0;
    for (let j = j0; j <= j1; j++) {
      const n = h.starts[j + 1] - h.starts[j];
      raw.set(decodeBlock(h, j, comp.subarray(p, p + n)), (j - j0) * h.bsize); p += n;
    }
    const f = new Float32Array(raw.buffer), base = (j0 * h.bsize) / 4;
    for (let r = 0; r < nr; r++) {
      const src = ti * NLAT * NLON + (r0 + r) * NLON + c0 - base;
      dst.set(f.subarray(src, src + nc), k * plane + r * nc);
    }
  });
}

async function pool(tasks, n, onDone) {
  let next = 0, done = 0;
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, async () => {
    while (next < tasks.length) { const t = tasks[next++]; await t(); onDone(++done, tasks.length); }
  }));
}

const gridOut = grid => ({ nr: grid.nr, nc: grid.nc, lat: grid.lat, lon: grid.lon, dataset: grid.ds.id });

/**
 * Downloads the next 72 h for Gotland:
 *  - currents uo/vo and sea level sla, hourly (15-min dataset)
 *  - surface water temperature thetao, every TEMP_STEP_H hours (hourly dataset)
 * onProgress(done, total, bytes)
 */
export async function downloadOcean(onProgress = () => {}) {
  let bytes = 0; const g = async (u, r) => { const b = await get(u, r); bytes += b.length; return b; };
  const ds = await discoverDatasets();
  const [grid, gridH] = await Promise.all([fetchGrid(ds.cur, g), fetchGrid(ds.hourly, g)]);
  const nowHour = Math.floor(Date.now() / 3600000) * 3600000;
  const times = [];
  for (let k = 0; k <= HOURS; k++) { const ms = nowHour + k * 3600000; if (ms <= grid.lastMs) times.push(ms); }
  if (!times.length || indexOf(grid, times[0]) < 0) throw new Error('Keine Prognose für die aktuelle Stunde gefunden');
  const tTimes = [];
  for (let ms = Math.floor(nowHour / (TEMP_STEP_H * 3600000)) * TEMP_STEP_H * 3600000; ms <= times.at(-1) + TEMP_STEP_H * 3600000; ms += TEMP_STEP_H * 3600000)
    if (ms <= gridH.lastMs && indexOf(gridH, ms) >= 0) tTimes.push(ms);

  const plane = grid.nr * grid.nc, planeH = gridH.nr * gridH.nc;
  const u = new Float32Array(times.length * plane), v = new Float32Array(times.length * plane), sla = new Float32Array(times.length * plane);
  const temp = new Float32Array(tTimes.length * planeH);
  const idx = times.map(ms => indexOf(grid, ms)), idxH = tTimes.map(ms => indexOf(gridH, ms));
  const level = await surfaceLevel(gridH, g);
  const tasks = [
    ...seriesTasks(grid, 'uo', idx, u, g), ...seriesTasks(grid, 'vo', idx, v, g),
    ...seriesTasks(grid, 'sla', idx, sla, g), ...seriesTasks(gridH, 'thetao', idxH, temp, g, level),
  ];
  await pool(tasks, 6, (d, n) => onProgress(d, n, bytes));

  return {
    version: 2, fetchedAt: Date.now(), modelLastTime: grid.lastMs, times, bytes,
    grid: gridOut(grid), u, v, sla,
    temp: { grid: gridOut(gridH), times: tTimes, data: temp },
    datasets: { cur: ds.cur.id, hourly: ds.hourly.id, retires: ds.cur.retires },
  };
}

/** Cheap check (a few hundred bytes): has Copernicus published a newer forecast run? */
export async function newerRunAvailable(fetchedAt) {
  try {
    const ds = await discoverDatasets();
    const r = await fetch(ds.cur.url + '/.zmetadata', { method: 'HEAD', cache: 'no-store' });
    const lm = Date.parse(r.headers.get('last-modified') || '');
    return Number.isFinite(lm) ? lm > fetchedAt : null;
  } catch { return null; }
}
