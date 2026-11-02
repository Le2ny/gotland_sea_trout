// Renders the Android splash screens: Gotland (real OSM coastline) surrounded by streamlines
// traced through a real Copernicus current forecast, coloured with the official palette.
// Usage: node tools/build_splash.mjs   (downloads one forecast, ~56 MB)
import fs from 'node:fs';
import { chromium } from 'playwright';
import { downloadOcean } from '../www/js/copernicus.js';
import { makeSampler } from '../www/js/field.js';
globalThis.atob ??= s => Buffer.from(s, 'base64').toString('binary');

const www = new URL('../www/', import.meta.url).pathname;
const res = new URL('../android/app/src/main/res/', import.meta.url).pathname;
const coast = JSON.parse(fs.readFileSync(www + 'data/coast.json'));
const palette = JSON.parse(fs.readFileSync(www + 'data/palette.json'));
const barriers = JSON.parse(fs.readFileSync(www + 'data/barriers.json'));
const icon = fs.readFileSync(www + 'icon.svg', 'utf8');

const o = await downloadOcean();
const f = { ...o.grid, times: o.times, u: o.u, v: o.v };
const sample = makeSampler(o.grid, [o.u, o.v], barriers), uv = [0, 0];
// pick the hour with the strongest mean current: livelier picture
let k = 0, best = -1;
for (let h = 0; h < f.times.length; h += 3) {
  let s = 0; for (let i = h * f.nr * f.nc, e = i + f.nr * f.nc; i < e; i++) if (f.u[i] !== -999) s += Math.hypot(f.u[i], f.v[i]);
  if (s > best) { best = s; k = h; }
}
// streamlines (lon/lat polylines with speed per vertex)
const cosL = Math.cos(57.4 * Math.PI / 180), lines = [];
for (let lat = 56.62; lat < 58.3; lat += 0.028) for (let lon = 17.42; lon < 20.1; lon += 0.028 / cosL) {
  const sLat = lat + (Math.random() - .5) * .02, sLon = lon + (Math.random() - .5) * .03;
  if (!sample(k, sLat, sLon, uv)) continue;
  const pts = [];
  for (const dir of [-1, 1]) {
    let y = sLat, x = sLon; const seg = [];
    for (let i = 0; i < 45; i++) {
      if (!sample(k, y, x, uv)) break;
      const sp = Math.hypot(uv[0], uv[1]); if (sp < 1e-4) break;
      seg.push([x, y, sp]);
      const st = 0.0045;
      y += dir * st * uv[1] / sp; x += dir * st * uv[0] / sp / cosL;
    }
    if (dir < 0) pts.push(...seg.reverse()); else pts.push(...seg.slice(1));
  }
  if (pts.length > 8) lines.push(pts.map(p => [+p[0].toFixed(4), +p[1].toFixed(4), +p[2].toFixed(3)]));
}
console.log(`hour ${new Date(f.times[k]).toISOString()}, ${lines.length} streamlines`);

