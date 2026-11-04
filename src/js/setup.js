// Settings page and first-run welcome wizard, built from the same sections.
import { db, save, todayKey, exportData, importData, resetAll } from './store.js';
import { pxPerDeg, esc, saveTextFile } from './util.js';
import { LENS_COLOURS, lens, setLensColour, lensOverlap, applyEyeColors, rgbCss, hex } from './lens.js';
import { applyDisplay, THEME_LABELS, SIZE_LABELS } from './theme.js';
import { ICON } from './icons.js';
import * as A from './accounts.js';
import { pinChangeCard, wirePinChange } from './clinic.js';

// Details the clinic manages are shown read-only to patients.
const managed = () => !!(A.me() && A.me().role === 'patient');
const docName = () => { const u = A.me(), d = u && A.userById(u.doctorId); return d ? A.displayName(d) : 'your doctor'; };

const CARD_W = 85.6, CARD_H = 53.98;

export function setupDone() { return !!(db.settings.consent && db.settings.pxPerMm); }

let blackStep = 1;      // black test step showing (1, 2 or 3)
let checkStage = 0;     // step 3 quiz progress

// ---------------- sections ----------------
const SECTIONS = {
  display: {
    title: 'Display', icon: 'sun',
    state: () => ['ok', 'Set'],
    html: () => {
      const s = db.settings;
      return `
      <p>Choose what is most comfortable for your eyes. You can change this any time.</p>
      <fieldset class="field"><legend>Colours</legend>
        <div class="seg">${Object.entries(THEME_LABELS).map(([k, l]) => `<label><input type="radio" name="theme" value="${k}" ${s.theme === k ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>
      </fieldset>
      <fieldset class="field"><legend>Text size</legend>
        <div class="seg">${Object.entries(SIZE_LABELS).map(([k, l]) => `<label><input type="radio" name="tsize" value="${k}" ${s.textSize === k ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>
      </fieldset>
      ${managed() ? `<p><b>Daily goal: ${s.dailyGoal} minutes.</b> <span class="muted">Set by ${esc(docName())}.</span></p>` : `<fieldset class="field"><legend>Daily goal</legend>
        <div class="seg">${[15, 20, 30, 40].map(m => `<label><input type="radio" name="goal" value="${m}" ${s.dailyGoal === m ? 'checked' : ''}><span>${m} min</span></label>`).join('')}</div>
      </fieldset>`}
      <p class="muted small">Light colours are easiest to read for most people. Dark or high contrast can feel better if bright screens bother you. Training screens always stay dark so the patterns show correctly.</p>`;
    },
    wire: (el, refresh) => {
      const s = db.settings;
      el.querySelectorAll('input[name=theme]').forEach(r => r.onchange = () => { s.theme = r.value; save(); applyDisplay(); refresh(); });
      el.querySelectorAll('input[name=tsize]').forEach(r => r.onchange = () => { s.textSize = r.value; save(); applyDisplay(); refresh(); });
      el.querySelectorAll('input[name=goal]').forEach(r => r.onchange = () => { s.dailyGoal = +r.value; save(); });
    },
  },

  about: {
    title: 'About you', icon: 'user',
    state: () => (managed() ? ['ok', 'From your clinic'] : db.settings.patientName ? ['ok', 'Added'] : ['', 'Optional']),
    html: () => {
      const s = db.settings, u = A.me();
      if (managed()) return `
      <p>These details come from your clinic and appear on your report. Ask the clinic if anything is wrong.</p>
      <div class="pgrid" style="grid-template-columns:repeat(3,minmax(0,1fr))">
        <div><span>Name</span><b>${esc(u.name)}</b></div>
        <div><span>Date of birth</span><b>${u.dob ? esc(new Date(u.dob).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })) : 'Not given'}</b></div>
        <div><span>Your doctor</span><b>${esc(docName())}</b></div>
      </div>`;
      return `
      <p>Optional. These details only appear on your report, so your eye-care professional knows whose results they are. They stay on this device.</p>
      <div class="fields">
        <label class="field">Your name<input type="text" id="pname" autocomplete="name" value="${esc(s.patientName || '')}" placeholder="e.g. Asha Patel"></label>
        <label class="field">Date of birth<input type="date" id="pdob" value="${esc(s.patientDob || '')}"></label>
        <label class="field">Eye-care professional or clinic<input type="text" id="pclin" value="${esc(s.clinician || '')}" placeholder="e.g. Dr Mehta, City Eye Clinic"></label>
      </div>
      <p class="muted small" id="aboutmsg" role="status"></p>`;
    },
    wire: (el, refresh) => {
      if (managed()) return;
      const s = db.settings, msg = el.querySelector('#aboutmsg');
      const bind = (id, key) => { el.querySelector(id).onchange = e => { s[key] = e.target.value.trim(); save(); msg.textContent = 'Saved.'; refresh(); }; };
      bind('#pname', 'patientName'); bind('#pdob', 'patientDob'); bind('#pclin', 'clinician');
    },
  },

  pin: {
    title: 'Your PIN', icon: 'shield',
    state: () => (A.me() && A.me().mustChangePin ? ['todo', 'Please change it'] : ['ok', 'Set']),
    html: () => `<p>You sign in with your PIN. Choose one only you know.</p>${pinChangeCard().replace(/^[\s\S]*?<div class="fields">/, '<div class="fields">').replace(/<\/section>\s*$/, '')}`,
    wire: el => wirePinChange(el),
  },

  eyes: {
    title: 'Your eyes', icon: 'eye',
    state: () => (db.settings.consent ? ['ok', 'Done'] : ['todo', 'Needed']),
    html: () => {
      const s = db.settings;
      return `
      ${managed() ? `<p><b>Weaker (lazy) eye: ${s.amblyopicEye === 'left' ? 'left' : 'right'}.</b> <span class="muted">Set by ${esc(docName())}.</span></p>` : `<fieldset class="field"><legend>Which eye is weaker (the lazy eye)?</legend>
        <div class="seg">
          <label><input type="radio" name="amb" value="left" ${s.amblyopicEye === 'left' ? 'checked' : ''}><span>Left eye</span></label>
          <label><input type="radio" name="amb" value="right" ${s.amblyopicEye === 'right' ? 'checked' : ''}><span>Right eye</span></label>
        </div>
      </fieldset>`}
      <div class="notice">
        <p><b>Please read.</b> This app is a research prototype, not a medical device. Use it with your eye-care professional's knowledge and wear your usual glasses. Stop and talk to your eye doctor if you notice double vision, headaches, or your sight getting worse.</p>
        <label class="check"><input type="checkbox" id="consent" ${s.consent ? 'checked' : ''}> I am 20 or older and I understand.</label>
      </div>`;
    },
    wire: (el, refresh) => {
      const s = db.settings;
      el.querySelectorAll('input[name=amb]').forEach(r => r.onchange = () => { s.amblyopicEye = r.value; save(); refresh(); });
      el.querySelector('#consent').onchange = e => { s.consent = e.target.checked; s.setupDone = setupDone(); save(); refresh(); };
    },
  },

  screen: {
    title: 'Screen size', icon: 'ruler',
    state: () => (db.settings.pxPerMm ? ['ok', 'Done'] : ['todo', 'Needed']),
    html: () => {
      const cardW = Math.round((db.settings.pxPerMm || 96 / 25.4) * CARD_W);
      return `
      <p>So patterns are drawn at the right size, hold any bank card or ID card flat against the screen. Move the slider until the box is exactly as wide as your card.</p>
      <div class="cardcal"><div class="cardbox" id="cardbox" style="width:${cardW}px;height:${Math.round(cardW * CARD_H / CARD_W)}px">Card</div></div>
      <div class="row">
        <button class="btn sm" id="cardminus" aria-label="Make the box smaller">−</button>
        <input type="range" id="cardw" min="180" max="720" step="1" value="${cardW}" aria-label="Box width">
        <button class="btn sm" id="cardplus" aria-label="Make the box bigger">+</button>
        <button class="btn primary" id="cardsave">${ICON.check}<span>It matches my card</span></button>
      </div>
      <p class="muted small" id="cardread">${db.settings.pxPerMm ? 'Saved.' : 'Not saved yet.'}</p>`;
    },
    wire: (el, refresh) => {
      const cw = el.querySelector('#cardw'), box = el.querySelector('#cardbox');
      const upd = () => { const w = +cw.value; box.style.width = w + 'px'; box.style.height = Math.round(w * CARD_H / CARD_W) + 'px'; };
      cw.oninput = upd;
      el.querySelector('#cardminus').onclick = () => { cw.value = +cw.value - 1; upd(); };
      el.querySelector('#cardplus').onclick = () => { cw.value = +cw.value + 1; upd(); };
      el.querySelector('#cardsave').onclick = () => { db.settings.pxPerMm = +cw.value / CARD_W; db.settings.setupDone = setupDone(); save(); refresh(); };
    },
    beforeNext: el => { const cw = el.querySelector('#cardw'); db.settings.pxPerMm = +cw.value / CARD_W; save(); },
  },

  distance: {
    title: 'How far you sit', icon: 'ruler',
    state: () => ['ok', 'Set'],
    html: () => `
      <p>Sit at the same distance every time. About an arm's length (60 cm) suits most laptops.</p>
      <div class="row">
        <label class="field inline">Distance from your eyes to the screen
          <span class="withunit"><input type="number" id="dist" min="30" max="300" step="5" value="${db.settings.distanceCm}"> cm</span>
        </label>
      </div>
      <p class="muted small">Tip: measure once with a tape measure, then notice where your chair and screen are.</p>`,
    wire: el => {
      el.querySelector('#dist').onchange = e => { db.settings.distanceCm = Math.max(30, Math.min(300, +e.target.value || 60)); save(); };
    },
  },

  glasses: {
    title: 'Glasses colours', icon: 'glasses',
    state: () => (!db.settings.lensConfirmed ? ['todo', 'Needed'] : db.settings.lensCalibrated ? ['ok', 'Tuned'] : ['todo', 'Black test recommended']),
    html: () => glassesHtml(),
    wire: (el, refresh) => wireGlasses(el, refresh),
  },

  brightness: {
    title: 'Brightness match', icon: 'sun',
    state: () => ['ok', 'Optional'],
    html: () => {
      const g = Math.round(255 * Math.pow(0.5, 1 / (db.settings.gamma || 2.2)));
      return `
      <p>Lean back or squint a little. Move the slider until the plain grey half looks as bright as the fine striped half. This helps faint patterns look right on your screen.</p>
      <div class="row">
        <canvas id="gammacv" class="gammacv" aria-label="Brightness match patches"></canvas>
        <input type="range" id="gval" min="140" max="230" value="${g}" aria-label="Grey brightness">
      </div>`;
    },
    wire: el => {
      const gc = el.querySelector('#gammacv');
      const draw = () => {
        const dpr = window.devicePixelRatio || 1, cssW = 300, cssH = 120;
        gc.style.width = cssW + 'px'; gc.style.height = cssH + 'px';
        gc.width = Math.round(cssW * dpr); gc.height = Math.round(cssH * dpr);
        const ctx = gc.getContext('2d'), img = ctx.createImageData(gc.width, gc.height);
        const half = Math.floor(gc.width / 2), g = +el.querySelector('#gval').value;
        for (let y = 0; y < gc.height; y++) for (let x = 0; x < gc.width; x++) {
          const i = (y * gc.width + x) * 4, v = x < half ? (((x + y) & 1) ? 255 : 0) : g;
          img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
      };
      draw();
      el.querySelector('#gval').oninput = () => { draw(); const v = +el.querySelector('#gval').value / 255; db.settings.gamma = Math.max(1.6, Math.min(3.2, Math.log(0.5) / Math.log(v))); save(); };
    },
  },

  data: {
    title: 'Your data', icon: 'download',
    state: () => ['ok', 'On this device'],
    html: () => `
      <p>Everything stays in this browser. ${managed() ? 'You can save a copy of your own results. Restoring or deleting data is done by the clinic admin.' : 'Save a copy to keep a backup, to show your eye-care professional, or to move to another computer.'}</p>
      <div class="row">
        <button class="btn" id="exp">${ICON.download}<span>Save a copy</span></button>
        ${managed() ? '' : `<label class="btn file-btn">${ICON.upload}<span>Load a copy</span><input type="file" id="imp" accept="application/json,.json"></label>
        <button class="btn danger" id="reset">${ICON.trash}<span>Delete everything</span></button>`}
      </div>
      <p class="muted small" id="datamsg" role="status"></p>
      <div id="confirmbox"></div>`,
    wire: (el, refresh) => {
      const msg = t => { el.querySelector('#datamsg').textContent = t; };
      el.querySelector('#exp').onclick = async () => {
        const r = await saveTextFile(`amblyopia-training-${todayKey()}.json`, exportData());
        msg(r === 'copied' ? 'Saving files is blocked here, so your data was copied to the clipboard instead.' : r === 'failed' ? 'Could not save a copy in this view.' : 'Copy saved.');
      };
      if (!el.querySelector('#imp')) return;
      el.querySelector('#imp').onchange = e => {
        const f = e.target.files && e.target.files[0]; if (!f) return;
        f.text().then(t => { try { importData(t); applyDisplay(); refresh(); } catch (err) { msg(err.message); } });
      };
      el.querySelector('#reset').onclick = () => {
        el.querySelector('#confirmbox').innerHTML = `<div class="alert crit">${ICON.alert}<div>Delete all sessions, results and settings on this device? This can't be undone.</div><button class="btn sm danger" id="reallyreset">Yes, delete everything</button><button class="btn sm" id="cancelreset">Keep my data</button></div>`;
        el.querySelector('#reallyreset').onclick = () => { resetAll(); applyDisplay(); location.hash = '#welcome'; };
        el.querySelector('#cancelreset').onclick = () => { el.querySelector('#confirmbox').innerHTML = ''; };
      };
    },
  },
};

// ---------------- glasses colours (black test) ----------------
function colourGroup(eye) {
  const L = lens(eye), shape = eye === 'left' ? 'square' : 'circle';
  return `
    <div class="cgroup" id="cg-${eye}">
      <div class="cg-head">
        <span class="swatch" style="background:${rgbCss(L.rgb)}"></span>
        <div><b>${eye === 'left' ? 'Left' : 'Right'}-eye colour</b><div class="muted small">the ${shape} · ${esc(L.name)} lens</div></div>
        <span class="hex">${hex(L.rgb)}</span>
      </div>
      ${['Red', 'Green', 'Blue'].map((c, i) => `
        <label class="chan"><span>${c}</span>
          <input type="range" min="0" max="255" step="1" value="${L.rgb[i]}" data-eye="${eye}" data-ch="${i}" aria-label="${eye} eye colour, ${c.toLowerCase()}">
          <output>${L.rgb[i]}</output>
        </label>`).join('')}
      <div class="row tight"><button class="btn sm" data-reset="${eye}">Reset to pure ${esc(L.name.toLowerCase())}</button></div>
    </div>`;
}

function lensPicker(eye) {
  const cur = lens(eye).name;
  return `
    <fieldset class="field lenspick"><legend>${eye === 'left' ? 'Lens over your <b>left</b> eye' : 'Lens over your <b>right</b> eye'}</legend>
      <div class="chipset">${Object.entries(LENS_COLOURS).map(([n, rgb]) => `<button type="button" class="chipbtn lenschip" data-lens="${eye}:${n}" aria-pressed="${cur === n}"><i class="sw" style="background:${rgbCss(rgb)}"></i>${n}</button>`).join('')}</div>
    </fieldset>`;
}

function glassesHtml() {
  const s = db.settings, L = lens('left'), R = lens('right');
  const overlap = lensOverlap();
  const steps = {
    1: `<b>Close your left eye</b> and look through the right (${esc(R.name)}) lens only. The <b>square</b> should disappear into the black. If you can still see it, even faintly, lower the <b>left-eye colour</b> sliders until it's gone.`,
    2: `<b>Close your right eye</b> and look through the left (${esc(L.name)}) lens only. The <b>circle</b> should disappear into the black. If you can still see it, lower the <b>right-eye colour</b> sliders until it's gone.`,
    3: 'Last step: two quick questions to confirm.',
  };
  const quiz = checkStage === 0
    ? `<p><b>Close your right eye.</b> What do you see?</p><div class="row"><button class="btn" data-q="0-square">Only the square</button><button class="btn" data-q="0-circle">Only the circle</button><button class="btn" data-q="0-both">Both</button></div>`
    : checkStage === 1
      ? `<p><b>Now close your left eye.</b> What do you see?</p><div class="row"><button class="btn" data-q="1-circle">Only the circle</button><button class="btn" data-q="1-square">Only the square</button><button class="btn" data-q="1-both">Both</button></div>`
      : checkStage === 2
        ? `<div class="alert good">${ICON.checkCircle}<div><b>All set.</b> Each eye sees only its own colour, and every two-eye game will use these colours.</div></div><div class="row"><button class="btn sm" data-q="redo">Check again</button></div>`
        : `<div class="alert warn">${ICON.info}<div>${checkStage === 'reversed' ? 'The colours seem to be the other way round. Check which colour is over each eye above and pick again.' : 'One eye still sees both shapes. Go back to steps 1 and 2 and lower the colour that is still showing.'}</div></div><div class="row"><button class="btn sm" data-q="redo">Try again</button></div>`;
  return `
    <p>Put your two-colour glasses on and look in a mirror, or hold them the way you wear them. <b>Which colour is in front of each eye?</b> Many glasses are red on the left, but not all. Yours might be blue or cyan on the left.</p>
    <div class="glasses-row">
      <div class="col">
        ${lensPicker('left')}
        ${lensPicker('right')}
      </div>
      <svg class="specs" viewBox="0 0 260 110" role="img" aria-label="Your glasses: ${esc(L.name)} lens over the left eye, ${esc(R.name)} over the right eye">
        <path class="specs-frame" d="M18 40 Q10 40 6 30" stroke-width="4" fill="none" stroke-linecap="round"/>
        <path class="specs-frame" d="M242 40 Q250 40 254 30" stroke-width="4" fill="none" stroke-linecap="round"/>
        <rect class="specs-frame" x="18" y="26" width="96" height="58" rx="18" fill="${rgbCss(L.rgb)}" fill-opacity="0.85" stroke-width="4"/>
        <rect class="specs-frame" x="146" y="26" width="96" height="58" rx="18" fill="${rgbCss(R.rgb)}" fill-opacity="0.85" stroke-width="4"/>
        <path class="specs-frame" d="M114 46 Q130 34 146 46" stroke-width="4" fill="none"/>
        <text x="66" y="104" text-anchor="middle" class="specs-l">Left eye: ${esc(L.name)}</text>
        <text x="194" y="104" text-anchor="middle" class="specs-l">Right eye: ${esc(R.name)}</text>
      </svg>
    </div>
    ${L.name === R.name ? `<div class="alert warn">${ICON.alert}<div>Both lenses are set to ${esc(L.name)}. Two-colour glasses have a different colour on each side.</div></div>`
      : overlap.length ? `<div class="alert warn">${ICON.info}<div>${esc(L.name)} and ${esc(R.name)} both let some ${overlap.join(' and ')} light through, so each eye may see a little of the other's picture. The black test below fixes this.</div></div>` : ''}
    ${s.lensConfirmed ? '' : `<div class="row"><button class="btn primary" id="lensok">${ICON.check}<span>Yes, ${esc(L.name)} left and ${esc(R.name)} right is correct</span></button></div>`}
    <div class="blacktest">
      <div class="seg" role="radiogroup" aria-label="Black test steps">
        ${[1, 2, 3].map(n => `<label><input type="radio" name="bstep" value="${n}" ${blackStep === n ? 'checked' : ''}><span>${n === 1 ? 'Step 1: left eye closed' : n === 2 ? 'Step 2: right eye closed' : 'Step 3: check'}</span></label>`).join('')}
      </div>
      <canvas id="blackcv" class="blackcv" aria-label="A square in your left-eye colour and a circle in your right-eye colour, on black"></canvas>
      <p class="binstr" aria-live="polite">${steps[blackStep]}</p>
      ${blackStep === 3 ? `<div class="quiz">${quiz}</div>` : `<div class="cgroups">${colourGroup('left')}${colourGroup('right')}</div>
      <p class="muted small">Tip: lower just the colour that shows through, not all three. With red/cyan glasses, if the circle shows through the red lens, try lowering its green a little.</p>`}
    </div>`;
}

function wireGlasses(el, refresh) {
  const s = db.settings, q = sel => el.querySelector(sel);
  el.querySelectorAll('[data-lens]').forEach(b => b.onclick = () => {
    const [eye, name] = b.dataset.lens.split(':');
    setLensColour(eye, name);
    db.state.glassesCheckDate = null; checkStage = 0; blackStep = 1; save(); applyEyeColors(); refresh();
  });
  const ok = q('#lensok');
  if (ok) ok.onclick = () => { s.lensConfirmed = true; db.state.glassesCheckDate = null; save(); refresh(); };
  el.querySelectorAll('input[name=bstep]').forEach(r => r.onchange = () => { blackStep = +r.value; if (blackStep === 3) checkStage = 0; refresh(); });
  const cv = q('#blackcv');
  const draw = () => {
    const dpr = window.devicePixelRatio || 1;
    const cssW = Math.min(cv.parentElement.clientWidth || 600, 640), cssH = Math.round(cssW * 0.42);
    cv.style.width = cssW + 'px'; cv.style.height = cssH + 'px';
    cv.width = Math.round(cssW * dpr); cv.height = Math.round(cssH * dpr);
    const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = '#000'; c.fillRect(0, 0, cssW, cssH);
    const r = cssH * 0.3, y = cssH * 0.45;
    c.fillStyle = rgbCss(lens('left').rgb); c.fillRect(cssW * 0.28 - r, y - r, 2 * r, 2 * r);
    c.fillStyle = rgbCss(lens('right').rgb); c.beginPath(); c.arc(cssW * 0.72, y, r, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#7d8a8e'; c.font = '14px "Atkinson Hyperlegible", Arial, sans-serif'; c.textAlign = 'center';
    c.fillText('left-eye colour', cssW * 0.28, cssH - 12); c.fillText('right-eye colour', cssW * 0.72, cssH - 12);
  };
  draw();
  const cl = q('#cg-left'), cr = q('#cg-right');
  if (cl) { cl.classList.toggle('active', blackStep === 1); cr.classList.toggle('active', blackStep === 2); }
  el.querySelectorAll('.chan input').forEach(inp => {
    inp.oninput = () => {
      const eye = inp.dataset.eye; lens(eye).rgb[+inp.dataset.ch] = +inp.value;
      inp.nextElementSibling.textContent = inp.value;
      const g = q('#cg-' + eye); g.querySelector('.swatch').style.background = rgbCss(lens(eye).rgb); g.querySelector('.hex').textContent = hex(lens(eye).rgb);
      s.lensCalibrated = false; draw(); applyEyeColors(); save();
    };
  });
  el.querySelectorAll('[data-reset]').forEach(b => b.onclick = () => {
    const eye = b.dataset.reset, base = LENS_COLOURS[lens(eye).name];
    if (base) lens(eye).rgb = [...base];
    s.lensCalibrated = false; save(); applyEyeColors(); refresh();
  });
  el.querySelectorAll('[data-q]').forEach(b => b.onclick = () => {
    const a = b.dataset.q;
    if (a === 'redo') checkStage = 0;
    else if (a === '0-square') checkStage = 1;
    else if (a === '0-circle' || a === '1-square') checkStage = 'reversed';
    else if (a === '0-both' || a === '1-both') checkStage = 'leak';
    else if (a === '1-circle') { checkStage = 2; s.lensCalibrated = true; db.state.glassesCheckDate = todayKey(); }
    save(); refresh();
  });
}

// ---------------- settings page ----------------
const ORDER = ['about', 'eyes', 'glasses', 'screen', 'distance', 'brightness', 'display', 'pin', 'data'];

export function renderSettings(el, rerender) {
  const refresh = () => { const y = window.scrollY; rerender(); window.scrollTo(0, y); };
  el.innerHTML = `
    <header class="view-head"><div class="vh"><h1>Settings</h1><p class="sub">How the app is set up for your eyes, glasses and screen, and how it looks. Everything is saved on this device.</p></div></header>
    <div class="settings-layout">
      <nav class="toc" aria-label="Settings sections">${ORDER.map(k => { const [st] = SECTIONS[k].state(); return `<a href="#s-${k}" data-toc="${k}">${SECTIONS[k].title}${st === 'todo' ? '<i title="Needs attention"></i>' : ''}</a>`; }).join('')}</nav>
      <div class="settings-list">
      ${ORDER.map(k => {
        const sec = SECTIONS[k], [st, label] = sec.state();
        return `<section class="card setup" id="s-${k}"><div class="step"><span class="num">${ICON[sec.icon]}</span><h2>${sec.title}</h2><span class="state ${st}">${label}</span></div><div data-sec="${k}">${sec.html()}</div></section>`;
      }).join('')}
      </div>
    </div>`;
  ORDER.forEach(k => SECTIONS[k].wire(el.querySelector(`[data-sec="${k}"]`), refresh));
  el.querySelectorAll('[data-toc]').forEach(a => a.onclick = e => { e.preventDefault(); const t = el.querySelector('#s-' + a.dataset.toc); if (t) t.scrollIntoView({ block: 'start', behavior: 'smooth' }); });
}

// ---------------- welcome wizard ----------------
const WIZ = ['welcome', 'eyes', 'screen', 'distance', 'glasses', 'display', 'done'];
let wizStep = 0;
export function resetWizard() { wizStep = 0; }

export function renderWizard(el, rerender) {
  const key = WIZ[wizStep];
  const refresh = () => rerender();
  const dots = `<div class="progressdots" aria-label="Step ${wizStep + 1} of ${WIZ.length}">${WIZ.map((_, i) => `<i class="${i <= wizStep ? 'on' : ''}"></i>`).join('')}</div>`;
  let body = '', title = '', canNext = true, nextLabel = 'Next';
  if (key === 'welcome') {
    title = 'Welcome';
    body = `
      <p class="sub">This app gives your weaker eye short, game-like training every day, about 30 minutes. Some activities use an eye patch, others use two-colour 3D glasses.</p>
      <ul class="bullets">
        <li>${ICON.clock}<span><b>A few minutes to set up</b>: your eyes, your screen size and your glasses.</span></li>
        <li>${ICON.patch}<span><b>You'll need</b>: your usual glasses, an eye patch, two-colour 3D glasses and a bank card (to measure the screen).</span></li>
        <li>${ICON.heart}<span><b>Go at your own pace.</b> Short breaks are good. Stop if your eyes feel uncomfortable.</span></li>
        <li>${ICON.shield}<span><b>Private.</b> No account. Nothing leaves this device.</span></li>
      </ul>`;
    nextLabel = 'Let\'s start';
  } else if (key === 'done') {
    title = 'You\'re all set';
    body = `
      <p class="sub">Your first session starts with a 2-minute balance test. It measures how your two eyes work together and sets the right level for the two-eye games.</p>
      <div class="row"><button class="btn primary big" data-session="today">${ICON.play}<span>Start my first session</span></button><a class="btn" href="#today">Go to my home page</a></div>`;
  } else {
    const sec = SECTIONS[key];
    title = sec.title;
    body = sec.html();
    if (key === 'eyes') canNext = !!db.settings.consent;
    if (key === 'glasses') { canNext = !!db.settings.lensConfirmed; nextLabel = db.settings.lensCalibrated || !canNext ? 'Next' : 'Skip the black test for now'; }
  }
  el.innerHTML = `
    <div class="wizard">
      <div class="brand wiz-brand"><svg class="glyph" viewBox="0 0 56 32" aria-hidden="true"><circle cx="14" cy="16" r="10" fill="none" stroke="var(--eyeL)" stroke-width="3"/><circle cx="14" cy="16" r="3.5" fill="var(--eyeL)"/><circle cx="42" cy="16" r="10" fill="none" stroke="var(--eyeR)" stroke-width="2" stroke-dasharray="3 3"/></svg><span class="bname"><b>Amblyopia Training Lab</b><span>Home vision training</span></span></div>
      ${dots}
      <header class="view-head"><div class="vh"><p class="eyebrow">Step ${wizStep + 1} of ${WIZ.length}</p><h1>${title}</h1></div></header>
      <section class="card" data-sec="${key}">${body}</section>
      ${key === 'done' ? '' : `<div class="wizard-nav">
        ${wizStep > 0 ? `<button class="btn" id="wback">${ICON.arrowLeft}<span>Back</span></button>` : '<span></span>'}
        <button class="btn primary big" id="wnext" ${canNext ? '' : 'disabled'}><span>${nextLabel}</span>${ICON.arrowRight}</button>
      </div>`}
      ${key === 'eyes' && !canNext ? '<p class="muted small">Tick the box above to continue.</p>' : ''}
      ${key === 'glasses' && !canNext ? '<p class="muted small">Choose the colour over each eye, or confirm it, to continue.</p>' : ''}
    </div>`;
  if (SECTIONS[key]) SECTIONS[key].wire(el.querySelector('[data-sec]'), refresh);
  const back = el.querySelector('#wback'), next = el.querySelector('#wnext');
  if (back) back.onclick = () => { wizStep--; refresh(); window.scrollTo(0, 0); };
  if (next) next.onclick = () => {
    if (SECTIONS[key] && SECTIONS[key].beforeNext) SECTIONS[key].beforeNext(el);
    db.settings.setupDone = setupDone(); save();
    wizStep = Math.min(WIZ.length - 1, wizStep + 1); refresh(); window.scrollTo(0, 0);
  };
}
