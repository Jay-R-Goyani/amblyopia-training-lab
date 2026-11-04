// Screens for the shared-device clinic: sign-in, first-run setup, admin and doctor pages.
// main.js passes in the pieces it owns (page header, report, progress, routing) through ctx.
import * as A from './accounts.js';
import { db, save, todayKey, useData, freshData } from './store.js';
import { CATALOG, TESTS, byId } from './catalog.js';
import { ICON, GAME_ICON } from './icons.js';
import { esc, saveTextFile } from './util.js';
import { METRICS, trend } from './metrics.js';

let ctx = null;
export function initClinic(c) { ctx = c; }
const view = () => document.getElementById('view');
const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : '');
const initials = n => n.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
const avatar = (u, cls = '') => `<span class="av ${u.role} ${cls}" aria-hidden="true">${esc(initials(u.name))}</span>`;
const fmtDate = (d, opts = { day: 'numeric', month: 'short', year: 'numeric' }) => (d ? new Date(d).toLocaleDateString(undefined, opts) : '–');
const fmtTime = d => (d ? new Date(d).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '–');
const ago = d => { if (!d) return 'never'; const days = Math.floor((new Date(todayKey()) - new Date(todayKey(new Date(d)))) / 864e5); return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`; };
const ageOf = dob => (dob ? Math.floor((Date.now() - new Date(dob)) / (365.25 * 864e5)) : null);
const roleBadge = r => `<span class="rolebadge ${r}">${A.ROLE_LABEL[r]}</span>`;
const GAMES = [...CATALOG];
const CHECKS = TESTS;

// ---------- a patient's plan & synced fields ----------
export function defaultPlan({ weakEye = 'left', dailyGoal = 30 } = {}) {
  const games = {};
  [...GAMES, ...CHECKS].forEach(g => { games[g.id] = { on: true, mode: 'choice' }; });
  return { weakEye, dailyGoal, dichoptic: true, games, reviewDate: '', updatedAt: new Date().toISOString(), updatedBy: null };
}
// Load a patient's data into db and copy in the details the clinic manages.
export function openPatient(p) {
  useData(A.dataKey(p.id));
  db.settings.patientName = p.name;
  db.settings.patientDob = p.dob || '';
  const d = A.userById(p.doctorId);
  db.settings.clinician = d ? A.displayName(d) : '';
  if (!db.state.plan) db.state.plan = defaultPlan({ weakEye: p.weakEye || db.settings.amblyopicEye });
  const pl = db.state.plan;
  if (pl.weakEye) db.settings.amblyopicEye = pl.weakEye;
  if (pl.dailyGoal) db.settings.dailyGoal = pl.dailyGoal;
  save();
}
export function createPatient(fields, by) {
  const u = A.createUser({ ...fields, role: 'patient' }, by);
  const data = freshData();
  data.settings.amblyopicEye = fields.weakEye || 'left';
  data.settings.patientName = u.name;
  data.state.plan = defaultPlan({ weakEye: fields.weakEye || 'left', dailyGoal: fields.dailyGoal || 30 });
  data.state.plan.updatedBy = by ? by.id : null;
  A.writeData(u.id, data);
  return u;
}

// ---------- summaries from a patient's stored data (no switching) ----------
export function summarize(p) {
  const d = A.readData(p.id) || freshData();
  const sess = d.sessions || [], sym = d.symptoms || [];
  const goal = (d.state.plan && d.state.plan.dailyGoal) || d.settings.dailyGoal || 30;
  const daysAgo = n => { const x = new Date(); x.setDate(x.getDate() - n); return todayKey(x); };
  const last14 = new Set(Array.from({ length: 14 }, (_, i) => daysAgo(i)));
  const last7 = new Set(Array.from({ length: 7 }, (_, i) => daysAgo(i)));
  const byDay = {};
  sess.forEach(s => { byDay[s.day] = (byDay[s.day] || 0) + (s.minutes || 0); });
  const trained14 = Object.keys(byDay).filter(k => last14.has(k) && byDay[k] > 0.5).length;
  const min7 = Object.keys(byDay).filter(k => last7.has(k)).reduce((a, k) => a + byDay[k], 0);
  const lastS = sess.length ? sess[sess.length - 1] : null;
  const since = lastS ? Math.floor((new Date(todayKey()) - new Date(lastS.day)) / 864e5) : null;
  const msgs = A.dir.messages[p.id] || [];
  const flags = [];
  if (d.state.dichopticLocked) flags.push(['crit', 'Double vision reported', 'Two-eye games are paused until you resume them.']);
  const recentDV = sym.filter(x => x.doubleVision).slice(-1)[0];
  if (!d.settings.consent) flags.push(['info', 'Not set up yet', 'The patient hasn\'t finished the first-run steps.']);
  else if (since == null) flags.push(['warn', 'No training yet', 'No sessions recorded.']);
  else if (since >= 3) flags.push(['warn', `No training for ${since} days`, `Last session ${ago(lastS.date)}.`]);
  if (sess.length && trained14 < 7 && since != null && since < 3) flags.push(['warn', 'Low adherence', `${trained14} of the last 14 days.`]);
  const strain = sym.filter(x => (x.headache || x.strain) && last14.has(x.day)).length;
  if (strain >= 2) flags.push(['warn', 'Eye strain reports', `${strain} headache or tired-eye reports in 14 days.`]);
  if (d.settings.consent && !d.settings.lensCalibrated) flags.push(['info', 'Glasses not calibrated', 'The black test hasn\'t been done.']);
  const unread = msgs.filter(m => !m.readAt).length;
  return { d, goal, trained14, min7, lastS, since, balance: d.state.balance, flags, unread, recentDV, sessions: sess.length, review: d.state.plan && d.state.plan.reviewDate };
}
const sevRank = f => (f.some(x => x[0] === 'crit') ? 0 : f.some(x => x[0] === 'warn') ? 1 : f.length ? 2 : 3);

// ---------- first run & sign-in ----------
let picked = null, pinBuf = '', pinMsg = '';
export function gate(kind) {
  document.body.classList.add('gate-mode');
  if (kind === 'setup') return setupScreen();
  return signinScreen();
}

function setupScreen() {
  const legacy = A.legacyData();
  view().innerHTML = `
    <div class="gate">
      ${brandBlock()}
      <header class="view-head"><div class="vh"><p class="eyebrow">First-time setup</p><h1>Set up this device</h1><p class="sub">Doctors and patients each get their own account with a PIN. Patients see only their own training. Doctors see only the patients assigned to them.</p></div></header>
      ${legacy ? `<div class="alert info">${ICON.info}<div><b>Training data from before accounts was found.</b> It will be kept as a patient called "${esc(legacy.settings.patientName || 'Existing patient')}". You can assign them to a doctor afterwards.</div></div>` : ''}
      <div class="gate-cols">
        <section class="card">
          <h2>Start a new clinic</h2>
          <p class="muted">You'll be the clinic admin: you add doctors and patients and assign patients to doctors. Admins don't see anyone's results.</p>
          <div class="fields">
            <label class="field">Clinic name <span class="help">optional</span><input type="text" id="clinic" placeholder="e.g. City Eye Clinic"></label>
            <label class="field">Your name<input type="text" id="aname" autocomplete="name"></label>
            <label class="field">Choose a PIN <span class="help">4 to 6 digits</span><input type="password" inputmode="numeric" maxlength="6" id="apin" autocomplete="new-password"></label>
            <label class="field">Type it again<input type="password" inputmode="numeric" maxlength="6" id="apin2" autocomplete="new-password"></label>
          </div>
          <p class="tcrit small" id="setupmsg" role="alert"></p>
          <div class="row"><button class="btn primary" id="mkclinic">${ICON.check}<span>Create clinic and sign in</span></button></div>
        </section>
        <section class="card">
          <h2>Explore the demo clinic</h2>
          <p class="muted">Ready-made accounts with example results, so you can try every role straight away.</p>
          <table class="log demo-pins"><thead><tr><th>Account</th><th>Role</th><th class="num">PIN</th></tr></thead><tbody>
            ${DEMO.map(x => `<tr><td>${esc(x.name)}${x.doc ? `<div class="muted small">patient of ${esc(DEMO.find(y => y.key === x.doc).name)}</div>` : ''}</td><td>${A.ROLE_LABEL[x.role]}</td><td class="num"><code>${x.pin}</code></td></tr>`).join('')}
          </tbody></table>
          <div class="row"><button class="btn" id="mkdemo">${ICON.play}<span>Load the demo clinic</span></button></div>
        </section>
      </div>
      <p class="tiny">${ICON.shield.replace('class="ic"', 'class="ic" style="width:1em;height:1em;vertical-align:-2px"')} Everything stays in this browser on this device. PINs keep people out of each other's screens, but this is not hospital-grade security: anyone with full access to the device's browser storage could read the data.</p>
    </div>`;
  const q = s => view().querySelector(s);
  q('#mkclinic').onclick = () => {
    const name = q('#aname').value.trim(), pin = q('#apin').value, pin2 = q('#apin2').value;
    const msg = t => { q('#setupmsg').textContent = t; };
    if (!name) return msg('Please enter your name.');
    if (!A.validPin(pin)) return msg('The PIN must be 4 to 6 digits.');
    if (pin !== pin2) return msg('The two PINs don\'t match.');
    A.dir.clinic = q('#clinic').value.trim();
    const admin = A.createUser({ role: 'admin', name, pin }, null);
    admin.pinLen = pin.length;
    migrateLegacy(admin);
    A.dir.setup = true; A.saveDir();
    A.signIn(admin); A.audit(admin, 'device_setup', null, A.dir.clinic);
    location.hash = '#accounts'; ctx.route();
  };
  q('#mkdemo').onclick = () => { ctx.seedDemo(); picked = null; location.hash = ''; ctx.route(); };
}

function migrateLegacy(by) {
  const legacy = A.legacyData();
  if (!legacy) return;
  const u = A.createUser({ role: 'patient', name: legacy.settings.patientName || 'Existing patient', pin: '0000', doctorId: null, dob: legacy.settings.patientDob || '', weakEye: legacy.settings.amblyopicEye || 'left' }, by);
  u.pinLen = 4; u.mustChangePin = true;
  legacy.state = legacy.state || {};
  legacy.state.plan = defaultPlan({ weakEye: legacy.settings.amblyopicEye || 'left', dailyGoal: legacy.settings.dailyGoal || 30 });
  A.writeData(u.id, legacy);
  A.saveDir();
}

function brandBlock() {
  return `<div class="brand gate-brand">${ctx.eyeGlyph()}<span class="bname"><b>Amblyopia Training Lab</b><span>${esc(A.dir.clinic || 'Home vision training')}</span></span></div>`;
}

function signinScreen() {
  const groups = [['patient', 'Patients'], ['doctor', 'Doctors'], ['admin', 'Clinic']];
  const users = A.dir.users.filter(u => u.active);
  if (picked && !A.userById(picked)) picked = null;
  const u = picked && A.userById(picked);
  view().innerHTML = `
    <div class="gate">
      ${brandBlock()}
      ${u ? pinPanel(u) : `
      <header class="view-head"><div class="vh"><h1>Who's using this device?</h1><p class="sub">Choose your name, then enter your PIN.</p></div></header>
      ${groups.map(([r, l]) => { const list = users.filter(x => x.role === r); return list.length ? `<section class="whogroup"><h2>${l}</h2><div class="whogrid">${list.map(x => `<button class="whotile" data-pick="${x.id}">${avatar(x)}<span><b>${esc(A.displayName(x))}</b><span>${x.role === 'patient' ? (A.userById(x.doctorId) ? `Patient of ${esc(A.displayName(A.userById(x.doctorId)))}` : 'Patient') : A.ROLE_LABEL[x.role]}</span></span></button>`).join('')}</div></section>` : ''; }).join('')}
      ${A.dir.demo ? `<details class="disclosure demohint"><summary>Demo PINs</summary><p class="muted small">This is the demo clinic. ${DEMO.map(x => `${esc(x.name)}: <code>${x.pin}</code>`).join(' · ')}</p></details>` : ''}`}
      <p class="tiny">${ICON.shield.replace('class="ic"', 'class="ic" style="width:1em;height:1em;vertical-align:-2px"')} Private: everything stays on this device. The screen locks itself after ${A.dir.device.idleMin} minutes without use.</p>
    </div>`;
  view().querySelectorAll('[data-pick]').forEach(b => b.onclick = () => { picked = b.dataset.pick; pinBuf = ''; pinMsg = ''; signinScreen(); });
  if (u) wirePin(u);
  else { const first = view().querySelector('[data-pick]'); if (first) first.focus({ preventScroll: true }); }
}

function pinPanel(u) {
  const len = u.pinLen || 4;
  const locked = u.lockUntil > Date.now();
  return `
    <section class="pinpanel card" aria-labelledby="pinwho">
      <button class="btn ghost sm pinback" data-x="back">${ICON.arrowLeft}<span>Not you?</span></button>
      ${avatar(u, 'big')}
      <h1 id="pinwho">${esc(A.displayName(u))}</h1>
      <p class="muted">${A.ROLE_LABEL[u.role]} · enter your PIN</p>
      <div class="pindots" aria-live="polite" aria-label="${pinBuf.length} of ${len} digits entered">${Array.from({ length: len }, (_, i) => `<i class="${i < pinBuf.length ? 'on' : ''}"></i>`).join('')}</div>
      <p class="pinmsg ${locked ? 'tcrit' : pinMsg ? 'tcrit' : 'muted'}" role="alert">${locked ? `Too many wrong PINs. Try again in ${Math.ceil((u.lockUntil - Date.now()) / 1000)} seconds.` : pinMsg || '&nbsp;'}</p>
      <div class="pinpad" role="group" aria-label="PIN keypad">
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button class="pinkey" data-k="${n}" ${locked ? 'disabled' : ''}>${n}</button>`).join('')}
        <button class="pinkey fn" data-k="clear" ${locked ? 'disabled' : ''} aria-label="Clear">Clear</button>
        <button class="pinkey" data-k="0" ${locked ? 'disabled' : ''}>0</button>
        <button class="pinkey fn" data-k="del" ${locked ? 'disabled' : ''} aria-label="Delete last digit">${ICON.arrowLeft}</button>
      </div>
      <p class="tiny">Forgot your PIN? ${u.role === 'patient' ? 'Ask your doctor or the clinic' : 'Ask the clinic admin'} to reset it.</p>
    </section>`;
}

