// Day planner acceptance tests (Handoff PLAN-T01 … T17, the parts that need no UI). node --test test/planner.test.mjs
import test from 'node:test'; import assert from 'node:assert/strict';
import { planDay, insertManual, pinStop } from '../www/js/planner.js';

const H = 3600000, D0 = Date.UTC(2026, 10, 4, 6);  // 07:00 Stockholm
// 5 spots on a line, 10 min drive per step from "start" at node 0
const spots = [1, 2, 3, 4, 5].map(i => ({ id: i, name: 'S' + i }));
const base = { 1: 60, 2: 70, 3: 80, 4: 65, 5: 90 };
const mk = (over = {}) => ({
  spots,
  quality: (id, t) => ({ index: (over.index?.(id, t)) ?? base[id], fishable: !(over.banned || []).includes(id), legal: { status: (over.banned || []).includes(id) ? 'verboten' : 'kein bekanntes Schutzgebiet', label: 'x' }, safety: { level: 'ok' }, confidence: { level: 'hoch' } }),
  access: id => ({ node: id, walkMin: 5, parkingName: 'P' + id }),
  drive: (a, b) => ({ min: Math.abs((a === 'start' ? 0 : a) - b) * (over.far?.[b] ?? 10), km: 1, status: over.estimate ? 'schätzung' : 'vorberechnet' }),
  from: D0, to: D0 + 10 * H, prefs: { stayMin: 90, ...(over.prefs || {}) }, manual: over.manual || [], done: over.done || [],
});
const ok = plan => { for (let i = 0; i < plan.stops.length; i++) { const s = plan.stops[i];
  assert.ok(s.arrive <= s.fishFrom && s.fishFrom < s.fishTo && s.fishTo <= s.depart, 'stop times ordered');
  if (i) assert.ok(s.arrive >= plan.stops[i - 1].depart, 'no overlap'); assert.ok(s.driveMin >= 0 && s.walkMin >= 0, 'no negative times'); } };

