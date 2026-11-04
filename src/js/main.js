import { db, save, todayKey, minutesOn, streak, storageOk, fellowEye, useData, dichOff, planMode, planOn, plan as docPlan } from './store.js';
import { CATALOG, TESTS, byId, todaysPlan, lastSession } from './catalog.js';
import { runGame } from './runner.js';
import { renderSettings, renderWizard, resetWizard, setupDone } from './setup.js';
import { lineChart, barChart } from './charts.js';
import { esc, fmtPct, logMAR, snellen, levelContrast, levelSpacing, levelCoherence } from './util.js';
import { lens, applyEyeColors } from './lens.js';
import { applyDisplay, watchSystemTheme, THEME_LABELS, SIZE_LABELS } from './theme.js';
import { ICON, GAME_ICON } from './icons.js';
import { METRICS, points, trend, inRange, dayList } from './metrics.js';
import * as A from './accounts.js';
import * as C from './clinic.js';

const view = () => document.getElementById('view');
const cap = s => s[0].toUpperCase() + s.slice(1);
const goal = () => db.settings.dailyGoal || 30;
// The mode an activity will run in: fixed for patch-only / glasses-only, the person's choice for the rest.
const gameMode = entry => {
  if (entry.module === 'dich') return 'anaglyph';
  if (entry.module === 'mono') return 'mono';
  if (dichOff()) return 'mono';
  return planMode(entry.id) || (db.state.modes || {})[entry.id] || entry.defaultMode || 'mono';
};
// After a double-vision report, games that can be played either way switch to the patch.
function forcePatchIfLocked(entry) {
  if (entry.module === 'both' && dichOff()) { db.state.modes = db.state.modes || {}; db.state.modes[entry.id] = 'mono'; save(); }
}
const gicon = id => `<span class="gicon" aria-hidden="true">${ICON[GAME_ICON[id]] || ICON.play}</span>`;

// ---------- shell ----------
function eyeGlyph() {
  const weak = db.settings.amblyopicEye;
  const col = eye => (eye === 'left' ? 'var(--eyeL)' : 'var(--eyeR)');
  const c = (eye, cx) => `<circle cx="${cx}" cy="16" r="10" fill="none" stroke="${col(eye)}" stroke-width="${eye === weak ? 3 : 2}" ${eye === weak ? '' : 'stroke-dasharray="3 3"'}/>${eye === weak ? `<circle cx="${cx}" cy="16" r="3.5" fill="${col(eye)}"/>` : ''}`;
  return `<svg class="glyph" viewBox="0 0 56 32" aria-hidden="true">${c('left', 14)}${c('right', 42)}</svg>`;
}

const NAV = {
  patient: [['today', 'Today', 'home'], ['train', 'Train', 'grid'], ['tests', 'Tests', 'clipboard'], ['progress', 'Progress', 'chart'], ['report', 'Report', 'report'], ['setup', 'Settings', 'gear']],
  doctor: [['patients', 'My patients', 'user'], ['account', 'My account', 'gear']],
  admin: [['accounts', 'Accounts', 'user'], ['audit', 'Audit log', 'report'], ['roles', 'Roles', 'shield'], ['device', 'Device', 'gear'], ['account', 'My account', 'eye']],
};
const SIZE_GLYPH = { m: '0.8rem', l: '0.98rem', xl: '1.16rem' };
const initials = n => n.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();

// A page header: title block on the left, actions on the right.
function head(title, sub, actions = '', eyebrow = '') {
  return `<header class="view-head"><div class="vh">${eyebrow ? `<p class="eyebrow">${eyebrow}</p>` : ''}<h1>${title}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}</div>${actions ? `<div class="head-actions">${actions}</div>` : ''}</header>`;
}

// Display preferences: patients keep them with their data, doctors and admins on their account.
const prefsOf = () => { const u = A.me(); return !u || u.role === 'patient' ? db.settings : u.prefs; };

function shell(active = current) {
  const u = A.me();
  if (!u) { document.getElementById('rail').innerHTML = ''; return; }
  const pr = prefsOf();
  applyEyeColors();
  const doc = u.role === 'patient' ? A.userById(u.doctorId) : null;
  const sub = u.role === 'patient' ? (doc ? `Patient of ${A.displayName(doc)}` : 'Patient') : u.role === 'doctor' ? `Doctor · ${A.patientsOf(u.id).length} patients` : 'Clinic admin';
  const navActive = active === 'patient' ? 'patients' : active;
  document.getElementById('rail').innerHTML = `
    <a class="brand" href="#">${eyeGlyph()}<span class="bname"><b>Amblyopia<br>Training Lab</b><span>${esc(A.dir.clinic || 'Home vision training')}</span></span></a>
    <button class="btn sm rail-switch" data-signout aria-label="Switch user (signed in as ${esc(A.displayName(u))})"><span class="av ${u.role}" aria-hidden="true">${esc(initials(u.name))}</span>${ICON.logout}</button>
    <nav aria-label="Main">
      ${NAV[u.role].map(([h, l, ic]) => `<a href="#${h}" data-nav="${h}" ${h === navActive ? 'class="on" aria-current="page"' : ''}>${ICON[ic]}<span>${l}</span></a>`).join('')}
    </nav>
    <div class="rail-foot">
      <div class="patient">
        <span class="who"><span class="av ${u.role}" aria-hidden="true">${esc(initials(u.name))}</span>
          <span><b>${esc(A.displayName(u))}</b><span>${esc(sub)}</span></span></span>
        ${u.role === 'patient' ? `<span class="eyechips">
          <span class="eyechip"><span class="d" style="background:var(--eyeL)"></span>Left lens: ${esc(lens('left').name)}</span>
          <span class="eyechip"><span class="d" style="background:var(--eyeR)"></span>Right lens: ${esc(lens('right').name)}</span>
        </span>` : ''}
        <button class="btn sm switchbtn" data-signout>${ICON.logout}<span>Switch user</span></button>
      </div>
      <div class="display-mini" role="group" aria-label="Display">
        <span class="lab">Colours</span>
        <div class="chipset">${Object.entries(THEME_LABELS).map(([k, l]) => `<button class="chipbtn" data-theme-set="${k}" aria-pressed="${pr.theme === k}" title="${l}">${k === 'auto' ? 'Auto' : k === 'contrast' ? 'High contrast' : l}</button>`).join('')}</div>
        <span class="lab">Text size</span>
        <div class="chipset">${Object.entries(SIZE_LABELS).map(([k, l]) => `<button class="chipbtn" data-size-set="${k}" aria-pressed="${pr.textSize === k}" aria-label="${l} text" title="${l}" style="font-size:${SIZE_GLYPH[k]}">A</button>`).join('')}</div>
      </div>
      <p class="privacy">${ICON.shield}<span>Private: stays on this device</span></p>
    </div>`;
}

document.addEventListener('click', e => {
  const t = e.target.closest('[data-theme-set],[data-size-set]');
  if (!t) return;
  const isTheme = 'themeSet' in t.dataset;
  const pr = prefsOf();
  if (isTheme) pr.theme = t.dataset.themeSet; else pr.textSize = t.dataset.sizeSet;
  if (pr === db.settings) save(); else A.saveDir();
  applyDisplay();
  const sel = isTheme ? `[data-theme-set="${t.dataset.themeSet}"]` : `[data-size-set="${t.dataset.sizeSet}"]`;
  if (current === 'setup') route(true); else shell(current);
  const again = document.querySelector('#rail ' + sel); if (again) again.focus();
});

