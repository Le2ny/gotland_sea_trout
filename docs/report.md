# Abnahme- und Rollbackbericht (HAND-01 / RELEASE-02)

Stand 03.11.2026 · Code: Branch `mobile` von `Le2ny/gotland_sea_trout` (App unter `app/`-Struktur dieses Repos: `www/`, `tools/`, `test/`, `docs/`) · Live: https://le2ny.github.io/gotland_sea_trout/ (Branch `gh-pages`).
`main` beider Repos unverändert (`3987e1e`). Alle Entscheidungen: `docs/decisions.md`; Evidenz: `docs/evidence.md`; Funktionsvergleich: `docs/feature-matrix.md`; Quellen/Lizenzen: `docs/data-sources.md`.

## Gates
| Gate | Status | Nachweis |
|---|---|---|
| G0 lokaler Stand/Backups | ✅ nur lesend inventarisiert, nichts verändert | decisions.md „G0“ |
| G1 reproduzierbarer Build + Tests | ✅ `node tools/build_web.mjs`; Tests unten | – |
| G2 Datenadapter + Lizenzen | ✅ (Open-Meteo nur nichtkommerziell) | data-sources.md |
| G3 Modelltests + rechtliche Korrektheit | ⚠ Index **nicht validiert** (bewusst unverändert); Recht: Polygon+Datum umgesetzt, Normtext/Geometrie-Abgleich der 25 Gebiete/34 Gewässer durch Ortskundige offen (26 Flächen geladen) | evidence.md, assess.js |
| G4 Zwei-Konten-Sicherheit, Offline, Restore | ⛔ **BLOCKED**: Cloud-Sync braucht Freigabe (Anbieter/DSGVO/Kosten). Lokal: Offline ✅, verschlüsselte Sicherung + Restore-Vorschau ✅ | diary.test, diary.ui.test |
| G5 Mobile-E2E + SW-Integrität | ✅ Chromium + WebKit (Safari-Engine), Offline-Neustart | Tests unten |
| G6 Deployment mit Rollback | ✅ GitHub Pages (Fork, vom Eigentümer gewünscht) – Rollback siehe unten | – |

