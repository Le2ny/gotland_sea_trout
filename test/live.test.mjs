// Tests the published web app (GitHub Pages): first start, forecast download,
// then full offline restart served by the service worker.
import { chromium, webkit } from 'playwright';
const engine = process.env.ENGINE === 'webkit' ? webkit : chromium;
const URL_ = process.argv[2] || 'https://le2ny.github.io/gotland_sea_trout/', out = process.argv[3] || '.';
const b = await engine.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: process.env.ENGINE !== 'webkit' || true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
const p = await ctx.newPage(); const errs = [];
p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
await p.goto(URL_); await p.waitForTimeout(3000);
console.log('manifest:', await p.evaluate(async () => (await (await fetch(document.querySelector('link[rel=manifest]').href)).json()).name));
console.log('service worker:', await p.evaluate(async () => { const r = await navigator.serviceWorker.ready; return r.active?.state; }));
await p.click('#btnLoad'); await p.waitForFunction(() => /Fertig|Fehler/.test(document.getElementById('progressText').textContent), null, { timeout: 240000 });
console.log('download:', await p.textContent('#progressText'));
await p.waitForTimeout(3000); await p.screenshot({ path: `${out}/live-1.png` });
await ctx.setOffline(true);
await p.reload(); await p.waitForTimeout(4000);
console.log('offline restart status:', await p.textContent('#status'));
console.log('offline spots ranked:', await p.$$eval('.spotIcon .badge', els => els.filter(e => /\d/.test(e.textContent)).length));
await p.screenshot({ path: `${out}/live-2-offline.png` });
console.log('errors:', errs.filter(e => !/ERR_INTERNET_DISCONNECTED|Failed to load resource|Failed to fetch/.test(e)).join(' | ') || 'none');
await b.close();
