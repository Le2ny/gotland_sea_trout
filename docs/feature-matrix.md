# Funktionsmatrix (REPO-01) – v6.2.4 `main` vs. diese Umsetzung (`mobile`)

| Bereich | `main` v6.2.4 (Omssen) | `v6-test` | Diese Umsetzung | Beleg/Test |
|---|---|---|---|---|
| Strömung numerisch | Copernicus Zarr im Worker, je Stunde ganze Ostsee (~2,3 MB) | DMI-EDR-Experimente, Overlays v1–v5 | Copernicus ARCO-Zarr, nur Gotland-Blöcke per Range, 72 h auf Vorrat, Datensatz via STAC | `test/field.test.mjs` (bitgenau, 26.898 Modellpunkte) |
| Küstenbarrieren | Laufzeit-Prüfung je Pixel (2–4 s/Ansicht) | – | vorberechnet, Gerät rechnet bei Gitterwechsel neu | 20–70 ms/Ansicht |
| Wasserstand, Temperatur | Open-Meteo/WMTS | – | Copernicus `sla`, `thetao` (3-stündlich) | field.test |
| Wind/Welle | Open-Meteo je Spot (sequentiell) | – | Open-Meteo Batch: alle Spots + Raster in 4 Anfragen | ui.test |
| Trübung, Tiefe, Satellit | WMTS/WMS | – | übernommen, angesehene Kacheln offline | ui.test |
| Eignungsindex | `scoreDetailed` additiv | – | **unverändert**, + Punkte je Faktor, Version | `assess.js` |
| Prognosesicherheit | – | – | getrennt, mit Gründen | plan.ui.test |
| Sicherheit | – | – | Wind/Böen/Welle getrennt | assess.js |
| Recht | Polygone + Hinweis | – | Polygon + Datum 1.9.–31.1., Status verboten/ungeprüft/unbekannt, nie stilles „erlaubt“ | planner.test T04/T14 |
| 3 beste Zeitfenster 48 h | – | – | ja | plan.ui.test |
| Marker Rang/Index, Filter | Index | – | Rang (Standard)/Index, Alle/Vordefiniert/Eigene, ⛔ gesperrt | plan.ui.test |
| Nur Satellit | Basiskarte umschaltbar | – | ein Tipp blendet Umweltlayer aus, zweiter stellt wieder her | plan.ui.test |
| GPS | Standortknopf | – | blauer Punkt + Genauigkeit, Zurückzentrieren, Schutzgebiets-Warnung | ui.test |
| Tagesplanung PLAN-01…09 | – | – | ja, offline mit vorberechneten Routen | planner.test (16), plan.ui.test |
| Tagebuch DIARY-01 | – (localStorage-Spots) | – | Sessions inkl. Nullfang, Fänge, Bisse, Fotos, Regeln, Prognose-Archiv, verschlüsselter Export/Import | diary.test (7), diary.ui.test |
| Zwei-Konten-Sync | – | – | **BLOCKED** (Freigabe nötig) | decisions.md D4 |
| Offline/PWA | SW mit 19 gepinnten Assets | `skipWaiting`-Ansatz | SW mit allen App-Dateien, Inhalts-Hash als Version, Daten in IndexedDB getrennt | live.test (Chromium + WebKit) |
| Android | – | – | Capacitor-APK | – |
