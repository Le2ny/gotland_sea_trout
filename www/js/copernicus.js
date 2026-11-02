// Copernicus Baltic current forecast, fetched directly from the public ARCO Zarr store.
// Only the Gotland rows are downloaded: each chunk is Blosc-compressed in independent
// 512 KB blocks, so an HTTP range request on the header + the needed blocks is enough.
// Values are bit-identical to decoding the full chunk (verified 2026-11-02).

export const BASE = 'https://s3.waw3-1.cloudferro.com/mdl-arco-time-001/arco/' +
  'BALTICSEA_ANALYSISFORECAST_PHY_003_006/cmems_mod_bal_phy_anfc_PT15M-i_202411/timeChunked.zarr';
export const BBOX = { south: 56.6, north: 58.3, west: 17.4, east: 20.1 };
export const NODATA = -999;
const HOURS = 72;

async function get(url, range) {
  const headers = range ? { Range: `bytes=${range[0]}-${range[1]}` } : {};
  const r = await fetch(url, { headers, cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status} für ${url.split('/').slice(-2).join('/')}`);
  const buf = new Uint8Array(await r.arrayBuffer());
  if (range && r.status !== 206 && buf.length !== range[1] - range[0] + 1) throw new Error('Server ignoriert Range-Anfrage');
  return buf;
}

// ---- Blosc 1 + LZ4 decoder (only what this dataset uses: lz4, byte shuffle, split streams)
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
    const leftover = bsz < h.bsize, split = !(h.flags & 0x10);
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

// ---- forecast download
async function pool(tasks, n, onDone) {
  let next = 0, done = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < tasks.length) { const t = tasks[next++]; await t(); onDone(++done, tasks.length); }
  }));
}

/** Downloads the next 72 h (hourly) of uo/vo for Gotland. onProgress(done,total,bytes). */
export async function downloadForecast(onProgress = () => {}) {
  let bytes = 0; const g = async (u, r) => { const b = await get(u, r); bytes += b.length; return b; };
  const meta = JSON.parse(new TextDecoder().decode(await g(BASE + '/.zmetadata'))).metadata;
  const za = meta['uo/.zarray'], [, NLAT, NLON] = za.shape, CT = za.chunks[0];
  if (za.dtype !== '<f4' || za.chunks[1] !== NLAT || za.chunks[2] !== NLON) throw new Error('Copernicus-Datenlayout hat sich geändert');
  const lat = new Float32Array(decodeFull(await g(BASE + '/latitude/0')).buffer, 0, NLAT);
  const lon = new Float32Array(decodeFull(await g(BASE + '/longitude/0')).buffer, 0, NLON);
  let r0 = lat.findIndex(v => v >= BBOX.south), r1 = lat.findLastIndex(v => v <= BBOX.north);
  let c0 = lon.findIndex(v => v >= BBOX.west), c1 = lon.findLastIndex(v => v <= BBOX.east);
  const nr = r1 - r0 + 1, nc = c1 - c0 + 1;

  // time axis (days since 1900-01-01), regular 15 min steps
  const tz = meta['time/.zarray'], NT = tz.shape[0], TC = tz.chunks[0];
  const tchunk = Math.floor((NT - 1) / TC);
  const tv = new Float64Array(decodeFull(await g(`${BASE}/time/${tchunk}`)).buffer);
  const toMs = d => Date.UTC(1900, 0, 1) + d * 86400000;
  const stepMs = toMs(tv[1]) - toMs(tv[0]);
  const lastMs = toMs(tv[(NT - 1) % TC]);
  const nowHour = Math.floor(Date.now() / 3600000) * 3600000;
  const iNow = (NT - 1) - Math.round((lastMs - nowHour) / stepMs);
  if (iNow < 0 || iNow > NT - 1) throw new Error('Keine Prognose für die aktuelle Stunde gefunden');
  const perHour = Math.round(3600000 / stepMs);
  const times = [], idx = [];
  for (let k = 0; k <= HOURS && iNow + k * perHour < NT; k++) { idx.push(iNow + k * perHour); times.push(nowHour + k * 3600000); }

  const plane = nr * nc, u = new Float32Array(times.length * plane), v = new Float32Array(times.length * plane);
  const tasks = [];
  for (let k = 0; k < idx.length; k++) for (const [name, dst] of [['uo', u], ['vo', v]]) tasks.push(async () => {
    const t = idx[k], url = `${BASE}/${name}/${Math.floor(t / CT)}.0.0`, ti = t % CT;
    const h = header(await g(url, [0, 255]));
    const lo = (ti * NLAT * NLON + r0 * NLON) * 4, hi = (ti * NLAT * NLON + (r1 + 1) * NLON) * 4 - 1;
    const j0 = Math.floor(lo / h.bsize), j1 = Math.floor(hi / h.bsize);
    const comp = await g(url, [h.starts[j0], h.starts[j1 + 1] - 1]);
    const raw = new Uint8Array((j1 - j0 + 1) * h.bsize); let p = 0;
    for (let j = j0; j <= j1; j++) {
      const n = h.starts[j + 1] - h.starts[j];
      const blk = decodeBlock(h, j, comp.subarray(p, p + n)); raw.set(blk, (j - j0) * h.bsize); p += n;
    }
    const f = new Float32Array(raw.buffer), base = (j0 * h.bsize) / 4;
    for (let r = 0; r < nr; r++) {
      const src = ti * NLAT * NLON + (r0 + r) * NLON + c0 - base;
      dst.set(f.subarray(src, src + nc), k * plane + r * nc);
    }
  });
  await pool(tasks, 6, (d, n) => onProgress(d, n, bytes));

  return {
    version: 1, fetchedAt: Date.now(), modelLastTime: lastMs, times, nr, nc,
    lat: Array.from(lat.subarray(r0, r1 + 1)), lon: Array.from(lon.subarray(c0, c1 + 1)),
    u, v, bytes,
  };
}