let pinKeyHandler = null;
function wirePin(u) {
  const len = u.pinLen || 4;
  const press = k => {
    if (u.lockUntil > Date.now()) return;
    if (k === 'del') pinBuf = pinBuf.slice(0, -1);
    else if (k === 'clear') pinBuf = '';
    else if (/^\d$/.test(k) && pinBuf.length < len) pinBuf += k;
    pinMsg = '';
    if (pinBuf.length === len) {
      const r = A.checkPin(u, pinBuf);
      pinBuf = '';
      if (r.ok) { picked = null; document.removeEventListener('keydown', pinKeyHandler); A.signIn(u); location.hash = ''; ctx.route(); return; }
      pinMsg = r.locked ? '' : `That PIN isn't right. ${r.left} ${r.left === 1 ? 'try' : 'tries'} left.`;
      if (r.locked) setTimeout(() => { if (picked === u.id) signinScreen(); }, r.locked * 1000 + 100);
    }
    const y = window.scrollY; signinScreen(); window.scrollTo(0, y);
    const again = view().querySelector(`[data-k="${k}"]`); if (again && !again.disabled) again.focus({ preventScroll: true });
  };
  view().querySelectorAll('[data-k]').forEach(b => b.onclick = () => press(b.dataset.k));
  view().querySelector('[data-x=back]').onclick = () => { picked = null; pinBuf = ''; pinMsg = ''; document.removeEventListener('keydown', pinKeyHandler); signinScreen(); };
  if (pinKeyHandler) document.removeEventListener('keydown', pinKeyHandler);
  pinKeyHandler = e => {
    if (!document.body.classList.contains('gate-mode') || picked !== u.id) return;
    if (/^\d$/.test(e.key)) { e.preventDefault(); press(e.key); } else if (e.key === 'Backspace') { e.preventDefault(); press('del'); } else if (e.key === 'Escape') { picked = null; pinBuf = ''; signinScreen(); }
  };
  document.addEventListener('keydown', pinKeyHandler);
  const k1 = view().querySelector('[data-k="1"]'); if (k1 && !k1.disabled) k1.focus({ preventScroll: true });
}

