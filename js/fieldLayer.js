// One Leaflet layer for every gridded quantity (current, wind, waves, temperature, sea level):
// a smoothed colour field sampled on the screen, optionally cut out along the OSM coastline,
// plus optional black arrows (dots where the vector is below its "calm" threshold).
import { ringInBounds } from './basemap.js';

const STEP = 3;        // colour sample every 3 CSS px, smoothed by the canvas
const ARROW_GAP = 34;  // CSS px between arrows

/** colour lookup table (256 entries) from stops [[value, [r,g,b]], …] */
export function lutFromStops(stops) {
  const lut = new Uint8ClampedArray(256 * 3), lo = stops[0][0], hi = stops.at(-1)[0];
  for (let i = 0; i < 256; i++) {
    const v = lo + (hi - lo) * i / 255;
    let j = 0; while (j < stops.length - 2 && v > stops[j + 1][0]) j++;
    const [a, ca] = stops[j], [b, cb] = stops[j + 1], t = Math.max(0, Math.min(1, (v - a) / (b - a)));
    for (let c = 0; c < 3; c++) lut[i * 3 + c] = ca[c] + (cb[c] - ca[c]) * t;
  }
  return { lut, lo, hi };
}

export function createFieldLayer(L, coast) {
  return L.Layer.extend({
    onAdd(map) {
      this._map = map;
      this._canvas = L.DomUtil.create('canvas', 'current-layer leaflet-zoom-hide');
      map.getPanes().overlayPane.appendChild(this._canvas);
      map.on('moveend zoomend resize', this.redraw, this);
      this.redraw();
    },
    onRemove(map) { this._canvas.remove(); map.off('moveend zoomend resize', this.redraw, this); },
    /**
     * spec: { sample(k,lat,lon,out), k, n (components), value(out)→number, scale:{lut,lo,hi}, alpha (0-255),
     *         eraseLand, arrows(out)→{dx,dy,calm}|null }  – or null to clear
     */
    setSpec(spec) { this._spec = spec; if (this._map) this.redraw(); },

    redraw() {
      const map = this._map, cv = this._canvas, size = map.getSize(), dpr = window.devicePixelRatio || 1;
      L.DomUtil.setPosition(cv, map.containerPointToLayerPoint([0, 0]));
      cv.style.width = size.x + 'px'; cv.style.height = size.y + 'px';
      cv.width = Math.round(size.x * dpr); cv.height = Math.round(size.y * dpr);
      const ctx = cv.getContext('2d');
      ctx.clearRect(0, 0, cv.width, cv.height);
      const sp = this._spec; if (!sp) return;
      const t0 = performance.now(), out = new Float64Array(sp.n || 2), { lut, lo, hi } = sp.scale;

      // 1) colour field on a coarse screen grid
      const w = Math.ceil(size.x / STEP) + 1, h = Math.ceil(size.y / STEP) + 1;
      const img = new ImageData(w, h);
      const latOf = new Float64Array(h), lonOf = new Float64Array(w);
      for (let y = 0; y < h; y++) latOf[y] = map.containerPointToLatLng([0, y * STEP]).lat;
      for (let x = 0; x < w; x++) lonOf[x] = map.containerPointToLatLng([x * STEP, 0]).lng;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (!sp.sample(sp.k, latOf[y], lonOf[x], out)) continue;
        const v = sp.value(out);
        const ci = Math.min(255, Math.max(0, Math.round((v - lo) / (hi - lo) * 255))) * 3, p = (y * w + x) * 4;
        img.data[p] = lut[ci]; img.data[p + 1] = lut[ci + 1]; img.data[p + 2] = lut[ci + 2]; img.data[p + 3] = sp.alpha ?? 204;
      }
      const off = document.createElement('canvas'); off.width = w; off.height = h; off.getContext('2d').putImageData(img, 0, 0);  // no OffscreenCanvas: iOS < 16.4
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(off, -STEP / 2 * dpr, -STEP / 2 * dpr, w * STEP * dpr, h * STEP * dpr);

      // 2) cut out land
      if (sp.eraseLand) {
        ctx.save(); ctx.globalCompositeOperation = 'destination-out'; ctx.beginPath();
        const b = map.getBounds().pad(0.1);
        for (const ring of coast.rings) {
          if (!ringInBounds(ring, b)) continue;
          for (let i = 0; i < ring.length; i += 2) {
            const p = map.latLngToContainerPoint([ring[i + 1], ring[i]]);
            i ? ctx.lineTo(p.x * dpr, p.y * dpr) : ctx.moveTo(p.x * dpr, p.y * dpr);
          }
          ctx.closePath();
        }
        ctx.fill('evenodd'); ctx.restore();
      }

      // 3) arrows where the colour field is visible
      if (sp.arrows) {
        const alpha = ctx.getImageData(0, 0, cv.width, cv.height).data;
        ctx.fillStyle = ctx.strokeStyle = '#000'; ctx.lineWidth = 1.4 * dpr; ctx.lineCap = 'round';
        const len = (map.getZoom() >= 13 ? 15 : 12) * dpr, a = 0.45, hl = 5 * dpr, ca = Math.cos(a), sa = Math.sin(a);
        for (let y = ARROW_GAP / 2; y < size.y; y += ARROW_GAP) for (let x = ARROW_GAP / 2; x < size.x; x += ARROW_GAP) {
          const px = Math.round(x * dpr), py = Math.round(y * dpr);
          if (alpha[(py * cv.width + px) * 4 + 3] < 60) continue;
          const ll = map.containerPointToLatLng([x, y]);
          if (!sp.sample(sp.k, ll.lat, ll.lng, out)) continue;
          const ar = sp.arrows(out); if (!ar) continue;
          if (ar.calm) { ctx.beginPath(); ctx.arc(px, py, 1.6 * dpr, 0, 7); ctx.fill(); continue; }
          const dx = ar.dx, dy = -ar.dy;  // screen y points down
          const hx = px + dx * len / 2, hy = py + dy * len / 2;
          ctx.beginPath(); ctx.moveTo(px - dx * len / 2, py - dy * len / 2); ctx.lineTo(hx, hy); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(hx, hy);
          ctx.lineTo(hx - hl * (dx * ca - dy * sa), hy - hl * (dy * ca + dx * sa));
          ctx.lineTo(hx - hl * (dx * ca + dy * sa), hy - hl * (dy * ca - dx * sa));
          ctx.closePath(); ctx.fill();
        }
      }
      this.lastRenderMs = performance.now() - t0;
    },
  });
}
