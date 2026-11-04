// Precision (approved design): a ringed target appears; tap its exact centre. 10 points for the middle, then 8, 6, 4, 2,
// and nothing outside. The next target appears straight away. Targets can stand still or move slowly.
// With colour glasses each target is in one lens colour, so the summary compares how precise each eye is.
import { db, save, fellowEye } from '../store.js';
import { lens, rgbCss } from '../lens.js';
import { ICON } from '../icons.js';
import { esc } from '../util.js';

const ID = 'precision';
const LEVELS = {
  easy: { label: 'Easy', size: 120, move: false, speed: 60 },
  medium: { label: 'Medium', size: 80, move: false, speed: 60 },
  hard: { label: 'Hard', size: 60, move: true, speed: 60 },
  extreme: { label: 'Extreme', size: 40, move: true, speed: 120 },
};
const NEXT = { easy: 'medium', medium: 'hard', hard: 'extreme' };
const ZONES = [[0.2, 10], [0.4, 8], [0.6, 6], [0.8, 4], [1.0, 2]]; // distance from centre (fraction of radius) -> points
const DURS = [[30, '30 sec.'], [60, '1 min.'], [120, '2 min.'], [180, '3 min.']];
const DEF = { level: 'easy', size: 120, move: false, speed: 60, dur: 60 };
const speedWord = v => (v < 50 ? 'Slow' : v < 110 ? 'Medium' : 'Fast');
const avgOf = a => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
const pointsFor = d => { for (const [k, p] of ZONES) if (d <= k) return p; return 0; };
const leanWords = (dx, dy) => { const h = Math.abs(dx) > 0.12 ? (dx < 0 ? 'left' : 'right') : '', v = Math.abs(dy) > 0.12 ? (dy < 0 ? 'high' : 'low') : ''; return [v, h].filter(Boolean).join(' and '); };

export function precisionOpts() {
  const o = { ...DEF, ...((db.state.opts || {})[ID] || {}) };
  for (const k of ['size', 'speed', 'dur']) o[k] = +o[k];
  o.move = !!o.move;
  return o;
}
function saveOpts(o) { db.state.opts = db.state.opts || {}; db.state.opts[ID] = o; save(); }
const levelName = o => (LEVELS[o.level] ? LEVELS[o.level].label : 'Custom');

// The target: thin rings with a small centre dot, all in one colour.
function drawTarget(c, x, y, size, colour) {
  const R = size / 2;
  c.strokeStyle = colour; c.lineWidth = Math.max(1.2, size / 70);
  for (let i = 1; i <= 5; i++) { c.beginPath(); c.arc(x, y, R * i / 5, 0, Math.PI * 2); c.stroke(); }
  c.fillStyle = colour; c.beginPath(); c.arc(x, y, Math.max(2, R * 0.06), 0, Math.PI * 2); c.fill();
}
// Tap map: every tap drawn on a target, relative to its centre, in the colour of the eye that saw it.
function tapMap(taps, glasses) {
  const R = 54, cx = 60, cy = 60;
  let rings = ''; for (let i = 1; i <= 5; i++) rings += `<circle cx="${cx}" cy="${cy}" r="${(R * i / 5).toFixed(1)}" fill="${i === 1 ? '#dff0e6' : 'none'}" stroke="#b7c6c3" stroke-width="1"/>`;
  const col = eye => (eye === 'none' ? '#17292c' : rgbCss(lens(eye).rgb));
  const dots = taps.map(tp => { const k = Math.min(1.08, tp.d) / Math.max(tp.d, 1e-6); return `<circle cx="${(cx + tp.dx * k * R).toFixed(1)}" cy="${(cy + tp.dy * k * R).toFixed(1)}" r="2.6" fill="${col(tp.eye)}" fill-opacity=".8"/>`; }).join('');
  return `<div class="fovmap"><svg viewBox="0 0 120 120" role="img" aria-label="Where your taps landed">${rings}<circle cx="${cx}" cy="${cy}" r="2" fill="#17292c"/>${dots}</svg>
    <div class="fovlegend"><b>Your taps</b>${glasses ? `<span><i style="background:${col('left')};border-radius:50%"></i>left eye (${esc(lens('left').name)})</span><span><i style="background:${col('right')};border-radius:50%"></i>right eye (${esc(lens('right').name)})</span>` : ''}<span><i style="background:#dff0e6;border:1px solid #b7c6c3"></i>middle = 10 points</span></div></div>`;
}