let current = 'today';
const ROUTES = {
  patient: ['today', 'train', 'tests', 'progress', 'report', 'setup', 'welcome'],
  doctor: ['patients', 'patient', 'account'],
  admin: ['accounts', 'audit', 'roles', 'device', 'account'],
};
const HOME = { patient: 'today', doctor: 'patients', admin: 'accounts' };
const BLANK = A.LEGACY_KEY + ':none';
const PAGE_NAMES = { today: 'the patient home page', train: 'training', tests: 'tests', progress: 'a patient\'s progress', report: 'a patient\'s report', setup: 'patient settings', welcome: 'patient setup', patients: 'the doctor\'s patient list', patient: 'patient records', accounts: 'account management', audit: 'the audit log', roles: 'roles and permissions', device: 'device settings', account: 'account settings' };

function route(keepScroll) {
  if (!A.dir.setup) { useData(BLANK); current = 'gate'; shell(); applyDisplay(); C.gate('setup'); return; }
  const u = A.me();
  if (!u) { useData(BLANK); current = 'gate'; shell(); applyDisplay(); C.gate('signin'); return; }
  document.body.classList.remove('gate-mode');
  // Patients always work on their own data; doctors load a patient's data only inside that record.
  if (u.role === 'patient') C.openPatient(u); else useData(BLANK);
  applyDisplay();
  let h = (location.hash || '').slice(1);
  const anchor = h === 'setup-glasses' ? 's-glasses' : h === 'setup-about' ? 's-about' : h === 'setup-pin' ? 's-pin' : null;
  if (anchor) h = 'setup';
  const [base, ...rest] = h.split('/');
  let name = base || HOME[u.role];
  const known = Object.values(ROUTES).flat();
  if (!known.includes(name)) name = HOME[u.role];
  if (!ROUTES[u.role].includes(name)) {
    current = name; document.body.classList.remove('wizard-mode'); shell(HOME[u.role]);
    C.denied(PAGE_NAMES[name] || name); view().focus({ preventScroll: true }); window.scrollTo(0, 0); return;
  }
  if (u.role === 'patient' && name === 'today' && !db.settings.consent && !db.sessions.length) { name = 'welcome'; history.replaceState(null, '', '#welcome'); }
  if (name === 'welcome' && current !== 'welcome') resetWizard();
  current = name;
  document.body.classList.toggle('wizard-mode', name === 'welcome');
  shell(name);
  const y = window.scrollY;
  ({ today, train, tests, progress: () => progress(), report: () => report(), setup: settings, welcome,
    patients: C.patientsHome, patient: () => C.patientRecord(rest[0], rest[1]), account: C.account,
    accounts: C.accounts, audit: C.auditLog, roles: C.roles, device: C.device })[name]();
  view().focus({ preventScroll: true });
  const target = anchor && document.getElementById(anchor);
  if (target) target.scrollIntoView({ block: 'start' });
  else window.scrollTo(0, keepScroll === true ? y : 0);
}

// ---------- starting activities ----------
function canTrain() {
  if (db.settings.consent && db.settings.pxPerMm) {
    if (location.hash === '#welcome') { history.replaceState(null, '', '#today'); current = 'today'; }
    return true;
  }
  location.hash = '#welcome';
  return false;
}

function start(id, minutes) {
  if (!A.can('train', A.me())) return C.denied('training');
  if (!canTrain()) return;
  const entry = byId(id);
  if (!entry) return;
  if (entry.module === 'dich' && dichOff()) { location.hash = '#today'; return; }
  forcePatchIfLocked(entry);
  runGame(entry.make(), { minutes: minutes || entry.minutes, onExit: route });
}

// One button: run the remaining plan items back to back, with a change-over screen between them.
function startSession() {
  if (!A.can('train', A.me())) return C.denied('training');
  if (!canTrain()) return;
  const plan = todaysPlan();
  let items = plan.filter(p => !p.done);
  if (!items.length) items = plan;
  items = items.filter(p => !(p.game.module === 'dich' && dichOff()));
  if (!items.length) return;
  const n = items.length;
  const run = i => {
    const entry = items[i].game, next = items[i + 1];
    forcePatchIfLocked(entry);
    const upNext = next ? {
      id: next.id, name: next.game.name, minutes: next.game.minutes, mode: gameMode(next.game),
      stepLabel: `activity ${i + 2} of ${n}`, start: () => run(i + 1),
    } : null;
    runGame(entry.make(), { minutes: entry.minutes, onExit: route, upNext, step: n > 1 ? `Activity ${i + 1} of ${n}` : null });
  };
  run(0);
}

document.addEventListener('click', e => {
  const b = e.target.closest('[data-start]');
  if (b) { e.preventDefault(); start(b.dataset.start, +b.dataset.min || undefined); return; }
  const s = e.target.closest('[data-session]');
  if (s) { e.preventDefault(); startSession(); }
});

// ---------- helpers ----------
function wear(module, entry) {
  if (module === 'both') {
    const m = gameMode(entry);
    const note = planMode(entry.id) || (docPlan() && docPlan().dichoptic === false) ? '(set by your doctor)' : db.state.dichopticLocked ? '(two-eye paused)' : '(you can switch)';
    return `<span class="wear">${m === 'anaglyph' ? `${ICON.glasses}<span class="lensdots" aria-hidden="true"><i style="background:var(--eyeL)"></i><i style="background:var(--eyeR)"></i></span><span>Glasses</span>` : `${ICON.patch}<span>Patch</span>`}<span class="muted">${note}</span></span>`;
  }
  return module === 'mono'
    ? `<span class="wear">${ICON.patch}<span>Patch on ${fellowEye()} eye</span></span>`
    : `<span class="wear">${ICON.glasses}<span class="lensdots" aria-hidden="true"><i style="background:var(--eyeL)"></i><i style="background:var(--eyeR)"></i></span><span>Glasses on</span></span>`;
}

function ago(date) {
  const d = Math.round((new Date(todayKey()) - new Date(todayKey(new Date(date)))) / 864e5);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
}

// Plain-language result; the raw number is kept for anyone who wants it.
function describe(s) {
  if (s.threshold == null) {
    if (s.game === 'jump-read') { const x = s.extra || {}; return x.time != null ? `${Math.floor(x.time / 60)}:${String(Math.floor(x.time % 60)).padStart(2, '0')}, ${x.errors} mistake${x.errors === 1 ? '' : 's'}` : `found ${s.correct} of ${s.trials}`; }
    if (s.game === 'fov-spot') return `found ${s.correct} of ${s.trials}${s.extra && s.extra.level ? ` · ${s.extra.level[0].toUpperCase() + s.extra.level.slice(1)}` : ''}`;
    if (s.game === 'visual-power') { const x = s.extra || {}; return [x.bestIn ? `in ${x.bestIn} px` : '', x.bestOut ? `out ${x.bestOut} px` : ''].filter(Boolean).join(' · ') || `found ${s.correct}`; }
    if (s.game === 'split-vision') { const x = s.extra || {}; return `found ${x.found ?? s.correct}${x.avg != null ? ` · ${x.avg.toFixed(1)} s each` : ''}`; }
    if (s.game === 'rotation-match') { const x = s.extra || {}; return `${s.correct} of ${s.trials} right first time${x.avg != null ? ` · ${x.avg.toFixed(1)} s each` : ''}`; }
    if (s.game === 'precision') { const x = s.extra || {}; return x.score != null ? `${x.score} points · ${x.avgPts} per tap` : `${s.correct} of ${s.trials} on target`; }
    if (s.game === 'peripheral-chart') { const x = s.extra || {}; return `found ${x.found ?? s.correct}${x.avg != null ? ` · ${x.avg.toFixed(1)} s each` : ''}`; }
    if (s.game === 'okn-stripes') { const x = s.extra || {}; return `${x.level ? x.level[0].toUpperCase() + x.level.slice(1) : ''}${x.secs ? ` · ${Math.round(x.secs)} s` : ''}${x.star && s.trials ? ` · stars ${s.correct} of ${s.trials}` : ''}`; }
    if (s.game === 'follow-it') return `found ${s.correct} of ${s.trials}${s.extra && s.extra.level ? ` · ${s.extra.level[0].toUpperCase() + s.extra.level.slice(1)}` : ''}`;
    if (s.game === 'eye-motion') return `${Math.round(s.minutes * 60)} s following${s.extra && s.extra.selfReport ? `, ${({ all: 'easy', most: 'mostly', few: 'hard' })[s.extra.selfReport]}` : ''}`;
    if (s.game === 'eye-jump') return `${s.trials} circles${s.extra && s.extra.selfReport ? `, read ${({ all: 'all', most: 'most', few: 'some' })[s.extra.selfReport]}` : ''}`;
    return s.score != null ? `${s.score} points` : `${Math.round(s.minutes)} min`;
  }
  switch (s.unit) {
    case 'contrast': return `Level ${levelContrast(s.threshold)} (${fmtPct(s.threshold, 1)} contrast)`;
    case 'coherence': return `Level ${levelCoherence(s.threshold)} (${fmtPct(s.threshold, 0)} signal)`;
    case 'spacing': return `Level ${levelSpacing(s.threshold)} (${s.threshold.toFixed(2)}× spacing)`;
    case 'arcmin': return `${snellen(s.threshold)} (logMAR ${logMAR(s.threshold).toFixed(2)})`;
    case 'balance': return `Balance ${Math.round(s.threshold * 100)}%`;
    default: return String(s.threshold);
  }
}

