// Wind, waves and water temperature for all spots from Open-Meteo, one request each
// (the API accepts comma-separated coordinate lists). Same variables and units as the
// original app: wind in km/h, wave height in m, sea surface temperature in °C.

const WIND = 'wind_speed_10m,wind_direction_10m,wind_gusts_10m';
const MARINE = 'wave_height,wave_direction,sea_surface_temperature';

async function json(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error('Open-Meteo HTTP ' + r.status);
  return r.json();
}

/** times: array of UTC ms (full hours). Returns { times, spots: [{wind:{...}[], marine:{...}[]}] } */
export async function downloadWeather(spots, times) {
  const lats = spots.map(s => s.lat).join(','), lons = spots.map(s => s.lon).join(',');
  const iso = ms => new Date(ms).toISOString().slice(0, 16);
  const range = `&start_hour=${iso(times[0])}&end_hour=${iso(times.at(-1))}&timezone=GMT&timeformat=unixtime`;
  const [w, m] = await Promise.all([
    json(`https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&hourly=${WIND}&wind_speed_unit=kmh${range}`),
    json(`https://marine-api.open-meteo.com/v1/marine?latitude=${lats}&longitude=${lons}&hourly=${MARINE}&cell_selection=sea${range}`),
  ]);
  const wa = Array.isArray(w) ? w : [w], ma = Array.isArray(m) ? m : [m];
  if (wa.length !== spots.length || ma.length !== spots.length) throw new Error('Open-Meteo: unvollständige Antwort');
  const pick = (d, vars) => times.map(t => {
    const i = d.hourly.time.indexOf(t / 1000);
    if (i < 0) return null;
    const o = {};
    for (const v of vars.split(',')) { const x = d.hourly[v]?.[i]; if (Number.isFinite(x)) o[v] = x; }
    return o;
  });
  return { fetchedAt: Date.now(), times, spots: spots.map((s, k) => ({ id: s.id, wind: pick(wa[k], WIND), marine: pick(ma[k], MARINE) })) };
}
