// OKN Stripes (approved design): full-screen stripes drift in one direction, and the eyes follow one, then flick
// back to catch the next (the optokinetic reflex). Optional centre dot to practise holding still, and an optional
// star that rides in with the stripes to tap. With colour glasses the stripes alternate between the two lens
// colours (each eye sees every other stripe), or go to one eye only.
import { db, save, fellowEye } from '../store.js';
import { lens, rgbCss } from '../lens.js';
import { ICON } from '../icons.js';
import { esc } from '../util.js';

const ID = 'okn-stripes';
const LEVELS = {
  easy: { label: 'Easy', width: 120, speed: 100 },
  medium: { label: 'Medium', width: 80, speed: 200 },
  hard: { label: 'Hard', width: 50, speed: 350 },
  extreme: { label: 'Extreme', width: 30, speed: 500 },
};
const NEXT = { easy: 'medium', medium: 'hard', hard: 'extreme' };
const DIRS = [['left', '←', 'Left'], ['right', '→', 'Right'], ['up', '↑', 'Up'], ['down', '↓', 'Down'], ['switch', '⇄', 'Switch']];
const DURS = [[30, '30 s'], [60, '1 min'], [120, '2 min'], [180, '3 min']];
const SWITCH_EVERY = 10;
const DEF = { level: 'easy', width: 120, speed: 100, dir: 'left', dot: true, star: true, who: 'both', dur: 60 };
const speedWord = v => (v < 150 ? 'Slow' : v < 300 ? 'Medium' : v < 450 ? 'Fast' : 'Very fast');
const fmtDur = s => (s < 60 ? `${Math.round(s)} sec` : `${Math.floor(s / 60)} min${s % 60 >= 1 ? ` ${Math.round(s % 60)} sec` : ''}`);
const VEL = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };

export function oknStripesOpts() {
  const o = { ...DEF, ...((db.state.opts || {})[ID] || {}) };
  for (const k of ['width', 'speed', 'dur']) o[k] = +o[k];
  return o;
}
function saveOpts(o) { db.state.opts = db.state.opts || {}; db.state.opts[ID] = o; save(); }
const levelName = o => (LEVELS[o.level] ? LEVELS[o.level].label : 'Custom');

// Which eye sees stripe number k: 'none' with a patch; alternating eyes, or one eye only, with glasses.
const stripeEye = (o, glasses, k) => (!glasses ? 'none' : o.who === 'both' ? (((k % 2) + 2) % 2 ? 'right' : 'left') : o.who);

// Draw the moving stripes. fillFor(k) returns the context and colour for stripe k (or null to skip it).
function drawStripes(w, h, o, offset, dir, fillFor) {
  const p = o.width * 2, horiz = dir === 'left' || dir === 'right', len = horiz ? w : h;
  const sgn = dir === 'right' || dir === 'down' ? 1 : -1;
  const o0 = ((sgn * offset) % p + p) % p, k0 = Math.floor((sgn * offset) / p);
  for (let i = Math.floor(-o0 / p) - 1; i * p + o0 < len + p; i++) {
    const f = fillFor(i - k0); if (!f) continue;
    const a = i * p + o0;
    f.c.fillStyle = f.fill;
    if (horiz) f.c.fillRect(a, 0, o.width, h); else f.c.fillRect(0, a, w, o.width);
  }
}
function drawDot(c, x, y) { c.fillStyle = '#000'; c.beginPath(); c.arc(x, y, 11, 0, Math.PI * 2); c.fill(); c.fillStyle = '#fff'; c.beginPath(); c.arc(x, y, 6, 0, Math.PI * 2); c.fill(); }
function drawStar(c, x, y, r, fill) {
  c.fillStyle = fill; c.strokeStyle = '#000'; c.lineWidth = 3; c.lineJoin = 'round'; c.beginPath();
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r; c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
  c.closePath(); c.fill(); c.stroke();
}

