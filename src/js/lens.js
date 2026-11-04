// Glasses colours. Each eye has a lens colour name and the exact screen colour (RGB 0-255) that
// reaches that eye. "Black test": a colour is right when the OTHER eye's lens turns it pure black.
import { db } from './store.js';

export const PRESETS = {
  'red-cyan': { label: 'Red / Cyan', a: { name: 'Red', rgb: [255, 0, 0] }, b: { name: 'Cyan', rgb: [0, 255, 255] } },
  'red-blue': { label: 'Red / Blue', a: { name: 'Red', rgb: [255, 0, 0] }, b: { name: 'Blue', rgb: [0, 0, 255] } },
  'red-green': { label: 'Red / Green', a: { name: 'Red', rgb: [255, 0, 0] }, b: { name: 'Green', rgb: [0, 255, 0] } },
  'green-magenta': { label: 'Green / Magenta', a: { name: 'Green', rgb: [0, 255, 0] }, b: { name: 'Magenta', rgb: [255, 0, 255] } },
  'blue-yellow': { label: 'Blue / Yellow (amber)', a: { name: 'Blue', rgb: [0, 0, 255] }, b: { name: 'Yellow', rgb: [255, 255, 0] } },
};

// The lens colours people actually own. Picking one per eye is clearer than a preset plus a side.
export const LENS_COLOURS = {
  Red: [255, 0, 0], Cyan: [0, 255, 255], Blue: [0, 0, 255],
  Green: [0, 255, 0], Magenta: [255, 0, 255], Yellow: [255, 255, 0],
};

export function setLensColour(eye, name) {
  const rgb = LENS_COLOURS[name];
  if (!rgb) return;
  db.settings.lens[eye] = { name, rgb: [...rgb] };
  const l = db.settings.lens.left.name, r = db.settings.lens.right.name;
  const key = Object.keys(PRESETS).find(k => { const p = PRESETS[k]; return (p.a.name === l && p.b.name === r) || (p.a.name === r && p.b.name === l); });
  db.settings.lensPreset = key || 'custom';
  db.settings.lensCalibrated = false;
  db.settings.lensConfirmed = true;
}

// Channels both lenses let through: each eye would see part of the other eye's picture.
export function lensOverlap() {
  const a = LENS_COLOURS[lens('left').name], b = LENS_COLOURS[lens('right').name];
  if (!a || !b) return [];
  return ['red', 'green', 'blue'].filter((_, i) => a[i] && b[i]);
}

export function lens(eye) { return db.settings.lens[eye]; }
export function otherEye(eye) { return eye === 'left' ? 'right' : 'left'; }
export const rgbCss = rgb => `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
export const hex = rgb => '#' + rgb.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');

// A brighter, UI-friendly version of a lens colour for text and dots on the dark interface.
function uiColor(rgb) {
  const m = Math.max(...rgb, 1);
  const k = 255 / m;
  const c = rgb.map(v => Math.round(v * k));
  // lift very dark pure blues so they stay readable on dark backgrounds
  const lum = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  if (lum < 90) return c.map(v => Math.round(v + (255 - v) * 0.35));
  return c;
}

export function applyEyeColors() {
  const r = document.documentElement.style;
  r.setProperty('--eyeL', rgbCss(uiColor(lens('left').rgb)));
  r.setProperty('--eyeR', rgbCss(uiColor(lens('right').rgb)));
}

export function setPreset(key, leftIsA = true) {
  const p = PRESETS[key];
  if (!p) return;
  const A = { name: p.a.name, rgb: [...p.a.rgb] }, B = { name: p.b.name, rgb: [...p.b.rgb] };
  db.settings.lensPreset = key;
  db.settings.lens = leftIsA ? { left: A, right: B } : { left: B, right: A };
  db.settings.lensCalibrated = false;
}

export function swapLenses() {
  const l = db.settings.lens.left;
  db.settings.lens.left = db.settings.lens.right;
  db.settings.lens.right = l;
}

// Names for sentences: "Red/Cyan glasses", "Red lens on your left eye"
export function pairName() { return `${lens('left').name}/${lens('right').name}`; }