## Testergebnisse (automatisiert, 03.11.2026)
```
## unit
ℹ tests 23
ℹ pass 23
ℹ fail 0
## field (live Copernicus)
download 89.0 MB in 9 s; datasets cmems_mod_bal_phy_anfc_PT15M-i_202411, cmems_mod_bal_phy_anfc_PT1H-i_202411; retires 2027-01-12T13:00:00.000Z
currents: exact original values at 26898 water model points (3 hours); 6 isolated
sea level (m), hour 0: 8975 valid, -0.011..0.063
temperature (°C), 26 steps every 3 h, first: 8975 valid, 8.071..12.915; same grid as currents: true
coverage 522083; barriers changed 8431, removed 7579 of 529662
## ui chromium
download: Fertig: 73 Stunden · 89 MB
GPS warning: ⚠ Du bist im Schutzgebiet „Vaste å Kioskbäcken“. In den Mündungsbereichen gilt laut Länsstyrelsen vom 1. September bis 31. Januar Angelverbot.
offline status: Prognose vom Di., 03.11., 20:22
offline: spots ranked 23 · custom kept 1 · home kept 1
errors: none
## ui webkit
download: Fertig: 73 Stunden · 89 MB
offline status: Prognose vom Di., 03.11., 20:23
offline: spots ranked 23 · custom kept 1 · home kept 1
errors: none
## plan ui
plan: {"head":"Planung: eingeschränkt 06:34–16:37 · 2 Stopp(s) · 🚗 57 min · 🚶 68 min · 🎣 6 h","stops":["Västergarn","Djupvik / Ekstakusten"],"origin":["A","A"]}
after insert: {"head":"Planung: eingeschränkt 06:34–16:37 · 3 Stopp(s) · 🚗 218 min · 🚶 104 min · 🎣 6 h","stops":["Västergarn","Åminne / Gothem","Djupvik / Ekstakusten"],"origin":["M","M","M"]}
after replan: {"head":"Planung: eingeschränkt 06:34–16:37 · 3 Stopp(s) · 🚗 218 min · 🚶 104 min · 🎣 6 h","stops":["Västergarn","Åminne / Gothem","Djupvik / Ekstakusten"],"origin":["M","M","M"]}
after reload: {"head":"Planung: eingeschränkt 06:34–16:37 · 3 Stopp(s) · 🚗 218 min · 🚶 104 min · 🎣 6 h","stops":["Västergarn","Åminne / Gothem","Djupvik / Ekstakusten"],"origin":["M","M","M"]} | same: true
sat-only: legend hidden true | field drawn false
restored: legend hidden false | field drawn true
errors: none
## plan ui webkit
plan: {"head":"Planung: gut 06:34–16:37 · 3 Stopp(s) · 🚗 22 min · 🚶 44 min · 🎣 7.5 h","stops":["Herrvik / Östergarn","Sandviken / Östergarn","Katthammarsvik"],"origin":["A","A","A"]}
after replan: {"head":"Planung: eingeschränkt 06:34–16:37 · 3 Stopp(s) · 🚗 131 min · 🚶 54 min · 🎣 6 h","stops":["Herrvik / Östergarn","Åminne / Gothem","Sandviken / Östergarn"],"origin":["M","M","M"]}
after reload: {"head":"Planung: eingeschränkt 06:34–16:37 · 3 Stopp(s) · 🚗 131 min · 🚶 54 min · 🎣 6 h","stops":["Herrvik / Östergarn","Åminne / Gothem","Sandviken / Östergarn"],"origin":["M","M","M"]} | same: true
errors: none
## diary ui
rule warnings: ⚠ Unter Mindestmaß 50 cm – zurücksetzen
stats: Sessions 2 (davon ohne Fang: 1) Anglerstunden 0 Fische 1 Bisse 2 Fische pro Anglerstunde –
export: encrypted AES-256-GCM | readable species in file: false
import preview: Neu 0 Aktualisiert 0 Unverändert 3 Gelöscht 0 Konflikte 0 (beide Fassungen bleiben erhalten) Ältere ignoriert 0
planned in diary: 3
after reload: sessions 2 | planned 3
errors: none
```
Planer-Abnahmetests ohne UI: PLAN-T01, T02, T03, T04, T05, T06, T07/T10, T09 (+b, c), T12, T13, T14, T16, T17 grün. T08/T11/T15 im Browser (plan.ui.test) grün. T18 (geplant vs. tatsächlich) über Tagebuch „Plan übernehmen → Jetzt angefangen / Nicht gemacht“ (diary.ui.test).

## Bekannte Grenzen / offen
1. **Index unvalidiert** – Planer und Zeitfenster optimieren diese Heuristik; Validierungsplan in evidence.md.
2. **Parkplätze:** bei 15/25 Spots kein OSM-Parkplatz ≤ 2,5 km → nächster Straßenpunkt; 6 Spots mit Fußweg ≥ 45 min (Sigsarve 90, Häftingsklint 90, Fårö Nord 72, Burgsvik West 142, Klintehamn Süd 68, Gnisvärd 46) → Koordinaten/Zugänge vor Ort prüfen (GEO-01).
3. **Recht:** 26 amtliche Flächen; Abgleich mit „25 Gebiete an 34 Gewässern“ und seit 2025 geltender Erweiterung auf Fließgewässer offen.
4. **Zwei Konten:** BLOCKED (s. G4). Bis dahin: verschlüsselte Datei teilen und importieren (Konflikte bleiben sichtbar erhalten).
5. **Routing:** FOSSGIS-Server ohne Verfügbarkeitsgarantie; Ausfall → Schätzung, Plan „unvollständig“.
6. **Datensatzwechsel:** Copernicus `…_202411` endet 12.01.2027; automatische Umstellung auf `…_202611` implementiert, nach dem 24.11.2026 einmal live prüfen.

## Rollback
- Web: vorherigen Stand von `gh-pages` wiederherstellen: `git -C <klon> push -f origin <alter-commit>:gh-pages` (Commits: `git log origin/gh-pages`). Nutzer erhalten beim nächsten Öffnen die alte Version (Service-Worker-Cache je Inhalts-Hash).
- Code: Branch `mobile` ist linear; jeder Schritt ein Commit (`git revert <commit>`).
- Nutzerdaten (Prognose, Plan, Tagebuch) liegen in IndexedDB, getrennt vom App-Cache – ein Rollback der App löscht sie nicht. Tagebuch-Schema `schemaVersion: 1`.