function lastResult(id) {
  const s = lastSession(id);
  return s ? `Last: ${esc(describe(s).replace(/ \(.*\)$/, ''))}, ${ago(s.date)}` : 'Not played yet';
}

function lockedBanner() {
  const pl = docPlan();
  if (db.state.dichopticLocked) return `<div class="alert crit" role="alert">${ICON.alert}
    <div><b>Two-eye games are paused.</b> You told us you had double vision after a session. Your doctor has been told and can turn two-eye games back on after checking with you. Patch games are still available.</div>
  </div>`;
  if (pl && pl.dichoptic === false) return `<div class="alert info">${ICON.info}<div><b>Your plan uses the eye patch only.</b> Your doctor has turned two-eye (colour glasses) games off for now.</div></div>`;
  return '';
}
function wireLocked() { /* resuming two-eye games is done by the doctor in the patient's plan */ }

function last14() {
  const out = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const k = todayKey(d);
    out.push({ label: k, short: `${d.getDate()}`, v: minutesOn(k), today: i === 0 });
  }
  return out;
}

function weekMinutes() {
  let m = 0;
  for (let i = 0; i < 7; i++) { const d = new Date(); d.setDate(d.getDate() - i); m += minutesOn(todayKey(d)); }
  return m;
}

function series(id, unit) {
  return db.sessions.filter(s => s.game === id && s.threshold != null && (!unit || s.unit === unit)).map(s => ({ t: s.date, y: s.threshold }));
}

// Plain-language findings from the shared measures, biggest improvement first.
function insights(from) {
  const out = [];
  for (const id of [...CATALOG.map(g => g.id), 'balance-test']) {
    const m = METRICS[id], tr = trend(id, from);
    if (!m || !tr || tr.dir !== 'up' || m.selfReport) continue;
    const g = byId(id);
    out.push({ gain: tr.gain, lab: id === 'balance-test' ? 'Eye balance' : `${g.name} · ${m.label.toLowerCase()}`, big: `${m.fmt(tr.first)} → ${m.fmt(tr.last)}`,
      text: id === 'balance-test' ? 'Your eyes are sharing the work more evenly. 100% means fully balanced.' : `Compared with your first sessions${tr.level ? ` at the same level (${cap(String(tr.level))})` : ''}.` });
  }
  return out.sort((a, b) => b.gain - a.gain);
}

