// Precomputes www/data/barriers.json for the current Copernicus model grid (see www/js/geo.js).
// The app recomputes it on the phone by itself if Copernicus ever changes the grid.
// Usage: node tools/build_barriers.mjs
import fs from 'node:fs';
import { fetchGrid, discoverDatasets } from '../www/js/copernicus.js';
import { computeBarriers } from '../www/js/geo.js';

const root = new URL('../www/data/', import.meta.url).pathname;
const coast = JSON.parse(fs.readFileSync(root + 'coast.json', 'utf8'));
const ds = await discoverDatasets();
const grid = await fetchGrid(ds.cur);
const t0 = Date.now();
const out = computeBarriers(coast, grid);
out.dataset = ds.cur.id;
fs.writeFileSync(root + 'barriers.json', JSON.stringify(out));
console.log(`${ds.cur.id}: grid ${grid.nr}x${grid.nc}, ${Object.keys(out.cells).length} coastal/inland cells, ${((Date.now() - t0) / 1000).toFixed(1)} s, ${Math.round(fs.statSync(root + 'barriers.json').size / 1024)} KB`);
