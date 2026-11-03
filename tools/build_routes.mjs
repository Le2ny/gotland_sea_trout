// Precomputes travel times for the day planner (PLAN-01), so planning works offline:
// - per spot up to 3 parking places with the real FOOT route (parking → spot)
// - a CAR time/distance matrix between all those parking places
// Routing: FOSSGIS OSRM servers on OpenStreetMap data (routing.openstreetmap.de), queried slowly
// (≤1 request/s) once at build time. Data © OpenStreetMap contributors (ODbL).
// Usage: node tools/build_routes.mjs
import fs from 'node:fs';

const root = new URL('../www/data/', import.meta.url).pathname;
const spots = JSON.parse(fs.readFileSync(root + 'spots.json', 'utf8'));
const parking = JSON.parse(fs.readFileSync(root + 'parking.json', 'utf8')).items;
const OSRM = 'https://routing.openstreetmap.de';
const UA = { 'User-Agent': 'gotland-sea-trout-app/1.0 (build-time route matrix, contact via github.com/Le2ny)' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hav = (a, b) => { const R = 6371000, p1 = a.lat * Math.PI / 180, p2 = b.lat * Math.PI / 180, dp = p2 - p1, dl = (b.lon - a.lon) * Math.PI / 180;
  return 2 * R * Math.asin(Math.sqrt(Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2)); };
async function get(url) {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url, { headers: UA }); await sleep(1100);
    if (r.ok) return r.json();
    console.warn('retry', r.status, url.slice(0, 90)); await sleep(3000 * (i + 1));
  }
  throw new Error('routing failed: ' + url);
}

const out = { generatedAt: new Date().toISOString(), source: 'FOSSGIS OSRM (routing.openstreetmap.de), © OpenStreetMap contributors (ODbL)', spots: {}, nodes: [], car: null };
const nodeIndex = new Map();
const node = p => { const key = `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`; if (!nodeIndex.has(key)) { nodeIndex.set(key, out.nodes.length); out.nodes.push({ lat: +p.lat.toFixed(6), lon: +p.lon.toFixed(6), name: p.name || null }); } return nodeIndex.get(key); };

for (const s of spots) {
  const cand = parking.map(p => ({ ...p, d: hav(s, p) })).filter(p => p.d <= 2500).sort((a, b) => a.d - b.d).slice(0, 6);
  const walks = [];
  for (const p of cand) {
    const r = await get(`${OSRM}/routed-foot/route/v1/foot/${p.lon},${p.lat};${s.lon},${s.lat}?overview=false`);
    const rt = r.routes?.[0]; if (!rt) continue;
    // OSRM snaps to the nearest path; the last bit to the shore is cross-country → add the snapping distance at 3 km/h
    const snap = (r.waypoints?.[1]?.distance || 0);
    walks.push({ node: node(p), name: p.name, walkM: Math.round(rt.distance + snap), walkMin: Math.round(rt.duration / 60 + snap / 50), fee: p.fee || null, capacity: p.capacity || null, straightM: Math.round(p.d) });
  }
  walks.sort((a, b) => a.walkMin - b.walkMin);
  const best = walks.filter(w => w.walkMin <= 30).slice(0, 3);
  if (!best.length) {  // no mapped parking nearby: nearest point on a drivable road + footpath from there
    const nr = await get(`${OSRM}/routed-car/nearest/v1/driving/${s.lon},${s.lat}`);
    const [lon, lat] = nr.waypoints[0].location;
    const r = await get(`${OSRM}/routed-foot/route/v1/foot/${lon},${lat};${s.lon},${s.lat}?overview=false`);
    const rt = r.routes?.[0], snap = r.waypoints?.[1]?.distance || 0;
    best.push({ node: node({ lat, lon, name: 'Straßenrand (kein offizieller Parkplatz bekannt)' }), name: null, roadside: true,
      walkM: rt ? Math.round(rt.distance + snap) : null, walkMin: rt ? Math.round(rt.duration / 60 + snap / 50) : null });
  }
  out.spots[s.id] = { parkings: best };
  console.log(`${s.name}: ${best.map(b => b.roadside ? `Straßenrand, ${b.walkMin} min zu Fuß` : `${b.walkMin} min zu Fuß (${b.name})`).join(' | ')}`);
}

// car matrix between all nodes (OSRM table, max ~100 coordinates per request)
const coords = out.nodes.map(n => `${n.lon},${n.lat}`).join(';');
const t = await get(`${OSRM}/routed-car/table/v1/driving/${coords}?annotations=duration,distance`);
out.car = { durMin: t.durations.map(r => r.map(x => x == null ? null : Math.round(x / 6) / 10)), distKm: t.distances.map(r => r.map(x => x == null ? null : Math.round(x / 100) / 10)) };
fs.writeFileSync(root + 'routes.json', JSON.stringify(out));
console.log(`routes.json: ${out.nodes.length} nodes, ${Object.keys(out.spots).length} spots, ${Math.round(fs.statSync(root + 'routes.json').size / 1024)} KB`);
