// Day planner in the browser with real data (PLAN-T01, T08, T09, T10, T11, T15) + spot sheet + satellite-only
import { chromium, webkit } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const engine = process.env.ENGINE === 'webkit' ? webkit : chromium;
const root = new URL('../www/', import.meta.url).pathname, out = process.argv[2] || '.';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const srv = http.createServer((q, s) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0]).replace(/\/$/, '/index.html'));
  fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); s.end(); } else { s.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); s.end(d); } }); }).listen(8780);
const b = await engine.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2.5, hasTouch: true, geolocation: { latitude: 57.6348, longitude: 18.2948 }, permissions: engine === chromium ? ['geolocation'] : [] });
const p = await ctx.newPage(); const errs = [];
p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errs.push(m.text())); p.on('dialog', d => d.accept(d.type() === 'prompt' ? '120' : undefined));
const shot = n => p.screenshot({ path: `${out}/${n}.png` });
await p.goto('http://localhost:8780/'); await p.waitForTimeout(2500); await p.click('#introGo').catch(() => {});
await p.click('#btnLoad'); await p.waitForFunction(() => /Fertig|Fehler/.test(document.getElementById('progressText').textContent), null, { timeout: 300000 });
console.log('load:', await p.textContent('#progressText')); await p.waitForTimeout(2000);
// spot sheet: four answers + windows
await p.evaluate(() => window.__map.setView([57.42, 18.93], 12, { animate: false })); await p.waitForTimeout(800);
await p.click('#btnSpots'); await p.click('.spotRow'); await p.waitForTimeout(600);
console.log('spot:', await p.textContent('#sheetTitle'), '|', (await p.$eval('.four', e => e.innerText.replace(/\n+/g, ' / '))).slice(0, 260));
console.log('windows:', await p.$$eval('.win', e => e.map(x => x.innerText.replace(/\n/g, ' ')).join(' | ')));
await shot('P1-spot'); await p.click('#sheetClose');
// one-click plan with defaults
await p.click('#btnPlan'); await p.waitForTimeout(800); await p.click('#pf button'); await p.waitForSelector('.stop', { timeout: 60000 });
const summary = async () => ({ head: (await p.$eval('.planHead', e => e.innerText.replace(/\n+/g, ' '))), stops: await p.$$eval('.stop .stopHead b:not(.num)', e => e.map(x => x.textContent)), origin: await p.$$eval('.stop', e => e.map(x => x.classList.contains('manual') ? 'M' : 'A')) });
console.log('plan:', JSON.stringify(await summary()));
console.log('first stop:', (await p.$eval('.stop', e => e.innerText.replace(/\n+/g, ' | '))).slice(0, 420));
await shot('P2-plan');
// insert a manual spot between stop 1 and 2
const n0 = await p.$$eval('.stop', e => e.length);
await p.click(`.ins[data-pos="${Math.min(1, n0)}"]`); await p.waitForTimeout(400);
const pick = await p.$$('.spotRow'); await pick[pick.length - 1].click(); await p.waitForTimeout(1500);
const s1 = await summary(); console.log('after insert:', JSON.stringify(s1));
// pin an automatic stop
const pinBtn = await p.$('[data-pin]'); if (pinBtn) { await pinBtn.click(); await p.waitForTimeout(1200); }
console.log('after pin:', JSON.stringify((await summary()).origin));
await p.click('#pReplan'); await p.waitForTimeout(1500);
const s2 = await summary(); console.log('after replan:', JSON.stringify(s2));
// persistence: reload → plan still there with the same manual stops
await p.reload(); await p.waitForTimeout(3500); await p.click('#introGo').catch(() => {}); await p.waitForTimeout(500);
await p.click('#btnPlan'); await p.waitForTimeout(800);
const s3 = await summary(); console.log('after reload:', JSON.stringify(s3), '| same:', JSON.stringify(s3.stops) === JSON.stringify(s2.stops));
await shot('P3-plan-reload'); await p.click('#sheetClose');
// satellite only
await p.click('#btnSat'); await p.waitForTimeout(800);
console.log('sat-only: legend hidden', await p.$eval('#legend', e => e.hidden), '| field drawn', await p.evaluate(() => !!window.__field._spec));
await shot('P4-satonly'); await p.click('#btnSat'); await p.waitForTimeout(500);
console.log('restored: legend hidden', await p.$eval('#legend', e => e.hidden), '| field drawn', await p.evaluate(() => !!window.__field._spec));
console.log('errors:', errs.join(' | ') || 'none');
await b.close(); srv.close();
