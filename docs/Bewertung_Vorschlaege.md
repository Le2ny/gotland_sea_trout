# Gotland Sea Trout – Vorschläge zur Spot-Bewertung

**Stand:** 2. November 2026
**Bezug:** `scoreDetailed()` und `currentContext()` aus `app.js`, Release v6.2.4 (`3987e1e`)
**Zweck:** Rückmeldung für dich als Entwickler. Es sind Vorschläge, du entscheidest. In der Android-Version ist deine Bewertungslogik bisher **unverändert** übernommen.

## Worauf die Aussagen beruhen

Ich habe deine Bewertung mit echten Daten nachgerechnet:

- **Zeitraum:** 02.11.2026 18:00 UTC bis 05.11.2026 18:00 UTC, stündlich.
- **Umfang:** alle 25 Spots × 73 Stunden = **1.825 Fälle**.
- **Wetter:** Open-Meteo, dieselben Variablen und Einheiten wie bei dir (Wind in km/h).
- **Strömung:** Copernicus `BALTICSEA_ANALYSISFORECAST_PHY_003_006`. Interpoliert wird wie in deinem Renderer: Radius 1,5 Gitterabstände, mindestens 2 Stützpunkte, nichts über Land.

Das ist **ein Novemberzeitraum mit einem Wetterlagenbild**. Die Zahlen zeigen Tendenzen, keine Jahresstatistik. Das Auswertungsskript liegt bei (`test/score-stats.mjs`) und lässt sich jederzeit neu ausführen.

## Kurzfassung

1. **Die Bewertung trennt die Spots zu wenig.** 27 % aller Fälle haben ≥ 90 Punkte, der Median liegt bei 81. Pro Stunde haben im Median **7 Spots** mindestens 90 Punkte. „Bester Spot jetzt“ ist so kaum zu erkennen.
2. **Drei Kriterien geben fast immer Punkte:** Wassertemperatur (100 %), Welle (96 %), Wind 8–26 km/h (80 %). Sie verschieben nur das Niveau, ohne zwischen den Spots zu unterscheiden.
3. **Die Strömungskriterien greifen in der Ostsee kaum.** Die Schwellen passen eher zu Gewässern mit kräftigen Gezeitenströmungen als zu Gotland. Die „Strömungskante“ misst auf der gewählten Distanz eher Interpolationsrauschen als echte Fronten.
4. **Ablandiger Wind wird nur zur Hälfte bestraft.**
5. Mehrere Daten, die die App schon lädt, fließen nicht ein: Böen, Wellenrichtung und der zeitliche Verlauf.

## Befunde im Detail

### 1. Sättigung und wenig Trennschärfe

| Kennzahl | Wert |
|---|---:|
| Punktzahl min / p10 / Median / p90 / max | 50 / 67 / 81 / 94 / 100 |
| Anteil = 100 | 4,1 % |
| Anteil ≥ 90 | 27,1 % |
| Anteil < 60 | 2,1 % |
| Spots ≥ 90 pro Stunde (min / Median / max) | 2 / 7 / 11 |
| Rohsumme vor Kappung > 100 | 4,3 % (max. 114) |
| Schwankung eines Spots über 72 h | 12 bis 39 Punkte |

Der Grundwert `28 + rating·5` liegt schon bei 43–53. Die Pluspunkte summieren sich bis 124, danach wird bei 100 gekappt. Spots mit 100 Punkten sind dadurch nicht mehr unterscheidbar.

### 2. Kriterien, die fast immer zutreffen

| Grund | Anteil der Fälle |
|---|---:|
| passende Wassertemperatur (4–14 °C) | **100 %** |
| passende Welle (0,2–1,05 m) | 95,9 % |
| brauchbarer Wind (8–26 km/h) | 79,9 % |
| Strömung längs/schräg zur Küste | 76,9 % |
| Wind zur Küste passend | 44,0 % |
| leichte–mäßige Strömung (0,12–0,65 m/s) | **11,3 %** |
| Strömungskante (≥ 0,06 m/s) | **1,4 %** |

