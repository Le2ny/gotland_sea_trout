// Leaflet layer: colour field (official Copernicus rainbow 0–0.7 m/s, ~80 % opacity),
// land cut out with the OSM coastline, black arrows (dots below 0.01 m/s).
import { ringInBounds } from './basemap.js';

const STEP = 3;          // colour sample every 3 CSS px, smoothed by the canvas
const ARROW_GAP = 34;    // CSS px between arrows
const CALM = 0.01;       // m/s, display threshold for dots

export function createCurrentLayer(L, palette, coast) {
  const lut = new Uint8ClampedArray(256 * 3);
  palette.colors.forEach((c, i) => lut.set(c, i * 3));

  return L.Layer.extend({
    onAdd(map) {
      this._map = map;
      this._canvas = L.DomUtil.create('canvas', 'current-layer leaflet-zoom-hide');
      map.getPanes().overlayPane.appendChild(this._canvas);
      map.on('moveend zoomend resize', this.redraw, this);
      this.redraw();
    },
    onRemove(map) {
      this._canvas.remove();
      map.off('moveend zoomend resize', this.redraw, this);
    },
    /** sampler: the same function the ranking and popups use (field.js makeSampler) */
    setData(forecast, hour, sampler) {
      this._f = forecast; this._k = hour; this._sample = sampler;
      if (this._map) this.redraw();
    },
    setHour(hour) { this._k = hour; if (this._map) this.redraw(); },

    redraw() {
      const map = this._map, cv = this._canvas, size = map.getSize(), dpr = window.devicePixelRatio || 1;
      L.DomUtil.setPosition(cv, map.containerPointToLayerPoint([0, 0]));
      cv.style.width = size.x + 'px'; cv.style.height = size.y + 'px';
      cv.width = Math.round(size.x * dpr); cv.height = Math.round(size.y * dpr);
      const ctx = cv.getContext('2d');
      ctx.clearRect(0, 0, cv.width, cv.height);
      if (!this._f) return;
      const t0 = performance.now();
      const k = this._k, sample = this._sample, uv = [0, 0];

      // 1) colour field, sampled on a coarse screen grid
      const w = Math.ceil(size.x / STEP) + 1, h = Math.ceil(size.y / STEP) + 1;
      const img = new ImageData(w, h);
      const latOf = new Float64Array(h), lonOf = new Float64Array(w);
      for (let y = 0; y < h; y++) latOf[y] = map.containerPointToLatLng([0, y * STEP]).lat;
      for (let x = 0; x < w; x++) lonOf[x] = map.containerPointToLatLng([x * STEP, 0]).lng;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (!sample(k, latOf[y], lonOf[x], uv)) continue;
        const s = Math.hypot(uv[0], uv[1]);
        const ci = Math.min(255, Math.max(0, Math.round(s / palette.max * 255))) * 3, p = (y * w + x) * 4;
        img.data[p] = lut[ci]; img.data[p + 1] = lut[ci + 1]; img.data[p + 2] = lut[ci + 2]; img.data[p + 3] = 204;
      }
      const off = document.createElement('canvas'); off.width = w; off.height = h; off.getContext('2d').putImageData(img, 0, 0);  // no OffscreenCanvas: iOS < 16.4
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      // pixel (x,y) of the small image is the sample at screen point (x*STEP, y*STEP)
      ctx.drawImage(off, -STEP / 2 * dpr, -STEP / 2 * dpr, w * STEP * dpr, h * STEP * dpr);

      // 2) cut out land
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
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
      ctx.fill('evenodd');
      ctx.restore();

      // 3) arrows where the colour field is visible (= sea with model support)
      const alpha = ctx.getImageData(0, 0, cv.width, cv.height).data;
      ctx.fillStyle = ctx.strokeStyle = '#000';
      ctx.lineWidth = 1.4 * dpr; ctx.lineCap = 'round';
      const z = map.getZoom(), len = (z >= 13 ? 15 : 12) * dpr;
      for (let y = ARROW_GAP / 2; y < size.y; y += ARROW_GAP) for (let x = ARROW_GAP / 2; x < size.x; x += ARROW_GAP) {
        const px = Math.round(x * dpr), py = Math.round(y * dpr);
        if (alpha[(py * cv.width + px) * 4 + 3] < 100) continue;
        const ll = map.containerPointToLatLng([x, y]);
        if (!sample(k, ll.lat, ll.lng, uv)) continue;
        const s = Math.hypot(uv[0], uv[1]);
        if (s < CALM) { ctx.beginPath(); ctx.arc(px, py, 1.6 * dpr, 0, 7); ctx.fill(); continue; }
        const dx = uv[0] / s, dy = -uv[1] / s;  // screen y points down
        const hx = px + dx * len / 2, hy = py + dy * len / 2;
        ctx.beginPath(); ctx.moveTo(px - dx * len / 2, py - dy * len / 2); ctx.lineTo(hx, hy); ctx.stroke();
        const a = 0.45, hl = 5 * dpr;
        ctx.beginPath(); ctx.moveTo(hx, hy);
        ctx.lineTo(hx - hl * (dx * Math.cos(a) - dy * Math.sin(a)), hy - hl * (dy * Math.cos(a) + dx * Math.sin(a)));
        ctx.lineTo(hx - hl * (dx * Math.cos(a) + dy * Math.sin(a)), hy - hl * (dy * Math.cos(a) - dx * Math.sin(a)));
        ctx.closePath(); ctx.fill();
      }
      this.lastRenderMs = performance.now() - t0;
    },
  });
}
