// Diary data layer: SYNC-01 acceptance (local part), encryption, rules. node --test test/diary.test.mjs
import test from 'node:test'; import assert from 'node:assert/strict';
import * as D from '../www/js/diary.js';
const rules = { minLengthCm: 50, wildPerDay: 1 };
const clone = x => JSON.parse(JSON.stringify(x));

test('zero-catch session is a valid session', () => {
  const d = D.emptyDiary('A'); const s = D.startSession(d, { spotName: 'Herrvik', anglers: ['Lenni', 'Omssen'] }); s.start -= 2 * 3600000; D.endSession(d, s.id);
  const st = D.stats(d); assert.equal(st.sessions, 1); assert.equal(st.fish, 0); assert.equal(st.zeroSessions, 1); assert.ok(st.anglerHours > 3.9);
});
test('two devices offline: independent edits survive, same field → visible conflict', () => {
  const a = D.emptyDiary('A'); const s = D.startSession(a, { spotName: 'X' });
  const b = clone(a); b.deviceId = 'B';
  D.updateSession(a, s.id, { notes: 'von A' });        // both at revision 2 → concurrent
  D.updateSession(b, s.id, { notes: 'von B' });
  D.merge(a, b); assert.equal(a.sessions[0].notes, 'von A'); assert.equal(a.conflicts.length, 1); assert.equal(a.conflicts[0].other.notes, 'von B');
  const c = D.addCatch(b, { sessionId: s.id, species: 'Meerforelle', lengthCm: 55 });
  D.merge(a, b); assert.ok(a.catches.some(x => x.id === c.id), 'independent new catch kept');
});
test('delete vs edit: no silent loss, no resurrection', () => {
  const a = D.emptyDiary('A'); const s = D.startSession(a, { spotName: 'X' }); const b = clone(a);
  D.remove(a, 'sessions', s.id); D.updateSession(b, s.id, { notes: 'edit' });
  D.merge(a, b); assert.ok(a.sessions[0].deletedAt, 'stays deleted');
  D.merge(b, a); assert.ok(b.sessions[0].deletedAt); assert.ok(b.conflicts.some(c => c.type === 'gelöscht vs. geändert'), 'edit preserved as conflict');
});
test('100× the same import → one logical effect (idempotent)', () => {
  const a = D.emptyDiary('A'); const inc = D.emptyDiary('B'); D.addCatch(inc, { species: 'Meerforelle' });
  for (let i = 0; i < 100; i++) D.merge(a, clone(inc));
  assert.equal(a.catches.length, 1); assert.equal(a.conflicts.length, 0);
});
test('encrypted export round trip; wrong password rejected', async () => {
  const d = D.emptyDiary('A'); D.addCatch(d, { species: 'Meerforelle', lengthCm: 61 });
  const file = await D.encryptExport({ diary: d, photos: { x: 'abc' } }, 'geheim123');
  assert.ok(!file.includes('Meerforelle'), 'content is not readable');
  const back = await D.decryptExport(file, 'geheim123'); assert.equal(back.diary.catches[0].lengthCm, 61);
  await assert.rejects(D.decryptExport(file, 'falsch!!'), /Passwort/);
});
test('preview shows the effect before importing', () => {
  const a = D.emptyDiary('A'); D.startSession(a, { spotName: 'X' }); const b = clone(a); D.updateSession(b, b.sessions[0].id, { notes: 'neu' }); D.addCatch(b, {});
  assert.deepEqual(D.previewMerge(a, b), { new: 1, updated: 1, unchanged: 0, conflicts: 0, deleted: 0, olderIgnored: 0 });
});
test('rules: under 50 cm kept, second wild sea trout per day', () => {
  const d = D.emptyDiary('A'); const t = Date.now();
  assert.match(D.ruleWarnings(d, { species: 'Meerforelle', lengthCm: 45, released: false, time: t }, rules)[0], /Mindestmaß/);
  D.addCatch(d, { species: 'Meerforelle', lengthCm: 60, released: false, wild: true, time: t, angler: 'Lenni' });
  assert.ok(D.ruleWarnings(d, { species: 'Meerforelle', lengthCm: 58, released: false, wild: true, time: t, angler: 'Lenni' }, rules).some(w => /Höchstens 1/.test(w)));
  assert.equal(D.ruleWarnings(d, { species: 'Meerforelle', lengthCm: 58, released: true, time: t, angler: 'Lenni' }, rules).length, 0);
});
