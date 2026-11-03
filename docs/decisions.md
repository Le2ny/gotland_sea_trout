# Entscheidungsprotokoll (Handoff v2.2 → Umsetzung)

Stand 03.11.2026 · Umsetzung durch Lenni + KI im Branch `mobile` des Forks `Le2ny/gotland_sea_trout`, Hosting vorerst GitHub Pages (`gh-pages`).
`main` beider Repos wurde nicht verändert.

## G0 – Ist-Stand (nur lesend, 03.11.2026)
- Lokaler Klon `~/gotland-sea-trout/repo`: sauber (keine uncommitteten/untracked Dateien, kein Stash, ein Worktree). Aktiver Branch `android-plan` (Commit `ba16a76`, nur `PLAN.md`), nicht Teil dieser Umsetzung.
- `upstream/main` = `fork/main` = `3987e1e` (v6.2.4, 01.11.2026).
- `v6-test` = `f39d5f1` (14.09.2026), **divergiert** von `main` (Merge-Base `15bb837`, 06.09.2026): 159 eigene Commits, 42 Dateien, Overlay-Experimente (`numeric-render-v2…v5`, `dmi-current-live-v1…v3`, Builds 6259–6278). Älter als die validierte Strömung in `main` → **nicht übernommen**. Übernehmenswert als Idee: offene DMI-EDR-Strömung (`opendataapi.dmi.dk/v1/forecastedr/collections/dkss_nsbs`, ohne Schlüssel).
- `main/.github/workflows/pages.yml` kopiert `v6-test` nach `/v6-test/` der Hauptseite.

## D1 – Copernicus numerisch ohne Zugangsdaten (Abweichung von Handoff §4)
Handoff nimmt an, numerische Daten bräuchten die Toolbox mit Login → GitHub Actions. **Geprüft:** Der öffentliche ARCO-Zarr-Speicher (`s3.waw3-1.cloudferro.com/mdl-arco-time-*`) ist ohne Login und mit CORS lesbar; per HTTP-Range nur die Gotland-Blöcke → bitgenau identisch zum vollständigen Chunk (Test `test/field.test.mjs`). Keine Zugangsdaten im Client, kein Server.
Datensatzversion wird über den offiziellen STAC-Katalog gewählt: `…_202411` wird am **12.01.2027** abgeschaltet, `…_202611` ab 24.11.2026 – automatischer Wechsel.

## D2 – Eignungsindex unverändert, aber getrennt (MODEL-01, LAW-01)
- Index = `scoreDetailed()` aus v6.2.4, **Logik unverändert** (Gewichte nicht validiert, keine Neugewichtung ohne Evidenz). Neu nur: Punkte je Faktor sichtbar, Rohsumme vor Kappung sichtbar, Versionstext `GST-Heuristik v6.2.4`.
- Getrennt davon: **Prognosesicherheit** (Datenvollständigkeit, Abstand des Strömungswerts, Vorlaufzeit, Alter – keine Fangwahrscheinlichkeit), **Sicherheit** (Wind/Böen/Welle), **Recht** (Schutzflächen Länsstyrelsen + Zeitraum 1.9.–31.1.; unbekannt/ungeprüft nie als erlaubt).
- Marker: Rang (Standard) oder Index; gesperrte Spots ⛔; gefährliche Bedingungen rot umrandet.

## D3 – Tagesplanung (PLAN-01 … 09)
- Routing: FOSSGIS-OSRM (`routing.openstreetmap.de`, OSM/ODbL, kostenlos, CORS). Spot↔Parkplatz-Fußwege und Auto-Matrix **einmal beim Build** vorberechnet (`tools/build_routes.mjs`, ≤1 Anfrage/s) → Planung offline. Nur die Strecke vom Startpunkt wird online live abgefragt; offline Luftlinie×1,35 bei 50 km/h, **als Schätzung markiert** (Planungsqualität „unvollständig“).
- Spots ohne OSM-Parkplatz im Umkreis 2,5 km: nächster befahrbarer Straßenpunkt, gekennzeichnet „Straßenrand (kein offizieller Parkplatz bekannt)“. Fußwege > 40 min → „lang/ungeprüft“.
- Optimierung: Beam-Search über den ganzen Tag; Wert = Σ Index/100 × Angelstunden − λ·Fahrstunden − 0,1·Gehstunden (λ 0,35; „weniger fahren“ 0,9 – ändert nur die Planung). Mindestnutzen gegen unnötige Wechsel.
- Manuelle Stopps: eingefügte Spots + **Nachbarn als Anker** → Position bleibt bei jeder Neuplanung; nie stilles Entfernen. Gesperrte manuelle Spots nur als Wegpunkt. Konflikte sichtbar mit Optionen.
- Plan wird offline gespeichert (IndexedDB), übersteht Neustart und SW-Update.
- Tests: `test/planner.test.mjs` (16 Fälle, PLAN-T01…T17 ohne UI), `test/plan.ui.test.mjs` (Browser, echte Daten).

## D4 – Gemeinsames Tagebuch / Cloud
Zwei-Konten-Sync bleibt **BLOCKED** bis zur ausdrücklichen Freigabe (Anbieter, DSGVO, Kosten). Bis dahin: lokal + verschlüsselte Exportdatei. Kein GitHub-Repo für private Fänge (Handoff §6.2).

## D5 – Karten
OSM-Kacheln nur zwischengespeichert, wenn angesehen (kein Bulk-Prefetch, OSMF-Policy). Eigene Offline-Grundkarte aus der OSM-Küstenlinie. „🛰 Nur Satellit“ blendet Umweltlayer aus und stellt die Auswahl beim zweiten Tipp wieder her.
