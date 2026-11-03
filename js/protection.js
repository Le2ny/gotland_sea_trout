// Official sea-trout protection areas on Gotland from Länsstyrelsen's map service
// "Svenska fiskeregler" – same query and filter as the original app (v6.2.4).
// Legally binding is always the regulation itself (HVMFS 2023:11), not this map.
import { inRings } from './geo.js';

export const FISH_GIS = 'https://ext-geodata-acc.lansstyrelsen.se/arcgis/rest/services/svenskafiskeregler/lst_svenskafiskeregler/MapServer/0/query';
export const RULES_URL = 'https://www.lansstyrelsen.se/gotland/djur/fiske/recreational-fishing.html';
export const HVMFS_URL = 'https://www.havochvatten.se/download/18.66b74fcf189fa80353fab44/1708708185345/HVMFS%202023-11-ev.pdf';
export const SEASON_NOTE = 'In den Mündungsbereichen gilt laut Länsstyrelsen vom 1. September bis 31. Januar Angelverbot.';

const NAMES = ['Själsö', 'Kolenskvarn', 'Lummelunda', 'Lickershamn', 'Ihre', 'Vaste', 'Kiosk', 'Vitärt', 'Välles', 'Arån', 'Hylu', 'Hultungs', 'Bång', 'Vägume', 'Vike', 'Gothem', 'Storsund', 'Djupån', 'Nygårds', 'Histilles', 'Halsegårda', 'Hugreif', 'Gartarve', 'Bane', 'Svajde', 'Lavas', 'Tuten', 'Närk', 'Kvarne', 'Snoder', 'Varbos', 'Robbjän', 'Västergarn', 'Kopparvik'];
const norm = x => String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const isSeaTrout = p => { const t = norm([p?.NAMN, p?.REF_HVMFS, p?.REF_BILAGA].join(' ')); return t.includes('2023:11') || NAMES.some(n => t.includes(norm(n))); };

export async function fetchProtection() {
  const params = new URLSearchParams({ where: '1=1', geometry: '17.75,56.80,19.55,58.12', geometryType: 'esriGeometryEnvelope', inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects', outFields: 'NAMN,REF_HVMFS,REF_BILAGA,REF_PARAGR,REF_KAPITE,REF_ID', returnGeometry: 'true', outSR: '4326', f: 'geojson' });
  const r = await fetch(FISH_GIS + '?' + params, { cache: 'no-store' });
  if (!r.ok) throw new Error('Länsstyrelsen HTTP ' + r.status);
  const data = await r.json(), seen = new Set();
  const features = (data.features || []).filter(f => isSeaTrout(f.properties)).filter(f => {
    const c = []; (function walk(x) { if (Array.isArray(x) && typeof x[0] === 'number') c.push(x); else if (Array.isArray(x)) x.forEach(walk); })(f.geometry?.coordinates);
    if (!c.length) return false;
    const xs = c.map(x => x[0]), ys = c.map(x => x[1]);
    const dw = Math.max(...xs) - Math.min(...xs), dh = Math.max(...ys) - Math.min(...ys), cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2;
    return cx > 17.8 && cx < 19.5 && cy > 56.85 && cy < 58.12 && dw < .48 && dh < .48;
  }).filter(f => { const p = f.properties || {}, k = p.REF_ID || [p.NAMN, p.REF_HVMFS, p.REF_BILAGA].join('|'); if (seen.has(k)) return false; seen.add(k); return true; })
    .map(f => ({ type: 'Feature', properties: { name: f.properties.NAMN, ref: [f.properties.REF_HVMFS, f.properties.REF_BILAGA, f.properties.REF_PARAGR].filter(Boolean).join(' · ') },
      geometry: f.geometry }));
  if (!features.length) throw new Error('Keine Schutzgebiete erhalten');
  return { type: 'FeatureCollection', source: 'Länsstyrelsen · Svenska fiskeregler', fetchedAt: new Date().toISOString(), features };
}

const polys = g => g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
/** feature containing the point, or null */
export function protectionAt(fc, lat, lon) {
  for (const f of fc?.features || []) for (const p of polys(f.geometry)) if (inRings(p, lon, lat)) return f;
  return null;
}
