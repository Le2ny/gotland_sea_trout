# Evidenzregister (SCI-01)

Stand 03.11.2026. Schema je Faktor: Quelle → Befund → Wirkannahme → Übertragbarkeit → Datenprodukt → Form → Unsicherheit → Validierung.
Stufen: **E1** begutachtete Gotland/Baltikum-Meerforellen-Evidenz · **E2** vergleichbare begutachtete Forschung · **E3** physikalisch/ökologisch plausibel · **E4** Anglerheuristik.

**Grundsatz der Umsetzung:** Keine Neugewichtung ohne Evidenz. Der Index bleibt die unveränderte Heuristik v6.2.4 (alle Faktoren derzeit **E4**). Neu sind nur Transparenz (Punkte je Faktor), eine getrennte Prognosesicherheit, Sicherheit und Recht.

| Faktor | Aktuelle Regel (v6.2.4) | Stufe | Beleglage | Folge |
|---|---|---|---|---|
| Wassertemperatur | +8 bei 4–14 °C | E4 | Gotland-Feldstudie (C&R, 2019/2020): Fänge bei **2–19 °C** – kein Optimum belegt ([PMC9543446](https://pmc.ncbi.nlm.nih.gov/articles/PMC9543446/)). Eigene Auswertung 11/2026: Kriterium trifft in **100 %** der Fälle zu → trennt nicht. | unverändert; Kandidat für Abstufung erst nach Evidenz |
| Wind 8–26 km/h | +10 | E4 | keine; trifft in 80 % zu | unverändert |
| Wind zur Küste (≤75°) / ablandig (>150°) | +9 / −7 | E3/E4 | Durchmischung/Trübung plausibel; Fangeffekt unbelegt | unverändert |
| Welle 0,2–1,05 m | +10 | E4 | trifft in 96 % zu | unverändert; Sicherheit separat (≥1,2 m Achtung, ≥1,8 m Gefahr) |
| Strömung 0,12–0,65 m/s | +13 | E4 | Ostsee-Median an Spots 0,04 m/s; Schwelle in 11 % erfüllt. Modell ~1 sm Auflösung – keine Riffskala | unverändert |
| Strömung längs/schräg (50–130°) | +9 | E4 | Richtung bei < 0,05 m/s kaum aussagekräftig | unverändert |
| Strömungskante (≥0,06 m/s auf ~600 m) | +12 | E4 | Distanz < Modellauflösung → misst v. a. Interpolation; erfüllt in 1,4 % | unverändert |
| Spotbewertung (Sterne) | +5/Stern | E4 | Expertenwissen Spotkenntnis | unverändert |
| Licht/Dämmerung | – | E3 | astronomisch berechenbar; Wirkung unbelegt | nur angezeigt (Tagesplan bis Dämmerungsende), nicht im Index |
| Luftdruck/-trend | – | E4 | Confounding wahrscheinlich | nicht im Index |
| Trübung (Sentinel-2 TUR) | – | E3 | Wolkenlücken, Küstenpixel | nur Kartenebene mit Aufnahmedatum, kein Bonus/Malus |
| Wasserstand | – | E3 | Zugang/Sicherheit primär | nur Anzeige |

Regional: Küstenwanderungen/Winterstrategien nordbaltischer Meerforellen ([ICES JMS 69(6):971](https://academic.oup.com/icesjms/article/69/6/971/620855)) – **nicht** als Beleg für Spot-Scores verwendet.

## Validierungsplan (MODEL-02/03) – vorbereitet, nicht ausgeführt
- Jede Session archiviert beim Start Index, Modellversion, Prognose-Ausgabezeit, Prognosesicherheit, Sicherheit und Rechtsstatus (`diary.js`, Feld `forecast`) → spätere Auswertung nach **Prognose vor dem Angeln**, nicht rückwirkend.
- Aufwand (Anglerstunden) und **Nullfang-Sessions** werden erfasst; Auswertung nur deskriptiv (Fische/Anglerstunde nach Spot und Index-Band), Warnhinweis unter 20 Sessions.
- Vor jeder Neugewichtung: Baselines (Spotkonstante, Saison, einfache Wetterregel), zeitlich/räumlich getrennte Holdouts, Sensitivität. Keine automatische Anpassung.