Wirklich unterscheiden tun im Moment vor allem die Windrichtung und die Spotbewertung (Sterne).

### 3. Strömung: Schwellen passen nicht zur Ostsee

- Die **mittlere Strömungsstärke** an den Spots liegt bei **0,043 m/s**. Der Bereich 0,12–0,65 m/s wird nur in 11 % der Fälle erreicht. Unter 0,05 m/s gibt es dagegen häufig −4 Punkte.
- **„Strömung längs/schräg zur Küste“** gibt in 77 % der Fälle +9 Punkte, auch bei 0,01–0,03 m/s. Bei so schwacher Strömung sagt die Richtung fachlich wenig aus.
- **Strömungskante:** Deine fünf Messpunkte liegen ±0,006° Breite und ±0,010° Länge auseinander, also etwa 600–670 m. Das Modell hat aber nur etwa 1 Seemeile Auflösung (ca. 1,85 km). Auf dieser Distanz ist die Differenz zum großen Teil Interpolation.
  - Gemessen: Median 0,008 m/s, p90 0,031 m/s, Maximum 0,079 m/s.
  - Die Schwelle von 0,06 m/s wird nur in **1,4 %** der Fälle erreicht.
- In **32 %** der Fälle liegt die Spot-Koordinate selbst ohne Modellwert, also direkt am Ufer. Dann nimmt die Android-Version den nächsten unterstützten Punkt, typischerweise 150 m vor dem Spot, und zeigt das auch an. Bei dir greift in diesem Fall der IDW-Wert oder der Fallback auf Open-Meteo.

### 4. Ablandiger Wind

- In **33 %** der Fälle ist der Wind nach deiner eigenen Funktion `exposure()` „ablandig“ (Winkel > 120°).
- Abzug gibt es aber erst ab > 150°. Das betrifft nur **53 %** dieser Fälle.
- Ein Drittel der ablandigen Fälle hat trotzdem ≥ 80 Punkte.
- Beispiel vom 02.11. 17:00: **Herrvik 100/100** bei 9 km/h aus NW, ablandig.

### 5. Ungenutzte Daten

- **Böen:** Hallshuk bekam 100 Punkte bei 26 km/h Wind und **Böen von 42 km/h**. Das ist für Watangler grenzwertig.
- **Welle über 1,05 m:** Bringt keine Pluspunkte, aber auch keinen Abzug. Damit liegt sie auf einer Stufe mit 0,1 m.
- **`wave_direction`** wird geladen, aber nicht genutzt.
- Der **zeitliche Verlauf** fehlt komplett: Hat sich die Welle über mehrere Stunden aufgebaut? Dreht die Strömung?

## Vorschläge

Sortiert nach Nutzen im Verhältnis zum Aufwand.

### A. Schnell umsetzbar, kaum Risiko

1. **Normieren statt kappen.**
   `score = round(100 · roh / max_möglich)`, dazu den Grundwert senken, etwa `20 + rating·4`. So bleibt die Rangfolge auch oben erhalten.
2. **Strömungsrichtung an die Stärke koppeln.**
   Die +9 für „längs/schräg“ nur vergeben, wenn `v ≥ 0,05 m/s`. Oder mit `min(1, v / 0,1)` gewichten.
3. **Strömungsschwellen an die Ostsee anpassen.**
   Zum Beispiel volle Punkte ab 0,08 m/s und kein Abzug erst unter 0,02 m/s. Noch besser wären Perzentile, siehe C1.
4. **Ablandigen Wind ab > 120° bestrafen**, passend zu deiner eigenen Funktion `exposure()`. Gestaffelt: 120–150° −4, > 150° −8.
5. **Böen berücksichtigen.**
   Ab 45 km/h −5, ab 60 km/h −12 und dazu ein Warnhinweis.
6. **Welle über 1,3 m abwerten** (−5) statt sie neutral zu behandeln.

### B. Mittelfristig: fachlich bessere Signale