test('T01 one click with defaults: consistent plan within the day', () => {
  const p = planDay(mk()); ok(p); assert.ok(p.stops.length >= 1); assert.ok(p.stops.at(-1).depart <= D0 + 10 * H); assert.equal(p.conflicts.length, 0);
});
test('T02 a far, slightly better spot is not forced into the plan', () => {
  const p = planDay(mk({ far: { 5: 120 }, prefs: { lessDriving: true } }));  // S5 best index but 8 h drive
  assert.ok(!p.stops.some(s => s.spotId === 5));
});
test('T03 hourly changes move the order', () => {
  const p = planDay(mk({ index: (id, t) => id === 1 && t < D0 + 3 * H ? 99 : id === 1 ? 10 : undefined }));
  assert.equal(p.stops[0].spotId, 1, 'S1 is excellent in the morning → first');
});
test('T04 banned spots are never planned automatically', () => {
  const p = planDay(mk({ banned: [5, 3] })); assert.ok(!p.stops.some(s => [3, 5].includes(s.spotId)));
});
test('T05 stops, travel and buffers stay inside the day window', () => {
  const p = planDay(mk({ prefs: { stayMin: 120 } })); ok(p); assert.ok(p.stops.at(-1).depart <= p.to);
});
test('T06 estimated routes make the plan "unvollständig"', () => {
  const p = planDay(mk({ estimate: true })); assert.equal(p.quality.level, 'unvollständig');
});
test('T07/T10 completed stops stay, manual stops survive replanning', () => {
  const first = planDay(mk({ manual: [{ stopId: 'm1', spotId: 2 }] }));
  const done = first.stops.slice(0, 1);
  const again = planDay(mk({ manual: [{ stopId: 'm1', spotId: 2 }], done }));
  assert.deepEqual(again.stops[0], done[0]); assert.ok(again.stops.some(s => s.stopId === 'm1'));
});
test('T09 insert before first, between and after last – position kept', () => {
  const p0 = planDay(mk()); const n = p0.stops.length; assert.ok(n >= 2);
  const spot = [1, 2, 3, 4, 5].find(id => !p0.stops.some(s => s.spotId === id));
  for (const pos of [0, 1, n]) {
    const manual = insertManual([], p0.stops, spot, pos), newId = manual.find(m => !m.anchor).stopId;
    const p = planDay(mk({ manual })); ok(p);
    const ids = p.stops.map(s => s.stopId), i = ids.indexOf(newId);
    assert.ok(i >= 0, 'manual stop present');
    if (pos === 0) assert.equal(i, 0, 'inserted first');
    if (pos === n) assert.equal(p.stops[i - 1].stopId, p0.stops[n - 1].stopId, 'directly after the former last stop');
    if (pos === 1) { assert.equal(p.stops[i - 1].stopId, p0.stops[0].stopId); assert.equal(p.stops[i + 1].stopId, p0.stops[1].stopId); }
  }
});
test('T12 impossible manual stop → visible conflict, never dropped', () => {
  const manual = [{ stopId: 'a', spotId: 1, stayMin: 400 }, { stopId: 'b', spotId: 5, stayMin: 400 }];
  const p = planDay(mk({ manual })); assert.ok(p.stops.some(s => s.stopId === 'a') && p.stops.some(s => s.stopId === 'b'));
  assert.ok(p.conflicts.some(c => c.type === 'zeit')); assert.ok(p.conflicts[0].options.length >= 3);
});
test('T13 several manual stops keep their relative order', () => {
  const manual = [{ stopId: 'x', spotId: 4 }, { stopId: 'y', spotId: 1 }, { stopId: 'z', spotId: 3 }];
  const p = planDay(mk({ manual })); const order = p.stops.filter(s => s.origin === 'manual').map(s => s.stopId);
  assert.deepEqual(order, ['x', 'y', 'z']);
});
test('T14 a banned spot stays banned even when added manually', () => {
  const p = planDay(mk({ banned: [2], manual: [{ stopId: 'b', spotId: 2 }] }));
  const s = p.stops.find(x => x.stopId === 'b'); assert.ok(s.waypointOnly); assert.ok(p.conflicts.some(c => c.type === 'recht'));
});
test('T16 "weniger fahren" changes the plan, not the index', () => {
  const a = planDay(mk()), b = planDay(mk({ prefs: { lessDriving: true } }));
  assert.ok(b.totals.driveMin <= a.totals.driveMin);
  for (const s of b.stops) assert.equal(s.avgIndex, base[s.spotId]);
});
test('T17 too short day → no plan quality "gut"', () => {
  const p = planDay({ ...mk(), to: D0 + 30 * 60000 }); assert.notEqual(p.quality.level, 'gut');
});

test('T09b inserting between two automatic stops keeps both neighbours and the position', () => {
  const p0 = planDay(mk()); assert.ok(p0.stops.length >= 2);
  const free = [1, 2, 3, 4, 5].find(id => !p0.stops.some(s => s.spotId === id));
  const manual = insertManual([], p0.stops, free, 1);
  const p = planDay(mk({ manual })); ok(p);
  const ids = p.stops.map(s => String(s.spotId));
  const i = ids.indexOf(String(free));
  assert.equal(ids[i - 1], String(p0.stops[0].spotId)); assert.equal(ids[i + 1], String(p0.stops[1].spotId));
});
test('T09c a banned manual stop does not remove the automatic stops around it', () => {
  const p0 = planDay(mk());
  const manual = insertManual([], p0.stops, 1, 1);
  const p = planDay(mk({ manual, banned: [1] }));
  assert.ok(p.stops.filter(s => !s.waypointOnly).length >= 2, 'fishing stops remain');
});
test('pinStop fixes an automatic stop in place', () => {
  const p0 = planDay(mk()); const m = pinStop([], p0.stops, p0.stops[1].stopId);
  const p = planDay(mk({ manual: m })); assert.ok(p.stops.some(s => s.stopId === p0.stops[1].stopId && s.origin === 'manual'));
});
