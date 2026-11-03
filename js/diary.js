// Private fishing diary (Handoff DIARY-01, PLAN-05, SYNC-01 local part, D "Plan B").
// - Sessions (also with zero catch), catches, bites, lures, anglers – stored only on this device (IndexedDB)
// - every object: id, schemaVersion, revision, createdAt, updatedAt, deletedAt (tombstone), deviceId
// - encrypted export file (AES-GCM, key from password via PBKDF2) and import with preview and a merge that
//   never loses data: higher revision wins, equal revision with different content → conflict copy, tombstones win
// - forecast snapshot archived when a session starts (index, confidence, safety, legal, model version, issue time)
// Two-account cloud sync stays BLOCKED until the owner approves provider/privacy/costs (Handoff §6.2).

export const SCHEMA = 1;
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2));
export const emptyDiary = deviceId => ({ schemaVersion: SCHEMA, deviceId: deviceId || uuid(), sessions: [], catches: [], conflicts: [], lastExportAt: null, changedAt: null });

function stamp(o, diary, isNew) {
  const now = Date.now();
  return { ...o, schemaVersion: SCHEMA, id: o.id || uuid(), revision: (o.revision || 0) + 1, createdAt: isNew ? now : o.createdAt, updatedAt: now, deviceId: diary.deviceId };
}
const put = (list, obj) => { const i = list.findIndex(x => x.id === obj.id); if (i >= 0) list[i] = obj; else list.push(obj); return obj; };

export function startSession(diary, s) {
  const sess = stamp({ status: 'läuft', start: Date.now(), end: null, anglers: [], lures: [], bites: 0, notes: '', ...s }, diary, true);
  diary.changedAt = Date.now(); return put(diary.sessions, sess);
}
export function updateSession(diary, id, fields) {
  const cur = diary.sessions.find(x => x.id === id); if (!cur) throw new Error('Session nicht gefunden');
  diary.changedAt = Date.now(); return put(diary.sessions, stamp({ ...cur, ...fields }, diary, false));
}
export function endSession(diary, id, status = 'beendet') { return updateSession(diary, id, { status, end: Date.now() }); }
export function addCatch(diary, c) { diary.changedAt = Date.now(); return put(diary.catches, stamp({ time: Date.now(), released: true, wild: true, ...c }, diary, true)); }
export function updateCatch(diary, id, fields) { const cur = diary.catches.find(x => x.id === id); diary.changedAt = Date.now(); return put(diary.catches, stamp({ ...cur, ...fields }, diary, false)); }
export function remove(diary, kind, id) {   // tombstone, never a hard delete (no resurrection after import)
  const list = diary[kind], cur = list.find(x => x.id === id); if (!cur) return;
  diary.changedAt = Date.now(); put(list, stamp({ ...cur, deletedAt: Date.now() }, diary, false));
}
export const live = list => list.filter(x => !x.deletedAt);
export const activeSession = diary => live(diary.sessions).find(s => s.status === 'läuft') || null;
export const catchesOf = (diary, sessionId) => live(diary.catches).filter(c => c.sessionId === sessionId);

/** Gotland rules for a catch (Länsstyrelsen Gotland; legally binding is the regulation) */
export function ruleWarnings(diary, c, rules) {
  const w = [];
  if (/meerforelle/i.test(c.species || '') && c.lengthCm && c.lengthCm < rules.minLengthCm && !c.released) w.push(`Unter Mindestmaß ${rules.minLengthCm} cm – zurücksetzen`);
  if (/meerforelle/i.test(c.species || '') && c.wild !== false && !c.released) {
    const day = new Date(c.time).toDateString();
    const kept = live(diary.catches).filter(x => x.id !== c.id && /meerforelle/i.test(x.species || '') && x.wild !== false && !x.released && new Date(x.time).toDateString() === day && (x.angler || '') === (c.angler || ''));
    if (kept.length >= rules.wildPerDay) w.push(`Höchstens ${rules.wildPerDay} wilde Meerforelle pro Tag und Angler`);
  }
  return w;
}

