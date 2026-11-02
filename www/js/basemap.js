// Base map that also works offline:
// 1) an always-available land/sea background drawn from the bundled OSM coastline
// 2) OSM tiles on top; every tile that was viewed once is kept on the phone (Cache Storage),
//    so previously viewed areas also show the full map without network.
//    (OSM's tile policy forbids bulk pre-downloading, so we only keep what was viewed.)

const TILE_CACHE = 'osm-tiles-v1';
const SEA = '#aad3df', LAND = '#f2efe9', SHORE = '#8fb4c0';

export function createCoastBackground(L, coast) {
  return L.Layer.extend({
    onAdd(map) {
      this._map = map;
      if (!map.getPane('coastBg')) { map.createPane('coastBg'); map.getPane('coastBg').style.zIndex = 150; }
      this._cv = L.DomUtil.create('canvas', 'leaflet-zoom-hide', map.getPane('coastBg'));
      map.on('moveend zoomend resize', this._draw, this); this._draw();
    },
    onRemove(map) { this._cv.remove(); map.off('moveend zoomend resize', this._draw, this); },
    _draw() {
      const map = this._map, cv = this._cv, size = map.getSize(), dpr = window.devicePixelRatio || 1;
      L.DomUtil.setPosition(cv, map.containerPointToLayerPoint([0, 0]));
      cv.style.width = size.x + 'px'; cv.style.height = size.y + 'px';
      cv.width = Math.round(size.x * dpr); cv.height = Math.round(size.y * dpr);
      const ctx = cv.getContext('2d');
      ctx.fillStyle = SEA; ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.beginPath();
      const b = map.getBounds().pad(0.1);
      for (const ring of coast.rings) {
        if (!ringInBounds(ring, b)) continue;
        for (let i = 0; i < ring.length; i += 2) {
          const p = map.latLngToContainerPoint([ring[i + 1], ring[i]]);
          i ? ctx.lineTo(p.x * dpr, p.y * dpr) : ctx.moveTo(p.x * dpr, p.y * dpr);
        }
        ctx.closePath();
      }
      ctx.fillStyle = LAND; ctx.fill('evenodd');
      ctx.strokeStyle = SHORE; ctx.lineWidth = dpr; ctx.stroke();
    },
  });
}

export function createCachedTileLayer(L) {
  return L.TileLayer.extend({
    createTile(coords, done) {
      const img = document.createElement('img');
      img.alt = ''; img.setAttribute('role', 'presentation');
      const url = this.getTileUrl(coords);
      loadTile(url).then(blob => {
        const obj = URL.createObjectURL(blob);
        img.onload = () => { URL.revokeObjectURL(obj); done(null, img); };
        img.onerror = () => { URL.revokeObjectURL(obj); done(new Error('tile'), img); };
        img.src = obj;
      }).catch(err => { img.style.visibility = 'hidden'; done(err, img); });  // offline: background shows through
      return img;
    },
  });
}

async function loadTile(url) {
  const key = url.replace(/https:\/\/[abc]\./, 'https://');  // same tile from any subdomain
  let cache = null;
  try { cache = await caches.open(TILE_CACHE); } catch { /* no Cache Storage: network only */ }
  const hit = cache && await cache.match(key);
  if (hit) {
    // refresh old tiles quietly in the background when online (OSM: max-age is usually 7 days)
    const age = Date.now() - (+hit.headers.get('x-cached-at') || 0);
    if (navigator.onLine && age > 30 * 86400000) fetchAndStore(url, key, cache).catch(() => {});
    return hit.blob();
  }
  return fetchAndStore(url, key, cache);
}

async function fetchAndStore(url, key, cache) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const blob = await r.blob();
  if (cache) cache.put(key, new Response(blob, { headers: { 'content-type': blob.type, 'x-cached-at': String(Date.now()) } })).catch(() => {});
  return blob;
}

export async function tileCacheInfo() {
  try { const c = await caches.open(TILE_CACHE); return (await c.keys()).length; } catch { return 0; }
}

export function ringInBounds(ring, b) {
  if (!ring._bb) {
    let s = 90, n = -90, w = 180, e = -180;
    for (let i = 0; i < ring.length; i += 2) { const x = ring[i], y = ring[i + 1]; if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
    ring._bb = [s, w, n, e];
  }
  const [s, w, n, e] = ring._bb;
  return !(n < b.getSouth() || s > b.getNorth() || e < b.getWest() || w > b.getEast());
}