// ---------- views ----------
function ring(mins) {
  const C = 2 * Math.PI * 52, pct = Math.min(1, mins / goal());
  return `<div class="ring" role="img" aria-label="${Math.round(mins)} of ${goal()} minutes today">
    <svg viewBox="0 0 120 120" aria-hidden="true"><circle class="track" cx="60" cy="60" r="52" fill="none" stroke-width="11"/>
    <circle class="fill" cx="60" cy="60" r="52" fill="none" stroke-width="11" stroke-linecap="round" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - pct)).toFixed(1)}" ${pct <= 0 ? 'stroke-opacity="0"' : ''}/></svg>
    <div class="center"><b>${Math.round(mins)}</b><span>of ${goal()} min</span></div>
  </div>`;
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function today() {
  const s = db.settings;
  const plan = todaysPlan();
  const mins = minutesOn(todayKey());
  const st = streak();
  const done = plan.filter(p => p.done).length;
  const allDone = plan.length && done === plan.length;
  const next = plan.find(p => !p.done);
  const left = plan.filter(p => !p.done).reduce((a, p) => a + p.game.minutes, 0);
  const total = plan.reduce((a, p) => a + p.game.minutes, 0);
  const dateStr = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const bal = db.state.balance;
  const win = insights()[0];
  const first = (s.patientName || '').trim().split(/\s+/)[0];
  const needsMono = plan.some(p => !p.done && gameMode(p.game) === 'mono'), needsDich = plan.some(p => !p.done && gameMode(p.game) === 'anaglyph');
  const title = allDone ? 'All done for today' : done ? `Nice work. ${done} of ${plan.length} done` : 'Ready for today\'s training?';
  const sub = allDone
    ? `You trained ${Math.round(mins)} minutes today. Rest your eyes, and come back tomorrow.`
    : done ? `About ${left} minutes left. You can stop and come back later.` : `${plan.length} short activities, about ${total} minutes. Take a break whenever you like.`;
  view().innerHTML = `
    ${storageOk ? '' : `<div class="alert warn">${ICON.alert}<div>This browser isn't letting the app save. Your progress will be lost when you close it. Download the app and open the file directly to keep your progress.</div></div>`}
    ${lockedBanner()}
    ${doctorMessages()}
    ${A.me() && A.me().mustChangePin ? `<div class="alert warn">${ICON.shield}<div><b>Please choose your own PIN.</b> You're using a PIN someone else set.</div><a class="btn sm primary" href="#setup-pin">Change PIN</a></div>` : ''}
    <section class="hero" aria-labelledby="herotitle">
      ${ring(mins)}
      <div class="hero-body">
        <p class="eyebrow">${greeting()}${first ? `, ${esc(first)}` : ''} · ${esc(dateStr)}${docPlan() && docPlan().reviewDate ? ` · next review ${new Date(docPlan().reviewDate + 'T12:00').toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}` : ''}</p>
        <h1 id="herotitle">${title}</h1>
        <p class="sub">${sub}</p>
        ${!allDone && (needsMono || needsDich) ? `<div class="needs"><span>You'll need</span>${needsMono ? `<span class="wear">${ICON.patch}<span>an eye patch</span></span>` : ''}${needsDich ? `<span class="wear">${ICON.glasses}<span class="lensdots" aria-hidden="true"><i style="background:var(--eyeL)"></i><i style="background:var(--eyeR)"></i></span><span>your two-colour glasses</span></span>` : ''}</div>` : ''}
        <div class="hero-actions">
          ${allDone
            ? `<span class="donebadge">${ICON.checkCircle}<span>Today's goal reached</span></span><a class="btn" href="#train">Play something extra</a>`
            : `<button class="btn primary big" data-session="today">${ICON.play}<span>${done ? 'Continue today\'s session' : 'Start today\'s session'}</span></button>`}
        </div>
      </div>
    </section>
    ${!setupDone() ? `<div class="alert info">${ICON.info}<div><b>Finish setting up.</b> A few minutes to choose your weaker eye and measure your screen, so patterns are drawn at the right size.</div><a class="btn primary sm" href="#welcome">Set up now</a></div>` : ''}
    ${setupDone() && !s.lensConfirmed ? `<div class="alert warn">${ICON.glasses}<div><b>Which colour is over each eye?</b> Tell us your glasses' left and right lens colours before two-eye games. Getting this the wrong way round makes them not work.</div><a class="btn sm primary" href="#setup-glasses">Set my glasses</a></div>` : ''}
    ${setupDone() && s.lensConfirmed && !s.lensCalibrated ? `<div class="alert info">${ICON.glasses}<div><b>Tune your glasses colours.</b> A two-minute check makes sure each eye sees only its own colour, so two-eye games work properly.</div><a class="btn sm" href="#setup-glasses">Check my glasses</a></div>` : ''}
    <div class="tiles">
      <div class="tile"><span class="tic sun">${ICON.flame}</span><div class="tbody"><span class="lab">Streak</span><span class="big">${st}<small> day${st === 1 ? '' : 's'}</small></span><span class="hint">${st >= 2 ? 'Keep it going' : st === 1 ? 'Great start' : 'Train today to start one'}</span></div></div>
      <div class="tile"><span class="tic">${ICON.clock}</span><div class="tbody"><span class="lab">This week</span><span class="big">${Math.round(weekMinutes())}<small> of ${goal() * 7} min</small></span><span class="hint">${Math.round(Math.min(100, weekMinutes() / (goal() * 7) * 100))}% of your weekly goal</span></div></div>
      <div class="tile"><span class="tic">${ICON.scale}</span><div class="tbody"><span class="lab">Eye balance</span><span class="big">${bal != null ? Math.round(bal * 100) + '<small>%</small>' : '–'}</span><span class="hint">${bal != null ? '100% means fully balanced' : 'Measured in your first session'}</span></div></div>
    </div>
    ${win ? `<div class="alert good">${ICON.arrowUp}<div><b>${esc(win.lab)}: ${esc(win.big)}.</b> ${esc(win.text)}</div><a class="btn sm ghost" href="#progress">See progress</a></div>` : ''}
    <section class="card" aria-labelledby="plantitle">
      <div class="card-head"><h2 id="plantitle">Today's plan</h2><span class="muted">${done} of ${plan.length} done · about ${total} min</span></div>
      <ol class="plan">
        ${plan.map(p => `
          <li class="${p.done ? 'done' : p === next ? 'next' : ''}">
            ${p.done ? `<span class="gicon" aria-hidden="true">${ICON.check}</span>` : gicon(p.id)}
            <div class="pmain"><b>${esc(p.game.name)}</b>
              <div class="meta">${wear(p.game.module, p.game)}<span>${p.game.minutes} min</span><span>${esc(p.why)}</span></div></div>
            <span class="state-pill ${p.done ? 'done' : p === next ? 'next' : ''}">${p.done ? 'Done' : p === next ? 'Next' : 'Later'}</span>
            <button class="btn sm ${p === next ? 'primary' : ''}" data-start="${p.id}" aria-label="${p.done ? 'Play again' : 'Start'}: ${esc(p.game.name)}">${p.done ? 'Again' : 'Start'}</button>
          </li>`).join('')}
      </ol>
      <p class="muted small">Always wear your usual glasses as well. Patch activities: cover your stronger (${fellowEye()}) eye. Two-colour activities: no patch, glasses on.</p>
    </section>
    <section class="card" aria-labelledby="daystitle">
      <div class="card-head"><h2 id="daystitle">Last two weeks</h2><span class="muted">minutes each day · dashed line is your goal</span></div>
      ${barChart(last14(), { target: goal() })}
    </section>`;
  wireLocked();
  view().querySelectorAll('[data-read]').forEach(b => b.onclick = () => { A.markRead(A.me().id, b.dataset.read, A.me()); route(true); });
}

// Instructions the doctor sent that the patient hasn't marked as read yet.
function doctorMessages() {
  const u = A.me(); if (!u || u.role !== 'patient') return '';
  const unread = (A.dir.messages[u.id] || []).filter(m => !m.readAt);
  return unread.map(m => { const d = A.userById(m.by); return `<section class="alert info docmsg" aria-label="Message from your doctor">${ICON.report}<div><b>From ${esc(A.displayName(d))}</b> <span class="muted small">· ${new Date(m.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span><p>${esc(m.text)}</p></div><button class="btn sm" data-read="${m.id}">${ICON.check}<span>Got it</span></button></section>`; }).join('');
}

function gameCard(g) {
  const locked = g.module === 'dich' && dichOff();
  return `<article class="gcard ${locked ? 'locked' : ''}">
    <div class="gtop">${gicon(g.id)}<div class="gname"><h3>${esc(g.name)}</h3><span>${esc(g.trains)}</span></div></div>
    <p>${esc(g.blurb)}</p>
    <details><summary>Why this works</summary><p class="muted small">Based on ${esc(g.basis)}.</p></details>
    <div class="gfoot"><div class="pmain"><div class="meta">${wear(g.module, g)}</div><span>${lastResult(g.id)}</span></div>
      <button class="btn sm primary" data-start="${g.id}" ${locked ? 'disabled title="Paused after a double-vision report"' : ''}>${ICON.play}<span>Play · ${g.minutes} min</span></button>
    </div>
  </article>`;
}

function train() {
  const inPlan = CATALOG.filter(g => planOn(g.id)), out = CATALOG.filter(g => !planOn(g.id));
  view().innerHTML = `
    ${head('Train', `${docPlan() ? 'The games in your plan from your doctor. ' : ''}Pick any game below, or let Today's plan choose for you.`, `<button class="btn primary" data-session="today">${ICON.play}<span>Start today's session</span></button>`, `${inPlan.length} games in your plan`)}
    ${lockedBanner()}
    <div class="ggrid">${inPlan.map(gameCard).join('')}</div>
    ${out.length ? `<p class="muted small">Not in your plan right now: ${out.map(g => esc(g.name)).join(', ')}. Your doctor can add them back.</p>` : ''}`;
  wireLocked();
}

function tests() {
  const bal = [...db.sessions].reverse().find(s => s.game === 'balance-test');
  const lt = [...db.sessions].reverse().find(s => s.game === 'letter-acuity' || (s.extra && s.extra.letterArcmin));
  const arc = lt && (lt.extra?.letterArcmin ?? lt.threshold);
  view().innerHTML = `
    ${head('Tests', 'Two short check-ups that set your training levels. Your eye doctor\'s tests are still the real measure.')}
    ${lockedBanner()}
    <div class="tiles two">
      <div class="tile"><span class="tic">${ICON.scale}</span><div class="tbody"><span class="lab">Eye balance</span><span class="big">${bal ? Math.round(bal.threshold * 100) + '<small>%</small>' : '–'}</span><span class="hint">${bal ? 'Checked ' + ago(bal.date) : 'Not checked yet'}</span></div></div>
      <div class="tile"><span class="tic">${ICON.text}</span><div class="tbody"><span class="lab">Smallest letter (home estimate)</span><span class="big">${lt ? esc(snellen(arc)) : '–'}</span><span class="hint">${lt ? `logMAR ${logMAR(arc).toFixed(2)} at ${db.settings.distanceCm} cm` : 'Not checked yet'}</span></div></div>
    </div>
    <div class="ggrid">${TESTS.map(gameCard).join('')}</div>
    <section class="card">
      <h2>What the numbers mean</h2>
      <ul class="bullets">
        <li>${ICON.scale}<span><b>Eye balance</b> is how bright your stronger eye's picture can be before it takes over. 100% means both eyes share the work equally. Two-eye games start at this level, and it's re-checked every week.</span></li>
        <li>${ICON.text}<span><b>Smallest letter</b> depends on your screen size and distance settings. Use it to watch the trend, not for glasses prescriptions.</span></li>
      </ul>
    </section>`;
  wireLocked();
}

function trendBadge(tr) {
  if (!tr || !tr.dir) return '<span class="trend flat">–</span>';
  const word = { up: 'Better', down: 'Lower', flat: 'Steady' }[tr.dir];
  return `<span class="trend ${tr.dir}">${tr.dir === 'flat' ? '' : ICON.arrowUp}${word}</span>`;
}

function progress(el = view(), opts = {}) {
  const hasData = db.sessions.length > 0;
  const example = db.sessions.some(s => s.example);
  const totalMin = db.sessions.reduce((a, s) => a + (s.minutes || 0), 0);
  const days = new Set(db.sessions.map(s => s.day)).size;
  const fe = db.sessions.filter(s => s.feEnd != null).map(s => ({ t: s.date, y: s.feEnd }));
  const ins = insights();
  const checkups = [
    ['Eye balance', 'Balance test · 100% = fully balanced', points('balance-test'), { fmt: METRICS['balance-test'].fmt }],
    ['Smallest letter', 'Letter size test · logMAR, home estimate', points('letter-acuity'), { fmt: v => v.toFixed(2), lowerIsBetter: true }],
    ['Stronger-eye brightness', 'Two-eye games · rises as your eyes cooperate', fe, { fmt: v => Math.round(v * 100) + '%' }],
  ].filter(c => c[2].length);
  const acts = CATALOG.map(g => ({ g, m: METRICS[g.id], pts: points(g.id), tr: trend(g.id) }));
  const charted = acts.filter(a => a.m && a.pts.length >= 2 && !a.m.selfReport);
  const notYet = acts.filter(a => !db.sessions.some(s => s.game === a.g.id));
  const recent = [...db.sessions].reverse().slice(0, 30);
  const sym = [...db.symptoms].reverse().slice(0, 14);
  const chartCard = (title, src, pts, opt, readout) => `
    <section class="card chartcard">
      <div class="card-head"><div><h2>${esc(title)}</h2><span class="muted small">${esc(src)}</span></div>
      <span class="readout">${readout}</span></div>
      ${lineChart(pts, opt)}
    </section>`;
  el.innerHTML = `
    ${opts.doctor ? '' : head('Progress', hasData ? `${Math.round(totalMin)} minutes over ${days} day${days === 1 ? '' : 's'}. The overall trend matters more than any single day. Tired days happen.` : 'Your results will show here after your first session.', hasData ? `<a class="btn" href="#report">${ICON.report}<span>Report for your doctor</span></a>` : '')}
    ${example ? `<div class="alert info">${ICON.info}<div><b>${opts.doctor ? 'This record includes example data' : 'You\'re looking at example data'}.</b> These sessions are made up to show how this page works.</div>${opts.doctor ? '' : '<button class="btn sm" id="clearex">Remove example data</button>'}</div>` : ''}
    ${!hasData ? `<div class="alert info">${ICON.info}<div>${opts.doctor ? 'No sessions recorded yet.' : 'No sessions yet. Want to see what this page looks like after a few weeks?'}</div>${opts.doctor ? '' : '<button class="btn sm" id="loadex">Show example data</button>'}</div>` : ''}
    ${hasData ? `<div class="insights">
      <div class="insight"><span class="lab">Time trained</span><span class="big">${Math.round(totalMin)} min</span><p>across ${days} day${days === 1 ? '' : 's'} · ${streak()} day streak</p></div>
      ${ins.slice(0, 3).map(i => `<div class="insight"><span class="lab">${esc(i.lab)}</span><span class="big">${ICON.arrowUp}${esc(i.big)}</span><p>${esc(i.text)}</p></div>`).join('')}
      ${!ins.length ? '<div class="insight"><span class="lab">Changes</span><span class="big">Too early to tell</span><p>After a few sessions of an activity at the same level, we compare your latest results with your first ones here.</p></div>' : ''}
    </div>` : ''}
    ${checkups.length || charted.length ? `<p class="muted small">${ICON.arrowUp.replace('class="ic"', 'class="ic" style="width:1em;height:1em;vertical-align:-2px"')} In every chart, <b>higher means better</b>. Measures where a smaller number is better are drawn upside down.</p>` : ''}
    ${checkups.length ? `<h2>Check-ups</h2><div class="cgrid">${checkups.map(([t, src, pts, opt]) => chartCard(t, src, pts, opt, esc(opt.fmt(pts[pts.length - 1].y)))).join('')}</div>` : ''}
    ${charted.length ? `<h2>Games</h2><div class="cgrid">${charted.map(a => chartCard(a.g.name, `${a.m.label}${a.tr && a.tr.level ? ` · latest level: ${cap(String(a.tr.level))}` : ''}`, a.pts, { fmt: a.m.fmt, lowerIsBetter: a.m.lowerIsBetter, log: a.m.log }, `${esc(a.m.fmt(a.pts[a.pts.length - 1].y))} ${trendBadge(a.tr)}`)).join('')}</div>` : ''}
    ${hasData && notYet.length ? `<p class="muted small">Not played yet: ${notYet.map(a => esc(a.g.name)).join(', ')}.</p>` : ''}
    ${hasData ? `
    <details class="disclosure"><summary>All sessions (${db.sessions.length})</summary>
      <div class="tablewrap"><table class="log">
        <thead><tr><th>Date</th><th>Activity</th><th>How</th><th class="num">Minutes</th><th>Result</th></tr></thead>
        <tbody>${recent.map(s => `<tr><td>${new Date(s.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</td><td>${esc(s.title || s.game)}</td><td>${s.mode === 'anaglyph' ? 'Glasses' : 'Patch'}</td><td class="num">${s.minutes.toFixed(1)}</td><td>${esc(describe(s))}</td></tr>`).join('')}</tbody>
      </table></div>
      ${db.sessions.length > recent.length ? `<p class="muted small">Showing the latest ${recent.length}. The report and a saved copy in Settings include everything.</p>` : ''}
    </details>
    <details class="disclosure"><summary>How your eyes felt (${db.symptoms.length})</summary>
      ${sym.length ? `<ul class="symlist">${sym.map(x => `<li><span>${new Date(x.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>${x.doubleVision || x.headache || x.strain ? [x.doubleVision && '<b class="tcrit">Double vision</b>', x.headache && 'Headache', x.strain && 'Tired or sore eyes'].filter(Boolean).join(', ') : '<span class="tgood">All good</span>'}</li>`).join('')}</ul>` : '<p class="muted">No answers yet.</p>'}
    </details>` : ''}`;
  const le = document.getElementById('loadex'); if (le) le.onclick = () => { loadExample(); route(); };
  const ce = document.getElementById('clearex'); if (ce) ce.onclick = () => { db.sessions = db.sessions.filter(s => !s.example); db.symptoms = db.symptoms.filter(s => !s.example); save(); route(); };
}

// ---------- report for the eye-care professional ----------
const RANGES = [['14', '2 weeks'], ['28', '4 weeks'], ['90', '3 months'], ['all', 'All time']];
let reportRange = '28';
const fmtDate = (d, long) => new Date(d).toLocaleDateString(undefined, long ? { day: 'numeric', month: 'long', year: 'numeric' } : { day: 'numeric', month: 'short', year: 'numeric' });

function report(el = view(), opts = {}) {
  const st = db.settings;
  const now = new Date();
  const firstEver = db.sessions.length ? new Date(db.sessions[0].date) : null;
  let from;
  if (reportRange === 'all') from = firstEver ? new Date(firstEver) : new Date(now);
  else { from = new Date(now); from.setDate(from.getDate() - (+reportRange - 1)); }
  from.setHours(0, 0, 0, 0);
  const sess = inRange(from);
  const days = dayList(from, now);
  const minsByDay = Object.fromEntries(days.map(d => [d, 0]));
  sess.forEach(s => { if (s.day in minsByDay) minsByDay[s.day] += s.minutes || 0; });
  const trainedDays = days.filter(d => minsByDay[d] > 0.5).length;
  const totalMin = sess.reduce((a, s) => a + (s.minutes || 0), 0);
  const avgDay = trainedDays ? totalMin / trainedDays : 0;
  const goalDays = days.filter(d => minsByDay[d] >= goal()).length;
  const patchMin = sess.filter(s => s.mode !== 'anaglyph').reduce((a, s) => a + s.minutes, 0);
  const glassMin = totalMin - patchMin;
  const name = (st.patientName || '').trim();
  const age = st.patientDob ? Math.floor((now - new Date(st.patientDob)) / (365.25 * 864e5)) : null;
  const L = lens('left'), R = lens('right');
  // daily or weekly bars
  let bars, barNote;
  if (days.length <= 31) {
    bars = days.map(d => { const x = new Date(d + 'T12:00'); return { label: d, short: String(x.getDate()), v: minsByDay[d], today: d === todayKey() }; });
    barNote = `minutes each day · dashed line is the daily goal (${goal()} min)`;
  } else {
    bars = [];
    for (let i = 0; i < days.length; i += 7) {
      const wk = days.slice(i, i + 7), x = new Date(wk[0] + 'T12:00');
      bars.push({ label: `Week of ${wk[0]}`, short: `${x.getDate()}/${x.getMonth() + 1}`, v: wk.reduce((a, d) => a + minsByDay[d], 0) / wk.length, today: wk.includes(todayKey()) });
    }
    barNote = `average minutes per day, by week · dashed line is the daily goal (${goal()} min)`;
  }
  // check-ups
  const fe = sess.filter(s => s.feEnd != null).map(s => ({ t: s.date, y: s.feEnd }));
  const balPts = points('balance-test', from), letPts = points('letter-acuity', from);
  const balTr = trend('balance-test', from), letTr = trend('letter-acuity', from);
  const ck = (title, sub, pts, opt) => `<div class="rchart"><div class="card-head"><div><h3>${title}</h3><span class="muted small">${sub}</span></div>${pts.length ? `<span class="readout">${esc(opt.fmt(pts[pts.length - 1].y))}</span>` : ''}</div>${pts.length ? lineChart(pts, { ...opt, height: 150, width: 400 }) : '<div class="chart-empty">No results in this period</div>'}</div>`;
  // activities
  const rows = CATALOG.map(g => {
    const ss = sess.filter(s => s.game === g.id), m = METRICS[g.id], tr = trend(g.id, from);
    if (!ss.length) return `<tr><td>${esc(g.name)}</td><td class="num">0</td><td class="num">–</td><td>–</td><td class="muted" colspan="3">Not played in this period</td></tr>`;
    const mono = ss.filter(s => s.mode !== 'anaglyph').length, dich = ss.length - mono;
    const how = [mono && `Patch ${mono}`, dich && `Glasses ${dich}`].filter(Boolean).join(' · ');
    const firstLast = !m || !tr ? '–' : m.selfReport ? `Read ${m.fmt(tr.latest)} (self-report)` : tr.n >= 2 ? `${esc(m.fmt(tr.first))} → <b>${esc(m.fmt(tr.last))}</b>` : `<b>${esc(m.fmt(tr.latest))}</b>`;
    return `<tr><td><b>${esc(g.name)}</b><div class="muted small">${esc(m ? m.label : g.trains)}${tr && tr.level ? ` · ${esc(cap(String(tr.level)))}` : ''}</div></td>
      <td class="num">${ss.length}</td><td class="num">${Math.round(ss.reduce((a, s) => a + s.minutes, 0))}</td><td>${how}</td>
      <td>${firstLast}</td><td>${m && !m.selfReport ? trendBadge(tr) : '–'}</td><td class="small">${esc(describe(ss[ss.length - 1]))}</td></tr>`;
  }).join('');
  // comfort & safety
  const sym = db.symptoms.filter(x => new Date(x.date) >= from);
  const dv = sym.filter(x => x.doubleVision).length, ha = sym.filter(x => x.headache).length, sr = sym.filter(x => x.strain).length;
  const fine = sym.filter(x => !x.doubleVision && !x.headache && !x.strain).length;
  const issues = sym.filter(x => x.doubleVision || x.headache || x.strain).reverse();
  const balLine = balTr ? `${METRICS['balance-test'].fmt(balTr.latest)}${balTr.n >= 2 ? ` (from ${METRICS['balance-test'].fmt(balTr.first)})` : ''}` : 'Not measured in this period';
  const letLine = letTr ? `logMAR ${letTr.latest.toFixed(2)} · ${METRICS['letter-acuity'].snellen(letTr.latest)}${letTr.n >= 2 ? ` (from ${letTr.first.toFixed(2)})` : ''}` : 'Not measured in this period';

  el.innerHTML = `
    ${opts.doctor ? `<div class="row between noprint"><p class="muted small">The same report the patient sees. Print it for the clinical record or save it as a PDF.</p><button class="btn primary" id="printrep">${ICON.printer}<span>Print or save PDF</span></button></div>`
      : head('Report for your eye-care professional', 'A summary of your home training to print, save as PDF, or show on screen at your next appointment.',
      `<button class="btn primary" id="printrep">${ICON.printer}<span>Print or save PDF</span></button>`).replace('class="view-head"', 'class="view-head noprint"')}
    <div class="row rangepick noprint"><span class="muted small">Period</span>
      <div class="seg" role="radiogroup" aria-label="Report period">${RANGES.map(([k, l]) => `<label><input type="radio" name="rrange" value="${k}" ${reportRange === k ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>
    </div>
    ${db.sessions.some(s => s.example) ? `<div class="alert warn noprint">${ICON.info}<div><b>This report includes example data.</b> ${opts.doctor ? 'It was added to show how the report works.' : 'Remove it on the Progress page before sharing.'}</div></div>` : ''}
    <article class="report" aria-labelledby="rtitle">
      <header class="rhead">
        <div class="rtitle"><p class="eyebrow">${eyeGlyph().replace('class="glyph"', 'class="glyph" style="width:2.2rem;height:1.25rem"')}Amblyopia Training Lab · home training report</p><h1 id="rtitle">Training report${name ? `: ${esc(name)}` : ''}</h1></div>
        <div class="rmeta"><span>Period <b>${fmtDate(from)} – ${fmtDate(now)}</b></span><span>${days.length} days</span><span>Created ${fmtDate(now, true)}</span></div>
      </header>
      <div class="pgrid">
        <div><span>Patient</span><b>${name ? esc(name) : 'Not given'}</b></div>
        <div><span>Date of birth</span><b>${st.patientDob ? `${fmtDate(st.patientDob)}${age != null ? ` (${age} y)` : ''}` : 'Not given'}</b></div>
        <div><span>Eye-care professional</span><b>${st.clinician ? esc(st.clinician) : 'Not given'}</b></div>
        <div><span>Training since</span><b>${firstEver ? fmtDate(firstEver) : '–'}</b></div>
        <div><span>Amblyopic (weaker) eye</span><b>${cap(st.amblyopicEye)}</b></div>
        <div><span>Anaglyph glasses</span><b>${esc(L.name)} left · ${esc(R.name)} right${st.lensCalibrated ? '' : ' (not calibrated)'}</b></div>
        <div><span>Viewing distance</span><b>${st.distanceCm} cm${st.pxPerMm ? '' : ' (screen not measured)'}</b></div>
        <div><span>Daily goal</span><b>${goal()} min</b></div>
      </div>
      ${!sess.length ? `<div class="alert info">${ICON.info}<div>No training was recorded in this period. Choose a longer period above.</div></div>` : ''}
      <section class="rsect"><h2><span class="n">1</span>Adherence<span class="muted">${sess.length} session${sess.length === 1 ? '' : 's'}</span></h2>
        <div class="kpis">
          <div class="kpi"><span>Days trained</span><b>${trainedDays}<small> of ${days.length}</small></b><em>${days.length ? Math.round(trainedDays / days.length * 100) : 0}% of days</em></div>
          <div class="kpi"><span>Total training</span><b>${Math.round(totalMin)}<small> min</small></b><em>${(totalMin / 60).toFixed(1)} hours</em></div>
          <div class="kpi"><span>Average per training day</span><b>${Math.round(avgDay)}<small> min</small></b><em>goal reached on ${goalDays} day${goalDays === 1 ? '' : 's'}</em></div>
          <div class="kpi"><span>Patch · glasses</span><b>${Math.round(patchMin)}<small> · </small>${Math.round(glassMin)}</b><em>minutes, monocular · dichoptic</em></div>
        </div>
        <div class="rchart"><div class="card-head"><h3>Training time</h3><span class="muted small">${barNote}</span></div>${barChart(bars, { target: goal(), height: 150 })}</div>
      </section>
      <section class="rsect"><h2><span class="n">2</span>Check-ups<span class="muted">home measures, not diagnostic</span></h2>
        <div class="kpis" style="grid-template-columns:repeat(2,minmax(0,1fr))">
          <div class="kpi"><span>Eye balance (dichoptic)</span><b style="font-size:1.15rem">${balLine}</b><em>100% = both eyes contribute equally</em></div>
          <div class="kpi"><span>Smallest letter (home estimate)</span><b style="font-size:1.15rem">${letLine}</b><em>depends on screen and distance settings</em></div>
        </div>
        <div class="rcharts">
          ${ck('Eye balance', 'Balance test', balPts, { fmt: METRICS['balance-test'].fmt })}
          ${ck('Smallest letter', 'logMAR · lower is better, drawn upside down', letPts, { fmt: v => v.toFixed(2), lowerIsBetter: true })}
          ${fe.length ? ck('Stronger-eye brightness', 'End level in two-eye games · higher means the eyes cooperate more', fe, { fmt: v => Math.round(v * 100) + '%' }) : ''}
        </div>
      </section>
      <section class="rsect"><h2><span class="n">3</span>Activities<span class="muted">first → latest at the same level</span></h2>
        <div class="tablewrap"><table class="log">
          <thead><tr><th>Activity · measure</th><th class="num">Sessions</th><th class="num">Min</th><th>How</th><th>First → latest</th><th>Trend</th><th>Latest result</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
        <p class="rnote">First and latest are medians of up to three sessions at each end, played at the same level as the most recent one. "Better" and "Lower" mean a change of more than 5%.</p>
      </section>
      <section class="rsect"><h2><span class="n">4</span>Eye comfort and safety<span class="muted">asked after every activity</span></h2>
        <div class="kpis">
          <div class="kpi"><span>Check-ins</span><b>${sym.length}</b><em>${sym.length ? Math.round(fine / sym.length * 100) : 0}% "all good"</em></div>
          <div class="kpi"><span>Double vision</span><b class="${dv ? 'tcrit' : ''}">${dv}</b><em>${dv ? 'two-eye games pause automatically' : 'none reported'}</em></div>
          <div class="kpi"><span>Headache</span><b>${ha}</b><em>reports</em></div>
          <div class="kpi"><span>Tired or sore eyes</span><b>${sr}</b><em>reports</em></div>
        </div>
        <p>${db.state.dichopticLocked ? '<span class="flag crit">' + ICON.alert + ' Two-eye games are currently paused</span> after a double-vision report, until the patient confirms their eye-care professional agrees.' : '<span class="flag good">' + ICON.checkCircle + ' Two-eye games active</span>'}</p>
        ${issues.length ? `<div class="tablewrap"><table class="log"><thead><tr><th>Date</th><th>After</th><th>Reported</th></tr></thead><tbody>${issues.slice(0, 20).map(x => `<tr><td>${fmtDate(x.date)}</td><td>${esc((byId(x.game) || {}).name || '–')}</td><td>${[x.doubleVision && '<b class="tcrit">Double vision</b>', x.headache && 'Headache', x.strain && 'Tired or sore eyes'].filter(Boolean).join(', ')}</td></tr>`).join('')}</tbody></table></div>` : ''}
      </section>
      <footer class="rfoot">
        <p class="rnote"><b>About this report.</b> Data are recorded by the patient on their own device during home training with an eye patch (monocular) or anaglyph glasses (dichoptic). Home measures depend on screen size, distance and lighting, and are meant for watching trends, not for diagnosis or prescribing.</p>
        <p class="rnote">Amblyopia Training Lab is a research prototype, not a medical device.</p>
      </footer>
    </article>`;
  document.getElementById('printrep').onclick = () => { A.audit(A.me(), 'report_print', A.me().role === 'patient' ? A.me().id : (location.hash.split('/')[1] || null)); window.print(); };
  document.querySelectorAll('input[name=rrange]').forEach(r => r.onchange = () => { reportRange = r.value; route(true); });
}

function settings() { renderSettings(view(), () => route(true)); }
function welcome() { renderWizard(view(), () => route(true)); }

// ---------- example data (clearly marked) ----------
function loadExample() {
  const add = (daysAgo, rec) => {
    const d = new Date(); d.setDate(d.getDate() - daysAgo); d.setHours(19, 10 + Math.floor(Math.random() * 40));
    db.sessions.push({ ...rec, example: true, date: d.toISOString(), day: todayKey(d) });
  };
  const jit = (v, p = 0.06) => v * (1 + (Math.random() - 0.5) * p * 2);
  const rnd = (a, b) => a + Math.random() * (b - a);
  for (let i = 27; i >= 1; i--) {
    if (i % 6 === 5 || i === 16) continue; // rest days
    const k = (27 - i) / 26; // 0 → 1 over four weeks
    const mode = i % 3 ? 'anaglyph' : 'mono';
    add(i, { game: 'contrast-finder', title: 'Contrast Finder', mode: 'mono', minutes: 3, threshold: jit(0.07 - 0.035 * k, 0.12), unit: 'contrast', trials: 60, correct: 45 });
    const shown = Math.round(120 / (1.2 - 0.6 * k));
    add(i, { game: 'eye-jump', title: 'Eye Jump', mode, minutes: 2, trials: shown, threshold: null, unit: null, score: null,
      extra: { char: Math.round(30 - 12 * k), circle: Math.round(64 - 16 * k), selfReport: k > 0.6 ? 'all' : k > 0.25 ? 'most' : 'few' } });
    if (i % 2) { const n = 2, got = k > 0.5 || Math.random() < 0.3 + k ? 2 : 1; add(i, { game: 'follow-it', title: 'Follow It', mode, minutes: 1, trials: n, correct: got, threshold: null, unit: null, extra: { level: 'medium' } }); }
    if (i % 2 === 0) { const t = 24, h = Math.round(t * Math.min(0.97, jit(0.62 + 0.3 * k, 0.06))); add(i, { game: 'fov-spot', title: 'FOV Spot', mode, minutes: 2, trials: t, correct: h, threshold: null, unit: null, extra: { level: 'medium' } }); }
    if (i % 3 === 0) add(i, { game: 'precision', title: 'Precision', mode, minutes: 1, trials: 30, correct: 28, threshold: null, unit: null, extra: { level: 'medium', avgPts: +jit(5.6 + 2.1 * k, 0.05).toFixed(2), score: Math.round(30 * (5.6 + 2.1 * k)) } });
    if (i % 3 === 1) { const t = 16, f = Math.round(t * Math.min(1, jit(0.6 + 0.3 * k, 0.07))); add(i, { game: 'rotation-match', title: 'Rotation Match', mode, minutes: 1, trials: t, correct: f, threshold: null, unit: null, extra: { level: 'medium', avg: +jit(3.4 - 1.1 * k, 0.08).toFixed(2) } }); }
    if (i % 4 === 0) add(i, { game: 'split-vision', title: 'Split Vision', mode, minutes: 1, trials: 14, correct: 13, threshold: null, unit: null, extra: { found: 13, avg: +jit(3.1 - 1.0 * k, 0.08).toFixed(2) } });
    if (i % 4 === 2) add(i, { game: 'peripheral-chart', title: 'Peripheral Chart', mode, minutes: 1, trials: 12, correct: 12, threshold: null, unit: null, extra: { found: 12, avg: +jit(4.2 - 1.4 * k, 0.08).toFixed(2) } });
    if (i % 5 === 1) add(i, { game: 'visual-power', title: 'Visual Power', mode: 'anaglyph', minutes: 2, trials: 20, correct: 17, threshold: null, unit: null, extra: { mode: 'timed', dir: 'in', bestIn: Math.round(rnd(0.9, 1.1) * (14 + 26 * k)) } });
    if (i % 5 === 3) { const time = jit(95 - 30 * k, 0.06); add(i, { game: 'jump-read', title: 'Jump Read', mode, minutes: +(time / 60).toFixed(2), trials: 26, correct: 26, threshold: null, unit: null, extra: { level: 'medium', time, errors: Math.round(rnd(0, 3) * (1 - k)) } }); }
    if (i % 7 === 6 || i === 27) add(i, { game: 'balance-test', title: 'Balance test', mode: 'anaglyph', minutes: 2, threshold: Math.min(1, 0.3 + 0.25 * k), unit: 'balance', trials: 28 });
    if (i % 10 === 0 || i === 26) add(i, { game: 'letter-acuity', title: 'Letter size test', mode: 'mono', minutes: 2, threshold: jit(11 - 3 * k), unit: 'arcmin', trials: 30, extra: { letterArcmin: jit(11 - 3 * k) } });
    const sd = new Date(Date.now() - i * 864e5);
    db.symptoms.push({ example: true, game: 'contrast-finder', date: sd.toISOString(), day: todayKey(sd), doubleVision: false, headache: i === 14, strain: i === 9 || i === 21 });
  }
  db.sessions.sort((a, b) => new Date(a.date) - new Date(b.date));
  db.symptoms.sort((a, b) => new Date(a.date) - new Date(b.date));
  save();
}

// ---------- demo clinic ----------
function seedDemo() {
  A.resetDevice();
  A.dir.clinic = 'City Eye Clinic (demo)'; A.dir.demo = true; A.dir.setup = true;
  const ids = {};
  const admin = A.createUser({ role: 'admin', name: 'Meera Shah', pin: '1111' }, null);
  ids.admin = admin;
  for (const x of C.DEMO.filter(x => x.role !== 'admin')) {
    const by = x.role === 'patient' ? ids[x.doc] : admin;
    ids[x.key] = x.role === 'patient' ? C.createPatient({ name: x.name, pin: x.pin, dob: x.dob, doctorId: ids[x.doc].id, weakEye: x.weakEye }, by) : A.createUser({ role: x.role, name: x.name, pin: x.pin }, admin);
  }
  A.dir.users.forEach(u => { u.pinLen = 4; });
  // Example results for each patient, ready set up so they go straight to Today.
  const prep = (u, fn) => {
    C.openPatient(u);
    Object.assign(db.settings, { consent: true, setupDone: true, pxPerMm: 96 / 25.4, lensConfirmed: true, lensCalibrated: true, lens: { left: { name: 'Blue', rgb: [0, 0, 255] }, right: { name: 'Red', rgb: [255, 0, 0] } } });
    fn(); save();
  };
  prep(ids.asha, () => {
    loadExample();
    db.state.balance = 0.55;
    Object.assign(db.state.plan, { reviewDate: todayKey(new Date(Date.now() + 9 * 864e5)), updatedBy: ids.mehta.id });
    db.state.plan.games['okn-stripes'] = { on: false, mode: 'choice' };
    db.state.plan.games['contrast-finder'] = { on: true, mode: 'mono' };
  });
  prep(ids.rohan, () => {
    loadExample(); db.sessions = db.sessions.filter(x => new Date(x.date) < new Date(Date.now() - 5 * 864e5));
    db.symptoms = db.symptoms.filter(x => new Date(x.date) < new Date(Date.now() - 5 * 864e5));
    const dv = new Date(Date.now() - 5 * 864e5);
    db.symptoms.push({ example: true, game: 'visual-power', date: dv.toISOString(), day: todayKey(dv), doubleVision: true, headache: false, strain: false });
    db.state.dichopticLocked = true; db.state.balance = 0.42;
  });
  prep(ids.priya, () => { loadExample(); db.state.balance = 0.6; });
  // Demo patients joined when their example history starts.
  [ids.asha, ids.rohan, ids.priya].forEach(u => { const d = A.readData(u.id); if (d && d.sessions.length) u.createdAt = d.sessions[0].date; });
  A.saveDir();
  A.sendMessage(ids.asha.id, 'Great progress this month. Please keep Contrast Finder on the patch every day, and do the balance test when the app asks.', ids.mehta);
  A.addNote(ids.asha.id, 'Contrast threshold improving steadily (about 7% to 3.5%). Balance up from 33% to 50%. Continue current plan; consider adding OKN Stripes at next review.', ids.mehta);
  A.addNote(ids.rohan.id, 'Reported double vision after Visual Power. Two-eye games paused automatically. Call patient before resuming.', ids.mehta);
  A.dir.audit = A.dir.audit.filter(r => r.action !== 'message_send' && r.action !== 'note_add');
  A.audit(null, 'device_setup', null, 'demo clinic');
  useData(BLANK);
}

// ---------- idle lock ----------
let lastAct = Date.now();
['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, () => { lastAct = Date.now(); A.touch(); }, true));
function lockNow(reason) { A.signOut(reason); useData(BLANK); history.replaceState(null, '', location.pathname + location.search); route(); }
setInterval(() => {
  if (A.me() && !document.body.classList.contains('stage-open') && Date.now() - lastAct > (A.dir.device.idleMin || 10) * 60000) lockNow('idle_lock');
}, 15000);
document.addEventListener('click', e => { if (e.target.closest('[data-signout]')) { e.preventDefault(); lockNow('signout'); } });

// ---------- boot ----------
C.initClinic({ head, route, report, progress, describe, trendBadge, eyeGlyph, seedDemo, shell: () => shell(current) });
document.addEventListener('click', e => { if (e.target.closest('.skip')) { e.preventDefault(); view().focus(); } });
if (/[?&]test\b/.test(location.search)) window.__atl = { idle: () => { lastAct = 0; lockNow('idle_lock'); }, me: () => A.me() && { id: A.me().id, role: A.me().role }, dir: () => A.dir };
A.resume();
applyDisplay();
watchSystemTheme(() => shell(current));
window.addEventListener('hashchange', () => route());
route();
