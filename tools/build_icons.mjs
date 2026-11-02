// Renders the original app icon (www/icon.svg) into Android launcher icons.
// Adaptive icon: fish on transparent foreground (inside the 66/108 safe zone) + #0b3d4d background.
import { chromium } from 'playwright'; import fs from 'node:fs';
const svg = fs.readFileSync(new URL('../www/icon.svg', import.meta.url), 'utf8');
const fg = svg.replace(/<rect[^>]*\/>/, '').replace('viewBox="0 0 512 512"', 'viewBox="-140 -140 792 792"');
const res = new URL('../android/app/src/main/res/', import.meta.url).pathname;
const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const b = await chromium.launch(); const p = await b.newPage();
async function render(src, px, file, round = false) {
  await p.setViewportSize({ width: px, height: px });
  await p.setContent(`<html><body style="margin:0;background:transparent"><div style="width:${px}px;height:${px}px;${round ? 'border-radius:50%;overflow:hidden;background:#0b3d4d' : ''}">${src.replace('<svg ', `<svg width="${px}" height="${px}" `)}</div></body></html>`);
  await p.screenshot({ path: file, omitBackground: true });
}
for (const [d, k] of Object.entries(dens)) {
  await render(svg, 48 * k, `${res}mipmap-${d}/ic_launcher.png`);
  await render(fg, 48 * k, `${res}mipmap-${d}/ic_launcher_round.png`, true);
  await render(fg, 108 * k, `${res}mipmap-${d}/ic_launcher_foreground.png`);
}
fs.writeFileSync(`${res}values/ic_launcher_background.xml`, '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#0B3D4D</color>\n</resources>\n');
await b.close(); console.log('icons written');
