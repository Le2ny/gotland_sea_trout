// Serves www/, opens it in a phone-sized headless Chromium, loads forecast + weather,
// checks ranking and spot sheet, then reloads with all internet blocked (offline test).
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const root = new URL('../www/', import.meta.url).pathname, out = process.argv[2] || '.';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const srv = http.createServer((q, s) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0]).replace(/\/$/, '/index.html'));
  fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); s.end(); } else { s.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); s.end(d); } }); }).listen(8765);
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 400, height: 860 }, deviceScaleFactor: 2.5, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
await p.goto('http://localhost:8765/'); await p.waitForTimeout(1500);
await p.click('#btnLoad'); await p.waitForFunction(() => /Fertig|Fehler/.test(document.getElementById('progressText').textContent), null, { timeout: 180000 });
console.log('progress:', await p.textContent('#progressText')); await p.waitForTimeout(3000);
await p.screenshot({ path: `${out}/1-overview.png` });
await p.click('#btnSpots'); await p.waitForTimeout(500);
console.log('top 5:', (await p.$$eval('.spotRow', els => els.slice(0, 5).map(e => e.innerText.replace(/\n/g, ' | ')))).join('\n       '));
await p.screenshot({ path: `${out}/2-list.png` });
await p.click('.spotRow'); await p.waitForTimeout(2500);
console.log('spot sheet:', (await p.textContent('#sheetTitle')), '\n', await p.$eval('.facts', e => e.innerText.replace(/\n/g, ' ')));
await p.screenshot({ path: `${out}/3-spot.png` });
await p.click('#sheetClose');
for (const [lat, lon, z] of [[57.3084, 18.135, 12], [57.968, 19.08, 14]]) { await p.evaluate(([a, o, zz]) => window.__map.setView([a, o], zz, { animate: false }), [lat, lon, z]); await p.waitForTimeout(2500); }
console.log('render ms (Fårö z14):', await p.evaluate(() => Math.round(window.__layer.lastRenderMs)));
// offline: block everything except the local app
await p.route(u => !u.href.startsWith('http://localhost'), r => r.abort());
await p.reload(); await p.waitForTimeout(3000);
console.log('offline status:', await p.textContent('#status'));
await p.evaluate(() => window.__map.setView([57.968, 19.08], 14, { animate: false })); await p.waitForTimeout(2000);
await p.screenshot({ path: `${out}/4-offline-viewed.png` });
await p.evaluate(() => window.__map.setView([56.95, 18.2], 13, { animate: false })); await p.waitForTimeout(2000);
await p.screenshot({ path: `${out}/5-offline-not-viewed.png` });
console.log('errors:', errs.filter(e => !/ERR_FAILED|Failed to load resource/.test(e)).length ? errs : 'none (blocked tile requests offline ignored)');
await b.close(); srv.close();
