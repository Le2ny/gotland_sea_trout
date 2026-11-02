// Full UI walk-through in a phone-sized browser (ENGINE=webkit for Safari's engine):
// load forecast, every map layer, top spots, own spot, holiday home, parking, protection areas,
// GPS warning inside a protection area, offline restart.
import { chromium, webkit } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const engine = process.env.ENGINE === 'webkit' ? webkit : chromium;
const root = new URL('../www/', import.meta.url).pathname, out = process.argv[2] || '.';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const srv = http.createServer((q, s) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0]).replace(/\/$/, '/index.html'));
  fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); s.end(); } else { s.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); s.end(d); } }); }).listen(8765);
const prot = JSON.parse(fs.readFileSync(root + 'data/protection.json')).features[0];
const ring = prot.geometry.type === 'Polygon' ? prot.geometry.coordinates[0] : prot.geometry.coordinates[0][0];
const inside = { latitude: ring.reduce((a, p) => a + p[1], 0) / ring.length, longitude: ring.reduce((a, p) => a + p[0], 0) / ring.length };
const b = await engine.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2.5, hasTouch: true, ...(engine === chromium ? { isMobile: true } : {}),
  geolocation: inside, permissions: engine === chromium ? ['geolocation'] : [] });
if (engine !== chromium) await ctx.grantPermissions(['geolocation']).catch(() => {});
const p = await ctx.newPage(); const errs = [];
p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
p.on('dialog', d => d.accept());
const shot = n => p.screenshot({ path: `${out}/${n}.png` });
const view = async (lat, lon, z) => { await p.evaluate(([a, o, zz]) => window.__map.setView([a, o], zz, { animate: false }), [lat, lon, z]); await p.waitForTimeout(1500); };
await p.goto('http://localhost:8765/'); await p.waitForTimeout(2500);
await p.click('#btnLoad'); await p.waitForFunction(() => /Fertig|Fehler/.test(document.getElementById('progressText').textContent), null, { timeout: 300000 });
console.log('download:', await p.textContent('#progressText')); await p.waitForTimeout(3000);
console.log('status:', await p.textContent('#status'));
for (const layer of ['current', 'wind', 'wave', 'temp', 'level', 'turbidity']) {
  await p.click('#btnLayers'); await p.click(`input[name=main][value=${layer}]`); await p.click('#sheetClose');
  await view(57.45, 18.6, 9); await p.waitForTimeout(layer === 'turbidity' ? 4000 : 500);
  console.log(`layer ${layer}: render ${Math.round(await p.evaluate(() => window.__field.lastRenderMs || 0))} ms, legend "${(await p.textContent('#legend')).replace(/\s+/g, ' ').trim()}"`);
  await shot('L-' + layer);
}
await p.click('#btnLayers'); await p.click('input[name=main][value=current]');
await p.click('input[data-k=parking]'); await p.click('#sheetClose');
await view(57.3084, 18.15, 13); await shot('P-parking-protection');
console.log('parking markers visible:', await p.$$eval('.parkIcon', e => e.length), '· protection polygons:', await p.$$eval('path.leaflet-interactive', e => e.length));
await p.click('#btnSpots'); await p.click('.tabs button[data-tab=best]'); await p.waitForTimeout(500);
console.log('best times top 3:', (await p.$$eval('.spotRow', els => els.slice(0, 3).map(e => e.innerText.replace(/\n/g, ' | ')))).join(' // '));
await shot('S-besttime'); await p.click('#sheetClose');
// own spot
await view(57.52, 18.10, 13);
await p.click('#btnMore'); await p.click('#mAdd'); await p.mouse.click(195, 420); await p.waitForTimeout(400);
await p.fill('#cf input[name=name]', 'Testspot Tofta'); await p.click('#cf button'); await p.waitForTimeout(800);
console.log('own spot sheet:', (await p.textContent('#sheetTitle')), '|', (await p.$eval('.facts', e => e.innerText.replace(/\n/g, ' '))).slice(0, 220));
await shot('C-customspot'); await p.click('#sheetClose');
// holiday home
await p.click('#btnMore'); await p.click('#mHome'); await p.mouse.click(250, 520); await p.waitForTimeout(500);
console.log('home marker:', await p.$$eval('.homeIcon', e => e.length));
// GPS inside a protection area
await p.click('#btnGps'); await p.waitForTimeout(2500);
console.log('GPS warning:', await p.isVisible('#gpsWarn') ? await p.textContent('#gpsWarn') : 'not shown');
await shot('G-gps-warning'); await p.click('#btnGps');
// offline restart
await ctx.setOffline(true); await p.reload(); await p.waitForTimeout(4500);
console.log('offline status:', await p.textContent('#status'));
console.log('offline: spots ranked', await p.$$eval('.spotIcon .badge', els => els.filter(e => /\d/.test(e.textContent)).length), '· custom kept', await p.$$eval('.badge.custom', e => e.length), '· home kept', await p.$$eval('.homeIcon', e => e.length));
await view(57.45, 18.6, 9); await shot('O-offline');
console.log('errors:', errs.filter(e => !/ERR_INTERNET_DISCONNECTED|Failed to load resource|Failed to fetch|NetworkError|Load failed|network connection/i.test(e)).join(' | ') || 'none');
await b.close(); srv.close();
