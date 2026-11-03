# Datenquellen- und Lizenzmatrix (DATA-01)

| Quelle | Wofür | Zugriff | Zeit/Auflösung | Lizenz / Bedingungen | Ausfallverhalten |
|---|---|---|---|---|---|
| Copernicus Marine `BALTICSEA_ANALYSISFORECAST_PHY_003_006` (PT15M-i, PT1H-i) | Strömung u/v, Wasserstand `sla`, Temperatur `thetao` (oberste Schicht) | öffentliches ARCO-Zarr (S3), HTTP-Range, ohne Login; Version per STAC | 15 min / 1 h, ~1 sm; Läufe 00/12 UTC (10/6 Tage) | Copernicus Marine Service, Quellenangabe | gespeicherte Prognose bleibt, „abgelaufen“ nach 72 h; NoData bleibt leer |
| Copernicus Ocean Colour Baltic TUR | Trübungsbild | WMTS | Tagesmosaik, ~100 m, Wolkenlücken | Copernicus | Kachel leer = keine Messung |
| Open-Meteo Forecast + Marine | Wind, Böen, Welle, SST (Spots) | REST, Batch | stündlich | **nur nichtkommerziell**, < 10.000 Anfragen/Tag, Quellenangabe | Spotwerte aus Raster/Copernicus, „ohne Wetter“ markiert |
| FOSSGIS OSRM (`routing.openstreetmap.de`) | Fahr-/Fußzeiten | REST; Matrix beim Build vorberechnet, Start live | Straßen-/Wegenetz OSM | OSM ODbL; faire Nutzung (≤1 req/s beim Build) | offline Luftlinie×1,35/50 km/h, „Schätzung“, Planungsqualität „unvollständig“ |
| OpenStreetMap (Overpass) | Küstenlinie, Parkplätze | beim Build gebündelt | Snapshot 01.11.2026 | ODbL, Attribution | gebündelt, kein Laufzeitabruf |
| OSM Standard-Kacheln | Grundkarte | nur angesehene Kacheln zwischengespeichert, **kein Bulk-Prefetch** | – | OSMF Tile Policy | eigene Offline-Grundkarte aus der Küstenlinie |
| Esri World Imagery | Satellitenkarte | Kacheln | – | Esri-Nutzungsbedingungen, Attribution | Grundkarte |
| EMODnet Bathymetry | Tiefe | WMS | ~100 m | EMODnet | ausblendbar |
| Länsstyrelsen „Svenska fiskeregler“ | Schutzgebiete Meerforelle | ArcGIS REST (CORS), beim Laden aufgefrischt, gebündelte Kopie | Stand mit Datum | amtlich; **verbindlich ist die Vorschrift** | älter als 60 Tage → „ungeprüft“; fehlt → „unbekannt“, nie „erlaubt“ |
| Länsstyrelsen Gotland (Text) | 1.9.–31.1., Mindestmaß 50 cm, 1 wilde Meerforelle/Tag | manuell übernommen 03.11.2026 | – | amtlich | Hinweistext mit Link |

Datenvertrag je Abruf (gespeichert in der Prognose): `datasets` (Copernicus-Datensatz-IDs, Abschaltdatum), `fetchedAt` (Abruf), `times` (UTC-Stunden), Raster-Koordinaten; Open-Meteo-Werte in km/h bzw. m, Richtung „aus“; Strömung u/v in m/s, Richtung „nach“.