1. **Strömungskante auf Modellmaßstab.**
   - Abstand 1,5–2 km statt 600 m (etwa ±0,015° Breite, ±0,028° Länge).
   - Zusätzlich die **Richtungsscherung** auswerten: Winkeldifferenz der Strömungsvektoren über 45° bei v > 0,03 m/s. Ein Richtungswechsel zeigt „Strömungen treffen sich“ oft besser als eine Stärkedifferenz.
   - Optional die Konvergenz auswerten (Divergenz < 0). Dort sammeln sich Futter und Treibgut.
2. **Strömungswechsel über die Zeit.**
   Plus, wenn die Richtung am Spot innerhalb von ±2 h um mehr als 60° dreht oder die Stärke durch ein Minimum geht. Das deckt den „Kenterpunkt“ ab, den du in der Übergabe als Ziel nennst. Mit allen 72 h auf dem Gerät ist das leicht zu rechnen.
3. **Wassertemperatur abstufen statt Ja/Nein.**
   Zum Beispiel volle Punkte bei 6–10 °C, abfallend bis 4 bzw. 14 °C. Im November gibt das Kriterium sonst immer volle Punkte.
4. **Welle über Zeit und Richtung.**
   - Plus für eine seit 6–12 h auflandig aufgebaute Welle (trübes Wasser, Futter im Uferbereich).
   - Dazu `wave_direction` relativ zu `facing` auswerten.
5. **Tageszeit.**
   Plus für Morgen- und Abenddämmerung (Sonnenauf- und -untergang ±1,5 h). Das lässt sich offline mit einer Formel rechnen und braucht keine API.

### C. Langfristig: kalibrieren statt schätzen

1. **Relative statt absolute Schwellen.**
   Strömung, Kante und Welle als Perzentil der eigenen 72-h-Prognose bewerten, etwa „obere 30 %“. Dann passt die Bewertung automatisch zu ruhigen und zu bewegten Lagen.
2. **Fangbuch als Grundlage.**
   Wenn Fänge und Nicht-Fänge mit Ort und Zeit erfasst werden, lassen sich die Gewichte später nachprüfen. Die Android-Version speichert alle Einflussgrößen pro Stunde schon offline, die Erfassung wäre also nur ein kleiner Schritt.
3. **Schutzgebiete.**
   Bei Spots mit Bachmündung (`protected`) Schonzeiten und Schutzabstände als Datum und Regel hinterlegen. Die Bewertung sollte dann klar warnen oder den Spot in der Schonzeit ausblenden. Die konkreten Regeln müsste jemand mit Ortskenntnis aus den aktuellen Vorschriften übernehmen. Ich habe sie nicht geprüft.

## Was in der Android-Version bereits anders ist (ohne die Gewichte zu ändern)

- **Strömung für die Bewertung** kommt aus denselben Copernicus-Daten wie die Karte. Dein Weg mit 130 Einzelabfragen und stillem Fallback auf das Open-Meteo-Strömungsmodell, wenn ein Punkt fehlt, entfällt. Karte und Bewertung können sich nicht mehr widersprechen.
- **Fehlende Werte werden angezeigt:** „keine Modelldaten“ und „Modellwert 150 m vor dem Spot“ statt still ersetzt.
- **Wetter für alle Spots** kommt mit je einer Anfrage (Wind und Meer), wird gespeichert und funktioniert offline.

## Offene Fragen an dich

1. Woher stammen die Schwellen für Strömung (0,12/0,65/0,9 m/s) und Kante (0,06 m/s)? Aus Erfahrung, aus Literatur oder von *Fishing in Denmark*?
2. Ist ablandiger Wind bewusst nur leicht bestraft? Bei kaltem, klarem Wasser im Winter kann ablandig ja auch gut sein.
3. Wie wurde die Sternebewertung pro Spot festgelegt? Sie ist im Moment der stabilste Unterschied zwischen den Spots.
4. Sollen Schonzeiten in der App hart erzwungen werden oder nur als Hinweis erscheinen?
