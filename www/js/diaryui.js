// Diary UI (DIARY-01, PLAN-05). Data rules are in diary.js (tested).
import * as D from './diary.js';
import { CATCH_RULES } from './assess.js';

const SPECIES = ['Meerforelle', 'Regenbogenforelle', 'Hornhecht', 'Dorsch', 'Plattfisch', 'Hering', 'Hecht', 'Barsch', 'Andere'];
const MIN = 60000;

/** ctx: { $, esc, sheet, closeSheet, toast, store, spots(), quality(id, ms), fix(), legalAt(lat, lon, ms), forecastInfo(), hhmm, fmtTime } */
export async function initDiary(ctx) {
  const { $, esc } = ctx;
  let diary = (await ctx.store.load('diary').catch(() => null)) || D.emptyDiary();
  if (!diary.anglers) diary.anglers = ['Lenni', 'Angler 2'];
  const save = async () => {
    await ctx.store.save('diary', diary);
    // rolling local backups (7 days) in addition to the encrypted export
    const day = new Date().toISOString().slice(0, 10), idx = (await ctx.store.load('diary-backups').catch(() => null)) || [];
    await ctx.store.save('diary-backup-' + day, diary);
    if (!idx.includes(day)) { idx.push(day); while (idx.length > 7) await ctx.store.save('diary-backup-' + idx.shift(), null); await ctx.store.save('diary-backups', idx); }
    badge();
  };
  const photoKey = id => 'photo:' + id;
  const nearestSpot = p => ctx.spots().map(s => ({ s, d: Math.hypot((s.lat - p.lat) * 111, (s.lon - p.lon) * 111 * Math.cos(p.lat * Math.PI / 180)) })).sort((a, b) => a.d - b.d)[0];
  const dur = (a, b) => { const m = Math.round(((b || Date.now()) - a) / MIN); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; };
  const backupDue = () => diary.changedAt && (!diary.lastExportAt || (diary.changedAt > diary.lastExportAt && Date.now() - diary.lastExportAt > 7 * 86400000));
  function badge() { const a = D.activeSession(diary); $('btnDiary').classList.toggle('on', !!a); $('btnDiary').title = a ? 'Session läuft' : 'Tagebuch'; }

  function snapshot(spotId, ms) {   // archive the forecast BEFORE fishing – never rewritten later
    const q = spotId != null ? ctx.quality(String(spotId), ms) : null, info = ctx.forecastInfo();
    if (!q) return { missing: true, issuedAt: info?.issuedAt || null };
    return { index: q.index, version: q.version, confidence: q.confidence.level, safety: q.safety.level, legal: q.legal.status, reasons: q.reasons,
      issuedAt: info.issuedAt, validAt: ms, sources: info.sources };
  }

  // ---------------------------------------------------------------- home
  function home() {
    const act = D.activeSession(diary), planned = D.live(diary.sessions).filter(s => s.status === 'geplant').sort((a, b) => a.planned.from - b.planned.from);
    const done = D.live(diary.sessions).filter(s => !['läuft', 'geplant'].includes(s.status)).sort((a, b) => b.start - a.start);
    const sesRow = s => { const n = D.catchesOf(diary, s.id).length;
      return `<div class="spotRow" data-s="${s.id}"><div class="badge ${n ? 'b-good' : 'b-low'}">${n}</div><div><b>${esc(s.spotName || 'ohne Spot')}</b>
        <div class="why">${ctx.fmtTime(s.start)} · ${s.end ? dur(s.start, s.end) : '–'} · ${(s.anglers || []).length} Angler · ${s.bites || 0} Bisse${s.status === 'abgebrochen' ? ' · abgebrochen' : ''}${s.planned ? ' · aus Tagesplan' : ''}</div></div></div>`; };
    ctx.sheet('diary', '📖 Tagebuch', `
      ${backupDue() ? '<p class="warn">💾 Letzte verschlüsselte Sicherung ist älter als 7 Tage. Bei Verlust des Geräts wären die Einträge weg – bitte sichern.</p>' : ''}
      ${act ? activeCard(act) : '<div class="menu"><button id="dStart">▶ Session starten</button></div>'}
      ${planned.length ? `<h4>Geplant (aus dem Tagesplan)</h4>${planned.map(s => `<div class="stop"><b>${esc(s.spotName)}</b> · ${ctx.hhmm(s.planned.from)}–${ctx.hhmm(s.planned.to)}
        <div class="stopBtns"><button data-go="${s.id}">▶ Jetzt angefangen</button><button data-skip="${s.id}" class="secondary">Nicht gemacht</button></div></div>`).join('')}` : ''}
      <h4>Sessions</h4>${done.map(sesRow).join('') || '<p class="note">Noch keine abgeschlossene Session. Auch Sessions ohne Fang sind wichtig – sie zeigen, wann es NICHT lief.</p>'}
      <div class="menu"><button id="dStats" class="secondary">📊 Auswertung</button><button id="dExport" class="secondary">🔒 Verschlüsselt sichern</button>
        <label class="fileBtn secondary">⇧ Sicherung einlesen<input id="dImport" type="file" accept=".json,application/json" hidden></label><button id="dAnglers" class="secondary">👥 Angler</button></div>
      ${diary.conflicts.length ? `<p class="warn">⚠ ${diary.conflicts.length} Konflikt(e) aus Importen – <button id="dConf" class="secondary">ansehen</button></p>` : ''}
      <p class="note">Nur auf diesem Gerät gespeichert (plus 7 Tages-Kopien). Gemeinsamer Cloud-Sync zweier Konten ist bewusst noch gesperrt, bis Anbieter und Datenschutz freigegeben sind.</p>`, () => {
      $('dStart') && ($('dStart').onclick = startForm);
      act && bindActive(act);
      $('sheetBody').querySelectorAll('[data-s]').forEach(el => el.onclick = () => sessionDetail(el.dataset.s));
      $('sheetBody').querySelectorAll('[data-go]').forEach(b => b.onclick = async () => { const s = diary.sessions.find(x => x.id === b.dataset.go);
        D.updateSession(diary, s.id, { status: 'läuft', start: Date.now(), forecast: snapshot(s.spotId, Date.now()) }); await save(); home(); });
      $('sheetBody').querySelectorAll('[data-skip]').forEach(b => b.onclick = async () => { D.updateSession(diary, b.dataset.skip, { status: 'abgebrochen', start: diary.sessions.find(x => x.id === b.dataset.skip).planned.from, end: diary.sessions.find(x => x.id === b.dataset.skip).planned.from, notes: 'geplant, nicht gefischt' }); await save(); home(); });
      $('dStats').onclick = statsView; $('dExport').onclick = exportFile; $('dImport').onchange = importFile; $('dAnglers').onclick = anglersForm;
      $('dConf') && ($('dConf').onclick = conflictsView);
    });
  }
  function activeCard(s) {
    const cs = D.catchesOf(diary, s.id);
    return `<div class="stop manual"><div class="stopHead"><b class="num">▶</b><div><b>${esc(s.spotName || 'Session')}</b><small>seit ${ctx.hhmm(s.start)} (${dur(s.start)}) · ${(s.anglers || []).map(esc).join(', ')}</small></div></div>
      ${s.forecast && !s.forecast.missing ? `<p class="note">Prognose beim Start: Index ${s.forecast.index}/100, Sicherheit der Prognose ${s.forecast.confidence}, Recht: ${esc(s.forecast.legal)}</p>` : ''}
      <dl class="kv"><dt>Bisse</dt><dd>${s.bites || 0}</dd><dt>Fische</dt><dd>${cs.length ? cs.map(c => `${esc(c.species)}${c.lengthCm ? ' ' + c.lengthCm + ' cm' : ''} (${esc(c.angler || '?')})`).join(', ') : '0'}</dd></dl>
      <div class="stopBtns"><button id="aBite">✋ Biss +1</button><button id="aCatch">🐟 Fang</button><button id="aEnd" class="secondary">■ Beenden</button><button id="aAbort" class="secondary">Abbrechen</button></div></div>`;
  }
  function bindActive(s) {
    $('aBite').onclick = async () => { D.updateSession(diary, s.id, { bites: (s.bites || 0) + 1 }); await save(); home(); };
    $('aCatch').onclick = () => catchForm(s);
    $('aEnd').onclick = async () => { D.endSession(diary, s.id); await save(); ctx.toast('Session gespeichert'); home(); };
    $('aAbort').onclick = async () => { if (!confirm('Session abbrechen? Sie bleibt als „abgebrochen“ im Tagebuch.')) return; D.endSession(diary, s.id, 'abgebrochen'); await save(); home(); };
  }

  // ---------------------------------------------------------------- start / catch forms
  async function startForm(pre = {}) {
    const p = await ctx.fix().catch(() => null), near = p ? nearestSpot(p) : null;
    const defId = pre.spotId ?? (near && near.d < 3 ? near.s.id : '');
    ctx.sheet('diary', '▶ Session starten', `<form id="sf" class="form">
      <label>Spot<select name="spot"><option value="">– ohne Spot –</option>${ctx.spots().map(s => `<option value="${esc(s.id)}" ${String(s.id) === String(defId) ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
      <div>${diary.anglers.map(n => `<label class="check"><input type="checkbox" name="a" value="${esc(n)}" checked> ${esc(n)}</label>`).join('')}</div>
      <label>Köder (Komma getrennt)<input name="lures" placeholder="z. B. Snaps 25 g kupfer, Fliege"></label>
      <button>Starten</button></form><p class="note">Die aktuelle Prognose wird mit der Session archiviert, damit sie später nicht „nachträglich besser“ wird.</p>`, () => {
      $('sf').onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target), sp = ctx.spots().find(s => String(s.id) === f.get('spot'));
        D.startSession(diary, { spotId: sp ? String(sp.id) : null, spotName: sp?.name || null, lat: p?.lat ?? sp?.lat ?? null, lon: p?.lon ?? sp?.lon ?? null,
          anglers: f.getAll('a'), lures: f.get('lures').split(',').map(x => x.trim()).filter(Boolean), forecast: snapshot(sp?.id, Date.now()), planned: pre.planned || null });
        await save(); home(); };
    });
  }
  async function catchForm(s, existing = null) {
    const c = existing || { species: 'Meerforelle', released: true, wild: true, angler: s.anglers?.[0] || diary.anglers[0], lure: s.lures?.[0] || '' };
    const p = existing ? { lat: c.lat, lon: c.lon } : await ctx.fix().catch(() => null);
    const pos = p || { lat: s.lat, lon: s.lon };
    let photo = existing ? await ctx.store.load(photoKey(existing.id)).catch(() => null) : null;
    ctx.sheet('diary', existing ? 'Fang bearbeiten' : '🐟 Fang', `<form id="cf" class="form">
      <div class="formRow"><label>Angler<select name="angler">${(s.anglers?.length ? s.anglers : diary.anglers).map(n => `<option ${n === c.angler ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
        <label>Art<select name="species">${SPECIES.map(x => `<option ${x === c.species ? 'selected' : ''}>${x}</option>`).join('')}</select></label></div>
      <div class="formRow"><label>Länge (cm)<input name="len" type="number" inputmode="decimal" step="0.5" value="${c.lengthCm ?? ''}"></label><label>Gewicht (g)<input name="wt" type="number" inputmode="numeric" value="${c.weightG ?? ''}"></label></div>
      <label class="check"><input type="checkbox" name="released" ${c.released ? 'checked' : ''}> Zurückgesetzt</label>
      <label class="check"><input type="checkbox" name="wild" ${c.wild !== false ? 'checked' : ''}> Wildfisch (nicht markiert/besetzt)</label>
      <label>Köder<input name="lure" value="${esc(c.lure || '')}"></label>
      <label>Foto <input name="photo" type="file" accept="image/*" capture="environment"></label><div id="ph">${photo ? `<img class="thumb" src="data:image/jpeg;base64,${photo}">` : ''}</div>
      <label>Notiz<textarea name="notes" rows="2">${esc(c.notes || '')}</textarea></label>
      <div id="rw"></div><button>Speichern</button></form>`, () => {
      const f = $('cf'), warn = () => {
        const v = { species: f.species.value, lengthCm: +f.len.value || null, released: f.released.checked, wild: f.wild.checked, angler: f.angler.value, time: c.time || Date.now(), id: c.id };
        const w = D.ruleWarnings(diary, v, CATCH_RULES), lg = pos.lat != null ? ctx.legalAt(pos.lat, pos.lon, v.time) : null;
        if (lg && !lg.fishable && /meerforelle/i.test(v.species)) w.unshift(lg.label);
        $('rw').innerHTML = w.map(x => `<p class="warn">⚠ ${esc(x)}</p>`).join('') + `<p class="note">Regeln Gotland laut Länsstyrelsen (Mindestmaß ${CATCH_RULES.minLengthCm} cm, ${CATCH_RULES.wildPerDay} wilde Meerforelle/Tag) – verbindlich ist die Vorschrift.</p>`;
      };
      f.oninput = warn; warn();
      f.photo.onchange = async () => { const file = f.photo.files[0]; if (!file) return; photo = await shrink(file); $('ph').innerHTML = `<img class="thumb" src="data:image/jpeg;base64,${photo}">`; };
      f.onsubmit = async e => { e.preventDefault();
        const fields = { sessionId: s.id, angler: f.angler.value, species: f.species.value, lengthCm: +f.len.value || null, weightG: +f.wt.value || null, released: f.released.checked, wild: f.wild.checked, lure: f.lure.value.trim(), notes: f.notes.value.trim(), lat: pos.lat ?? null, lon: pos.lon ?? null, hasPhoto: !!photo };
        const saved = existing ? D.updateCatch(diary, existing.id, fields) : D.addCatch(diary, fields);
        if (photo) await ctx.store.save(photoKey(saved.id), photo);
        await save(); ctx.toast('Fang gespeichert'); s.status === 'läuft' ? home() : sessionDetail(s.id); };
    });
  }
  async function shrink(file, max = 1600) {
    const url = URL.createObjectURL(file), img = new Image(); img.src = url; await img.decode();
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
    return c.toDataURL('image/jpeg', .82).split(',')[1];
  }

  // ---------------------------------------------------------------- session detail
  async function sessionDetail(id) {
    const s = diary.sessions.find(x => x.id === id), cs = D.catchesOf(diary, id);
    ctx.sheet('diary', esc(s.spotName || 'Session'), `<dl class="kv"><dt>Zeit</dt><dd>${ctx.fmtTime(s.start)} – ${s.end ? ctx.hhmm(s.end) : 'läuft'} (${dur(s.start, s.end)})</dd>
      ${s.planned ? `<dt>Geplant</dt><dd>${ctx.hhmm(s.planned.from)}–${ctx.hhmm(s.planned.to)} (Tagesplan)</dd>` : ''}
      <dt>Angler</dt><dd>${(s.anglers || []).map(esc).join(', ') || '–'}</dd><dt>Köder</dt><dd>${(s.lures || []).map(esc).join(', ') || '–'}</dd><dt>Bisse</dt><dd>${s.bites || 0}</dd><dt>Status</dt><dd>${esc(s.status)}</dd>
      <dt>Prognose damals</dt><dd>${s.forecast && !s.forecast.missing ? `Index ${s.forecast.index}/100 (${esc(s.forecast.version || '')}), Prognosesicherheit ${s.forecast.confidence}, Sicherheit ${s.forecast.safety}, Recht ${esc(s.forecast.legal)}, ausgegeben ${s.forecast.issuedAt ? ctx.fmtTime(s.forecast.issuedAt) : '–'}` : 'nicht vorhanden'}</dd></dl>
      <h4>Fänge</h4>${cs.map(c => `<div class="spotRow" data-c="${c.id}"><div class="badge b-good">🐟</div><div><b>${esc(c.species)}${c.lengthCm ? ' · ' + c.lengthCm + ' cm' : ''}${c.weightG ? ' · ' + c.weightG + ' g' : ''}</b><div class="why">${esc(c.angler || '')} · ${ctx.hhmm(c.time)}${c.released ? ' · zurückgesetzt' : ''}${c.lure ? ' · ' + esc(c.lure) : ''}${c.hasPhoto ? ' · 📷' : ''}</div></div></div>`).join('') || '<p class="note">Kein Fang – auch das ist ein wertvoller Eintrag.</p>'}
      <form id="nf" class="form"><label>Notiz<textarea name="notes" rows="2">${esc(s.notes || '')}</textarea></label><button class="secondary">Notiz speichern</button></form>
      <div class="menu"><button id="sAddC" class="secondary">＋ Fang nachtragen</button><button id="sDel" class="secondary">Session löschen</button><button id="sBack" class="secondary">← Tagebuch</button></div>`, () => {
      $('sheetBody').querySelectorAll('[data-c]').forEach(el => el.onclick = () => catchForm(s, diary.catches.find(x => x.id === el.dataset.c)));
      $('nf').onsubmit = async e => { e.preventDefault(); D.updateSession(diary, id, { notes: new FormData(e.target).get('notes') }); await save(); ctx.toast('Gespeichert'); };
      $('sAddC').onclick = () => catchForm(s);
      $('sDel').onclick = async () => { if (!confirm('Session löschen? (bleibt als Löschvermerk erhalten, damit sie bei Importen nicht wieder auftaucht)')) return; D.remove(diary, 'sessions', id); for (const c of cs) D.remove(diary, 'catches', c.id); await save(); home(); };
      $('sBack').onclick = home;
    });
  }

  // ---------------------------------------------------------------- statistics (descriptive only)
  function statsView() {
    const st = D.stats(diary), f = x => x == null ? '–' : x.toLocaleString('de-DE', { maximumFractionDigits: 2 });
    const table = (title, rows) => rows.length ? `<h4>${title}</h4><table class="lb"><tr><th></th><th>Sessions</th><th>Anglerstd.</th><th>Fische</th><th>Fische/Std.</th></tr>${rows.map(r => `<tr><td>${esc(r.k)}</td><td>${r.sessions}</td><td>${f(r.h)}</td><td>${r.n}</td><td>${f(r.perH)}</td></tr>`).join('')}</table>` : '';
    ctx.sheet('diary', '📊 Auswertung', `<dl class="kv"><dt>Sessions</dt><dd>${st.sessions} (davon ohne Fang: ${st.zeroSessions})</dd><dt>Anglerstunden</dt><dd>${f(st.anglerHours)}</dd><dt>Fische</dt><dd>${st.fish}</dd><dt>Bisse</dt><dd>${st.bites}</dd><dt>Fische pro Anglerstunde</dt><dd>${f(st.perH)}</dd></dl>
      ${table('Nach Spot', st.bySpot)}${table('Nach Prognose-Index beim Start', st.byIndexBand)}
      <p class="note">${st.small ? '⚠ Weniger als 20 Sessions – die Zahlen sind Beschreibung, keine Aussage über Ursachen. ' : ''}Normiert auf Anglerstunden. Spotwahl, Wetter und Tageszeit verzerren den Vergleich; das Modell wird daraus nicht automatisch angepasst.</p>
      <div class="menu"><button id="sb" class="secondary">← Tagebuch</button></div>`, () => { $('sb').onclick = home; });
  }

  // ---------------------------------------------------------------- export / import
  async function exportFile() {
    const pw = prompt('Passwort für die Sicherung (mind. 6 Zeichen) – ohne Passwort ist die Datei nicht lesbar:'); if (!pw) return;
    if (prompt('Passwort wiederholen:') !== pw) return ctx.toast('Passwörter stimmen nicht überein');
    const photos = {}; for (const c of D.live(diary.catches)) if (c.hasPhoto) { const ph = await ctx.store.load(photoKey(c.id)).catch(() => null); if (ph) photos[c.id] = ph; }
    const text = await D.encryptExport({ app: 'gotland-sea-trout', diary, photos }, pw);
    const file = new File([text], `gotland-tagebuch-${new Date().toISOString().slice(0, 10)}.json`, { type: 'application/json' });
    try { if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: 'Gotland Tagebuch (verschlüsselt)' }); else throw 0; }
    catch (e) { if (e?.name === 'AbortError') return; const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }
    diary.lastExportAt = Date.now(); await save(); ctx.toast('Verschlüsselte Sicherung erstellt'); home();
  }
  async function importFile(e) {
    const file = e.target.files[0]; if (!file) return;
    const pw = prompt('Passwort der Sicherung:'); if (!pw) return;
    let data; try { data = await D.decryptExport(await file.text(), pw); } catch (err) { return ctx.toast(err.message); }
    const pv = D.previewMerge(diary, data.diary);
    ctx.sheet('diary', 'Sicherung einlesen – Vorschau', `<dl class="kv"><dt>Neu</dt><dd>${pv.new}</dd><dt>Aktualisiert</dt><dd>${pv.updated}</dd><dt>Unverändert</dt><dd>${pv.unchanged}</dd><dt>Gelöscht</dt><dd>${pv.deleted}</dd><dt>Konflikte</dt><dd>${pv.conflicts} (beide Fassungen bleiben erhalten)</dd><dt>Ältere ignoriert</dt><dd>${pv.olderIgnored}</dd></dl>
      <div class="menu"><button id="iOk">Übernehmen</button><button id="iNo" class="secondary">Abbrechen</button></div>`, () => {
      $('iOk').onclick = async () => { D.merge(diary, data.diary); for (const [id, ph] of Object.entries(data.photos || {})) if (!(await ctx.store.load(photoKey(id)).catch(() => null))) await ctx.store.save(photoKey(id), ph); await save(); ctx.toast('Sicherung übernommen'); home(); };
      $('iNo').onclick = home;
    });
  }
  function conflictsView() {
    ctx.sheet('diary', 'Konflikte', diary.conflicts.map((c, i) => `<div class="stop"><b>${esc(c.type)}</b> · ${c.kind === 'sessions' ? 'Session' : 'Fang'}<br><small>behalten: ${esc(JSON.stringify(c.kept).slice(0, 140))}…<br>andere Fassung: ${esc(JSON.stringify(c.other).slice(0, 140))}…</small>
      <div class="stopBtns"><button data-take="${i}" class="secondary">Andere Fassung übernehmen</button><button data-keep="${i}" class="secondary">Behalten</button></div></div>`).join(''), () => {
      $('sheetBody').querySelectorAll('[data-take]').forEach(b => b.onclick = async () => { const c = diary.conflicts[+b.dataset.take]; const list = diary[c.kind];
        const cur = list.find(x => x.id === c.id); Object.assign(cur, { ...c.other, revision: Math.max(cur.revision, c.other.revision) + 1, updatedAt: Date.now() }); diary.conflicts.splice(+b.dataset.take, 1); await save(); conflictsView(); });
      $('sheetBody').querySelectorAll('[data-keep]').forEach(b => b.onclick = async () => { diary.conflicts.splice(+b.dataset.keep, 1); await save(); diary.conflicts.length ? conflictsView() : home(); });
    });
  }
  function anglersForm() {
    ctx.sheet('diary', '👥 Angler', `<form id="af" class="form"><label>Namen (Komma getrennt)<input name="n" value="${esc(diary.anglers.join(', '))}"></label><button>Speichern</button></form>`, () => {
      $('af').onsubmit = async e => { e.preventDefault(); diary.anglers = new FormData(e.target).get('n').split(',').map(x => x.trim()).filter(Boolean); await save(); home(); };
    });
  }

  // ---------------------------------------------------------------- PLAN-05: plan → diary
  async function fromPlan(stops, planId) {
    let n = 0;
    for (const st of stops) { if (st.waypointOnly || diary.sessions.some(s => s.planned?.stopId === st.stopId && !s.deletedAt)) continue;
      const sp = ctx.spots().find(s => String(s.id) === String(st.spotId));
      D.startSession(diary, { status: 'geplant', start: st.fishFrom, spotId: String(st.spotId), spotName: sp?.name, lat: sp?.lat, lon: sp?.lon, anglers: diary.anglers.slice(), planned: { planId, stopId: st.stopId, from: st.fishFrom, to: st.fishTo } }); n++; }
    // a planned session is not "running": fix the status the generic start wrote
    await save(); return n;
  }
  badge();
  return { open: home, startAt: spotId => startForm({ spotId }), fromPlan, startFromStop: st => startForm({ spotId: st.spotId, planned: { stopId: st.stopId, from: st.fishFrom, to: st.fishTo } }), get data() { return diary; } };
}
