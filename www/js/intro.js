// Intro: picture, spinning coin, a rotating fun line – and a real coin toss that picks
// between the two best spots of the current hour. Sound and jingle are synthesised here
// (own melody, no recordings); browsers only allow audio after a tap, so nothing plays
// unless the coin is tapped.

const LINES = [
  'Toss a coin to your software engineer',
  'Wirf deinem Entwickler eine Münze zu – er hat 40.180 Küstenstücke geprüft',
  'Petri Heil & Range-Requests',
  '56 MB Ostsee, bitgenau ausgepackt',
  'Kein Server wurde für diese App betrieben',
  'Die Meerforelle liest keine Prognosen. Du schon.',
  'Strömungskante gesucht, Kaffee gefunden',
  'Offline am Strand, online im Herzen',
];

let audio = null;
function ctx() { try { audio ??= new (window.AudioContext || window.webkitAudioContext)(); audio.resume?.(); return audio; } catch { return null; } }

/** metallic "clink": a few inharmonic partials with fast decay */
function clink(ac, t, gain = 0.25) {
  for (const [f, g, d] of [[2093, 1, 0.5], [3137, 0.6, 0.35], [4186, 0.35, 0.25], [5274, 0.2, 0.18]]) {
    const o = ac.createOscillator(), v = ac.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(f, t);
    v.gain.setValueAtTime(0.0001, t); v.gain.exponentialRampToValueAtTime(gain * g, t + 0.005); v.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(v).connect(ac.destination); o.start(t); o.stop(t + d + 0.05);
  }
}

/** short original sea-shanty style motif in D minor, plucked */
function jingle(ac, t0) {
  const N = { D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.0, A4: 440.0, Bb4: 466.16, C5: 523.25, D5: 587.33 };
  const tune = [['D4', .18], ['F4', .18], ['A4', .18], ['D5', .36], ['C5', .18], ['A4', .18], ['Bb4', .18], ['G4', .18], ['A4', .54], ['F4', .18], ['E4', .18], ['D4', .6]];
  let t = t0;
  for (const [n, d] of tune) {
    for (const [mult, g, type] of [[1, 0.16, 'triangle'], [2, 0.04, 'sine']]) {
      const o = ac.createOscillator(), v = ac.createGain();
      o.type = type; o.frequency.setValueAtTime(N[n] * mult, t);
      v.gain.setValueAtTime(0.0001, t); v.gain.exponentialRampToValueAtTime(g, t + 0.01); v.gain.exponentialRampToValueAtTime(0.0001, t + d * 1.6);
      o.connect(v).connect(ac.destination); o.start(t); o.stop(t + d * 1.7);
    }
    t += d;
  }
}

/** Gotland silhouette as SVG path from the largest coastline rings (simplified) */
function gotlandPath(coast) {
  const rings = [...coast.rings].sort((a, b) => b.length - a.length).slice(0, 2);
  let w = 180, e = -180, s = 90, n = -90;
  for (const r of rings) for (let i = 0; i < r.length; i += 2) { w = Math.min(w, r[i]); e = Math.max(e, r[i]); s = Math.min(s, r[i + 1]); n = Math.max(n, r[i + 1]); }
  const k = Math.cos(57.4 * Math.PI / 180), sc = 64 / Math.max((e - w) * k, n - s);
  const ox = 50 - (e - w) * k * sc / 2, oy = 50 - (n - s) * sc / 2;
  return rings.map(r => { const step = Math.max(2, Math.floor(r.length / 600) * 2); let d = '';
    for (let i = 0; i < r.length; i += step) d += (i ? 'L' : 'M') + (ox + (r[i] - w) * k * sc).toFixed(1) + ' ' + (oy + (n - r[i + 1]) * sc).toFixed(1);
    return d + 'Z'; }).join('');
}

