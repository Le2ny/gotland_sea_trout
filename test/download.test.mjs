import { downloadForecast, NODATA } from '../www/js/copernicus.js';
const t0 = Date.now(); let last = 0;
const f = await downloadForecast((d, n, b) => { if (d - last >= 40 || d === n) { last = d; console.log(`  ${d}/${n} ${(b/1e6).toFixed(1)} MB`); } });
const plane = f.nr * f.nc;
const valid = k => { let n = 0; for (let i = 0; i < plane; i++) if (f.u[k*plane+i] !== NODATA && f.v[k*plane+i] !== NODATA) n++; return n; };
let maxS = 0; for (let i = 0; i < f.u.length; i++) if (f.u[i] !== NODATA) maxS = Math.max(maxS, Math.hypot(f.u[i], f.v[i]));
console.log(`grid ${f.nr}x${f.nc}, hours ${f.times.length}, first ${new Date(f.times[0]).toISOString()}, last ${new Date(f.times.at(-1)).toISOString()}`);
console.log(`valid pairs h0 ${valid(0)}, h72 ${valid(f.times.length-1)}, max speed ${maxS.toFixed(3)} m/s`);
console.log(`download ${(f.bytes/1e6).toFixed(1)} MB in ${((Date.now()-t0)/1000).toFixed(0)} s`);
