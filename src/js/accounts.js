// Accounts and role-based access for a shared device (clinic tablet, family computer).
// Roles: clinic admin, doctor, patient. Each patient's training data lives under its own storage key.
// This runs entirely in the browser: PINs are salted and hashed, and every screen checks permissions,
// but anyone with full access to the device's browser storage could still read it. Real security needs a server.

const DIR_KEY = 'atl.directory.v1';
const SESSION_KEY = 'atl.session.v1';
export const LEGACY_KEY = 'amblyopia-training-lab.v1';
export const dataKey = id => `${LEGACY_KEY}:${id}`;

// ---------- SHA-256 (small, synchronous, works on file:// too) ----------
function sha256(msg) {
  const K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  const bytes = new TextEncoder().encode(msg);
  const l = bytes.length, withPad = ((l + 9 + 63) >> 6) << 6;
  const m = new Uint8Array(withPad); m.set(bytes); m[l] = 0x80;
  const bits = l * 8; for (let i = 0; i < 4; i++) m[withPad - 1 - i] = (bits >>> (8 * i)) & 0xff;
  const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const w = new Uint32Array(64), r = (x, n) => (x >>> n) | (x << (32 - n));
  for (let o = 0; o < withPad; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = (m[o + 4 * i] << 24) | (m[o + 4 * i + 1] << 16) | (m[o + 4 * i + 2] << 8) | m[o + 4 * i + 3];
    for (let i = 16; i < 64; i++) { const s0 = r(w[i - 15], 7) ^ r(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = r(w[i - 2], 17) ^ r(w[i - 2], 19) ^ (w[i - 2] >>> 10); w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0; }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
      const t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0; H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
  }
  return H.map(x => (x >>> 0).toString(16).padStart(8, '0')).join('');
}
const randId = (p = '') => p + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
const hashPin = (pin, salt) => { let h = `${salt}:${pin}`; for (let i = 0; i < 2000; i++) h = sha256(h); return h; };
export const validPin = pin => /^\d{4,6}$/.test(pin);
export const suggestPin = () => String(1000 + Math.floor(Math.random() * 9000));

// ---------- directory ----------
const EMPTY = { version: 1, setup: false, demo: false, clinic: '', users: [], notes: {}, messages: {}, audit: [], device: { idleMin: 10 } };
function loadDir() {
  try { const raw = localStorage.getItem(DIR_KEY); if (raw) return { ...JSON.parse(JSON.stringify(EMPTY)), ...JSON.parse(raw) }; } catch (e) { /* storage unavailable */ }
  return JSON.parse(JSON.stringify(EMPTY));
}
export const dir = loadDir();
export function saveDir() { try { localStorage.setItem(DIR_KEY, JSON.stringify(dir)); } catch (e) { /* ignore */ } }
export function resetDevice() {
  try { Object.keys(localStorage).filter(k => k === DIR_KEY || k.startsWith(LEGACY_KEY)).forEach(k => localStorage.removeItem(k)); sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
  for (const k of Object.keys(dir)) delete dir[k];
  Object.assign(dir, JSON.parse(JSON.stringify(EMPTY)));
}

export const ROLE_LABEL = { admin: 'Clinic admin', doctor: 'Doctor', patient: 'Patient' };
export const userById = id => dir.users.find(u => u.id === id) || null;
export const doctors = (all = false) => dir.users.filter(u => u.role === 'doctor' && (all || u.active));
export const patients = (all = false) => dir.users.filter(u => u.role === 'patient' && (all || u.active));
export const patientsOf = docId => patients().filter(p => p.doctorId === docId);
export const displayName = u => (u ? (u.role === 'doctor' && !/^dr\b/i.test(u.name) ? `Dr ${u.name}` : u.name) : '–');

export function createUser({ role, name, pin, doctorId = null, dob = '', weakEye = 'left' }, by) {
  const salt = randId();
  const u = { id: randId(role[0]), role, name: name.trim(), salt, pin: hashPin(pin, salt), active: true, createdAt: new Date().toISOString(), createdBy: by ? by.id : null, lastLogin: null, failed: 0, lockUntil: 0, prefs: { theme: 'auto', textSize: 'm' } };
  if (role === 'patient') Object.assign(u, { doctorId, dob, weakEye });
  dir.users.push(u);
  saveDir();
  audit(by, 'account_create', u.id, `${ROLE_LABEL[role]}${role === 'patient' && doctorId ? `, assigned to ${displayName(userById(doctorId))}` : ''}`);
  return u;
}
export function setPin(u, pin, by, action = 'pin_reset') {
  u.salt = randId(); u.pin = hashPin(pin, u.salt); u.failed = 0; u.lockUntil = 0; saveDir();
  audit(by, action, u.id);
}

// ---------- sign-in ----------
export const MAX_TRIES = 5, LOCK_SECS = 60;
let current = null;
export const me = () => current;
export function checkPin(u, pin) {
  const now = Date.now();
  if (u.lockUntil > now) return { ok: false, locked: Math.ceil((u.lockUntil - now) / 1000) };
  if (hashPin(pin, u.salt) === u.pin) { u.failed = 0; u.lockUntil = 0; saveDir(); return { ok: true }; }
  u.failed = (u.failed || 0) + 1;
  if (u.failed >= MAX_TRIES) { u.lockUntil = now + LOCK_SECS * 1000; u.failed = 0; }
  saveDir();
  audit(null, 'signin_failed', u.id, u.lockUntil > now ? `locked for ${LOCK_SECS} s` : `${MAX_TRIES - u.failed} tries left`);
  return { ok: false, left: u.lockUntil > now ? 0 : MAX_TRIES - u.failed, locked: u.lockUntil > now ? LOCK_SECS : 0 };
}
export function signIn(u) {
  current = u; u.lastLogin = new Date().toISOString(); saveDir();
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ uid: u.id, at: Date.now() })); } catch (e) { /* ignore */ }
  audit(u, 'signin', u.id);
}
export function signOut(reason = 'signout') {
  if (current) audit(current, reason, current.id);
  current = null;
  try { sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
}
// Survive a page reload in the same tab, unless the device has been idle too long.
export function resume() {
  try {
    const s = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    const u = s && userById(s.uid);
    if (u && u.active && Date.now() - s.at < (dir.device.idleMin || 10) * 60000) { current = u; touch(); return u; }
  } catch (e) { /* ignore */ }
  return null;
}
export function touch() { try { if (current) sessionStorage.setItem(SESSION_KEY, JSON.stringify({ uid: current.id, at: Date.now() })); } catch (e) { /* ignore */ } }

// ---------- audit log ----------
export function audit(by, action, target = null, detail = '') {
  dir.audit.push({ at: new Date().toISOString(), uid: by ? by.id : null, role: by ? by.role : null, action, target, detail });
  if (dir.audit.length > 800) dir.audit.splice(0, dir.audit.length - 800);
  saveDir();
}
export const ACTION_LABEL = {
  signin: 'Signed in', signout: 'Signed out', idle_lock: 'Locked after inactivity', signin_failed: 'Wrong PIN',
  account_create: 'Created account', account_update: 'Changed account', account_deactivate: 'Deactivated account', account_activate: 'Reactivated account',
  assign: 'Assigned patient', pin_reset: 'Reset PIN', pin_change: 'Changed own PIN',
  patient_open: 'Opened patient record', plan_update: 'Changed training plan', dich_resume: 'Resumed two-eye games',
  note_add: 'Added clinical note', message_send: 'Sent instruction', message_read: 'Read instruction',
  access_denied: 'Access denied', device_backup: 'Saved device backup', device_restore: 'Restored device backup', device_setup: 'Set up device', report_print: 'Printed report',
};

// ---------- permissions ----------
// Each rule gets the signed-in user and, where it matters, the patient account the action is about.
const own = (u, p) => u.role === 'doctor' && p && p.role === 'patient' && p.doctorId === u.id && p.active;
const self = (u, p) => u.role === 'patient' && p && p.id === u.id;
const RULES = {
  'accounts.manage': u => u.role === 'admin',
  'patients.create': u => u.role === 'admin' || u.role === 'doctor',
  'patients.assign': u => u.role === 'admin',
  'patients.list': u => u.role === 'admin' || u.role === 'doctor',
  'pin.reset': (u, p) => u.role === 'admin' || own(u, p),
  'audit.read': u => u.role === 'admin',
  'device.manage': u => u.role === 'admin',
  'clinical.read': (u, p) => own(u, p) || self(u, p),
  'plan.write': (u, p) => own(u, p),
  'notes.rw': (u, p) => own(u, p),
  'message.send': (u, p) => own(u, p),
  'message.read': (u, p) => self(u, p),
  'train': (u, p) => self(u, p),
};
export function can(perm, target, u = current) { return !!(u && u.active && RULES[perm] && RULES[perm](u, target)); }

// What the roles page shows. Cells: true, false, or a short qualifier.
export const MATRIX = [
  ['Sign in with their own PIN, change their PIN and display', true, true, true],
  ['Add and edit doctor accounts', true, false, false],
  ['Add patient accounts', true, 'assigned to themselves', false],
  ['Assign or move patients between doctors', true, false, false],
  ['Deactivate accounts', true, false, false],
  ['Reset a PIN', 'anyone', 'own patients', false],
  ['See the patient list', 'names and doctor only', 'own patients', false],
  ['See results, progress and the report', false, 'own patients', 'only their own'],
  ['Print or save the report', false, 'own patients', 'only their own'],
  ['Set the training plan (games, minutes, goal, weaker eye, two-eye games)', false, 'own patients', false],
  ['Resume two-eye games after a double-vision report', false, 'own patients', false],
  ['Write and read private clinical notes', false, 'own patients', false],
  ['Send instructions to a patient', false, 'own patients', 'reads their own'],
  ['Play training and record results', false, false, true],
  ['See the audit log', true, false, false],
  ['Back up, restore or reset this device', true, false, false],
];

// ---------- notes & messages ----------
export function addNote(patientId, text, by) {
  (dir.notes[patientId] = dir.notes[patientId] || []).push({ id: randId('n'), by: by.id, at: new Date().toISOString(), text });
  saveDir(); audit(by, 'note_add', patientId);
}
export function sendMessage(patientId, text, by) {
  (dir.messages[patientId] = dir.messages[patientId] || []).push({ id: randId('m'), by: by.id, at: new Date().toISOString(), text, readAt: null });
  saveDir(); audit(by, 'message_send', patientId);
}
export function markRead(patientId, msgId, by) {
  const m = (dir.messages[patientId] || []).find(x => x.id === msgId);
  if (m && !m.readAt) { m.readAt = new Date().toISOString(); saveDir(); audit(by, 'message_read', patientId); }
}

// ---------- reading another patient's data without loading it ----------
export function readData(id) {
  try { const raw = localStorage.getItem(dataKey(id)); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
}
export function writeData(id, data) { try { localStorage.setItem(dataKey(id), JSON.stringify(data)); } catch (e) { /* ignore */ } }
export function legacyData() {
  try { const raw = localStorage.getItem(LEGACY_KEY); const d = raw && JSON.parse(raw); return d && (d.sessions?.length || d.settings?.consent) ? d : null; } catch (e) { return null; }
}

// Whole-device backup (accounts, notes, messages, audit and every patient's data).
export function backup() {
  const out = { kind: 'atl-device-backup', exportedAt: new Date().toISOString(), directory: dir, patients: {} };
  dir.users.filter(u => u.role === 'patient').forEach(p => { out.patients[p.id] = readData(p.id); });
  return JSON.stringify(out, null, 2);
}
export function restore(json) {
  const b = JSON.parse(json);
  if (!b || b.kind !== 'atl-device-backup' || !b.directory) throw new Error('This file is not a device backup from Amblyopia Training Lab.');
  resetDevice();
  Object.assign(dir, b.directory); saveDir();
  for (const [id, d] of Object.entries(b.patients || {})) if (d) writeData(id, d);
}