export function precision() {
  let env, o, W = 0, H = 0, lastT = 0, tgt = null, score = 0, taps = [], fx = [], eyeTurn = 0, streak = 0, bestStreak = 0;
  const glasses = () => env.mode === 'anaglyph';
  const area = () => ({ x0: 30, y0: 60, x1: W - 30, y1: H - 90 }); // clear of the score (top left) and Back (bottom right)
  function clampTarget() { const a = area(), R = o.size / 2; tgt.x = Math.max(a.x0 + R, Math.min(a.x1 - R, tgt.x)); tgt.y = Math.max(a.y0 + R, Math.min(a.y1 - R, tgt.y)); }
  function newTarget() {
    const a = area(), R = o.size / 2, prev = tgt;
    let x, y, k = 0;
    do { x = a.x0 + R + Math.random() * Math.max(1, a.x1 - a.x0 - 2 * R); y = a.y0 + R + Math.random() * Math.max(1, a.y1 - a.y0 - 2 * R); k++; }
    while (prev && k < 30 && Math.hypot(x - prev.x, y - prev.y) < Math.min(W, H) * 0.25); // jump somewhere new
    const ang = Math.random() * Math.PI * 2;
    tgt = { x, y, vx: Math.cos(ang) * o.speed, vy: Math.sin(ang) * o.speed, eye: glasses() ? ['left', 'right'][eyeTurn++ % 2] : 'none', t0: env.elapsed };
  }
  const corner = () => env.setCorner(`${score} points · ${taps.length} taps`);

  return {
    id: ID, title: 'Precision', mode: 'anaglyph', modes: ['mono', 'anaglyph'], hud: 'minimal',
    how: 'Tap the exact centre of each target. The closer you are, the more points.',
    countHint: () => 'Tap the exact centre of each target',

    // ---------- the approved settings page ----------
    renderSetup(el, api) {
      let pv = { raf: 0, last: 0, t: 0, x: 0, y: 0, vx: 0, vy: 0, eye: 'left', tap: null, init: false };
      const draw = () => {
        const so = precisionOpts(), gl = api.mode === 'anaglyph', L = lens('left'), R = lens('right');
        el.innerHTML = `
          <div class="ejs">
            <div class="ejs-top">
              <button class="ejs-back" data-x="back">${ICON.arrowLeft}<span>Back</span></button>
              <h1>Precision</h1>
              <button class="ejs-help" data-x="help" aria-expanded="false">How it helps</button>
            </div>
            <div class="ejs-helpbox" hidden>
              <p><b>What you do:</b> a target with rings appears. Tap its exact centre. The closer you are, the more points: 10 for the middle, then 8, 6, 4 and 2 for the outer rings. Tapping outside the target scores nothing. Either way, the next target appears straight away.</p>
              <p><b>What it trains:</b> precise eye-hand coordination: seeing exactly where something is and putting your finger right there. ${so.move ? 'With moving targets you also have to follow them while you aim.' : 'Turn on moving targets to add following while you aim.'}</p>
              <p><b>With colour glasses</b> each target is drawn in one lens colour, so only one eye sees it. The summary compares how precise each eye is.</p>
              <p><b>The tap map at the end</b> shows where all your taps landed. If they lean one way (for example always a little to the left), the summary tells you.</p>
            </div>
            <div class="ejs-chips" role="radiogroup" aria-label="How to play">
              ${api.modes.map(m => `<button class="ejs-chip" data-mode="${m}" aria-pressed="${api.mode === m}">${m === 'anaglyph' ? `${ICON.glasses}<span>Colour glasses</span>` : `${ICON.patch}<span>Eye patch</span>`}</button>`).join('')}
            </div>
            <p class="ejs-note">${gl
              ? `Glasses: <b><i class="sw" style="background:${rgbCss(L.rgb)}"></i>${esc(L.name)}</b> left · <b><i class="sw" style="background:${rgbCss(R.rgb)}"></i>${esc(R.name)}</b> right · <button class="ejs-link" data-x="lens">Change</button>`
              : `Patch over your <b>${fellowEye()}</b> (stronger) eye.`}</p>
            <div class="ejs-preview em" aria-label="Preview at real size${so.move ? ' and speed' : ''}"><span class="cap">Preview · real size${so.move ? ' and speed' : ''}</span><canvas></canvas></div>
            <section class="ejs-sect"><div class="ejs-lab">Level</div>
              <div class="ejs-chips">${Object.entries(LEVELS).map(([k, v]) => `<button class="ejs-chip" data-level="${k}" aria-pressed="${so.level === k}">${v.label}</button>`).join('')}<button class="ejs-chip" data-level="custom" aria-pressed="${so.level === 'custom'}">Custom</button></div>
              <p class="ejs-hint" style="text-align:left">${so.level === 'custom' ? 'Your own mix of the settings below.' : `${levelName(so)}: ${so.size} px targets${so.move ? `, moving at ${so.speed} px/s` : ', standing still'}. Change anything below to make your own.`}</p></section>
            <section class="ejs-sect"><div class="ejs-lab"><span>Target size</span><output data-out="size">${so.size} px</output></div>
              <div class="ejs-slider"><span class="end txt">Small</span><input type="range" data-range="size" min="24" max="160" step="2" value="${so.size}" aria-label="Target size"><span class="end txt">Big</span></div></section>
            <section class="ejs-sect"><div class="ejs-lab">Targets</div>
              <div class="ejs-chips"><button class="ejs-chip" data-move="still" aria-pressed="${!so.move}">Stand still</button><button class="ejs-chip" data-move="moving" aria-pressed="${so.move}">Move slowly</button></div></section>
            <section class="ejs-sect" ${so.move ? '' : 'hidden'}><div class="ejs-lab"><span>Speed</span><output data-out="speed">${speedWord(so.speed)} · ${so.speed} px/s</output></div>
              <div class="ejs-slider"><span class="end txt">Slow</span><input type="range" data-range="speed" min="20" max="200" step="10" value="${so.speed}" aria-label="Speed"><span class="end txt">Fast</span></div></section>
            <section class="ejs-sect"><div class="ejs-lab">How long</div>
              <div class="ejs-dur">${DURS.map(([v, l]) => `<button data-dur="${v}" aria-pressed="${so.dur === v}"><span class="dot"></span>${l}</button>`).join('')}</div></section>
            <div class="ejs-startbar">
              <button class="ejs-start" data-x="start">${ICON.play}<span>Start</span></button>
              <p class="ejs-hint">Tap the exact centre · <b>Space</b> pauses · <b>Back</b> finishes</p>
            </div>
          </div>`;
        sizePreview();
      };
      const sizePreview = () => {
        const so = precisionOpts(), box = el.querySelector('.ejs-preview'), cv = box.querySelector('canvas'), dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = Math.max(200, box.clientWidth - 2), h = Math.max(170, so.size + 60);
        cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.width = w + 'px'; cv.style.height = h + 'px';
        box.style.minHeight = h + 'px'; pv.init = false;
      };
      // A target at real size; every 1.4 s a pretend tap lands near the centre and the target moves on.
      const tick = t => {
        if (!el.isConnected) { pv.raf = 0; return; }
        const cv = el.querySelector('.ejs-preview canvas'); if (!cv) { pv.raf = requestAnimationFrame(tick); return; }
        const so = precisionOpts(), gl = api.mode === 'anaglyph';
        const dpr = cv.width / parseFloat(cv.style.width), w = cv.width / dpr, h = cv.height / dpr, R = so.size / 2;
        const dt = Math.min(0.1, (t - (pv.last || t)) / 1000); pv.last = t; pv.t += dt;
        const place = () => { pv.x = R + 6 + Math.random() * Math.max(1, w - 2 * R - 12); pv.y = R + 22 + Math.random() * Math.max(1, h - 2 * R - 28); const a = Math.random() * Math.PI * 2; pv.vx = Math.cos(a) * so.speed; pv.vy = Math.sin(a) * so.speed; pv.eye = gl ? (pv.eye === 'left' ? 'right' : 'left') : 'none'; pv.t = 0; };
        if (!pv.init) { place(); pv.init = true; }
        if (so.move) {
          pv.x += pv.vx * dt; pv.y += pv.vy * dt;
          if (pv.x < R + 4 || pv.x > w - R - 4) { pv.vx = -pv.vx; pv.x = Math.max(R + 4, Math.min(w - R - 4, pv.x)); }
          if (pv.y < R + 20 || pv.y > h - R - 4) { pv.vy = -pv.vy; pv.y = Math.max(R + 20, Math.min(h - R - 4, pv.y)); }
        }
        if (pv.t > 1.4) { const a = Math.random() * Math.PI * 2, d = Math.random() * R * 0.35; pv.tap = { x: pv.x + Math.cos(a) * d, y: pv.y + Math.sin(a) * d, t0: t }; place(); }
        const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
        drawTarget(c, pv.x, pv.y, so.size, pv.eye === 'none' ? 'rgb(235,235,235)' : rgbCss(lens(pv.eye).rgb));
        if (pv.tap) { const k = (t - pv.tap.t0) / 500; if (k < 1) { c.fillStyle = `rgba(255,255,255,${1 - k})`; c.beginPath(); c.arc(pv.tap.x, pv.tap.y, 4, 0, Math.PI * 2); c.fill(); } }
        pv.raf = requestAnimationFrame(tick);
      };
      const set = (patch, focusSel) => { saveOpts({ ...precisionOpts(), ...patch }); draw(); if (focusSel) { const nn = el.querySelector(focusSel); if (nn) nn.focus(); } };
      el.onclick = e => {
        const b = e.target.closest('button'); if (!b) return;
        const d = b.dataset;
        if (d.x === 'back') { cancelAnimationFrame(pv.raf); api.close(); }
        else if (d.x === 'lens') { cancelAnimationFrame(pv.raf); api.close('#setup-glasses'); }
        else if (d.x === 'help') { const hb = el.querySelector('.ejs-helpbox'); hb.hidden = !hb.hidden; b.setAttribute('aria-expanded', String(!hb.hidden)); }
        else if (d.x === 'start') { cancelAnimationFrame(pv.raf); api.start(precisionOpts().dur / 60); }
        else if (d.mode) { api.setMode(d.mode); draw(); el.querySelector(`[data-mode="${d.mode}"]`).focus(); }
        else if (d.level) { const lv = LEVELS[d.level]; set(lv ? { level: d.level, size: lv.size, move: lv.move, speed: lv.speed } : { level: 'custom' }, `[data-level="${d.level}"]`); }
        else if (d.move) set({ move: d.move === 'moving', level: 'custom' }, `[data-move="${d.move}"]`);
        else if (d.dur) set({ dur: +d.dur }, `[data-dur="${d.dur}"]`);
      };
      el.oninput = e => {
        const r = e.target.closest('[data-range]'); if (!r) return;
        const so = precisionOpts(), k = r.dataset.range, v = +r.value;
        so[k] = v; so.level = 'custom';
        el.querySelectorAll('[data-level]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.level === 'custom')));
        el.querySelector(`[data-out="${k}"]`).textContent = k === 'speed' ? `${speedWord(v)} · ${v} px/s` : `${v} px`;
        saveOpts(so);
        if (k === 'size') sizePreview();
      };
      el.onchange = e => { const r = e.target.closest('[data-range]'); if (!r) return; draw(); const nn = el.querySelector(`[data-range="${r.dataset.range}"]`); if (nn) nn.focus(); };
      draw();
      pv.raf = requestAnimationFrame(tick);
      el.querySelector('[data-x="start"]').focus({ preventScroll: true });
    },

    // ---------- play ----------
    init(e) {
      env = e; o = precisionOpts(); W = env.w; H = env.h;
      lastT = env.elapsed; score = 0; taps = []; fx = []; eyeTurn = Math.floor(Math.random() * 2); streak = 0; bestStreak = 0; tgt = null;
      newTarget(); corner();
      if (/[?&]test\b/.test(location.search)) window.__pr = () => ({ tgt: tgt && { x: tgt.x, y: tgt.y, eye: tgt.eye }, score, taps: taps.length }); // automated checks only
    },
    onResize(w, h) { W = w; H = h; if (tgt) clampTarget(); },
    update() {
      const dt = Math.min(0.25, env.elapsed - lastT); lastT = env.elapsed; // real time, so the speed holds even if a frame is slow
      if (tgt && o.move) {
        const a = area(), R = o.size / 2;
        tgt.x += tgt.vx * dt; tgt.y += tgt.vy * dt;
        if (tgt.x < a.x0 + R || tgt.x > a.x1 - R) { tgt.vx = -tgt.vx; clampTarget(); }
        if (tgt.y < a.y0 + R || tgt.y > a.y1 - R) { tgt.vy = -tgt.vy; clampTarget(); }
      }
      if (fx.length) fx = fx.filter(f => env.elapsed - f.t0 < 0.7);
    },
    draw(a, f) {
      const amb = db.settings.amblyopicEye, gl = glasses();
      if (tgt) drawTarget(tgt.eye === 'none' || tgt.eye === amb ? a : f, tgt.x, tgt.y, o.size, tgt.eye === 'none' ? 'rgb(235,235,235)' : '#fff');
      for (const c of gl ? [a, f] : [a]) for (const fl of fx) {
        const k = (env.elapsed - fl.t0) / 0.7;
        c.globalAlpha = 1 - k; c.fillStyle = '#fff';
        c.beginPath(); c.arc(fl.x, fl.y, 4, 0, Math.PI * 2); c.fill();
        c.font = '700 20px "Atkinson Hyperlegible", Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'bottom';
        c.fillText(fl.p ? `+${fl.p}` : 'miss', fl.x, fl.y - 10 - 18 * k);
        c.globalAlpha = 1;
      }
    },
    params() { return { bgA: 0, bgF: 0 }; },
    onPointer(x, y, type) {
      if (type !== 'pointerdown' || !tgt) return;
      const R = o.size / 2, dx = (x - tgt.x) / R, dy = (y - tgt.y) / R, d = Math.hypot(dx, dy), p = pointsFor(d);
      score += p; taps.push({ dx, dy, d, p, eye: tgt.eye, px: d * R });
      if (p === 10) { streak++; bestStreak = Math.max(bestStreak, streak); } else streak = 0;
      fx.push({ x, y, p, t0: env.elapsed });
      if (p >= 8) env.sfx.good(); else if (p > 0) env.sfx.tick(); else env.sfx.bad();
      newTarget(); corner(); // straight to the next one
    },
    onKey() { return false; },
    result() {
      env.setCorner('');
      const n = taps.length;
      if (!n) return null;
      const gl = glasses(), L = lens('left'), R = lens('right');
      const hitsOnly = taps.filter(t => t.p > 0), avgPts = score / n, avgPx = avgOf(hitsOnly.map(t => t.px));
      const bulls = taps.filter(t => t.p === 10).length, misses = n - hitsOnly.length;
      const lean = hitsOnly.length >= 5 ? leanWords(avgOf(hitsOnly.map(t => t.dx)), avgOf(hitsOnly.map(t => t.dy))) : '';
      const eyeLine = eye => { const arr = taps.filter(t => t.eye === eye); if (!arr.length) return 'none'; const pts = arr.reduce((s, t) => s + t.p, 0) / arr.length, h = arr.filter(t => t.p > 0); return `${pts.toFixed(1)} points per tap${h.length ? ` · ${avgOf(h.map(t => t.px)).toFixed(0)} px off` : ''}`; };
      const summary = [['Score', `${score} points from ${n} taps`], ['Average per tap', `${avgPts.toFixed(1)} of 10`]];
      if (avgPx != null) summary.push(['Average distance from centre', `${avgPx.toFixed(0)} px`]);
      summary.push(['Bullseyes (10 points)', `${bulls}${bestStreak > 1 ? ` · best run ${bestStreak} in a row` : ''}`], ['Missed the target', `${misses}`]);
      if (gl) summary.push([`Left eye (${esc(L.name)})`, eyeLine('left')], [`Right eye (${esc(R.name)})`, eyeLine('right')]);
      summary.push(['Level', `${levelName(o)} · ${o.size} px${o.move ? ` · moving ${o.speed} px/s` : ''}`]);
      summary.push(['Tip', lean ? `Your taps lean a little ${lean} of the centre. Try aiming slightly the other way.`
        : avgPts >= 8.5 ? (o.level === 'extreme' || o.level === 'custom' ? 'Very precise. Try smaller or faster targets.' : `Very precise. Next time try ${LEVELS[NEXT[o.level]].label}.`)
        : 'Well centred. Keep practising to raise your points per tap.']);
      return {
        complete: env.elapsed >= o.dur - 0.5, trials: n, correct: hitsOnly.length, threshold: null, unit: null, score: null,
        headline: avgPts >= 8 ? 'Very precise!' : 'Well done', summary, html: n >= 3 ? tapMap(taps, gl) : '',
        extra: { level: o.level, size: o.size, move: o.move, speed: o.speed, score, taps: n, avgPts: +avgPts.toFixed(2), avgPx, bulls, misses, lean: lean || null },
      };
    },
  };
}
