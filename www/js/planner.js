// "Angeltag planen" (Handoff PLAN-01 … PLAN-09). Pure function, no UI, deterministic → testable.
//
// Objective: quality of the WHOLE day, not the single best spots:
//   value = Σ over stops (index/100 × fishing hours)  −  λ × driving hours  −  0.1 × walking hours
//   λ = 0.35 normal, 0.9 with "weniger fahren" (planning preference only – never changes the index)
// Manual stops (origin 'manual', locked) keep their relative order and their position between the
// stops the user put them next to; automatic stops only fill the gaps. Banned or dangerous spots are
// never chosen automatically; a manually inserted banned spot stays in the plan as a waypoint
// marked "nicht befischbar". If the day does not fit, the plan says so (conflicts) – nothing is
// silently dropped or moved.

const MIN = 60000;

/**
 * @param {object} p
 *  spots: [{id,name,lat,lon}]
 *  quality(spotId, ms) → { index, fishable, legal, safety, confidence }   (hourly model values)
 *  access(spotId) → { node, walkMin|null, parkingName, roadside }        (precomputed parking + walk)
 *  drive(fromNode|'start', toNode) → { min, km, status: 'vorberechnet'|'live'|'schätzung' } | null
 *  from, to: ms (day window)   prefs: { stayMin, minStayMin, setupMin, bufferMin, lessDriving, maxWalkMin }
 *  manual: [{ stopId, spotId, stayMin?, preferredStart? }] in the user's order
 *  done: stops already completed (kept as they are, planning starts after them)
 */
