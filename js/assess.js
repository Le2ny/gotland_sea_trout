// Four separate answers per spot and hour (Handoff v2: MODEL-01, LAW-01, safety separate):
//   index      – the original heuristic 0–100 (fixed scale, never re-normalised per list), versioned
//   confidence – how much the inputs can be trusted (data completeness, distance, lead time, age) – NOT a catch chance
//   safety     – wind/gusts/waves, independent of the index
//   legal      – protection areas (Länsstyrelsen polygons) + season 1 Sep–31 Jan; unknown is never shown as allowed
import { MODEL_VERSION } from './ranking.js';
import { protectionAt } from './protection.js';

export { MODEL_VERSION };
export const STOCKHOLM = 'Europe/Stockholm';

/** is the Meerforelle ban season (1 Sep – 31 Jan, Gotland protection areas) active on this date (Stockholm time)? */
export function inBanSeason(ms) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: STOCKHOLM, month: 'numeric', day: 'numeric' }).formatToParts(new Date(ms));
  const m = +p.find(x => x.type === 'month').value;
  return m >= 9 || m === 1;
}

/** protection area at or right next to the spot (shore spots sit on the polygon edge) */
export function areaNear(protection, s, metres = 150) {
  const f = protectionAt(protection, s.lat, s.lon); if (f) return { f, inside: true };
  const dLat = metres / 111320, dLon = metres / (111320 * Math.cos(s.lat * Math.PI / 180));
  for (const [dy, dx] of [[dLat, 0], [-dLat, 0], [0, dLon], [0, -dLon], [dLat, dLon], [-dLat, -dLon], [dLat, -dLon], [-dLat, dLon]]) {
    const g = protectionAt(protection, s.lat + dy, s.lon + dx); if (g) return { f: g, inside: false };
  }
  return null;
}

export function legalStatus(s, ms, protection) {
  const checkedAt = protection?.fetchedAt || null;
  const stale = !checkedAt || Date.now() - Date.parse(checkedAt) > 60 * 86400000;
  const a = protection?.features?.length ? areaNear(protection, s) : null;
  const season = inBanSeason(ms);
  if (a && season) return { status: 'verboten', label: `Angelverbot (Meerforelle) im Schutzgebiet „${a.f.properties.name}“, 1.9.–31.1.`, area: a.f.properties.name, checkedAt, fishable: false };
  if (a) return { status: 'schutzgebiet', label: `Schutzgebiet „${a.f.properties.name}“ – außerhalb der Schonzeit (1.9.–31.1.)`, area: a.f.properties.name, checkedAt, fishable: true };
  if (!protection?.features?.length) return { status: 'unbekannt', label: 'Schutzgebietsdaten fehlen – Regeln selbst prüfen', checkedAt, fishable: true };
  if (s.protected) return { status: 'ungeprüft', label: `Bach-/Flussmündung (${s.protected}) in der Nähe, aber keine amtliche Fläche am Spot gefunden – Regel vor Ort prüfen`, checkedAt, fishable: true };
  if (stale) return { status: 'ungeprüft', label: 'Schutzgebiete länger nicht aktualisiert – Stand prüfen', checkedAt, fishable: true };
  return { status: 'kein bekanntes Schutzgebiet', label: `Kein amtliches Schutzgebiet am Spot bekannt (Stand ${new Date(checkedAt).toLocaleDateString('de-DE')})`, checkedAt, fishable: true };
}

/** Gotland rules shown with a catch (Länsstyrelsen Gotland, as of 2026 – check the official page) */
export const CATCH_RULES = { minLengthCm: 50, wildPerDay: 1, source: 'https://www.lansstyrelsen.se/gotland/djur/fiske.html' };

