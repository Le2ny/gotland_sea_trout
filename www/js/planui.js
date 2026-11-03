// UI for "Angeltag planen" (PLAN-01 … PLAN-09). The planning itself is in planner.js (pure, tested).
import { planDay, insertManual, pinStop } from './planner.js';
import { STOCKHOLM } from './assess.js';
import { sunTimes } from './sun.js';

const MIN = 60000;
const hm = ms => new Date(ms).toLocaleTimeString('de-DE', { timeZone: STOCKHOLM, hour: '2-digit', minute: '2-digit' });
const dayLabel = ms => new Date(ms).toLocaleDateString('de-DE', { timeZone: STOCKHOLM, weekday: 'long', day: '2-digit', month: '2-digit' });
const OSRM = 'https://routing.openstreetmap.de/routed-car/table/v1/driving/';

/** ctx: { L, map, $, esc, sheet, closeSheet, toast, store, routes, spots(), quality(spotId, ms), hasForecast(), fix(), home(), forecastRange() } */
export function initPlanner(ctx) {
  const { L, map, $, esc } = ctx;
  const layer = L.layerGroup().addTo(map);
  let state = null;   // { params, manual, excluded, done, plan, startTable, createdAt }

  const nodes = ctx.routes.nodes;
  const estimate = (a, b) => { const kx = 111.32 * Math.cos(a.lat * Math.PI / 180), d = Math.hypot((a.lat - b.lat) * 110.57, (a.lon - b.lon) * kx) * 1.35;
    return { min: Math.round(d / 50 * 60), km: Math.round(d * 10) / 10, status: 'schätzung' }; };
  const spotById = id => ctx.spots().find(s => String(s.id) === String(id));
  const access = id => {
    const r = ctx.routes.spots[id]?.parkings?.[0];
    if (r) return { node: r.node, walkMin: r.walkMin, parkingName: r.roadside ? 'Straßenrand (kein offizieller Parkplatz bekannt)' : (r.name && r.name !== 'Parkplatz' ? r.name : 'Parkplatz'), roadside: !!r.roadside };
    const s = spotById(id); if (!s) return null;
    return { node: `v:${s.lat},${s.lon}`, walkMin: null, parkingName: 'eigener Spot – Zufahrt unbekannt', roadside: true };
  };
  const pos = n => typeof n === 'number' ? nodes[n] : n === 'start' ? state.params.start : { lat: +n.slice(2).split(',')[0], lon: +n.split(',')[1] };
  const drive = (a, b) => {
    if (a === b) return { min: 0, km: 0, status: 'vorberechnet' };
    if (a === 'start' && typeof b === 'number' && state.startTable?.[b] != null) return { ...state.startTable[b], status: 'live' };
    if (typeof a === 'number' && typeof b === 'number') { const m = ctx.routes.car.durMin[a][b]; if (m != null) return { min: m, km: ctx.routes.car.distKm[a][b], status: 'vorberechnet' }; }
    return estimate(pos(a), pos(b));
  };

  async function liveStartTable(start) {
    if (!navigator.onLine) return null;
    try {
      const coords = [start, ...nodes].map(p => `${p.lon},${p.lat}`).join(';');
      const r = await fetch(`${OSRM}${coords}?sources=0&annotations=duration,distance`); if (!r.ok) return null;
      const d = await r.json();
      return d.durations[0].slice(1).map((x, i) => x == null ? null : { min: Math.round(x / 6) / 10, km: Math.round(d.distances[0][i + 1] / 100) / 10 });
    } catch { return null; }
  }

  function compute() {
    const p = state.params;
    state.plan = planDay({ spots: ctx.spots().filter(s => !state.excluded.includes(String(s.id))).map(s => ({ id: String(s.id), name: s.name })),
      quality: (id, ms) => ctx.quality(id, ms), access: id => access(id), drive, from: Math.max(p.from, state.done.at(-1)?.depart || 0), to: p.to,
      prefs: p.prefs, manual: state.manual, done: state.done });
    draw(); save();
  }
  const save = () => ctx.store.save('plan', state).catch(() => {});

  // ---------------------------------------------------------------- map
  function draw() {
    layer.clearLayers(); if (!state?.plan) return;
    const pts = [[state.params.start.lat, state.params.start.lon]];
    state.plan.stops.forEach((s, i) => {
      const sp = spotById(s.spotId), park = pos(s.node);
      pts.push([park.lat, park.lon]);
      L.marker([sp.lat, sp.lon], { icon: L.divIcon({ className: 'planNum', iconSize: [26, 26], html: `<b class="${s.origin}${s.waypointOnly ? ' bad' : ''}">${i + 1}</b>` }), zIndexOffset: 1000 })
        .on('click', () => showPlan()).addTo(layer);
      L.polyline([[park.lat, park.lon], [sp.lat, sp.lon]], { color: '#fff', weight: 2, dashArray: '2 5' }).addTo(layer);
    });
    L.polyline(pts, { color: '#1565c0', weight: 4, opacity: .75 }).addTo(layer);
    L.circleMarker(pts[0], { radius: 7, color: '#fff', weight: 2, fillColor: '#1565c0', fillOpacity: 1 }).bindTooltip('Start').addTo(layer);
  }

  // ---------------------------------------------------------------- form (all fields have defaults – one tap is enough)
  async function openForm() {
    if (!ctx.hasForecast()) return ctx.toast('Erst im WLAN „Prognose laden“');
    const [f0, f1] = ctx.forecastRange();
    const now = Date.now(), d = new Date(now);
    const tomorrow = d.getHours() >= 15;
    const base = new Date(d); if (tomorrow) base.setDate(base.getDate() + 1); base.setHours(12, 0, 0, 0);
    const st = sunTimes(+base, 57.45, 18.6);
    const from = Math.max(tomorrow ? st.rise - 30 * MIN : now + 15 * MIN, f0), to = Math.min(st.dusk ?? st.set + 40 * MIN, f1);
    const iso = ms => new Date(ms - new Date(ms).getTimezoneOffset() * MIN).toISOString().slice(0, 16);
    const gps = await ctx.fix().catch(() => null), home = ctx.home();
    ctx.sheet('plan', '🗓 Angeltag planen', `<form id="pf" class="form">
      <label>Start<select name="start">${gps ? '<option value="gps">Mein Standort</option>' : ''}${home ? '<option value="home">Ferienhaus</option>' : ''}<option value="center">Kartenmitte</option></select></label>
      <div class="formRow"><label>Von<input name="from" type="datetime-local" value="${iso(from)}" required></label><label>Bis<input name="to" type="datetime-local" value="${iso(to)}" required></label></div>
      <div class="formRow"><label>Aufenthalt pro Spot<select name="stay">${[60, 90, 120, 180].map(m => `<option value="${m}" ${m === 90 ? 'selected' : ''}>${m} min</option>`).join('')}</select></label>
        <label>Max. Fußweg<select name="walk">${[15, 25, 40, 60].map(m => `<option value="${m}" ${m === 40 ? 'selected' : ''}>${m} min</option>`).join('')}</select></label></div>
      <label class="check"><input type="checkbox" name="less"> Weniger fahren</label>
      <button>Plan erstellen</button></form>
      <p class="note">Bis: standardmäßig Ende der Dämmerung (${hm(st.dusk ?? st.set)}). Die Vorlieben ändern nur die Planung, nie den Eignungsindex der Spots.</p>`, () => {
      $('pf').onsubmit = async e => {
        e.preventDefault(); const fd = new FormData(e.target), sel = fd.get('start');
        const start = sel === 'gps' ? { lat: gps.lat, lon: gps.lon, label: 'Mein Standort' } : sel === 'home' ? { ...home, label: 'Ferienhaus' } : { lat: map.getCenter().lat, lon: map.getCenter().lng, label: 'Kartenmitte' };
        const params = { start, from: Math.max(f0, new Date(fd.get('from')).getTime()), to: Math.min(f1, new Date(fd.get('to')).getTime()),
          prefs: { stayMin: +fd.get('stay'), maxWalkMin: +fd.get('walk'), lessDriving: fd.get('less') === 'on' } };
        if (params.to <= params.from) return ctx.toast('Ende muss nach dem Beginn liegen (innerhalb der Prognose)');
        ctx.sheet('plan', '🗓 Angeltag planen', '<p class="note">Rechne … (Fahrzeiten vom Start werden online abgefragt)</p>');
        state = { params, manual: [], excluded: [], done: [], startTable: await liveStartTable(start), createdAt: Date.now() };
        compute(); showPlan();
      };
    });
  }

  // ---------------------------------------------------------------- plan view
  function showPlan() {
    if (!state?.plan) return openForm();
    const P = state.plan, q = P.quality, t = P.totals, stops = P.stops;
    const tag = { gut: 'qGood', eingeschränkt: 'qMid', unvollständig: 'qLow' }[q.level];
    const ins = i => `<button class="ins" data-pos="${i}">＋ Spot hier einfügen</button>`;
    const stopHtml = (s, i) => {
      const sp = spotById(s.spotId), past = s.depart < Date.now();
      const route = s.routing === 'schätzung' ? 'grob geschätzt (Luftlinie)' : s.routing === 'live' ? 'Route (live)' : 'Route (vorberechnet)';
      const alts = alternatives(s);
      return `<div class="stop ${s.origin}${past ? ' past' : ''}${s.waypointOnly ? ' bad' : ''}">
        <div class="stopHead"><b class="num">${i + 1}</b><div><b>${esc(sp?.name || s.spotId)}</b>
          <small>${s.origin === 'manual' ? (state.manual.find(m => m.stopId === s.stopId)?.anchor ? '⚓ Anker (fixiert beim Einfügen)' : '📌 Manuell festgelegt') : 'Vorschlag des Planers'}${past ? ' · erledigt' : ''}</small></div></div>
        <dl class="kv">
          <dt>Anfahrt</dt><dd>${s.driveMin} min${s.driveKm != null ? `, ${String(s.driveKm).replace('.', ',')} km` : ''} · ${route}</dd>
          <dt>Parken</dt><dd>${esc(s.parking)} · ${hm(s.arrive)}</dd>
          <dt>Fußweg</dt><dd>${s.walkKnown ? s.walkMin + ' min' : 'unbekannt (15 min angesetzt)'}${s.walkMin > state.params.prefs.maxWalkMin ? ' · ⚠ lang/ungeprüft' : ''}</dd>
          <dt>Angeln</dt><dd><b>${s.waypointOnly ? 'nicht befischbar' : `${hm(s.fishFrom)}–${hm(s.fishTo)}`}</b></dd>
          <dt>Abfahrt</dt><dd>${hm(s.depart)}</dd>
          <dt>Eignung</dt><dd>${s.avgIndex ?? '–'}/100 · Sicherheit der Prognose: ${s.confidence?.level || '–'}</dd>
          <dt>Recht</dt><dd>${esc(s.legal?.label || 'unbekannt')}</dd>
          ${s.safety?.msgs?.length ? `<dt>Sicherheit</dt><dd>⚠ ${esc(s.safety.msgs.join(', '))}</dd>` : ''}
        </dl>
        <p class="why">${s.origin === 'manual' ? 'Vom Nutzer festgelegt – das Modell bewertet die Zeit dort mit ' + (s.avgIndex ?? '–') + '/100.' : esc(why(s))}</p>
        ${alts.length ? `<p class="note">Alternativen: ${alts.map(a => `${esc(a.name)} (${a.idx})`).join(', ')}</p>` : ''}
        ${past ? '' : `<div class="stopBtns">
          <a href="https://www.google.com/maps/dir/?api=1&destination=${pos(s.node).lat},${pos(s.node).lon}" target="_blank" rel="noopener">🚗 Navigation</a>
          ${s.origin === 'manual' ? `<button data-up="${s.stopId}" class="secondary">↑</button><button data-down="${s.stopId}" class="secondary">↓</button><button data-unpin="${s.stopId}" class="secondary">Fixierung lösen</button>`
            : `<button data-pin="${s.stopId}" class="secondary">📌 Fixieren</button>`}
          <button data-stay="${s.stopId}" class="secondary">⏱ Aufenthalt</button><button data-del="${s.stopId}" class="secondary">✕</button></div>`}
      </div>`;
    };
    ctx.sheet('plan', `🗓 ${dayLabel(state.params.from)}`, `
      <div class="planHead"><span class="qbadge ${tag}">Planung: ${q.level}</span>
        <span>${hm(state.params.from)}–${hm(state.params.to)} · ${t.stops} Stopp(s) · 🚗 ${Math.round(t.driveMin)} min · 🚶 ${Math.round(t.walkMin)} min · 🎣 ${Math.round(t.fishMin / 60 * 10) / 10} h</span></div>
      ${q.why.length ? `<ul class="qwhy">${q.why.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
      ${P.conflicts.filter(c => c.options).map(c => `<p class="warn">⚠ ${esc(c.text)}<br><small>Möglich: ${c.options.map(esc).join(' · ')}</small></p>`).join('')}
      <p class="note">Start: ${esc(state.params.start.label)} · Zeiten in Gotland-Ortszeit</p>
      ${ins(0)}${stops.map((s, i) => stopHtml(s, i) + ins(i + 1)).join('')}
      <div class="menu"><button id="pReplan">↻ Restlichen Angeltag neu planen</button><button id="pNew" class="secondary">Neuen Plan erstellen</button><button id="pClear" class="secondary">Plan verwerfen</button></div>
      <p class="note">Eignungsindex = Heuristik der Original-App (nicht validiert), keine Fangwahrscheinlichkeit. Planungsqualität bewertet nur Zeiten, Wege und Daten.</p>`, bind);
  }
  const why = s => {
    const q = ctx.quality(s.spotId, s.fishFrom); const r = (q?.reasons || []).slice(0, 3).join(', ');
    return `Gewählt für ${hm(s.fishFrom)}–${hm(s.fishTo)}: Ø ${s.avgIndex}/100${r ? ' – ' + r : ''}; ${s.driveMin} min Fahrt.`;
  };
  function alternatives(s) {
    return ctx.spots().filter(x => String(x.id) !== s.spotId && !state.plan.stops.some(y => y.spotId === String(x.id)))
      .map(x => ({ x, q: ctx.quality(String(x.id), s.fishFrom), d: drive(s.node, access(String(x.id))?.node) }))
      .filter(a => a.q?.fishable && a.d && a.d.min <= s.driveMin + 15)
      .sort((a, b) => b.q.index - a.q.index).slice(0, 2).map(a => ({ name: a.x.name, idx: a.q.index }));
  }
  function bind() {
    const B = sel => $('sheetBody').querySelectorAll(sel);
    const find = id => state.plan.stops.find(s => s.stopId === id);
    B('.ins').forEach(b => b.onclick = () => chooseSpot(+b.dataset.pos));
    B('[data-pin]').forEach(b => b.onclick = () => { state.manual = pinStop(state.manual, state.plan.stops, b.dataset.pin); recompute(); });
    B('[data-unpin]').forEach(b => b.onclick = () => { state.manual = state.manual.filter(m => m.stopId !== b.dataset.unpin); recompute(); });
    B('[data-del]').forEach(b => b.onclick = () => { const s = find(b.dataset.del);
      if (s.origin === 'manual') state.manual = state.manual.filter(m => m.stopId !== s.stopId); else state.excluded.push(s.spotId); recompute(); });
    B('[data-up]').forEach(b => b.onclick = () => move(b.dataset.up, -1));
    B('[data-down]').forEach(b => b.onclick = () => move(b.dataset.down, 1));
    B('[data-stay]').forEach(b => b.onclick = () => { const s = find(b.dataset.stay); const v = prompt('Aufenthalt in Minuten', Math.round((s.fishTo - s.fishFrom) / MIN)); if (!v || !(+v > 0)) return;
      state.manual = pinStop(state.manual, state.plan.stops, s.stopId, { stayMin: +v });
      recompute(); });
    $('pReplan').onclick = async () => {  // keep finished stops and fixed ones; plan the rest from now
      state.done = state.plan.stops.filter(s => s.depart <= Date.now());
      const gps = await ctx.fix().catch(() => null);
      if (gps && !state.done.length) { state.params.start = { lat: gps.lat, lon: gps.lon, label: 'Mein Standort' }; state.startTable = await liveStartTable(state.params.start); }
      state.params.from = Math.max(state.params.from, Date.now()); recompute(); ctx.toast('Restplan neu berechnet');
    };
    $('pNew').onclick = openForm;
    $('pClear').onclick = async () => { if (!confirm('Plan verwerfen?')) return; state = null; layer.clearLayers(); await ctx.store.save('plan', null); ctx.closeSheet(); };
  }
  function move(stopId, dir) {
    const i = state.manual.findIndex(m => m.stopId === stopId), j = i + dir; if (j < 0 || j >= state.manual.length) return;
    [state.manual[i], state.manual[j]] = [state.manual[j], state.manual[i]];

    recompute();
  }
  const recompute = () => { compute(); showPlan(); };

  function chooseSpot(position) {
    const prev = state.plan.stops[position - 1], at = prev ? prev.depart : state.params.from;
    const list = ctx.spots().map(s => ({ s, q: ctx.quality(String(s.id), at), inPlan: state.plan.stops.some(x => x.spotId === String(s.id)) }))
      .sort((a, b) => (b.q?.index ?? -1) - (a.q?.index ?? -1));
    ctx.sheet('plan', `Spot einfügen an Position ${position + 1}`, list.map(({ s, q, inPlan }) => `<div class="spotRow" data-id="${esc(s.id)}">
      <div class="badge ${q?.index >= 75 ? 'b-good' : q?.index >= 60 ? 'b-mid' : 'b-low'}">${q?.index ?? '–'}</div>
      <div><b>${esc(s.name)}</b><div class="why">${inPlan ? '⚠ schon im Plan · ' : ''}${q && !q.fishable ? '⛔ ' + esc(q.legal.fishable ? q.safety.msgs.join(', ') : q.legal.label) : esc(q?.legal?.label || '')}</div></div></div>`).join('')
      + '<p class="note">Werte zur Zeit des vorigen Stopps. Eigene Spots über ⋯ → „Eigenen Spot setzen“ anlegen, dann hier auswählen.</p>', null, () => {
      $('sheetBody').querySelectorAll('.spotRow').forEach(el => el.onclick = () => {
        const id = el.dataset.id;
        if (state.plan.stops.some(x => x.spotId === id) && !confirm('Dieser Spot ist schon im Plan. Trotzdem ein zweites Mal besuchen?')) return;
        state.manual = insertManual(state.manual, state.plan.stops, id, position); recompute();
      });
    });
  }

  // PLAN-07: the plan survives reloads and works offline
  (async () => { const saved = await ctx.store.load('plan').catch(() => null); if (saved?.plan) { state = saved; draw(); } })();
  return { openForm, showPlan, hasPlan: () => !!state?.plan, addSpot: id => { if (!state?.plan) return openForm(); state.manual = insertManual(state.manual, state.plan.stops, String(id), state.plan.stops.length); recompute(); } };
}