const page = (W, H) => `<!doctype html><html><body style="margin:0;background:#06222c">
<canvas id="c" width="${W}" height="${H}"></canvas>
<script>{
const W=${W},H=${H},lines=${JSON.stringify(lines)},rings=${JSON.stringify(coast.rings.filter(r => r.length > 40))},pal=${JSON.stringify(palette.colors)};
const c=document.getElementById('c').getContext('2d');
const g=c.createRadialGradient(W*.5,H*.5,0,W*.5,H*.5,Math.max(W,H)*.75);g.addColorStop(0,'#0f4a5c');g.addColorStop(1,'#041a22');
c.fillStyle=g;c.fillRect(0,0,W,H);
const portrait=H>=W, cosL=${cosL};
// map frame
const lat0=56.62,lat1=58.32,lon0=17.42,lon1=20.08;
const fw=portrait?W*.98:W*.62, fh=portrait?H*.74:H*.98;
const sc=Math.min(fw/((lon1-lon0)*cosL), fh/(lat1-lat0));
const ox=portrait?(W-(lon1-lon0)*cosL*sc)/2:W-(lon1-lon0)*cosL*sc-W*.02, oy=portrait?H*.17+(H*.8-(lat1-lat0)*sc)/2:(H-(lat1-lat0)*sc)/2;
const P=(x,y)=>[ox+(x-lon0)*cosL*sc, oy+(lat1-y)*sc];
const off=document.createElement('canvas');off.width=W;off.height=H;const main=c;{const c=off.getContext('2d');
c.lineCap='round';c.lineWidth=Math.max(1.2,W/520);
for(const l of lines){for(let i=1;i<l.length;i++){const s=l[i][2],ci=Math.min(255,Math.round(s/.7*255*2.2));const col=pal[ci];
 const a=Math.min(1,i/6,(l.length-i)/6)*.85;c.strokeStyle='rgba('+col+','+a+')';const p=P(l[i-1][0],l[i-1][1]),q=P(l[i][0],l[i][1]);c.beginPath();c.moveTo(...p);c.lineTo(...q);c.stroke();}}
const [x0,y0]=P(lon0,lat1),[x1,y1]=P(lon1,lat0),cx=(x0+x1)/2,cy=(y0+y1)/2,rx=(x1-x0)/2,ry=(y1-y0)/2;
c.globalCompositeOperation='destination-in';c.save();c.translate(cx,cy);c.scale(rx,ry);
const m=c.createRadialGradient(0,0,0,0,0,1);m.addColorStop(0,'rgba(0,0,0,1)');m.addColorStop(.72,'rgba(0,0,0,1)');m.addColorStop(1,'rgba(0,0,0,0)');
c.fillStyle=m;c.fillRect(-1.5,-1.5,3,3);c.restore();}
main.drawImage(off,0,0);
// island
c.beginPath();for(const r of rings){for(let i=0;i<r.length;i+=2){const p=P(r[i],r[i+1]);i?c.lineTo(...p):c.moveTo(...p)}c.closePath()}
c.shadowColor='rgba(0,0,0,.45)';c.shadowBlur=W/40;c.fillStyle='#e9e1cf';c.fill('evenodd');c.shadowBlur=0;
c.strokeStyle='rgba(255,255,255,.55)';c.lineWidth=Math.max(1,W/700);c.stroke();
// title
const T=portrait?W*.085:H*.1;c.fillStyle='#fff';c.textBaseline='alphabetic';
c.font='700 '+T+'px sans-serif';
const tx=portrait?W/2:W*.05, ty=portrait?H*.12:H*.42;c.textAlign=portrait?'center':'left';
c.fillText('Gotland Sea Trout',tx,ty);
c.font='400 '+T*.42+'px sans-serif';c.fillStyle='rgba(255,255,255,.8)';
c.fillText('Strömung · Spots · offline',tx,ty+T*.75);
c.font='400 '+T*.28+'px sans-serif';c.fillStyle='rgba(255,255,255,.55)';
c.fillText('Strömung © Copernicus Marine Service · Küste © OpenStreetMap',portrait?W/2:tx,portrait?H*.975:H*.95);
}</script>
<img id="fish" src="data:image/svg+xml;base64,${Buffer.from(icon).toString('base64')}" style="position:absolute;width:${Math.round(Math.min(W, H) * 0.16)}px;${H >= W ? `left:${Math.round(W / 2 - Math.min(W, H) * 0.08)}px;top:${Math.round(H * 0.015)}px` : `left:${Math.round(W * 0.05)}px;top:${Math.round(H * 0.12)}px`};border-radius:22%">
</body></html>`;

const b = await chromium.launch(); const p = await b.newPage(); p.on('pageerror', e => console.log('PAGE ERROR', e.message));
const targets = fs.readdirSync(res).filter(d => d.startsWith('drawable')).filter(d => fs.existsSync(`${res}${d}/splash.png`));
for (const d of targets) {
  const buf = fs.readFileSync(`${res}${d}/splash.png`), W = buf.readUInt32BE(16), H = buf.readUInt32BE(20);
  await p.setViewportSize({ width: W, height: H });
  await p.setContent(page(W, H)); await p.waitForTimeout(150);
  await p.screenshot({ path: `${res}${d}/splash.png` });
}
await p.setViewportSize({ width: 1080, height: 2280 }); await p.setContent(page(1080, 2280)); await p.waitForTimeout(150);
await p.screenshot({ path: new URL('../test/splash-preview.png', import.meta.url).pathname });
fs.mkdirSync(www + 'img', { recursive: true });
await p.screenshot({ path: www + 'img/intro.jpg', type: 'jpeg', quality: 82 });
await b.close(); console.log('splash written for', targets.join(', '));