export function safety(w, m) {
  const wind = w?.wind_speed_10m, gust = w?.wind_gusts_10m, wave = m?.wave_height, msgs = [];
  let level = 'ok';
  const up = l => { if (l === 'gefahr' || (l === 'achtung' && level === 'ok')) level = l; };
  if (gust >= 55 || wind >= 45) { up('gefahr'); msgs.push(`Sturmböen bis ${Math.round(gust ?? wind)} km/h`); }
  else if (gust >= 40 || wind >= 30) { up('achtung'); msgs.push(`kräftiger Wind, Böen ${Math.round(gust ?? wind)} km/h`); }
  if (wave >= 1.8) { up('gefahr'); msgs.push(`hohe Wellen ${wave.toFixed(1)} m – Watangeln gefährlich`); }
  else if (wave >= 1.2) { up('achtung'); msgs.push(`Wellen ${wave.toFixed(1)} m`); }
  if (wind == null && wave == null) return { level: 'unbekannt', msgs: ['keine Wetterdaten'] };
  return { level, msgs };
}

/**
 * Prognosesicherheit – data/model trust, explicitly not a probability of catching.
 * r: ranking entry (w, m, cur, src); leadH: hours ahead of the forecast issue time; ageH: age of the stored forecast
 */
export function confidence(r, leadH, ageH) {
  let c = 100; const why = [];
  const minus = (v, t) => { c -= v; why.push(t); };
  if (!r.w) minus(25, 'Winddaten fehlen');
  if (r.m?.wave_height == null) minus(10, 'Wellendaten fehlen');
  if (r.m?.sea_surface_temperature == null) minus(10, 'Wassertemperatur fehlt');
  if (!r.cur) minus(25, 'keine Strömungswerte am Spot');
  else { if (r.cur.dist > 0) minus(10, `Strömung aus ${r.cur.dist} m Entfernung`); if (r.cur.edgePoints < 5) minus(5, 'Kante nur teilweise berechenbar'); }
  if (r.src === 'grid') minus(5, 'Wetter aus dem Raster statt am Spot');
  if (leadH > 48) minus(25, 'mehr als 48 h voraus'); else if (leadH > 24) minus(10, 'mehr als 24 h voraus');
  if (ageH > 18) minus(15, `Prognose ${Math.round(ageH)} h alt`);
  c = Math.max(0, c);
  return { value: c, level: c >= 75 ? 'hoch' : c >= 50 ? 'mittel' : 'niedrig', why };
}

export function assess(r, { ms, protection, leadH, ageH }) {
  return { index: r.score, raw: r.raw, version: MODEL_VERSION, parts: r.parts, reasons: r.reasons,
    confidence: confidence(r, leadH, ageH), safety: safety(r.w, r.m), legal: legalStatus(r.spot, ms, protection) };
}

/** usable as a fishing stop in a plan / best window: not banned, not dangerous */
export const fishable = a => a.legal.fishable && a.safety.level !== 'gefahr';

/**
 * up to n best time windows (1–4 h) in [k0,k1]: start at the best remaining hour and grow while the
 * index stays within 5 points of that hour's value; banned/dangerous hours are never part of a window
 */
export function bestWindows(series, n = 3) {  // series: [{k, t, index, ok}]
  const used = new Set(), out = [];
  const order = series.filter(x => x.ok).sort((a, b) => b.index - a.index || a.k - b.k);
  for (const top of order) {
    if (out.length >= n) break;
    if (used.has(top.k)) continue;
    let lo = top.k, hi = top.k;
    const at = k => series.find(x => x.k === k);
    while (hi - lo < 3) {
      const l = at(lo - 1), h = at(hi + 1);
      const okL = l && l.ok && !used.has(l.k) && l.index >= top.index - 5, okH = h && h.ok && !used.has(h.k) && h.index >= top.index - 5;
      if (okH && (!okL || h.index >= l.index)) hi++; else if (okL) lo--; else break;
    }
    for (let k = lo; k <= hi; k++) used.add(k);
    // keep one hour of distance between windows so they are really different
    used.add(lo - 1); used.add(hi + 1);
    const part = series.filter(x => x.k >= lo && x.k <= hi);
    out.push({ from: at(lo).t, to: at(hi).t + 3600000, peak: top.index, avg: Math.round(part.reduce((a, x) => a + x.index, 0) / part.length) });
  }
  return out.sort((a, b) => a.from - b.from);
}