export function planDay(p) {
  const pr = { stayMin: 90, minStayMin: 45, setupMin: 10, bufferMin: 10, lessDriving: false, maxWalkMin: 40, ...p.prefs };
  const lambda = pr.lessDriving ? 0.9 : 0.35;
  const manual = p.manual || [];
  const value = (spotId, a, b) => {  // index-weighted fishing hours in [a,b]
    let v = 0;
    for (let t = a; t < b; t += 15 * MIN) { const q = p.quality(spotId, t); if (q?.fishable) v += (q.index / 100) * 0.25; }
    return v;
  };
  const legStart = (t, fromNode, spotId) => {
    const acc = p.access(spotId); if (!acc) return null;
    const d = p.drive(fromNode, acc.node); if (!d || d.min == null) return null;
    const walk = acc.walkMin ?? 15;  // unknown walk: conservative 15 min, marked incomplete
    const arrivePark = t + Math.ceil(d.min) * MIN, startFish = arrivePark + (walk + pr.setupMin) * MIN;
    return { d, acc, walk, walkKnown: acc.walkMin != null, arrivePark, startFish };
  };

  // one stop given the current time/location
  const makeStop = (t, fromNode, spotId, origin, stay, opts = {}) => {
    const leg = legStart(t, fromNode, spotId); if (!leg) return null;
    let fishFrom = leg.startFish;
    if (opts.preferredStart && opts.preferredStart > fishFrom) fishFrom = opts.preferredStart;  // wait for a wished start
    const fishTo = fishFrom + stay * MIN;
    const depart = fishTo + (pr.setupMin + leg.walk) * MIN;  // pack up + walk back to the car
    const q = p.quality(spotId, fishFrom);
    return { spotId, origin, locked: origin === 'manual', stopId: opts.stopId || `auto-${spotId}-${fishFrom}`, driveMin: Math.ceil(leg.d.min), driveKm: leg.d.km,
      routing: leg.d.status, walkMin: leg.walk, walkKnown: leg.walkKnown, parking: leg.acc.parkingName, roadside: !!leg.acc.roadside, node: leg.acc.node,
      arrive: leg.arrivePark, fishFrom, fishTo, depart, fishable: q ? q.fishable : false,
      value: value(spotId, fishFrom, fishTo), avgIndex: avgIndex(p, spotId, fishFrom, fishTo), legal: q?.legal, safety: q?.safety, confidence: q?.confidence };
  };

  // fill the time between (t, node) and a deadline with automatic stops (beam search)
  const fillGap = (t0, node0, deadline, nextLeg, used) => {
    let beam = [{ t: t0, node: node0, stops: [], v: 0 }], best = beam[0];
    for (let depth = 0; depth < 6; depth++) {
      const next = [];
      for (const st of beam) for (const s of p.spots) {
        if (used.has(s.id) || st.stops.some(x => x.spotId === s.id)) continue;
        const acc = p.access(s.id); if (!acc || (acc.walkMin != null && acc.walkMin > pr.maxWalkMin)) continue;
        for (const stay of [pr.stayMin, pr.stayMin * 2]) {
          const stop = makeStop(st.t, st.node, s.id, 'automatic', stay);
          if (!stop || !stop.fishable || stop.safety?.level === 'gefahr') continue;
          if (stop.depart + pr.bufferMin * MIN > deadline) continue;
          const tail = nextLeg ? nextLeg(stop.depart, stop.node) : 0;   // must still reach the next fixed stop / day end
          if (tail == null || stop.depart + tail * MIN > deadline) continue;
          const v = st.v + stop.value - lambda * stop.driveMin / 60 - 0.1 * stop.walkMin / 60;
          next.push({ t: stop.depart, node: stop.node, stops: [...st.stops, stop], v });
        }
      }
      if (!next.length) break;
      next.sort((a, b) => b.v - a.v);
      beam = next.slice(0, 30);
      if (beam[0].v > best.v) best = beam[0];
    }
    // only keep a stop if it is worth it (≥ 0.2 good fishing hours net) – no switching for tiny gains
    return best.stops.length && best.v >= 0.2 * best.stops.length ? best.stops : [];
  };

  // ---- walk through the day: done stops, then gaps and manual stops in the user's order
  const plan = { stops: [...(p.done || [])], conflicts: [], from: p.from, to: p.to };
  let t = p.done?.length ? p.done.at(-1).depart : p.from, node = p.done?.length ? p.done.at(-1).node : 'start';
  const used = new Set(plan.stops.map(s => s.spotId));
  const remainingManual = manual.filter(m => !plan.stops.some(s => s.stopId === m.stopId));
  for (let i = 0; i <= remainingManual.length; i++) {
    const m = remainingManual[i];
    if (m) {
      // earliest the manual stop could start from here; the gap before it may hold automatic stops
      const direct = makeStop(t, node, m.spotId, 'manual', m.stayMin || pr.stayMin, m);
      if (!direct) { plan.conflicts.push({ type: 'route', stopId: m.stopId, text: `Keine Route zu ${name(p, m.spotId)} – Zeiten nicht berechenbar` }); continue; }
      const slack = (m.preferredStart ? m.preferredStart - direct.fishFrom : 0);
      if (slack > pr.stayMin * MIN) {
        const gap = fillGap(t, node, m.preferredStart, (dep, nd) => { const l = legStart(dep, nd, m.spotId); return l ? Math.ceil(l.d.min) + l.walk + pr.setupMin : null; }, new Set([...used, ...manual.map(x => x.spotId)]));
        for (const s of gap) { plan.stops.push(s); used.add(s.spotId); t = s.depart; node = s.node; }
      }
      const stop = makeStop(t, node, m.spotId, 'manual', m.stayMin || pr.stayMin, m);
      if (!stop.fishable) stop.waypointOnly = true;   // banned / dangerous: shown, but not as a fishing stop
      plan.stops.push(stop); used.add(m.spotId); t = stop.depart; node = stop.node;
    } else {
      const gap = fillGap(t, node, p.to, null, new Set([...used, ...manual.map(x => x.spotId)]));
      for (const s of gap) { plan.stops.push(s); used.add(s.spotId); t = s.depart; node = s.node; }
    }
  }
  // ---- conflicts: never hide them
  const end = plan.stops.length ? plan.stops.at(-1).depart : p.from;
  if (end > p.to) {
    plan.conflicts.push({ type: 'zeit', overMin: Math.round((end - p.to) / MIN), text: `Der Plan endet ${Math.round((end - p.to) / MIN)} min nach dem gewünschten Tagesende`,
      options: ['Automatische Stopps entfernen', 'Tagesende später setzen', 'Aufenthalte kürzen', 'Manuelle Stopps verschieben oder entfernen'] });
  }
  for (const s of plan.stops) if (s.waypointOnly) plan.conflicts.push({ type: 'recht', stopId: s.stopId, text: `${name(p, s.spotId)}: ${s.legal?.label || 'nicht befischbar'} – nur als Wegpunkt` });
  for (let i = 1; i < plan.stops.length; i++) if (plan.stops[i].arrive < plan.stops[i - 1].depart) plan.conflicts.push({ type: 'überlappung', text: 'Stopps überlappen' });
  plan.quality = planQuality(plan, pr);
  plan.totals = { driveMin: sum(plan.stops, 'driveMin'), walkMin: sum(plan.stops, s => 2 * s.walkMin), fishMin: sum(plan.stops, s => s.waypointOnly ? 0 : (s.fishTo - s.fishFrom) / MIN), stops: plan.stops.length };
  return plan;
}