/** descriptive statistics only – effort-normalised, no causal claims */
export function stats(diary) {
  const ses = live(diary.sessions).filter(s => s.status !== 'geplant');
  const hours = s => s.end && s.start ? Math.max(0, (s.end - s.start) / 3600000) * Math.max(1, (s.anglers || []).length) : 0;
  const rows = ses.map(s => ({ s, h: hours(s), n: catchesOf(diary, s.id).length, bites: s.bites || 0 }));
  const tot = rows.reduce((a, r) => ({ h: a.h + r.h, n: a.n + r.n, b: a.b + r.bites, zero: a.zero + (r.n === 0 && r.s.status !== 'läuft' ? 1 : 0) }), { h: 0, n: 0, b: 0, zero: 0 });
  const rate = (n, h) => h >= 0.5 ? n / h : null;  // too little effort → no rate (would be meaningless)
  const group = key => { const m = new Map(); for (const r of rows) { const k = key(r); if (k == null) continue; const g = m.get(k) || { h: 0, n: 0, sessions: 0 }; g.h += r.h; g.n += r.n; g.sessions++; m.set(k, g); } return [...m.entries()].map(([k, g]) => ({ k, ...g, perH: rate(g.n, g.h) })).sort((a, b) => b.sessions - a.sessions); };
  return { sessions: rows.length, zeroSessions: tot.zero, anglerHours: tot.h, fish: tot.n, bites: tot.b, perH: rate(tot.n, tot.h),
    bySpot: group(r => r.s.spotName), byIndexBand: group(r => { const i = r.s.forecast?.index; return i == null ? null : i >= 80 ? 'Index ≥ 80' : i >= 60 ? 'Index 60–79' : 'Index < 60'; }),
    small: rows.length < 20 };
}

// ------------------------------------------------------------------ encrypted export / import
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = buf => { const b = new Uint8Array(buf); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function key(password, salt) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 250000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function encryptExport(payload, password) {
  if (!password || password.length < 6) throw new Error('Passwort mit mindestens 6 Zeichen nötig');
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(password, salt), enc.encode(JSON.stringify(payload)));
  return JSON.stringify({ format: 'gst-diary-encrypted', v: 1, kdf: 'PBKDF2-SHA256-250000', cipher: 'AES-256-GCM', createdAt: new Date().toISOString(), salt: b64(salt), iv: b64(iv), data: b64(data) });
}
export async function decryptExport(text, password) {
  const f = JSON.parse(text);
  if (f.format !== 'gst-diary-encrypted') throw new Error('Keine Tagebuch-Sicherung');
  try { return JSON.parse(dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(f.iv) }, await key(password, unb64(f.salt)), unb64(f.data)))); }
  catch { throw new Error('Falsches Passwort oder beschädigte Datei'); }
}

/** what an import would change, without changing anything */
export function previewMerge(local, incoming) {
  const r = { new: 0, updated: 0, unchanged: 0, conflicts: 0, deleted: 0, olderIgnored: 0 };
  for (const kind of ['sessions', 'catches']) for (const o of incoming[kind] || []) {
    const cur = local[kind].find(x => x.id === o.id);
    if (!cur) { r.new++; continue; }
    if (JSON.stringify(cur) === JSON.stringify(o)) { r.unchanged++; continue; }
    if (o.deletedAt && !cur.deletedAt) { r.deleted++; continue; }
    if (o.revision > cur.revision) r.updated++; else if (o.revision < cur.revision) r.olderIgnored++; else r.conflicts++;
  }
  return r;
}
/** merge without losing data (SYNC-01 acceptance: idempotent, conflicts visible, no resurrection) */
export function merge(local, incoming) {
  for (const kind of ['sessions', 'catches']) for (const o of incoming[kind] || []) {
    const cur = local[kind].find(x => x.id === o.id);
    if (!cur) { local[kind].push(o); continue; }
    if (JSON.stringify(cur) === JSON.stringify(o)) continue;
    if (cur.deletedAt && !o.deletedAt && o.revision <= cur.revision) continue;          // no resurrection
    if (o.deletedAt && !cur.deletedAt) { Object.assign(cur, { ...cur, deletedAt: o.deletedAt, revision: Math.max(cur.revision, o.revision) + 1 }); local.conflicts.push({ kind, id: o.id, type: 'gelöscht vs. geändert', kept: cur, other: o, at: Date.now() }); continue; }
    if (o.revision > cur.revision) { Object.assign(cur, o); continue; }
    if (o.revision < cur.revision) continue;
    // same revision, different content → keep ours, store theirs as a visible conflict copy
    local.conflicts.push({ kind, id: o.id, type: 'gleichzeitig geändert', kept: cur, other: o, at: Date.now() });
  }
  local.changedAt = Date.now();
  return local;
}