// ---------- demo clinic ----------
export const DEMO = [
  { key: 'admin', role: 'admin', name: 'Meera Shah', pin: '1111' },
  { key: 'mehta', role: 'doctor', name: 'Rahul Mehta', pin: '2222' },
  { key: 'rao', role: 'doctor', name: 'Anita Rao', pin: '3333' },
  { key: 'asha', role: 'patient', name: 'Asha Patel', pin: '4444', doc: 'mehta', dob: '1988-03-14', weakEye: 'left' },
  { key: 'rohan', role: 'patient', name: 'Rohan Iyer', pin: '5555', doc: 'mehta', dob: '1979-11-02', weakEye: 'right' },
  { key: 'priya', role: 'patient', name: 'Priya Nair', pin: '6666', doc: 'rao', dob: '1996-07-21', weakEye: 'left' },
];

// ---------- page frame helpers ----------
const head = (...a) => ctx.head(...a);
export function denied(what) {
  A.audit(A.me(), 'access_denied', null, what);
  view().innerHTML = `
    ${head('No access', '')}
    <div class="alert crit" role="alert">${ICON.shield}<div><b>Your account can't open this page.</b> ${esc(A.ROLE_LABEL[A.me().role])} accounts don't have permission for ${esc(what)}. This attempt has been recorded in the audit log.</div><a class="btn sm" href="#">Go to my home page</a></div>`;
}

