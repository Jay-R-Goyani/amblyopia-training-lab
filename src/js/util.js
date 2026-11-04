import { db } from './store.js';

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
export const randInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
export const pick = arr => arr[Math.floor(Math.random() * arr.length)];
export const shuffle = arr => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };

// CSS pixels per mm. 96 CSS px per inch is the nominal value until the card calibration runs.
export function pxPerMm() { return db.settings.pxPerMm || 96 / 25.4; }

// CSS pixels per degree of visual angle at the configured viewing distance.
export function pxPerDeg() {
  const mm = db.settings.distanceCm * 10 * Math.tan(Math.PI / 180);
  return mm * pxPerMm();
}

// Letter height (CSS px) for a given size in arcminutes.
export function arcminToPx(arcmin) { return pxPerDeg() * arcmin / 60; }

// logMAR from letter height in arcmin (a 20/20 letter is 5 arcmin tall).
export function logMAR(arcmin) { return Math.log10(arcmin / 5); }
export function snellen(arcmin) { return `20/${Math.round(20 * arcmin / 5)}`; }

export const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function fmtMin(m) {
  if (m < 1) return `${Math.round(m * 60)} s`;
  return `${Math.round(m)} min`;
}

export function fmtPct(v, digits = 1) { return `${(v * 100).toFixed(digits)}%`; }

// ---- sound (WebAudio, created on first user gesture) ----
let ac = null;
export function initAudio() {
  try { if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === 'suspended') ac.resume(); } catch (e) { ac = null; }
}
export function beep(freq = 660, dur = 0.08, vol = 0.06) {
  if (!ac) return;
  try {
    const o = ac.createOscillator(), g = ac.createGain();
    o.frequency.value = freq; o.type = 'sine';
    g.gain.setValueAtTime(vol, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
    o.connect(g); g.connect(ac.destination); o.start(); o.stop(ac.currentTime + dur + 0.02);
  } catch (e) { /* ignore */ }
}
export const sfx = {
  good: () => beep(880, 0.07),
  bad: () => beep(240, 0.12, 0.05),
  tick: () => beep(520, 0.05, 0.04),
  interval: () => beep(700, 0.06, 0.05),
};

// ---- file save with graceful fallbacks ----
export async function saveTextFile(filename, text) {
  try {
    if (window.claude && typeof window.claude.use === 'function') {
      const d = await window.claude.use('downloads');
      if (d) { await d.save({ filename, data: text }); return 'saved'; }
    }
  } catch (e) { /* fall through */ }
  try {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return 'downloaded';
  } catch (e) { /* fall through */ }
  try { await navigator.clipboard.writeText(text); return 'copied'; } catch (e) { return 'failed'; }
}

// Friendly difficulty levels (higher = harder = better) derived from staircase values.
export const levelContrast = c => Math.max(1, Math.round(Math.log10(1 / Math.max(c, 1e-4)) * 12));
export const levelSpacing = sp => Math.max(1, Math.round((2.6 - sp) * 10));
export const levelCoherence = c => Math.max(1, Math.round(Math.log10(1 / Math.max(c, 1e-3)) * 15));