export function oknStripes() {
  let env, o, W = 0, H = 0, off = 0, dir = 'left', lastSwitch = 0, tipUntil = 0;
  let star = null, nextStar = 0, shown = 0, hits = 0, fx = [];
  const glasses = () => env.mode === 'anaglyph';

  function spawnStar() {
    const [vx, vy] = VEL[dir], r = Math.max(14, Math.min(30, o.width * 0.35));
    star = {
      r,
      x: vx ? (vx > 0 ? -r : W + r) : W * (0.2 + Math.random() * 0.6),
      y: vy ? (vy > 0 ? -r : H + r) : H * (0.2 + Math.random() * 0.6),
    };
    shown++;
  }
  const scoreLine = () => { if (o.star) env.setCorner(`Stars ${hits} of ${shown - (star ? 1 : 0)}`); };

  return {
    id: ID, title: 'OKN Stripes', mode: 'anaglyph', modes: ['mono', 'anaglyph'], hud: 'minimal', pills: true,
    how: 'Let your eyes follow the drifting stripes, and tap the star when it rides past.',
    countHint: () => `Let your eyes follow the stripes${oknStripesOpts().star ? ', and tap the star when you see it' : ''}`,

    // ---------- the approved settings page ----------
    renderSetup(el, api) {
      let pv = { raf: 0, off: 0, last: 0, t: 0 };
      const draw = () => {
        const so = oknStripesOpts(), gl = api.mode === 'anaglyph', L = lens('left'), R = lens('right'), weak = db.settings.amblyopicEye;
        el.innerHTML = `
          <div class="ejs">
            <div class="ejs-top">
              <button class="ejs-back" data-x="back">${ICON.arrowLeft}<span>Back</span></button>
              <h1>OKN Stripes</h1>
              <button class="ejs-help" data-x="help" aria-expanded="false">How it helps</button>
            </div>
            <div class="ejs-helpbox" hidden>
              <p><b>What you do:</b> stripes drift across the screen. Let your eyes follow them naturally: they'll glide with a stripe, then flick back to catch the next one.${so.star ? ' Now and then a star rides in with the stripes. Tap it before it slides away.' : ''}</p>
              <p><b>What it trains:</b> this follow-and-flick-back pattern is the optokinetic reflex (OKN). Moving stripes are a classic eye-care tool that exercises smooth following and quick re-fixation together.</p>
              <p><b>With colour glasses:</b> the stripes alternate between your two lens colours, so each eye sees every other stripe and both eyes keep working. You can also show the stripes to one eye only.</p>
              <p><b>Centre dot:</b> with the dot on, you can practise keeping your eyes still while the stripes move behind it (harder than it sounds).</p>
            </div>
            <p class="ejs-warn">Moving stripes can make some people dizzy or queasy. Start short and slow, and stop straight away if you feel unwell.</p>
            <div class="ejs-chips" role="radiogroup" aria-label="How to play">
              ${api.modes.map(m => `<button class="ejs-chip" data-mode="${m}" aria-pressed="${api.mode === m}">${m === 'anaglyph' ? `${ICON.glasses}<span>Colour glasses</span>` : `${ICON.patch}<span>Eye patch</span>`}</button>`).join('')}
            </div>
            <p class="ejs-note">${gl
              ? `Glasses: <b><i class="sw" style="background:${rgbCss(L.rgb)}"></i>${esc(L.name)}</b> left · <b><i class="sw" style="background:${rgbCss(R.rgb)}"></i>${esc(R.name)}</b> right · <button class="ejs-link" data-x="lens">Change</button>`
              : `Patch over your <b>${fellowEye()}</b> (stronger) eye.`}</p>
            <div class="ejs-preview em" aria-label="Preview at real size and speed"><span class="cap okn-cap">Preview · real size and speed</span><canvas></canvas></div>
            <section class="ejs-sect"><div class="ejs-lab">Level</div>
              <div class="ejs-chips">${Object.entries(LEVELS).map(([k, v]) => `<button class="ejs-chip" data-level="${k}" aria-pressed="${so.level === k}">${v.label}</button>`).join('')}<button class="ejs-chip" data-level="custom" aria-pressed="${so.level === 'custom'}">Custom</button></div>
              <p class="ejs-hint" style="text-align:left">${so.level === 'custom' ? 'Your own mix of the settings below.' : `${levelName(so)}: ${so.width} px stripes at ${so.speed} px/s. Change anything below to make your own.`}</p></section>
            <section class="ejs-sect"><div class="ejs-lab">Direction</div>
              <div class="ejs-chips">${DIRS.map(([k, a, l]) => `<button class="ejs-chip" data-dir="${k}" aria-pressed="${so.dir === k}"><span style="font-size:1.25rem" aria-hidden="true">${a}</span><span>${l}</span></button>`).join('')}</div>
              ${so.dir === 'switch' ? `<p class="ejs-hint" style="text-align:left">Changes between left and right every ${SWITCH_EVERY} seconds.</p>` : ''}</section>
            <section class="ejs-sect"><div class="ejs-lab"><span>Stripe width</span><output data-out="width">${so.width} px</output></div>
              <div class="ejs-slider"><span class="end txt">Thin</span><input type="range" data-range="width" min="10" max="200" step="2" value="${so.width}" aria-label="Stripe width"><span class="end txt">Wide</span></div></section>
            <section class="ejs-sect"><div class="ejs-lab"><span>Speed</span><output data-out="speed">${speedWord(so.speed)} · ${so.speed} px/s</output></div>
              <div class="ejs-slider"><span class="end txt">Slow</span><input type="range" data-range="speed" min="30" max="700" step="10" value="${so.speed}" aria-label="Speed"><span class="end txt">Fast</span></div></section>
            <section class="ejs-sect" ${gl ? '' : 'hidden'}><div class="ejs-lab">Stripes seen by</div>
              <div class="ejs-chips">
                <button class="ejs-chip" data-who="both" aria-pressed="${so.who === 'both'}">Both eyes, alternating</button>
                <button class="ejs-chip" data-who="left" aria-pressed="${so.who === 'left'}">Left eye only${weak === 'left' ? ' (weaker)' : ''}</button>
                <button class="ejs-chip" data-who="right" aria-pressed="${so.who === 'right'}">Right eye only${weak === 'right' ? ' (weaker)' : ''}</button>
              </div></section>
            <section class="ejs-sect"><div class="ejs-lab">Extras</div>
              <div class="ejs-chips"><button class="ejs-chip" data-toggle="dot" aria-pressed="${so.dot}">Centre dot</button><button class="ejs-chip" data-toggle="star" aria-pressed="${so.star}">Tap the star</button></div></section>
            <section class="ejs-sect"><div class="ejs-lab">How long</div>
              <div class="ejs-dur">${DURS.map(([v, l]) => `<button data-dur="${v}" aria-pressed="${so.dur === v}"><span class="dot"></span>${l}</button>`).join('')}</div></section>
            <div class="ejs-startbar">
              <button class="ejs-start" data-x="start">${ICON.play}<span>Start</span></button>
              <p class="ejs-hint">Let your eyes follow the stripes${so.star ? ' · tap the star' : ''} · <b>Space</b> pauses · <b>Back</b> finishes</p>
            </div>
          </div>`;
        sizePreview();
      };
      const sizePreview = () => {
        const box = el.querySelector('.ejs-preview'), cv = box.querySelector('canvas');
        const dpr = Math.min(window.devicePixelRatio || 1, 2), w = Math.max(200, box.clientWidth - 2), h = 170;
        cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.width = w + 'px'; cv.style.height = h + 'px';
      };
      const tick = t => {
        if (!el.isConnected) { pv.raf = 0; return; }
        const cv = el.querySelector('.ejs-preview canvas'); if (!cv) { pv.raf = requestAnimationFrame(tick); return; }
        const so = oknStripesOpts(), gl = api.mode === 'anaglyph';
        const dpr = cv.width / parseFloat(cv.style.width), w = cv.width / dpr, h = cv.height / dpr;
        const dt = Math.min(0.1, (t - (pv.last || t)) / 1000); pv.last = t; pv.t += dt; pv.off += so.speed * dt;
        const d = so.dir === 'switch' ? ['left', 'right'][Math.floor(pv.t / 3) % 2] : so.dir;
        const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
        c.fillStyle = '#000'; c.fillRect(0, 0, w, h);
        drawStripes(w, h, so, pv.off, d, k => { const eye = stripeEye(so, gl, k); return { c, fill: eye === 'none' ? '#f2f2f2' : rgbCss(lens(eye).rgb) }; });
        if (so.dot) drawDot(c, w / 2, h / 2);
        pv.raf = requestAnimationFrame(tick);
      };
      const set = (patch, focusSel) => { saveOpts({ ...oknStripesOpts(), ...patch }); draw(); if (focusSel) { const n = el.querySelector(focusSel); if (n) n.focus(); } };
      el.onclick = e => {
        const b = e.target.closest('button'); if (!b) return;
        const d = b.dataset;
        if (d.x === 'back') { cancelAnimationFrame(pv.raf); api.close(); }
        else if (d.x === 'lens') { cancelAnimationFrame(pv.raf); api.close('#setup-glasses'); }
        else if (d.x === 'help') { const hb = el.querySelector('.ejs-helpbox'); hb.hidden = !hb.hidden; b.setAttribute('aria-expanded', String(!hb.hidden)); }
        else if (d.x === 'start') { cancelAnimationFrame(pv.raf); api.start(oknStripesOpts().dur / 60); }
        else if (d.mode) { api.setMode(d.mode); draw(); el.querySelector(`[data-mode="${d.mode}"]`).focus(); }
        else if (d.level) { const lv = LEVELS[d.level]; set(lv ? { level: d.level, width: lv.width, speed: lv.speed } : { level: 'custom' }, `[data-level="${d.level}"]`); }
        else if (d.dir) set({ dir: d.dir }, `[data-dir="${d.dir}"]`);
        else if (d.who) set({ who: d.who }, `[data-who="${d.who}"]`);
        else if (d.toggle) set({ [d.toggle]: !oknStripesOpts()[d.toggle] }, `[data-toggle="${d.toggle}"]`);
        else if (d.dur) set({ dur: +d.dur }, `[data-dur="${d.dur}"]`);
      };
      el.oninput = e => {
        const r = e.target.closest('[data-range]'); if (!r) return;
        const so = oknStripesOpts(), k = r.dataset.range, v = +r.value;
        so[k] = v; so.level = 'custom';
        el.querySelectorAll('[data-level]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.level === 'custom')));
        el.querySelector(`[data-out="${k}"]`).textContent = k === 'speed' ? `${speedWord(v)} · ${v} px/s` : `${v} px`;
        saveOpts(so);
      };
      el.onchange = e => {
        const r = e.target.closest('[data-range]'); if (!r) return;
        draw(); const n = el.querySelector(`[data-range="${r.dataset.range}"]`); if (n) n.focus();
      };
      draw();
      pv.raf = requestAnimationFrame(tick);
      el.querySelector('[data-x="start"]').focus({ preventScroll: true });
    },

    // ---------- play ----------
    init(e) {
      env = e; o = oknStripesOpts(); W = env.w; H = env.h;
      off = 0; dir = o.dir === 'switch' ? 'left' : o.dir; lastSwitch = 0; tipUntil = 0;
      star = null; nextStar = 3 + Math.random() * 2; shown = 0; hits = 0; fx = [];
      env.setTip(''); scoreLine();
      if (/[?&]test\b/.test(location.search)) window.__okn = () => ({ star, elapsed: env.elapsed, dir, off }); // automated checks only
    },
    onResize(w, h) { W = w; H = h; },
    update(dt) {
      const t = env.elapsed;
      off += o.speed * dt;
      if (tipUntil && t > tipUntil) { env.setTip(''); tipUntil = 0; }
      if (o.dir === 'switch' && t - lastSwitch >= SWITCH_EVERY) {
        dir = dir === 'left' ? 'right' : 'left'; lastSwitch = t;
        if (star) { star = null; shown--; nextStar = t + 1.5; }
        env.setTip('Direction changed'); tipUntil = t + 1.2;
      }
      if (o.star) {
        if (!star && t >= nextStar) spawnStar();
        if (star) {
          const [vx, vy] = VEL[dir];
          star.x += vx * o.speed * dt; star.y += vy * o.speed * dt;
          if (star.x < -60 || star.x > W + 60 || star.y < -60 || star.y > H + 60) { star = null; nextStar = t + 2 + Math.random() * 4; }
        }
        scoreLine();
      }
      fx = fx.filter(f => t - f.t0 < 0.4);
    },
    draw(a, f) {
      const gl = glasses(), amb = db.settings.amblyopicEye;
      // Stripes: with a patch everything goes to the weaker eye's layer; with glasses each stripe goes to its eye's layer.
      drawStripes(W, H, o, off, dir, k => { const eye = stripeEye(o, gl, k); return { c: eye === 'none' || eye === amb ? a : f, fill: '#fff' }; });
      // The dot, the star and the tap ripples are seen by both eyes.
      for (const c of gl ? [a, f] : [a]) {
        if (o.dot) drawDot(c, W / 2, H / 2);
        if (star) drawStar(c, star.x, star.y, star.r, gl ? '#fff' : '#8a8a8a');
        for (const r of fx) { const k = (env.elapsed - r.t0) / 0.4; c.strokeStyle = `rgba(255,255,255,${1 - k})`; c.lineWidth = 4; c.beginPath(); c.arc(r.x, r.y, 20 + 30 * k, 0, Math.PI * 2); c.stroke(); }
      }
    },
    params() { return { bgA: 0, bgF: 0 }; },
    onPointer(x, y, type) {
      if (type !== 'pointerdown' || !star) return;
      if (Math.hypot(x - star.x, y - star.y) <= star.r * 1.6) {
        hits++; fx.push({ x: star.x, y: star.y, t0: env.elapsed }); env.sfx.good();
        star = null; nextStar = env.elapsed + 2 + Math.random() * 4; scoreLine();
      }
    },
    onKey() { return false; },
    result() {
      env.setTip(''); env.setCorner('');
      const secs = Math.min(env.elapsed, o.dur), done = env.elapsed >= o.dur - 0.5, missed = shown - (star ? 1 : 0);
      const L = lens('left'), R = lens('right'), gl = glasses();
      const summary = [['Time', fmtDur(secs)], ['Level', `${levelName(o)} · ${o.width} px · ${o.speed} px/s`], ['Direction', DIRS.find(d => d[0] === o.dir)[2]]];
      if (gl) summary.push(['Stripes seen by', o.who === 'both' ? `Both eyes (${esc(L.name)} and ${esc(R.name)})` : `${o.who === 'left' ? 'Left' : 'Right'} eye only`]);
      if (o.star) summary.push(['Stars tapped', `${hits} of ${missed}`]);
      const harder = o.level === 'extreme' || o.level === 'custom' ? 'a faster speed or thinner stripes' : LEVELS[NEXT[o.level]].label;
      return {
        complete: done, trials: o.star ? missed : 0, correct: o.star ? hits : 0, threshold: null, unit: null, score: null,
        headline: 'Well done', summary,
        extra: { level: o.level, width: o.width, speed: o.speed, dir: o.dir, who: gl ? o.who : null, dot: o.dot, star: o.star, secs: Math.round(secs) },
        ask: {
          q: 'How did the moving stripes feel?',
          options: [
            ['fine', 'Comfortable', `Good. Next time try ${harder}.`],
            ['bit', 'A bit dizzy', 'Stay at this level, or try a shorter time. Take a short break before the next activity.'],
            ['sick', 'Dizzy or sick', 'Stop for today and rest your eyes. Next time choose Easy and 30 seconds. If it keeps happening, mention it to your eye-care professional.'],
          ],
        },
      };
    },
  };
}