// ---------- admin: accounts ----------
let editing = null; // { mode: 'add'|'edit'|'pin', role, id }
let notice = '';
export function accounts() {
  const all = A.dir.users;
  const docs = A.doctors(true), pats = A.patients(true), admins = all.filter(u => u.role === 'admin');
  const unassigned = A.patients().filter(p => !p.doctorId || !A.userById(p.doctorId) || !A.userById(p.doctorId).active);
  const statusCell = u => (u.active ? '<span class="flag good">Active</span>' : '<span class="flag warn">Deactivated</span>');
  const actions = u => `<div class="row tight"><button class="btn sm" data-edit="${u.id}">Edit</button><button class="btn sm" data-pin="${u.id}">Reset PIN</button>${u.id === A.me().id ? '' : `<button class="btn sm ${u.active ? 'danger' : ''}" data-toggle="${u.id}">${u.active ? 'Deactivate' : 'Reactivate'}</button>`}</div>`;
  view().innerHTML = `
    ${head('Accounts', `Add doctors and patients, assign each patient to a doctor, and reset PINs. As clinic admin you see names and assignments only, not results.`, `<button class="btn" data-add="doctor">${ICON.user}<span>Add doctor</span></button><button class="btn primary" data-add="patient">${ICON.user}<span>Add patient</span></button>`, esc(A.dir.clinic || 'Clinic'))}
    ${notice ? `<div class="alert good" role="status">${ICON.checkCircle}<div>${notice}</div><button class="btn sm ghost" data-x="dismiss">Dismiss</button></div>` : ''}
    ${unassigned.length ? `<div class="alert warn">${ICON.alert}<div><b>${unassigned.length} patient${unassigned.length === 1 ? ' has' : 's have'} no active doctor.</b> No doctor can see ${unassigned.length === 1 ? 'their' : 'these'} results until you assign one below.</div></div>` : ''}
    <div class="tiles four">
      <div class="tile"><span class="tic">${ICON.user}</span><div class="tbody"><span class="lab">Doctors</span><span class="big">${A.doctors().length}</span><span class="hint">active</span></div></div>
      <div class="tile"><span class="tic">${ICON.eye}</span><div class="tbody"><span class="lab">Patients</span><span class="big">${A.patients().length}</span><span class="hint">active</span></div></div>
      <div class="tile"><span class="tic sun">${ICON.alert}</span><div class="tbody"><span class="lab">Without a doctor</span><span class="big">${unassigned.length}</span><span class="hint">need assigning</span></div></div>
      <div class="tile"><span class="tic">${ICON.shield}</span><div class="tbody"><span class="lab">Deactivated</span><span class="big">${all.filter(u => !u.active).length}</span><span class="hint">can't sign in</span></div></div>
    </div>
    ${editing ? accountForm() : ''}
    <section class="card"><div class="card-head"><h2>Doctors</h2><span class="muted">${docs.length}</span></div>
      <div class="tablewrap"><table class="log"><thead><tr><th>Name</th><th class="num">Patients</th><th>Last sign-in</th><th>Status</th><th></th></tr></thead><tbody>
      ${docs.map(u => `<tr><td><span class="cellwho">${avatar(u)}<b>${esc(A.displayName(u))}</b></span></td><td class="num">${A.patientsOf(u.id).length}</td><td>${u.lastLogin ? ago(u.lastLogin) : 'never'}</td><td>${statusCell(u)}</td><td>${actions(u)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No doctors yet. Add one to start assigning patients.</td></tr>'}
      </tbody></table></div></section>
    <section class="card"><div class="card-head"><h2>Patients</h2><span class="muted">${pats.length}</span></div>
      <div class="tablewrap"><table class="log"><thead><tr><th>Name</th><th>Date of birth</th><th>Doctor</th><th>Last sign-in</th><th>Status</th><th></th></tr></thead><tbody>
      ${pats.map(u => `<tr><td><span class="cellwho">${avatar(u)}<b>${esc(u.name)}</b></span></td><td>${u.dob ? fmtDate(u.dob) : '–'}</td>
        <td><select data-assign="${u.id}" aria-label="Doctor for ${esc(u.name)}"><option value="">No doctor</option>${A.doctors().map(d => `<option value="${d.id}" ${u.doctorId === d.id ? 'selected' : ''}>${esc(A.displayName(d))}</option>`).join('')}</select></td>
        <td>${u.lastLogin ? ago(u.lastLogin) : 'never'}</td><td>${statusCell(u)}</td><td>${actions(u)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No patients yet.</td></tr>'}
      </tbody></table></div></section>
    <section class="card"><div class="card-head"><h2>Clinic admins</h2><span class="muted">${admins.length}</span></div>
      <div class="tablewrap"><table class="log"><thead><tr><th>Name</th><th>Last sign-in</th><th>Status</th><th></th></tr></thead><tbody>
      ${admins.map(u => `<tr><td><span class="cellwho">${avatar(u)}<b>${esc(u.name)}</b>${u.id === A.me().id ? ' <span class="muted small">(you)</span>' : ''}</span></td><td>${u.lastLogin ? ago(u.lastLogin) : 'never'}</td><td>${statusCell(u)}</td><td>${actions(u)}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="row"><button class="btn sm" data-add="admin">Add another admin</button></div></section>`;
  wireAccounts();
}

function accountForm() {
  const e = editing, u = e.id && A.userById(e.id), role = u ? u.role : e.role;
  if (e.mode === 'pin') {
    return `<section class="card formcard" aria-labelledby="ftitle"><h2 id="ftitle">Reset PIN for ${esc(A.displayName(u))}</h2>
      <p class="muted">Give the new PIN to the person in private. They can change it after signing in.</p>
      <div class="fields"><label class="field">New PIN <span class="help">4 to 6 digits</span><input type="text" inputmode="numeric" maxlength="6" id="fpin" value="${A.suggestPin()}"></label></div>
      <p class="tcrit small" id="fmsg" role="alert"></p>
      <div class="row"><button class="btn primary" data-x="savepin">Set new PIN</button><button class="btn ghost" data-x="cancel">Cancel</button></div></section>`;
  }
  return `<section class="card formcard" aria-labelledby="ftitle"><h2 id="ftitle">${u ? `Edit ${esc(A.displayName(u))}` : `Add ${role === 'admin' ? 'a clinic admin' : `a ${role}`}`}</h2>
    <div class="fields">
      <label class="field">Full name<input type="text" id="fname" value="${u ? esc(u.name) : ''}" placeholder="${role === 'doctor' ? 'e.g. Rahul Mehta' : 'e.g. Asha Patel'}"></label>
      ${role === 'patient' ? `<label class="field">Date of birth<input type="date" id="fdob" value="${u ? esc(u.dob || '') : ''}"></label>
        <label class="field">Doctor<select id="fdoc"><option value="">No doctor yet</option>${A.doctors().map(d => `<option value="${d.id}" ${u && u.doctorId === d.id ? 'selected' : ''}>${esc(A.displayName(d))}</option>`).join('')}</select></label>
        ${u ? '' : `<label class="field">Weaker eye<select id="feye"><option value="left">Left</option><option value="right">Right</option></select></label>`}` : ''}
      ${u ? '' : `<label class="field">First PIN <span class="help">4 to 6 digits</span><input type="text" inputmode="numeric" maxlength="6" id="fpin" value="${A.suggestPin()}"></label>`}
    </div>
    <p class="tcrit small" id="fmsg" role="alert"></p>
    <div class="row"><button class="btn primary" data-x="saveacct">${u ? 'Save changes' : 'Add account'}</button><button class="btn ghost" data-x="cancel">Cancel</button></div></section>`;
}

function wireAccounts() {
  const me = A.me(), q = s => view().querySelector(s), re = () => { const y = window.scrollY; accounts(); window.scrollTo(0, y); };
  view().querySelectorAll('[data-add]').forEach(b => b.onclick = () => { editing = { mode: 'add', role: b.dataset.add }; notice = ''; accounts(); const f = q('#fname'); if (f) f.focus(); });
  view().querySelectorAll('[data-edit]').forEach(b => b.onclick = () => { editing = { mode: 'edit', id: b.dataset.edit }; notice = ''; accounts(); const f = q('#fname'); if (f) f.focus(); });
  view().querySelectorAll('[data-pin]').forEach(b => b.onclick = () => { editing = { mode: 'pin', id: b.dataset.pin }; notice = ''; accounts(); const f = q('#fpin'); if (f) f.select(); });
  view().querySelectorAll('[data-toggle]').forEach(b => b.onclick = () => {
    const u = A.userById(b.dataset.toggle); u.active = !u.active; A.saveDir();
    A.audit(me, u.active ? 'account_activate' : 'account_deactivate', u.id);
    notice = `${esc(A.displayName(u))} ${u.active ? 'can sign in again' : 'can no longer sign in'}.${!u.active && u.role === 'doctor' && A.patients().some(p => p.doctorId === u.id) ? ' Their patients need a new doctor.' : ''}`;
    re();
  });
  view().querySelectorAll('[data-assign]').forEach(sel => sel.onchange = () => {
    const p = A.userById(sel.dataset.assign), d = A.userById(sel.value);
    p.doctorId = sel.value || null; A.saveDir();
    A.audit(me, 'assign', p.id, d ? `to ${A.displayName(d)}` : 'no doctor');
    notice = d ? `${esc(p.name)} is now a patient of ${esc(A.displayName(d))}.` : `${esc(p.name)} has no doctor now.`;
    re();
  });
  const dismiss = q('[data-x=dismiss]'); if (dismiss) dismiss.onclick = () => { notice = ''; re(); };
  const cancel = q('[data-x=cancel]'); if (cancel) cancel.onclick = () => { editing = null; re(); };
  const msg = t => { q('#fmsg').textContent = t; };
  const savepin = q('[data-x=savepin]');
  if (savepin) savepin.onclick = () => {
    const pin = q('#fpin').value.trim(), u = A.userById(editing.id);
    if (!A.validPin(pin)) return msg('The PIN must be 4 to 6 digits.');
    A.setPin(u, pin, me); u.pinLen = pin.length; A.saveDir();
    notice = `New PIN for ${esc(A.displayName(u))}: <code>${pin}</code>. Give it to them in private.`; editing = null; re();
  };
  const saveacct = q('[data-x=saveacct]');
  if (saveacct) saveacct.onclick = () => {
    const name = q('#fname').value.trim();
    if (!name) return msg('Please enter a name.');
    if (editing.mode === 'edit') {
      const u = A.userById(editing.id);
      u.name = name;
      if (u.role === 'patient') { u.dob = q('#fdob').value; const nd = q('#fdoc').value || null; if (nd !== u.doctorId) { u.doctorId = nd; A.audit(me, 'assign', u.id, nd ? `to ${A.displayName(A.userById(nd))}` : 'no doctor'); } }
      A.saveDir(); A.audit(me, 'account_update', u.id);
      notice = `Saved changes for ${esc(A.displayName(u))}.`;
    } else {
      const pin = q('#fpin').value.trim();
      if (!A.validPin(pin)) return msg('The PIN must be 4 to 6 digits.');
      let u;
      if (editing.role === 'patient') u = createPatient({ name, pin, dob: q('#fdob').value, doctorId: q('#fdoc').value || null, weakEye: q('#feye').value }, me);
      else u = A.createUser({ role: editing.role, name, pin }, me);
      u.pinLen = pin.length; A.saveDir();
      notice = `Added ${esc(A.displayName(u))}. Their first PIN is <code>${pin}</code>.`;
    }
    editing = null; re();
  };
}

// ---------- admin: audit log ----------
let auditFilter = { who: '', action: '' };
export function auditLog() {
  const rows = [...A.dir.audit].reverse().filter(r => (!auditFilter.who || r.uid === auditFilter.who) && (!auditFilter.action || r.action === auditFilter.action)).slice(0, 300);
  const nameOf = id => { const u = A.userById(id); return u ? A.displayName(u) : '–'; };
  const actions = [...new Set(A.dir.audit.map(r => r.action))];
  view().innerHTML = `
    ${head('Audit log', 'Who signed in, who opened which patient record, and every change to accounts, plans and notes. Newest first. It can\'t be edited.')}
    <div class="row filters">
      <label class="field inline">Person <select id="fwho"><option value="">Everyone</option>${A.dir.users.map(u => `<option value="${u.id}" ${auditFilter.who === u.id ? 'selected' : ''}>${esc(A.displayName(u))}</option>`).join('')}</select></label>
      <label class="field inline">Action <select id="fact"><option value="">All actions</option>${actions.map(a => `<option value="${a}" ${auditFilter.action === a ? 'selected' : ''}>${esc(A.ACTION_LABEL[a] || a)}</option>`).join('')}</select></label>
      <span class="muted small">${rows.length} shown</span>
    </div>
    <section class="card"><div class="tablewrap"><table class="log"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>About</th><th>Details</th></tr></thead><tbody>
      ${rows.map(r => `<tr class="${r.action === 'access_denied' || r.action === 'signin_failed' ? 'rowwarn' : ''}"><td class="nowrap">${fmtTime(r.at)}</td><td>${r.uid ? `${esc(nameOf(r.uid))}<div class="muted small">${A.ROLE_LABEL[r.role] || ''}</div>` : r.action === 'signin_failed' ? '<span class="muted">Someone at the sign-in screen</span>' : '–'}</td><td>${esc(A.ACTION_LABEL[r.action] || r.action)}</td><td>${r.target ? esc(nameOf(r.target)) : '–'}</td><td class="small">${esc(r.detail || '')}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Nothing recorded yet.</td></tr>'}
    </tbody></table></div></section>`;
  view().querySelector('#fwho').onchange = e => { auditFilter.who = e.target.value; auditLog(); };
  view().querySelector('#fact').onchange = e => { auditFilter.action = e.target.value; auditLog(); };
}

// ---------- roles & permissions ----------
export function roles() {
  const cell = v => (v === true ? `<span class="perm yes">${ICON.check}<span class="sr-only">Yes</span></span>` : v === false ? '<span class="perm no" aria-label="No">–</span>' : `<span class="perm some">${ICON.check}<span>${esc(v)}</span></span>`);
  view().innerHTML = `
    ${head('Roles and permissions', 'What each kind of account can do. Every screen checks these rules before it shows anything, and refused attempts are written to the audit log.')}
    <section class="card"><div class="tablewrap"><table class="log matrix"><thead><tr><th>Permission</th><th>Clinic admin</th><th>Doctor</th><th>Patient</th></tr></thead><tbody>
      ${A.MATRIX.map(([label, a, d, p]) => `<tr><td>${esc(label)}</td><td>${cell(a)}</td><td>${cell(d)}</td><td>${cell(p)}</td></tr>`).join('')}
    </tbody></table></div></section>
    <section class="card"><h2>How it's kept separate</h2>
      <ul class="bullets">
        <li>${ICON.user}<span><b>Least privilege.</b> The clinic admin manages accounts but never sees results. Doctors see only patients assigned to them. Patients see only their own training and the instructions their doctor sends.</span></li>
        <li>${ICON.clock}<span><b>Auto-lock.</b> The device returns to the sign-in screen after ${A.dir.device.idleMin} minutes without use (not during a training activity).</span></li>
        <li>${ICON.alert}<span><b>PIN lockout.</b> ${A.MAX_TRIES} wrong PINs in a row lock that account for ${A.LOCK_SECS} seconds.</span></li>
        <li>${ICON.shield}<span><b>Limits.</b> All data stays in this browser on this device. PINs are salted and hashed, but someone with full access to the browser's storage could still read the data. For multi-device or hospital use, the same rules need to run on a server.</span></li>
      </ul></section>`;
}

// ---------- admin: device ----------
export function device() {
  const d = A.dir.device;
  view().innerHTML = `
    ${head('Device', 'Clinic details, auto-lock, and backups of everything on this device.')}
    <section class="card setup"><div class="step"><span class="num">${ICON.home}</span><h2>Clinic</h2></div>
      <div class="fields"><label class="field">Clinic name<input type="text" id="clinic" value="${esc(A.dir.clinic || '')}" placeholder="e.g. City Eye Clinic"></label></div></section>
    <section class="card setup"><div class="step"><span class="num">${ICON.clock}</span><h2>Auto-lock</h2></div>
      <fieldset class="field"><legend>Go back to the sign-in screen after</legend>
        <div class="seg">${[2, 5, 10, 15, 30].map(m => `<label><input type="radio" name="idle" value="${m}" ${d.idleMin === m ? 'checked' : ''}><span>${m} min</span></label>`).join('')}</div></fieldset>
      <p class="muted small">Without use. Training activities are never interrupted.</p></section>
    <section class="card setup"><div class="step"><span class="num">${ICON.download}</span><h2>Backup</h2></div>
      <p>A backup holds every account, plan, note, instruction, the audit log and all patients' results. Keep it somewhere safe: it contains health information.</p>
      <div class="row"><button class="btn" id="bk">${ICON.download}<span>Save a backup</span></button>
        <label class="btn file-btn">${ICON.upload}<span>Restore a backup</span><input type="file" id="rs" accept="application/json,.json"></label>
        <button class="btn danger" id="wipe">${ICON.trash}<span>Reset this device</span></button></div>
      <p class="muted small" id="devmsg" role="status"></p><div id="confirmbox"></div></section>`;
  const q = s => view().querySelector(s), me = A.me(), msg = t => { q('#devmsg').textContent = t; };
  q('#clinic').onchange = e => { A.dir.clinic = e.target.value.trim(); A.saveDir(); A.audit(me, 'account_update', null, 'clinic name'); msg('Saved.'); };
  view().querySelectorAll('input[name=idle]').forEach(r => r.onchange = () => { A.dir.device.idleMin = +r.value; A.saveDir(); msg(`The device now locks after ${r.value} minutes.`); });
  q('#bk').onclick = async () => { A.audit(me, 'device_backup'); const r = await saveTextFile(`amblyopia-clinic-backup-${todayKey()}.json`, A.backup()); msg(r === 'copied' ? 'Saving files is blocked here, so the backup was copied to the clipboard.' : r === 'failed' ? 'Could not save a backup in this view.' : 'Backup saved.'); };
  q('#rs').onchange = e => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    f.text().then(t => { try { A.restore(t); A.audit(null, 'device_restore'); A.signOut(); location.hash = ''; ctx.route(); } catch (err) { msg(err.message); } });
  };
  q('#wipe').onclick = () => {
    q('#confirmbox').innerHTML = `<div class="alert crit">${ICON.alert}<div>Delete every account, plan, note and all patients' results on this device? This can't be undone. Save a backup first if you might need it.</div><button class="btn sm danger" id="reallywipe">Yes, reset the device</button><button class="btn sm" id="keep">Keep everything</button></div>`;
    q('#reallywipe').onclick = () => { A.resetDevice(); try { localStorage.removeItem(A.LEGACY_KEY); } catch (err) { /* ignore */ } location.hash = ''; ctx.route(); };
    q('#keep').onclick = () => { q('#confirmbox').innerHTML = ''; };
  };
}

// ---------- own account (doctors & admins) ----------
export function account() {
  const u = A.me();
  view().innerHTML = `
    ${head('My account', `${A.ROLE_LABEL[u.role]} · signed in since ${fmtTime(u.lastLogin)}`)}
    <section class="card setup"><div class="step"><span class="num">${ICON.user}</span><h2>Your name</h2></div>
      <div class="fields"><label class="field">Name shown to others<input type="text" id="myname" value="${esc(u.name)}"></label></div><p class="muted small" id="namemsg" role="status"></p></section>
    ${pinChangeCard()}
    <section class="card setup"><div class="step"><span class="num">${ICON.sun}</span><h2>Display</h2></div>
      <fieldset class="field"><legend>Colours</legend><div class="seg">${Object.entries({ auto: 'Match my device', light: 'Light', dark: 'Dark', contrast: 'High contrast' }).map(([k, l]) => `<label><input type="radio" name="theme" value="${k}" ${u.prefs.theme === k ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div></fieldset>
      <fieldset class="field"><legend>Text size</legend><div class="seg">${Object.entries({ m: 'Standard', l: 'Large', xl: 'Extra large' }).map(([k, l]) => `<label><input type="radio" name="tsize" value="${k}" ${u.prefs.textSize === k ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div></fieldset></section>`;
  const q = s => view().querySelector(s);
  q('#myname').onchange = e => { const v = e.target.value.trim(); if (!v) return; u.name = v; A.saveDir(); A.audit(u, 'account_update', u.id, 'own name'); q('#namemsg').textContent = 'Saved.'; ctx.shell(); };
  view().querySelectorAll('input[name=theme]').forEach(r => r.onchange = () => { u.prefs.theme = r.value; A.saveDir(); ctx.route(true); });
  view().querySelectorAll('input[name=tsize]').forEach(r => r.onchange = () => { u.prefs.textSize = r.value; A.saveDir(); ctx.route(true); });
  wirePinChange(view());
}

export function pinChangeCard() {
  return `<section class="card setup" id="s-pin"><div class="step"><span class="num">${ICON.shield}</span><h2>Change your PIN</h2>${A.me().mustChangePin ? '<span class="state todo">Please change it</span>' : ''}</div>
    <div class="fields">
      <label class="field">Current PIN<input type="password" inputmode="numeric" maxlength="6" id="pcur" autocomplete="current-password"></label>
      <label class="field">New PIN <span class="help">4 to 6 digits</span><input type="password" inputmode="numeric" maxlength="6" id="pnew" autocomplete="new-password"></label>
      <label class="field">New PIN again<input type="password" inputmode="numeric" maxlength="6" id="pnew2" autocomplete="new-password"></label>
    </div>
    <p class="small" id="pinchmsg" role="status"></p>
    <div class="row"><button class="btn primary" id="pinch">Change PIN</button></div></section>`;
}
export function wirePinChange(root) {
  const q = s => root.querySelector(s), u = A.me();
  if (!q('#pinch')) return;
  q('#pinch').onclick = () => {
    const m = (t, ok) => { const el = q('#pinchmsg'); el.textContent = t; el.className = `small ${ok ? 'tgood' : 'tcrit'}`; };
    const r = A.checkPin(u, q('#pcur').value);
    if (!r.ok) return m(r.locked ? `Too many wrong PINs. Wait ${r.locked} seconds.` : 'The current PIN isn\'t right.');
    const n = q('#pnew').value;
    if (!A.validPin(n)) return m('The new PIN must be 4 to 6 digits.');
    if (n !== q('#pnew2').value) return m('The two new PINs don\'t match.');
    A.setPin(u, n, u, 'pin_change'); u.pinLen = n.length; delete u.mustChangePin; A.saveDir();
    ['#pcur', '#pnew', '#pnew2'].forEach(s => { q(s).value = ''; });
    m('Your PIN has been changed.', true);
  };
}

// ---------- doctor: my patients ----------
export function patientsHome() {
  const me = A.me();
  lastOpened = null;
  const mine = A.patientsOf(me.id).map(p => ({ p, s: summarize(p) })).sort((a, b) => sevRank(a.s.flags) - sevRank(b.s.flags) || a.p.name.localeCompare(b.p.name));
  const today = mine.filter(x => x.s.since === 0).length, attention = mine.filter(x => sevRank(x.s.flags) <= 1).length;
  const flagChips = f => f.slice(0, 2).map(([sev, t]) => `<span class="flag ${sev === 'info' ? 'info' : sev}">${sev === 'crit' ? ICON.alert : ''}${esc(t)}</span>`).join(' ') + (f.length > 2 ? ` <span class="muted small">+${f.length - 2}</span>` : '');
  view().innerHTML = `
    ${head('My patients', `Patients assigned to you. Those who need attention come first.`, `<button class="btn primary" id="addpat">${ICON.user}<span>Add patient</span></button>`, `${esc(A.displayName(me))}${A.dir.clinic ? ` · ${esc(A.dir.clinic)}` : ''}`)}
    ${addingPatient ? addPatientForm() : ''}
    ${patNotice ? `<div class="alert good" role="status">${ICON.checkCircle}<div>${patNotice}</div><button class="btn sm ghost" id="pndismiss">Dismiss</button></div>` : ''}
    <div class="tiles">
      <div class="tile"><span class="tic">${ICON.user}</span><div class="tbody"><span class="lab">Patients</span><span class="big">${mine.length}</span><span class="hint">assigned to you</span></div></div>
      <div class="tile"><span class="tic">${ICON.checkCircle}</span><div class="tbody"><span class="lab">Trained today</span><span class="big">${today}<small> of ${mine.length}</small></span><span class="hint">so far</span></div></div>
      <div class="tile"><span class="tic sun">${ICON.alert}</span><div class="tbody"><span class="lab">Need attention</span><span class="big">${attention}</span><span class="hint">safety or adherence flags</span></div></div>
    </div>
    <section class="card"><div class="tablewrap"><table class="log patlist"><thead><tr><th>Patient</th><th>Weaker eye</th><th>Last trained</th><th>Last 14 days</th><th class="num">This week</th><th class="num">Balance</th><th>Flags</th></tr></thead><tbody>
      ${mine.map(({ p, s }) => `<tr data-open="${p.id}" tabindex="0" role="link" aria-label="Open ${esc(p.name)}">
        <td><span class="cellwho">${avatar(p)}<span><b>${esc(p.name)}</b><span class="muted small">${ageOf(p.dob) != null ? `${ageOf(p.dob)} y` : ''}${s.review ? ` · review ${fmtDate(s.review, { day: 'numeric', month: 'short' })}` : ''}</span></span></span></td>
        <td>${cap(s.d.settings.amblyopicEye)}</td>
        <td>${s.lastS ? ago(s.lastS.date) : '–'}</td>
        <td><span class="adh" title="${s.trained14} of 14 days"><i style="width:${Math.round(s.trained14 / 14 * 100)}%"></i></span> <span class="small">${s.trained14}/14</span></td>
        <td class="num">${Math.round(s.min7)}<span class="muted small"> / ${s.goal * 7}</span></td>
        <td class="num">${s.balance != null ? Math.round(s.balance * 100) + '%' : '–'}</td>
        <td>${s.flags.length ? flagChips(s.flags) : '<span class="flag good">On track</span>'}</td></tr>`).join('') || `<tr><td colspan="7" class="muted">No patients are assigned to you yet. Add one, or ask the clinic admin to assign them.</td></tr>`}
    </tbody></table></div></section>
    <p class="muted small">You only see patients assigned to you. To take over another doctor's patient, ask the clinic admin.</p>`;
  const go = id => { location.hash = `#patient/${id}/overview`; };
  view().querySelectorAll('[data-open]').forEach(tr => { tr.onclick = () => go(tr.dataset.open); tr.onkeydown = e => { if (e.key === 'Enter') go(tr.dataset.open); }; });
  view().querySelector('#addpat').onclick = () => { addingPatient = true; patNotice = ''; patientsHome(); view().querySelector('#npname').focus(); };
  const pnd = view().querySelector('#pndismiss'); if (pnd) pnd.onclick = () => { patNotice = ''; patientsHome(); };
  if (addingPatient) wireAddPatient();
}
let addingPatient = false, patNotice = '';
function addPatientForm() {
  return `<section class="card formcard"><h2>Add a patient</h2><p class="muted">They'll be assigned to you. Give them the PIN in private; they can change it after signing in.</p>
    <div class="fields">
      <label class="field">Full name<input type="text" id="npname" placeholder="e.g. Asha Patel"></label>
      <label class="field">Date of birth<input type="date" id="npdob"></label>
      <label class="field">Weaker (amblyopic) eye<select id="npeye"><option value="left">Left</option><option value="right">Right</option></select></label>
      <label class="field">Daily goal<select id="npgoal">${[15, 20, 30, 40, 60].map(m => `<option value="${m}" ${m === 30 ? 'selected' : ''}>${m} min</option>`).join('')}</select></label>
      <label class="field">First PIN <span class="help">4 to 6 digits</span><input type="text" inputmode="numeric" maxlength="6" id="nppin" value="${A.suggestPin()}"></label>
    </div><p class="tcrit small" id="npmsg" role="alert"></p>
    <div class="row"><button class="btn primary" id="npsave">Add patient</button><button class="btn ghost" id="npcancel">Cancel</button></div></section>`;
}
function wireAddPatient() {
  const q = s => view().querySelector(s), me = A.me();
  q('#npcancel').onclick = () => { addingPatient = false; patientsHome(); };
  q('#npsave').onclick = () => {
    const name = q('#npname').value.trim(), pin = q('#nppin').value.trim();
    if (!name) { q('#npmsg').textContent = 'Please enter a name.'; return; }
    if (!A.validPin(pin)) { q('#npmsg').textContent = 'The PIN must be 4 to 6 digits.'; return; }
    if (!A.can('patients.create')) return denied('adding patients');
    const u = createPatient({ name, pin, dob: q('#npdob').value, doctorId: me.id, weakEye: q('#npeye').value, dailyGoal: +q('#npgoal').value }, me);
    u.pinLen = pin.length; A.saveDir();
    addingPatient = false; patNotice = `Added ${esc(name)}. Their first PIN is <code>${pin}</code>.`;
    patientsHome();
  };
}

// ---------- doctor: one patient's record ----------
const TABS = [['overview', 'Overview'], ['plan', 'Training plan'], ['notes', 'Clinical notes'], ['instructions', 'Instructions'], ['report', 'Report'], ['progress', 'Progress']];
let lastOpened = null;
export function patientRecord(id, tab) {
  const p = A.userById(id), me = A.me();
  if (!p || p.role !== 'patient') return denied('that patient record');
  if (!A.can('clinical.read', p)) return denied(`${p.name}'s record (not your patient)`);
  if (!TABS.some(t => t[0] === tab)) tab = 'overview';
  openPatient(p);
  if (lastOpened !== id) { A.audit(me, 'patient_open', p.id); lastOpened = id; }
  const s = summarize(p);
  const msgs = A.dir.messages[p.id] || [];
  view().innerHTML = `
    <a class="backlink" href="#patients">${ICON.arrowLeft}<span>My patients</span></a>
    <header class="pathead">
      ${avatar(p, 'big')}
      <div class="vh"><h1>${esc(p.name)}</h1>
        <p class="sub">${ageOf(p.dob) != null ? `${ageOf(p.dob)} years · ` : ''}weaker eye ${esc(db.settings.amblyopicEye)} · ${s.sessions} sessions · patient since ${fmtDate(p.createdAt)}</p></div>
      <div class="head-actions"><button class="btn" id="resetpin">${ICON.shield}<span>Reset PIN</span></button></div>
    </header>
    ${pinNotice ? `<div class="alert good" role="status">${ICON.checkCircle}<div>${pinNotice}</div></div>` : ''}
    <nav class="tabs" aria-label="Patient record">${TABS.map(([k, l]) => `<a href="#patient/${p.id}/${k}" ${k === tab ? 'class="on" aria-current="page"' : ''}>${l}${k === 'instructions' && s.unread ? ` <span class="count-badge" title="unread by patient">${s.unread}</span>` : k === 'notes' && (A.dir.notes[p.id] || []).length ? ` <span class="count-badge muted">${A.dir.notes[p.id].length}</span>` : ''}</a>`).join('')}</nav>
    <div id="tabbody"></div>`;
  const body = view().querySelector('#tabbody');
  view().querySelector('#resetpin').onclick = () => {
    if (!A.can('pin.reset', p)) return denied('resetting this PIN');
    const pin = A.suggestPin(); A.setPin(p, pin, me); p.pinLen = 4; A.saveDir();
    pinNotice = `New PIN for ${esc(p.name)}: <code>${pin}</code>. Give it to them in private.`; patientRecord(id, tab); pinNotice = '';
  };
  ({ overview: () => overviewTab(p, s, body), plan: () => planTab(p, body), notes: () => notesTab(p, body), instructions: () => instructionsTab(p, body, msgs), report: () => ctx.report(body, { doctor: true }), progress: () => ctx.progress(body, { doctor: true }) })[tab]();
}
let pinNotice = '';

function overviewTab(p, s, el) {
  const d = s.d;
  const recent = [...d.sessions].reverse().slice(0, 8);
  const lastMsg = (A.dir.messages[p.id] || []).slice(-1)[0];
  const ins = [...CATALOG.map(g => g.id), 'balance-test'].map(id => ({ id, tr: trend(id) })).filter(x => x.tr && x.tr.dir && !METRICS[x.id].selfReport);
  el.innerHTML = `
    ${s.flags.length ? `<div class="flaglist">${s.flags.map(([sev, t, more]) => `<div class="alert ${sev === 'info' ? 'info' : sev}">${sev === 'crit' ? ICON.alert : sev === 'warn' ? ICON.info : ICON.info}<div><b>${esc(t)}.</b> ${esc(more)}</div>${sev === 'crit' && d.state.dichopticLocked ? `<a class="btn sm" href="#patient/${p.id}/plan">Review in plan</a>` : ''}</div>`).join('')}</div>` : `<div class="alert good">${ICON.checkCircle}<div><b>On track.</b> No safety or adherence flags.</div></div>`}
    <div class="tiles four">
      <div class="tile"><span class="tic">${ICON.calendar}</span><div class="tbody"><span class="lab">Days trained</span><span class="big">${s.trained14}<small> of 14</small></span><span class="hint">last two weeks</span></div></div>
      <div class="tile"><span class="tic">${ICON.clock}</span><div class="tbody"><span class="lab">This week</span><span class="big">${Math.round(s.min7)}<small> of ${s.goal * 7} min</small></span><span class="hint">goal ${s.goal} min a day</span></div></div>
      <div class="tile"><span class="tic">${ICON.scale}</span><div class="tbody"><span class="lab">Eye balance</span><span class="big">${s.balance != null ? Math.round(s.balance * 100) + '<small>%</small>' : '–'}</span><span class="hint">100% = fully balanced</span></div></div>
      <div class="tile"><span class="tic">${ICON.play}</span><div class="tbody"><span class="lab">Last trained</span><span class="big" style="font-size:1.25rem">${s.lastS ? ago(s.lastS.date) : 'never'}</span><span class="hint">${s.lastS ? esc(s.lastS.title || '') : ''}</span></div></div>
    </div>
    <div class="grid2 even">
      <section class="card"><div class="card-head"><h2>Changes</h2><a class="small" href="#patient/${p.id}/progress">All charts</a></div>
        ${ins.length ? `<table class="log"><tbody>${ins.map(x => `<tr><td>${esc(x.id === 'balance-test' ? 'Eye balance' : byId(x.id).name)}<div class="muted small">${esc(METRICS[x.id].label)}</div></td><td class="num">${x.tr.n >= 2 ? `${esc(METRICS[x.id].fmt(x.tr.first))} → <b>${esc(METRICS[x.id].fmt(x.tr.last))}</b>` : esc(METRICS[x.id].fmt(x.tr.latest))}</td><td>${ctx.trendBadge(x.tr)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Not enough sessions yet to compare.</p>'}
      </section>
      <section class="card"><div class="card-head"><h2>Recent sessions</h2><a class="small" href="#patient/${p.id}/report">Full report</a></div>
        ${recent.length ? `<table class="log"><tbody>${recent.map(x => `<tr><td class="nowrap">${fmtDate(x.date, { day: 'numeric', month: 'short' })}</td><td>${esc(x.title || x.game)}<div class="muted small">${x.mode === 'anaglyph' ? 'Glasses' : 'Patch'} · ${Math.round(x.minutes * 10) / 10} min</div></td><td class="small">${esc(ctx.describe(x))}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No sessions yet.</p>'}
      </section>
    </div>
    <section class="card"><div class="card-head"><h2>Latest instruction</h2><a class="small" href="#patient/${p.id}/instructions">Send a new one</a></div>
      ${lastMsg ? `<p>${esc(lastMsg.text)}</p><p class="muted small">${fmtTime(lastMsg.at)} · ${lastMsg.readAt ? `read ${fmtTime(lastMsg.readAt)}` : 'not read yet'}</p>` : '<p class="muted">You haven\'t sent any instructions yet.</p>'}
    </section>`;
}

function planTab(p, el) {
  const pl = db.state.plan, me = A.me();
  const modeSel = g => (g.module === 'both'
    ? `<select data-mode="${g.id}" aria-label="How ${esc(g.name)} is played"><option value="choice" ${!pl.games[g.id] || pl.games[g.id].mode === 'choice' || !pl.games[g.id].mode ? 'selected' : ''}>Patient chooses</option><option value="mono" ${pl.games[g.id] && pl.games[g.id].mode === 'mono' ? 'selected' : ''}>Patch only</option><option value="anaglyph" ${pl.games[g.id] && pl.games[g.id].mode === 'anaglyph' ? 'selected' : ''}>Glasses only</option></select>`
    : `<span class="muted small">${g.module === 'dich' ? 'Glasses only' : 'Patch only'}</span>`);
  const row = g => `<tr><td><label class="check"><input type="checkbox" data-on="${g.id}" ${!pl.games[g.id] || pl.games[g.id].on !== false ? 'checked' : ''}><span>${esc(g.name)}</span></label><div class="muted small">${esc(g.trains)}</div></td><td>${modeSel(g)}</td></tr>`;
  el.innerHTML = `
    ${db.state.dichopticLocked ? `<div class="alert crit">${ICON.alert}<div><b>Two-eye games are paused</b> because ${esc(p.name)} reported double vision${(db.symptoms || []).filter(x => x.doubleVision).slice(-1)[0] ? ` on ${fmtDate(db.symptoms.filter(x => x.doubleVision).slice(-1)[0].date)}` : ''}. Only you can turn them back on, after reviewing.</div><button class="btn sm" id="resume">Resume two-eye games</button></div>` : ''}
    <section class="card"><h2>Basics</h2>
      <div class="fields">
        <fieldset class="field"><legend>Weaker (amblyopic) eye</legend><div class="seg">${['left', 'right'].map(e => `<label><input type="radio" name="weak" value="${e}" ${pl.weakEye === e ? 'checked' : ''}><span>${cap(e)}</span></label>`).join('')}</div></fieldset>
        <fieldset class="field"><legend>Daily goal</legend><div class="seg">${[15, 20, 30, 40, 60].map(m => `<label><input type="radio" name="goal" value="${m}" ${pl.dailyGoal === m ? 'checked' : ''}><span>${m} min</span></label>`).join('')}</div></fieldset>
        <fieldset class="field"><legend>Two-eye (dichoptic) games</legend><div class="seg"><label><input type="radio" name="dich" value="yes" ${pl.dichoptic !== false ? 'checked' : ''}><span>Allowed</span></label><label><input type="radio" name="dich" value="no" ${pl.dichoptic === false ? 'checked' : ''}><span>Not allowed</span></label></div></fieldset>
        <label class="field">Next review<input type="date" id="review" value="${esc(pl.reviewDate || '')}"></label>
      </div></section>
    <section class="card"><div class="card-head"><h2>Games</h2><span class="muted">${GAMES.length} games · untick to leave a game out</span></div>
      <div class="tablewrap"><table class="log"><thead><tr><th>Game</th><th>How it's played</th></tr></thead><tbody>${GAMES.map(row).join('')}</tbody></table></div></section>
    <section class="card"><div class="card-head"><h2>Check-ups</h2><span class="muted">offered automatically when due</span></div>
      <div class="tablewrap"><table class="log"><tbody>${CHECKS.map(g => `<tr><td><label class="check"><input type="checkbox" data-on="${g.id}" ${!pl.games[g.id] || pl.games[g.id].on !== false ? 'checked' : ''}><span>${esc(g.name)}</span></label><div class="muted small">${g.id === 'balance-test' ? 'Weekly' : 'Every two weeks'} · ${esc(g.trains)}</div></td><td>${modeSel(g)}</td></tr>`).join('')}</tbody></table></div></section>
    <div class="row savebar"><button class="btn primary big" id="saveplan">${ICON.check}<span>Save plan</span></button><span class="muted small" id="planmsg" role="status">${pl.updatedAt ? `Last changed ${fmtTime(pl.updatedAt)}${pl.updatedBy && A.userById(pl.updatedBy) ? ` by ${esc(A.displayName(A.userById(pl.updatedBy)))}` : ''}` : ''}</span></div>`;
  const q = s => el.querySelector(s);
  const resume = q('#resume');
  if (resume) resume.onclick = () => {
    if (!A.can('plan.write', p)) return denied('changing this plan');
    db.state.dichopticLocked = false; save(); A.audit(me, 'dich_resume', p.id); patientRecord(p.id, 'plan');
  };
  q('#saveplan').onclick = () => {
    if (!A.can('plan.write', p)) return denied('changing this plan');
    const before = JSON.stringify(pl);
    pl.weakEye = el.querySelector('input[name=weak]:checked').value;
    pl.dailyGoal = +el.querySelector('input[name=goal]:checked').value;
    pl.dichoptic = el.querySelector('input[name=dich]:checked').value === 'yes';
    pl.reviewDate = q('#review').value;
    [...GAMES, ...CHECKS].forEach(g => {
      const on = el.querySelector(`[data-on="${g.id}"]`), md = el.querySelector(`[data-mode="${g.id}"]`);
      pl.games[g.id] = { on: on ? on.checked : true, mode: md ? md.value : 'choice' };
    });
    if (JSON.stringify(pl) === before) { q('#planmsg').textContent = 'No changes to save.'; return; }
    pl.updatedAt = new Date().toISOString(); pl.updatedBy = me.id;
    p.weakEye = pl.weakEye; A.saveDir();
    db.settings.amblyopicEye = pl.weakEye; db.settings.dailyGoal = pl.dailyGoal; save();
    const off = [...GAMES, ...CHECKS].filter(g => pl.games[g.id].on === false).map(g => g.name);
    A.audit(me, 'plan_update', p.id, `goal ${pl.dailyGoal} min, ${pl.weakEye} eye, two-eye ${pl.dichoptic ? 'allowed' : 'off'}${off.length ? `, off: ${off.join(', ')}` : ''}`);
    planTab(p, el); el.querySelector('#planmsg').textContent = 'Plan saved. The patient sees it next time they open Today.';
  };
}

function notesTab(p, el) {
  const notes = [...(A.dir.notes[p.id] || [])].reverse(), me = A.me();
  el.innerHTML = `
    <div class="alert info">${ICON.shield}<div><b>Private to doctors.</b> ${esc(p.name)} can't see these notes. They stay with the record if the patient moves to another doctor.</div></div>
    <section class="card"><h2>Add a note</h2>
      <label class="field"><span class="sr-only">Note</span><textarea id="note" rows="4" placeholder="e.g. Reports less strain. Keep contrast work on patch; review balance in 2 weeks."></textarea></label>
      <div class="row"><button class="btn primary" id="addnote">Add note</button></div></section>
    <section class="card"><h2>Notes</h2>
      ${notes.length ? `<ul class="notelist">${notes.map(n => `<li><p>${esc(n.text)}</p><span class="muted small">${esc(A.displayName(A.userById(n.by)))} · ${fmtTime(n.at)}</span></li>`).join('')}</ul>` : '<p class="muted">No notes yet.</p>'}</section>`;
  el.querySelector('#addnote').onclick = () => {
    const t = el.querySelector('#note').value.trim(); if (!t) return;
    if (!A.can('notes.rw', p)) return denied('writing notes for this patient');
    A.addNote(p.id, t, me); patientRecord(p.id, 'notes');
  };
}

function instructionsTab(p, el, msgs) {
  const me = A.me();
  el.innerHTML = `
    <section class="card"><h2>Send an instruction</h2><p class="muted">${esc(p.name)} sees it at the top of their Today page until they mark it as read.</p>
      <label class="field"><span class="sr-only">Instruction</span><textarea id="msg" rows="3" placeholder="e.g. Please do Contrast Finder with the patch every day this week."></textarea></label>
      <div class="row"><button class="btn primary" id="send">Send</button></div></section>
    <section class="card"><h2>Sent</h2>
      ${msgs.length ? `<ul class="notelist">${[...msgs].reverse().map(m => `<li><p>${esc(m.text)}</p><span class="muted small">${esc(A.displayName(A.userById(m.by)))} · ${fmtTime(m.at)} · ${m.readAt ? `<span class="tgood">read ${fmtTime(m.readAt)}</span>` : 'not read yet'}</span></li>`).join('')}</ul>` : '<p class="muted">Nothing sent yet.</p>'}</section>`;
  el.querySelector('#send').onclick = () => {
    const t = el.querySelector('#msg').value.trim(); if (!t) return;
    if (!A.can('message.send', p)) return denied('sending instructions to this patient');
    A.sendMessage(p.id, t, me); patientRecord(p.id, 'instructions');
  };
}
