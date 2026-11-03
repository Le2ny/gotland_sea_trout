// Sunrise, sunset and civil dusk (sun 6° below the horizon = "dark") from the sun's position,
// NOAA solar equations – works offline for any place and day.
const D2R = Math.PI / 180;

/** UTC ms of the moment the sun crosses `alt` degrees (rising=false: in the evening) on the date of `dayMs` */
function crossing(dayMs, lat, lon, alt, rising) {
  const d = new Date(dayMs), J = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 12) / 86400000 + 2440587.5;
  const n = Math.round(J - 2451545.0 + 0.0008 - (-lon) / 360);                   // Julian cycle
  const Js = 2451545.0 + 0.0009 + (-lon) / 360 + n;                               // approx. solar noon
  const M = (357.5291 + 0.98560028 * (Js - 2451545)) % 360;                       // mean anomaly
  const C = 1.9148 * Math.sin(M * D2R) + 0.02 * Math.sin(2 * M * D2R) + 0.0003 * Math.sin(3 * M * D2R);
  const lam = (M + C + 180 + 102.9372) % 360;                                     // ecliptic longitude
  const Jt = Js + 0.0053 * Math.sin(M * D2R) - 0.0069 * Math.sin(2 * lam * D2R);  // solar transit
  const dec = Math.asin(Math.sin(lam * D2R) * Math.sin(23.4397 * D2R));
  const cosH = (Math.sin(alt * D2R) - Math.sin(lat * D2R) * Math.sin(dec)) / (Math.cos(lat * D2R) * Math.cos(dec));
  if (cosH > 1 || cosH < -1) return null;                                         // polar day/night
  const H = Math.acos(cosH) / D2R / 360;
  return ((rising ? Jt - H : Jt + H) - 2440587.5) * 86400000;
}

export function sunTimes(dayMs, lat, lon) {
  return { rise: crossing(dayMs, lat, lon, -0.833, true), set: crossing(dayMs, lat, lon, -0.833, false), dusk: crossing(dayMs, lat, lon, -6, false) };
}
