// Diary in the browser: session with bite + catch (rule warning), zero-catch session, stats, encrypted export → import preview, plan → diary
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const root = new URL('../www/', import.meta.url).pathname, out = process.argv[2] || '.';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
const srv = http.createServer((q, s) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0]).replace(/\/$/, '/index.html'));
  fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); s.end(); } else { s.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); s.end(d); } }); }).listen(8781);
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2.5, hasTouch: true, isMobile: true, geolocation: { latitude: 57.4200, longitude: 18.9330 }, permissions: ['geolocation'], acceptDownloads: true });
const p = await ctx.newPage(); const errs = [];
p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errs.push(m.text()));
const answers = []; p.on('dialog', d => d.accept(d.type() === 'prompt' ? (answers.shift() ?? '') : undefined));
const shot = n => p.screenshot({ path: `${out}/${n}.png` });
await p.goto('http://localhost:8781/'); await p.waitForTimeout(2000); await p.click('#introGo').catch(() => {});
await p.click('#btnLoad'); await p.waitForFunction(() => /Fertig|Fehler/.test(document.getElementById('progressText').textContent), null, { timeout: 300000 }); await p.waitForTimeout(1500);
// session at Herrvik (nearest spot to GPS)
await p.click('#btnDiary'); await p.click('#dStart'); await p.waitForTimeout(800);
console.log('start form spot:', await p.$eval('select[name=spot]', e => e.selectedOptions[0].textContent));
await p.fill('input[name=lures]', 'Snaps 25 g kupfer'); await p.click('#sf button'); await p.waitForTimeout(500);
await p.click('#aBite'); await p.waitForTimeout(300); await p.click('#aBite'); await p.waitForTimeout(300);
await p.click('#aCatch'); await p.waitForTimeout(500);
await p.selectOption('select[name=species]', 'Meerforelle'); await p.fill('input[name=len]', '45'); await p.uncheck('input[name=released]'); await p.waitForTimeout(300);
console.log('rule warnings:', await p.$$eval('#rw .warn', e => e.map(x => x.textContent).join(' | ')));
await shot('D1-catch'); await p.check('input[name=released]'); await p.click('#cf button'); await p.waitForTimeout(500);
console.log('active card:', (await p.$eval('.stop.manual', e => e.innerText.replace(/\n+/g, ' | '))).slice(0, 300));
await p.click('#aEnd'); await p.waitForTimeout(500);
// zero-catch session
await p.click('#dStart'); await p.click('#sf button'); await p.waitForTimeout(300); await p.click('#aEnd'); await p.waitForTimeout(400);
console.log('sessions listed:', await p.$$eval('.spotRow', e => e.length));
await p.click('#dStats'); await p.waitForTimeout(300); console.log('stats:', (await p.$eval('.kv', e => e.innerText.replace(/\n/g, ' '))));
await shot('D2-stats'); await p.click('#sb');
// encrypted export
answers.push('geheim123', 'geheim123');
const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#dExport')]);
const file = path.join(out, 'backup.json'); await dl.saveAs(file);
const txt = fs.readFileSync(file, 'utf8'); console.log('export: encrypted', JSON.parse(txt).cipher, '| readable species in file:', /Meerforelle/.test(txt));
// import into the same diary → preview says unchanged
answers.push('geheim123');
await p.setInputFiles('#dImport', file); await p.waitForTimeout(1500);
console.log('import preview:', (await p.$eval('.kv', e => e.innerText.replace(/\n/g, ' '))));
await p.click('#iNo'); await p.waitForTimeout(300);
// plan → diary
await p.click('#sheetClose'); await p.click('#btnPlan'); await p.waitForTimeout(500); await p.click('#pf button'); await p.waitForSelector('.stop', { timeout: 60000 });
await p.click('#pDiary'); await p.waitForTimeout(800);
console.log('planned in diary:', await p.$$eval('[data-go]', e => e.length));
await shot('D3-planned');
// reload: diary persists
await p.reload(); await p.waitForTimeout(3000); await p.click('#introGo').catch(() => {}); await p.click('#btnDiary'); await p.waitForTimeout(500);
console.log('after reload: sessions', await p.$$eval('.spotRow', e => e.length), '| planned', await p.$$eval('[data-go]', e => e.length));
console.log('errors:', errs.join(' | ') || 'none');
await b.close(); srv.close();