export function initIntro({ coast, fishSvg, getTopTwo, openSpot, showHow, soundOn, setSound }) {
  const intro = document.getElementById('intro');
  if (!intro) return;
  window.__appReady = true;
  const line = LINES[(crypto.getRandomValues(new Uint32Array(1))[0]) % LINES.length];
  intro.insertAdjacentHTML('beforeend', `
    <div class="introUi">
      <button class="coin" id="coin" type="button" aria-label="Münze werfen">
        <span class="face front">${fishSvg}</span>
        <span class="face back"><svg viewBox="0 0 100 100"><path d="${gotlandPath(coast)}"/></svg></span>
      </button>
      <p class="tag">${line}</p>
      <p class="hint" id="coinHint">Tippe die Münze: sie wählt deinen Spot</p>
      <div class="introBtns">
        <button id="introHow" type="button" class="ghost">ⓘ So funktioniert's</button>
        <button id="introSound" type="button" class="ghost" aria-label="Ton">${soundOn() ? '🔊' : '🔇'}</button>
        <button id="introGo" type="button">Los geht's</button>
      </div>
    </div>`);
  let auto = setTimeout(close, 3600), busy = false;
  const keep = () => { clearTimeout(auto); auto = null; };
  intro.addEventListener('pointerdown', keep, { once: true });

  function close() { clearTimeout(auto); intro.classList.add('gone'); setTimeout(() => intro.remove(), 700); }
  document.getElementById('introGo').onclick = close;
  document.getElementById('introHow').onclick = () => { close(); showHow(); };
  document.getElementById('introSound').onclick = e => { setSound(!soundOn()); e.currentTarget.textContent = soundOn() ? '🔊' : '🔇'; };

  document.getElementById('coin').onclick = () => {
    if (busy) return; busy = true; keep();
    const coin = document.getElementById('coin'), hint = document.getElementById('coinHint');
    const heads = (crypto.getRandomValues(new Uint8Array(1))[0] & 1) === 0;  // fair 50:50
    const top = getTopTwo();
    if (soundOn()) { const ac = ctx(); if (ac) { const t = ac.currentTime; clink(ac, t + 0.02); clink(ac, t + 1.15, 0.18); clink(ac, t + 1.32, 0.1); jingle(ac, t + 1.5); } }
    coin.classList.remove('spin'); coin.style.setProperty('--end', heads ? '1800deg' : '1980deg');
    void coin.offsetWidth; coin.classList.add('flip');
    hint.textContent = 'Die Münze fliegt …';
    setTimeout(() => {
      if (!top.length) { hint.innerHTML = heads ? '<b>Kopf:</b> WLAN suchen und Prognose laden.' : '<b>Zahl:</b> Trotzdem angeln gehen – ohne Prognose.'; busy = false; return; }
      const pick = top.length === 1 ? top[0] : heads ? top[0] : top[1];
      hint.innerHTML = `<b>${heads ? 'Kopf (Fisch)' : 'Zahl (Gotland)'}:</b> ${pick.name} · ${pick.score}/100` +
        (top.length > 1 ? `<br><small>zwischen ${top[0].name} und ${top[1].name}</small>` : '') +
        `<br><button id="coinGo" type="button">Hinfahren</button>`;
      document.getElementById('coinGo').onclick = () => { close(); openSpot(pick.id); };
      busy = false;
    }, 1500);
  };
}

export const HOW_HTML = `
  <p><b>Kurz:</b> Die App holt sich die offizielle Ostsee-Prognose direkt aufs Handy, rechnet dort alles selbst und funktioniert danach offline. Es gibt keinen eigenen Server.</p>
  <h4>1 · Daten holen</h4>
  <p>Das Ostsee-Modell von Copernicus (EU) rechnet zweimal täglich Strömung, Wasserstand und Temperatur für die ganze Ostsee, im Raster von etwa 1 Seemeile und alle 15 Minuten. Die Dateien sind für die ganze Ostsee gepackt. Die App lädt per Teil-Download nur die Blöcke mit Gotland und entpackt sie selbst. Das ergibt bitgenau dieselben Werte wie der volle Download, aber rund dreimal weniger Daten (~89 MB für 72 Stunden). Wind und Welle kommen von Open-Meteo.</p>
  <h4>2 · Speichern</h4>
  <p>Alles landet im Speicher des Handys. Am Strand ohne Netz laufen Karte, Zeitregler und Bewertung weiter. Küstenlinie, Spots, Parkplätze und Schutzgebiete stecken schon in der App.</p>
  <h4>3 · Karte zeichnen</h4>
  <p>Zwischen den Modellpunkten wird gewichtet gemittelt: Alle Punkte im Umkreis von 1,5 Gitterabständen zählen, nähere stärker. Gebraucht werden mindestens zwei Punkte. An einem Modellpunkt selbst kommt exakt der Originalwert heraus. <b>Nie über Land:</b> Für jede Fläche von etwa 150 m ist vorab berechnet, welche Modellpunkte ohne Landquerung erreichbar sind (40.180 Küstenstücke aus OpenStreetMap). Wo das Modell keine Daten hat, bleibt die Karte leer. Es wird nichts erfunden.</p>
  <h4>4 · Spots bewerten</h4>
  <p>Die Punkte stammen aus der Original-App: Wind, Wind zur Küste, Welle, Wassertemperatur, Strömungsstärke und -richtung sowie die Strömungskante (Unterschied an 5 Punkten rund um den Spot). Die Strömung kommt aus denselben Daten wie die Karte.</p>
  <h4>5 · Schutzgebiete</h4>
  <p>Die amtlichen Flächen der Länsstyrelsen werden bei jedem Laden aufgefrischt. Mit GPS warnt die App, wenn du in einem Schutzgebiet stehst. Rechtlich maßgeblich bleibt die Vorschrift.</p>
  <h4>6 · Tag planen & Tagebuch</h4>
  <p><b>🗓 Tag planen</b> baut aus Prognose, vorberechneten Fahr-/Fußwegen (OpenStreetMap-Routing) und Schutzgebieten einen Tagesplan; eigene Spots lassen sich an jeder Stelle fest einfügen. <b>📖 Tagebuch</b> speichert Sessions (auch ohne Fang), Bisse und Fänge nur auf dem Gerät – mit verschlüsselter Sicherungsdatei. Der Index ist eine unvalidierte Heuristik, keine Fangwahrscheinlichkeit; Prognosesicherheit, Sicherheit und Recht stehen getrennt daneben.</p>
  <h4>7 · Die Münze</h4>
  <p>Ehrlicher Zufall (50:50 aus dem Zufallsgenerator des Geräts) zwischen den zwei besten Spots der aktuellen Stunde. Klang und Melodie werden live im Gerät erzeugt.</p>
  <h4>Grenzen</h4>
  <p>Das alles sind Modellprognosen, keine Messungen. Eine Seemeile Auflösung zeigt keine Details direkt an einzelnen Steinen. Kein Ersatz für Seekarte, Wetterwarnung oder Vorschriften.</p>`;
