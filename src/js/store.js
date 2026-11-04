// Local-only persistence. Everything lives in this browser's localStorage.
// Each patient's data lives under its own key (see accounts.js); useData() switches which one `db` holds.
let KEY = 'amblyopia-training-lab.v1';

const DEFAULTS = {
  version: 1,
  settings: {
    consent: false,
    amblyopicEye: 'left',      // 'left' | 'right'
    // Glasses: lens colour per eye and the calibrated screen colour that reaches that eye.
    lensPreset: 'red-cyan',
    lens: { left: { name: 'Red', rgb: [255, 0, 0] }, right: { name: 'Cyan', rgb: [0, 255, 255] } },
    lensCalibrated: false,
    lensConfirmed: false,      // the person has told us which colour is over each eye
    pxPerMm: null,             // CSS px per mm, from card calibration
    distanceCm: 60,
    gamma: 2.2,
    noiseContrast: 0.6,
    setupDone: false,
    theme: 'auto',             // 'auto' | 'light' | 'dark' | 'contrast'
    textSize: 'm',             // 'm' | 'l' | 'xl'
    dailyGoal: 30,             // minutes
  },
  state: {
    feLevel: null,             // fellow-eye level for dichoptic games (0.05..1)
    balance: null,             // last balance point
    thresholds: {},            // per game id
    sf: 3,                     // Gabor spatial frequency, cycles/deg
    letterSize: null,          // last letter size threshold, arcmin
    glassesCheckDate: null,
    dichopticLocked: false,
  },
  sessions: [],
  symptoms: [],
};

function clone(o) { return JSON.parse(JSON.stringify(o)); }

function merge(base, extra) {
  const out = clone(base);
  if (!extra || typeof extra !== 'object') return out;
  for (const k of Object.keys(extra)) {
    if (out[k] && typeof out[k] === 'object' && !Array.isArray(out[k]) && extra[k] && typeof extra[k] === 'object' && !Array.isArray(extra[k])) {
      out[k] = merge(out[k], extra[k]);
    } else {
      out[k] = extra[k];
    }
  }
  return out;
}

// Older saves stored glasses as type + red-lens side + two gains. Convert them to per-eye colours.
function migrate(saved) {
  const st = saved && saved.settings;
  if (st && !st.lens && (st.glasses || st.redOn)) {
    const other = st.glasses === 'red-green' ? { name: 'Green', mask: [0, 1, 1].map((v, i) => (i === 1 ? 1 : 0)) }
      : st.glasses === 'red-blue' ? { name: 'Blue', mask: [0, 0, 1] } : { name: 'Cyan', mask: [0, 1, 1] };
    const gr = st.gainRed ?? 1, gc = st.gainCyan ?? 1;
    const red = { name: 'Red', rgb: [Math.round(255 * gr), 0, 0] };
    const oth = { name: other.name, rgb: other.mask.map(m => Math.round(255 * gc * m)) };
    st.lens = st.redOn === 'right' ? { left: oth, right: red } : { left: red, right: oth };
    st.lensPreset = st.glasses === 'red-green' ? 'red-green' : st.glasses === 'red-blue' ? 'red-blue' : 'red-cyan';
    delete st.glasses; delete st.redOn; delete st.gainRed; delete st.gainCyan;
  }
  if (st && st.lensConfirmed == null && st.lensCalibrated) st.lensConfirmed = true;
  return saved;
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return merge(DEFAULTS, migrate(JSON.parse(raw)));
  } catch (e) { /* storage unavailable */ }
  return clone(DEFAULTS);
}

export const db = load();
export let storageOk = true;

// Load another profile's data into the same `db` object, so every module keeps its reference.
export function useData(key) {
  KEY = key;
  const next = load();
  for (const k of Object.keys(db)) delete db[k];
  Object.assign(db, next);
}
export const freshData = () => clone(DEFAULTS);

// The doctor's training plan, stored with the patient's data (db.state.plan). No plan = everything on.
export const plan = () => db.state.plan || null;
export const planOn = id => { const p = plan(); return !p || !p.games || !p.games[id] || p.games[id].on !== false; };
export const planMinutes = (id, def) => { const p = plan(); return (p && p.games && p.games[id] && p.games[id].minutes) || def; };
// 'mono' (patch only), 'anaglyph' (glasses only) or null (the patient chooses).
export const planMode = id => { const p = plan(), m = p && p.games && p.games[id] && p.games[id].mode; return m === 'mono' || m === 'anaglyph' ? m : null; };
// Two-eye games are off after a double-vision report, or when the doctor's plan doesn't allow them.
export const dichOff = () => !!(db.state.dichopticLocked || (plan() && plan().dichoptic === false));

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); storageOk = true; }
  catch (e) { storageOk = false; }
}

export function resetAll() {
  const fresh = clone(DEFAULTS);
  for (const k of Object.keys(db)) delete db[k];
  Object.assign(db, fresh);
  save();
}

export function importData(json) {
  const parsed = JSON.parse(json);
  if (!parsed || typeof parsed !== 'object' || !parsed.settings) throw new Error('This file is not an Amblyopia Training Lab export.');
  const merged = merge(DEFAULTS, migrate(parsed));
  for (const k of Object.keys(db)) delete db[k];
  Object.assign(db, merged);
  save();
}

export function exportData() {
  return JSON.stringify({ ...db, exportedAt: new Date().toISOString() }, null, 2);
}

export function todayKey(d = new Date()) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addSession(rec) {
  db.sessions.push({ ...rec, date: new Date().toISOString(), day: todayKey() });
  save();
}

export function addSymptoms(rec) {
  db.symptoms.push({ ...rec, date: new Date().toISOString(), day: todayKey() });
  if (rec.doubleVision) db.state.dichopticLocked = true;
  save();
}

export function sessionsOn(day) { return db.sessions.filter(s => s.day === day); }

export function minutesOn(day) {
  return sessionsOn(day).reduce((a, s) => a + (s.minutes || 0), 0);
}

export function streak() {
  let n = 0;
  const d = new Date();
  // today counts if trained; otherwise start from yesterday
  if (minutesOn(todayKey(d)) <= 0) d.setDate(d.getDate() - 1);
  for (;;) {
    if (minutesOn(todayKey(d)) > 0) { n++; d.setDate(d.getDate() - 1); }
    else break;
  }
  return n;
}

export function fellowEye() { return db.settings.amblyopicEye === 'left' ? 'right' : 'left'; }
