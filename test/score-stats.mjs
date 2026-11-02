// Statistics of the original scoring over the next 72 h for all spots (real data),
// used as evidence for the scoring suggestions.
import fs from 'node:fs';
import { downloadForecast } from '../www/js/copernicus.js';
import { makeSampler } from '../www/js/field.js';
import { downloadWeather } from '../www/js/weather.js';
import { rankAll, exposure, angleDiff } from '../www/js/ranking.js';
globalThis.atob ??= s => Buffer.from(s, 'base64').toString('binary');
const d = n => JSON.parse(fs.readFileSync(new URL(`../www/data/${n}.json`, import.meta.url)));
const spots = d('spots'), barriers = d('barriers');
const f = await downloadForecast(); const w = await downloadWeather(spots, f.times);
const sample = makeSampler(f, barriers);
const all = []; const reasonCount = {}; const topPerHour = [];
for (let k = 0; k < f.times.length; k++) {
  const r = rankAll(spots, sample, k, w); topPerHour.push(r.filter(x => x.score >= 90).length);
  for (const x of r) { all.push({ ...x, k }); for (const re of x.reasons) reasonCount[re] = (reasonCount[re] || 0) + 1; }
}
const N = all.length, pct = n => (100 * n / N).toFixed(1) + ' %';
const sc = all.map(x => x.score).sort((a, b) => a - b), q = p => sc[Math.floor(p * (N - 1))];
console.log(`period ${new Date(f.times[0]).toISOString()} .. ${new Date(f.times.at(-1)).toISOString()}, ${spots.length} spots x ${f.times.length} h = ${N}`);
console.log(`score min ${sc[0]} p10 ${q(.1)} median ${q(.5)} p90 ${q(.9)} max ${sc.at(-1)}`);
console.log(`score = 100: ${pct(all.filter(x => x.score === 100).length)}, >= 90: ${pct(all.filter(x => x.score >= 90).length)}, < 60: ${pct(all.filter(x => x.score < 60).length)}`);
console.log(`spots >= 90 per hour: min ${Math.min(...topPerHour)} median ${topPerHour.sort((a, b) => a - b)[36]} max ${Math.max(...topPerHour)}`);
const raw = all.map(x => { let n = 28 + x.spot.rating * 5; return n; });
const off = all.filter(x => x.w?.wind_direction_10m != null && exposure(x.spot, x.w.wind_direction_10m) === 'ablandig');
console.log(`offshore wind (ablandig): ${pct(off.length)} of cases; of those score >= 80: ${(100 * off.filter(x => x.score >= 80).length / off.length).toFixed(0)} %, penalised (d>150): ${(100 * off.filter(x => angleDiff(x.spot.facing, x.w.wind_direction_10m) > 150).length / off.length).toFixed(0)} %`);
const cur = all.filter(x => x.cur); const ev = cur.map(x => x.cur.edge).sort((a, b) => a - b);
console.log(`current available ${pct(cur.length)}; speed median ${cur.map(x => x.cur.v).sort((a, b) => a - b)[cur.length >> 1].toFixed(3)} m/s; edge median ${ev[ev.length >> 1].toFixed(4)} p90 ${ev[Math.floor(.9 * ev.length)].toFixed(4)} max ${ev.at(-1).toFixed(3)}; edge >= 0.06: ${pct(cur.filter(x => x.cur.edge >= .06).length)}`);
console.log(`current via nearest point (spot itself without model value): ${pct(cur.filter(x => x.cur.dist > 0).length)}, median distance ${cur.filter(x => x.cur.dist > 0).map(x => x.cur.dist).sort((a, b) => a - b)[0] ?? '-'}..`);
const wind = all.filter(x => x.w?.wind_speed_10m != null).map(x => x.w.wind_speed_10m);
console.log(`wind km/h median ${wind.sort((a, b) => a - b)[wind.length >> 1].toFixed(0)}, in 8..26: ${pct(wind.filter(v => v >= 8 && v <= 26).length)}`);
const sst = all.filter(x => x.m?.sea_surface_temperature != null);
console.log(`SST in 4..14: ${pct(sst.filter(x => x.m.sea_surface_temperature >= 4 && x.m.sea_surface_temperature <= 14).length)}; waves 0.2..1.05: ${pct(all.filter(x => x.m?.wave_height >= .2 && x.m.wave_height <= 1.05).length)}`);
console.log('reasons:', Object.entries(reasonCount).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${pct(v)}`).join('; '));
const unc = all.map(x => { let n = 28 + x.spot.rating * 5; for (const re of x.reasons) n += { 'brauchbarer Wind': 10, 'Wind zur Küste passend': 9, 'passende Welle': 10, 'passende Wassertemperatur': 8, 'leichte–mäßige Strömung': 13, 'deutliche Strömung': 7, 'Strömung längs/schräg zur Küste': 9, 'Strömungskante im Umfeld': 12 }[re] || 0; return n; });
console.log(`uncapped raw score > 100 (before penalties): ${pct(unc.filter(v => v > 100).length)}, max ${Math.max(...unc)}`);
const byHour = new Set(); for (const sp of spots) { const s = all.filter(x => x.spot.id === sp.id).map(x => x.score); byHour.add(Math.max(...s) - Math.min(...s)); }
console.log(`score range over 72 h per spot: min ${Math.min(...byHour)} max ${Math.max(...byHour)}`);
const rat = {}; for (const x of all) (rat[x.spot.rating] ??= []).push(x.score);
console.log('mean score by spot rating:', Object.entries(rat).map(([r, v]) => `${r}★ ${(v.reduce((a, b) => a + b) / v.length).toFixed(0)}`).join(', '));
