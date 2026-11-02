// Bundles data that rarely changes, so the app has it offline:
// - www/data/parking.json    : public parking near the coast (OSM via Overpass, same filter as the original app)
// - www/data/protection.json : official sea-trout protection areas (Länsstyrelsen "Svenska fiskeregler",
//                               same query and filter as the original app); the app refreshes it online.
// Usage: node tools/build_static.mjs
import fs from 'node:fs';
import { coastIndex } from '../www/js/geo.js';
import { fetchProtection } from '../www/js/protection.js';

const root = new URL('../www/data/', import.meta.url).pathname;
const coast = JSON.parse(fs.readFileSync(root + 'coast.json', 'utf8'));
const ix = coastIndex(coast);

// --- parking
const bb = '56.85,17.95,58.42,19.40';
const q = `[out:json][timeout:90];(node[amenity=parking](${bb});way[amenity=parking](${bb});relation[amenity=parking](${bb}););out center tags;`;
let d = null;
const EPS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
for (let attempt = 0; attempt < 8 && !d; attempt++) {
  const ep = EPS[attempt % EPS.length];
  if (attempt >= EPS.length) await new Promise(r => setTimeout(r, 10000));
  try {
    const r = await fetch(ep, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'gotland-sea-trout-app-build/1.0' } });
    if (r.ok) { d = await r.json(); console.log('overpass ok:', ep); break; }
    console.warn(ep, r.status);
  } catch (e) { console.warn(ep, e.message); }
}
if (!d) throw new Error('Overpass nicht erreichbar');
const MAX_PARK_COAST_M = 800;  // as in the original app
const items = d.elements.filter(x => x.tags?.amenity === 'parking').map(x => ({
  lat: x.lat ?? x.center?.lat, lon: x.lon ?? x.center?.lon, name: x.tags?.name || 'Parkplatz',
  access: x.tags?.access || '', foot: x.tags?.foot || '', surface: x.tags?.surface || '', capacity: x.tags?.capacity || '', fee: x.tags?.fee || '',
})).filter(x => x.lat && x.lon && !['private', 'no'].includes(x.access) && x.foot !== 'no')
  .map(x => ({ ...x, coast: Math.round(ix.distToCoast(x.lat, x.lon, MAX_PARK_COAST_M)) }))
  .filter(x => Number.isFinite(x.coast) && x.coast <= MAX_PARK_COAST_M)
  .map(({ access, foot, ...x }) => ({ ...x, lat: +x.lat.toFixed(6), lon: +x.lon.toFixed(6) }));
fs.writeFileSync(root + 'parking.json', JSON.stringify({ source: '© OpenStreetMap contributors (ODbL)', fetchedAt: new Date().toISOString(), maxCoastM: MAX_PARK_COAST_M, items }));
console.log(`parking.json: ${items.length} of ${d.elements.length} parking places within ${MAX_PARK_COAST_M} m of the coast`);

// --- protection areas
const prot = await fetchProtection();
fs.writeFileSync(root + 'protection.json', JSON.stringify(prot));
console.log(`protection.json: ${prot.features.length} areas, ${Math.round(fs.statSync(root + 'protection.json').size / 1024)} KB`);