const sum = (a, f) => a.reduce((x, s) => x + (typeof f === 'function' ? f(s) : s[f] || 0), 0);
const name = (p, id) => p.spots.find(s => s.id === id)?.name || id;
function avgIndex(p, spotId, a, b) { let n = 0, s = 0; for (let t = a; t < b; t += 60 * MIN) { const q = p.quality(spotId, t); if (q) { s += q.index; n++; } } return n ? Math.round(s / n) : null; }

/** PLAN-09: ordinal planning quality, separate from the spot index */
export function planQuality(plan, pr) {
  const why = [];
  if (!plan.stops.length) return { level: 'unvollständig', why: ['kein Stopp im Zeitfenster möglich'] };
  if (plan.stops.some(s => s.routing === 'schätzung')) why.push('Fahrzeiten teils nur geschätzt (Luftlinie)');
  if (plan.stops.some(s => !s.walkKnown)) why.push('Fußwege teils unbekannt');
  const incomplete = why.length > 0;
  if (plan.conflicts.length) why.push(...plan.conflicts.map(c => c.text));
  if (plan.stops.some(s => s.walkMin > (pr?.maxWalkMin ?? 40))) why.push('langer oder ungeprüfter Zugang');
  if (plan.stops.some(s => ['ungeprüft', 'unbekannt'].includes(s.legal?.status))) why.push('Rechtslage an einem Stopp ungeprüft');
  if (plan.stops.some(s => s.confidence?.level === 'niedrig')) why.push('geringe Prognosesicherheit');
  return { level: incomplete ? 'unvollständig' : why.length ? 'eingeschränkt' : 'gut', why };
}

/**
 * PLAN-02: insert a manual stop at a position of the current plan. The neighbouring automatic stops
 * become anchors (fixed), so the new stop stays exactly between them after any re-planning.
 * Returns the new list of fixed stops in plan order.
 */
export function insertManual(manual, stops, spotId, position, extra = {}) {
  const entry = { stopId: `man-${spotId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, spotId: String(spotId), ...extra };
  const seq = [];
  stops.forEach((s, i) => {
    if (i === position) seq.push(entry);
    const m = manual.find(x => x.stopId === s.stopId);
    if (m) seq.push(m);
    else if ((i === position - 1 || i === position) && !s.done) seq.push(anchorOf(s));
  });
  if (position >= stops.length) seq.push(entry);
  for (const m of manual) if (!seq.includes(m)) seq.push(m);
  return seq;
}
/** fix an automatic stop where it is (optionally with a new stay) */
export function pinStop(manual, stops, stopId, extra = {}) {
  const seq = [];
  for (const s of stops) {
    const m = manual.find(x => x.stopId === s.stopId);
    if (m) seq.push(s.stopId === stopId ? Object.assign(m, extra) : m);
    else if (s.stopId === stopId) seq.push({ ...anchorOf(s), anchor: false, ...extra });
  }
  for (const m of manual) if (!seq.includes(m)) seq.push(m);
  return seq;
}
const anchorOf = s => ({ stopId: s.stopId, spotId: s.spotId, stayMin: Math.round((s.fishTo - s.fishFrom) / 60000), anchor: true });
