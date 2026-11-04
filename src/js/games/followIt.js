// Follow It (approved design): some planes are marked, then everything flies for the chosen time.
// When they stop, tap the ones you followed. One round per game. With colour glasses, half the planes
// are drawn for each eye, so following them all needs both eyes switched on.
import { db, save, fellowEye } from '../store.js';
import { lens, rgbCss } from '../lens.js';
import { ICON } from '../icons.js';
import { esc } from '../util.js';

const ID = 'follow-it';
const PRESET_SIZE = 60, PRESET_SPEED = 120;
const LEVELS = {
  easy: { label: 'Easy', size: PRESET_SIZE, count: 12, follow: 1, speed: PRESET_SPEED },
  medium: { label: 'Medium', size: PRESET_SIZE, count: 14, follow: 2, speed: PRESET_SPEED },
  hard: { label: 'Hard', size: PRESET_SIZE, count: 18, follow: 3, speed: PRESET_SPEED },
  extreme: { label: 'Extreme', size: PRESET_SIZE, count: 22, follow: 4, speed: PRESET_SPEED },
};
const NEXT = { easy: 'medium', medium: 'hard', hard: 'extreme' }, PREV = { medium: 'easy', hard: 'medium', extreme: 'hard' };
const FLY = [[10, '10 s'], [20, '20 s'], [30, '30 s'], [60, '1 min'], [120, '2 min']];
const DEF = { shape: 'plane', level: 'easy', size: PRESET_SIZE, count: 12, follow: 1, speed: PRESET_SPEED, fly: 20, meet: 'bounce' };
const speedWord = v => (v < 110 ? 'Slow' : v < 135 ? 'Medium' : 'Fast');
const fmtDur = s => (s < 60 ? `${Math.round(s)} sec` : `${Math.floor(s / 60)} min${s % 60 >= 1 ? ` ${Math.round(s % 60)} sec` : ''}`);
const PLANE_SVG = '<svg viewBox="-11 -11 22 22" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M10 0Q9-1.4 6-1.4L1.5-1.4-3-9-5-9-2.2-1.4-6.5-1.4-8.5-4.5-10-4.5-8.8 0-10 4.5-8.5 4.5-6.5 1.4-2.2 1.4-5 9-3 9 1.5 1.4 6 1.4Q9 1.4 10 0Z" transform="rotate(-90)"/></svg>';

export function followItOpts() {
  const o = { ...DEF, ...((db.state.opts || {})[ID] || {}) };
  for (const k of ['size', 'count', 'follow', 'speed', 'fly']) o[k] = +o[k];
  o.speed = Math.max(90, Math.min(150, o.speed));
  return o;
}
function saveOpts(o) { db.state.opts = db.state.opts || {}; db.state.opts[ID] = o; save(); }
const maxFollow = o => Math.max(1, Math.min(6, o.count - 2));
const followN = o => Math.min(o.follow, maxFollow(o));
const levelName = o => (LEVELS[o.level] ? LEVELS[o.level].label : 'Custom');

function drawObj(c, shape, x, y, heading, fill, size) {
  const r = size / 2;
  c.fillStyle = fill;
  if (shape === 'ball') { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); return; }
  c.save(); c.translate(x, y); c.rotate(heading); c.scale(r / 10, r / 10);
  c.beginPath();
  c.moveTo(10, 0); c.quadraticCurveTo(9, -1.4, 6, -1.4); c.lineTo(1.5, -1.4); c.lineTo(-3, -9); c.lineTo(-5, -9); c.lineTo(-2.2, -1.4);
  c.lineTo(-6.5, -1.4); c.lineTo(-8.5, -4.5); c.lineTo(-10, -4.5); c.lineTo(-8.8, 0); c.lineTo(-10, 4.5); c.lineTo(-8.5, 4.5); c.lineTo(-6.5, 1.4);
  c.lineTo(-2.2, 1.4); c.lineTo(-5, 9); c.lineTo(-3, 9); c.lineTo(1.5, 1.4); c.lineTo(6, 1.4); c.quadraticCurveTo(9, 1.4, 10, 0);
  c.closePath(); c.fill(); c.restore();
}
function ring(c, x, y, r, colour, width, dash) { c.strokeStyle = colour; c.lineWidth = width; if (dash) c.setLineDash(dash); c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.stroke(); if (dash) c.setLineDash([]); }

// Movement shared by the preview and the game: smoothly wandering headings (loops and curves),
// bouncing off the edges, and either bouncing off each other or passing through.
function makeObjects(n, box, size) {
  const objs = [];
  for (let i = 0; i < n; i++) {
    let x, y, k = 0;
    do { x = box.x0 + size + Math.random() * Math.max(1, box.x1 - box.x0 - 2 * size); y = box.y0 + size + Math.random() * Math.max(1, box.y1 - box.y0 - 2 * size); k++; }
    while (k < 60 && objs.some(o => Math.hypot(o.x - x, o.y - y) < size * 1.8));
    objs.push({ x, y, h: Math.random() * Math.PI * 2, w: 0, eye: 'none', target: false, picked: false });
  }
  return objs;
}
function moveObjects(objs, dt, box, size, speed, meet) {
  const r = size / 2;
  for (const o of objs) {
    o.w += (Math.random() - 0.5) * 6 * dt; o.w = Math.max(-1.6, Math.min(1.6, o.w * 0.995));
    o.h += o.w * dt;
    o.x += Math.cos(o.h) * speed * dt; o.y += Math.sin(o.h) * speed * dt;
    if (o.x < box.x0 + r) { o.x = box.x0 + r; o.h = Math.PI - o.h; } if (o.x > box.x1 - r) { o.x = box.x1 - r; o.h = Math.PI - o.h; }
    if (o.y < box.y0 + r) { o.y = box.y0 + r; o.h = -o.h; } if (o.y > box.y1 - r) { o.y = box.y1 - r; o.h = -o.h; }
  }
  if (meet === 'pass') return;
  for (let i = 0; i < objs.length; i++) for (let j = i + 1; j < objs.length; j++) {
    const a = objs[i], b = objs[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), min = size * 1.15;
    if (d < min && d > 0.01) {
      const push = (min - d) / 2, ux = dx / d, uy = dy / d;
      a.x -= ux * push; a.y -= uy * push; b.x += ux * push; b.y += uy * push;
      const t = a.h; a.h = b.h; b.h = t;
    }
  }
}

export function followIt() {
  let env, o, W = 0, H = 0, objs = [], phase = 'mark', phaseAt = 0, n = 1, picks = 0, result = null;
  const arena = () => ({ x0: 20, y0: 64, x1: W - 20, y1: H - 70 });
  const word = k => (o.shape === 'plane' ? (k === 1 ? 'plane' : 'planes') : (k === 1 ? 'ball' : 'balls'));

  function endRound() {
    const got = objs.filter(x => x.target && x.picked).length;
    const byEye = eye => { const t = objs.filter(x => x.target && x.eye === eye); return { got: t.filter(x => x.picked).length, of: t.length }; };
    result = { got, n, left: byEye('left'), right: byEye('right') };
    if (got === n) { env.sfx.good(); env.setTip(n >= 3 ? `All ${n}, brilliant!` : 'All correct!'); }
    else { env.sfx.bad(); env.setTip(`${got} of ${n}. The dashed rings show the ones you missed.`); }
    phase = 'reveal'; phaseAt = env.elapsed;
  }

  return {
    id: ID, title: 'Follow It', mode: 'anaglyph', modes: ['mono', 'anaglyph'], hud: 'minimal', noDuration: true,
    how: 'Remember the marked planes, follow them while they fly, then tap them.',
    countHint: () => `Remember the marked ones, then follow them for ${fmtDur(followItOpts().fly)}`,

    // ---------- the approved settings page ----------
    renderSetup(el, api) {
      let pv = { raf: 0, objs: null, last: 0, t: 0 };
      const draw = () => {
        const so = followItOpts(), glasses = api.mode === 'anaglyph', L = lens('left'), R = lens('right');
        el.innerHTML = `
          <div class="ejs">
            <div class="ejs-top">
              <button class="ejs-back" data-x="back">${ICON.arrowLeft}<span>Back</span></button>
              <h1>Follow It</h1>
              <button class="ejs-help" data-x="help" aria-expanded="false">How it helps</button>
            </div>
            <div class="ejs-helpbox" hidden>
              <p><b>What you do:</b> some of the ${so.shape === 'plane' ? 'planes' : 'balls'} are marked at the start. Then they all look the same and fly around for the time you choose. Keep your eyes on the marked ones. When they stop, tap the ones you followed.</p>
              <p><b>What it trains:</b> tracking several moving things at once with attention and side vision, plus visual memory. You use this in traffic, crowds and sports.</p>
              <p><b>With colour glasses</b> half of them are in one lens colour and half in the other, so each eye sees only its own half. To follow them all, your brain has to keep both eyes switched on.</p>
              <p><b>Levels:</b> Easy (12 flying, follow 1), Medium (14, follow 2), Hard (18, follow 3) and Extreme (22, follow 4), all at the same size and speed. Move any slider to make your own (Custom).</p>
              <p><b>When two meet:</b> they can bounce apart, or pass through each other. Passing through is harder.</p>
            </div>
            <div class="ejs-chips" role="radiogroup" aria-label="How to play">
              ${api.modes.map(m => `<button class="ejs-chip" data-mode="${m}" aria-pressed="${api.mode === m}">${m === 'anaglyph' ? `${ICON.glasses}<span>Colour glasses</span>` : `${ICON.patch}<span>Eye patch</span>`}</button>`).join('')}
            </div>
            <p class="ejs-note">${glasses
              ? `Glasses: <b><i class="sw" style="background:${rgbCss(L.rgb)}"></i>${esc(L.name)}</b> left · <b><i class="sw" style="background:${rgbCss(R.rgb)}"></i>${esc(R.name)}</b> right · <button class="ejs-link" data-x="lens">Change</button>`
              : `Patch over your <b>${fellowEye()}</b> (stronger) eye.`}</p>
            <div class="ejs-preview em" aria-label="Preview at real size and speed"><span class="cap">Preview · real size and speed</span><canvas></canvas></div>
            <section class="ejs-sect"><div class="ejs-lab">Level</div>
              <div class="ejs-chips">${Object.entries(LEVELS).map(([k, v]) => `<button class="ejs-chip" data-level="${k}" aria-pressed="${so.level === k}">${v.label}</button>`).join('')}<button class="ejs-chip" data-level="custom" aria-pressed="${so.level === 'custom'}">Custom</button></div>
              <p class="ejs-hint" style="text-align:left">${so.level === 'custom' ? 'Your own mix of the settings below.' : `${levelName(so)}: ${so.count} on screen, follow ${followN(so)}. Every level uses ${PRESET_SIZE} px ${so.shape === 'plane' ? 'planes' : 'balls'} at ${PRESET_SPEED} px/s. Change anything below to make your own.`}</p></section>
            <section class="ejs-sect"><div class="ejs-lab">What flies around</div>
              <div class="ejs-chips">
                <button class="ejs-chip" data-shape="plane" aria-pressed="${so.shape === 'plane'}">${PLANE_SVG}<span>Planes</span></button>
                <button class="ejs-chip" data-shape="ball" aria-pressed="${so.shape === 'ball'}"><svg width="18" height="18" aria-hidden="true"><circle cx="9" cy="9" r="8" fill="currentColor"/></svg><span>Balls</span></button>
              </div></section>
            <section class="ejs-sect"><div class="ejs-lab"><span>Size</span><output data-out="size">${so.size} px</output></div>
              <div class="ejs-slider"><span class="end txt">Small</span><input type="range" data-range="size" min="16" max="110" step="2" value="${so.size}" aria-label="Size"><span class="end txt">Big</span></div></section>
            <section class="ejs-sect"><div class="ejs-lab"><span>How many on screen</span><output data-out="count">${so.count}</output></div>
              <div class="ejs-slider"><span class="end txt">Few</span><input type="range" data-range="count" min="4" max="24" step="1" value="${so.count}" aria-label="How many on screen"><span class="end txt">Many</span></div></section>
            <section class="ejs-sect"><div class="ejs-lab">How many to follow</div>
              <div class="ejs-chips">${[1, 2, 3, 4, 5, 6].map(v => `<button class="ejs-chip" data-follow="${v}" aria-pressed="${so.follow === v}" ${v > maxFollow(so) ? 'disabled style="opacity:.35"' : ''}>${v}</button>`).join('')}</div></section>
            <section class="ejs-sect"><div class="ejs-lab"><span>Speed</span><output data-out="speed">${speedWord(so.speed)} · ${so.speed} px/s</output></div>
              <div class="ejs-slider"><span class="end txt">Slow</span><input type="range" data-range="speed" min="90" max="150" step="5" value="${so.speed}" aria-label="Speed"><span class="end txt">Fast</span></div></section>
            <section class="ejs-sect"><div class="ejs-lab">When two of them meet</div>
              <div class="ejs-chips"><button class="ejs-chip" data-meet="bounce" aria-pressed="${so.meet === 'bounce'}">Bounce apart</button><button class="ejs-chip" data-meet="pass" aria-pressed="${so.meet === 'pass'}">Pass through</button></div>
              <p class="ejs-hint" style="text-align:left">${so.meet === 'pass' ? 'They can cross over each other, which is harder: you must keep track of which one is yours.' : 'They never overlap; they bounce off each other.'}</p></section>
            <section class="ejs-sect"><div class="ejs-lab">How long they fly</div>
              <div class="ejs-dur">${FLY.map(([v, l]) => `<button data-fly="${v}" aria-pressed="${so.fly === v}"><span class="dot"></span>${l}</button>`).join('')}</div></section>
            <div class="ejs-startbar">
              <button class="ejs-start" data-x="start">${ICON.play}<span>Start</span></button>
              <p class="ejs-hint">Watch the marked ones · follow them · tap them at the end · <b>Space</b> pauses</p>
            </div>
          </div>`;
        sizePreview();
      };
      const sizePreview = () => {
        const box = el.querySelector('.ejs-preview'), cv = box.querySelector('canvas'), so = followItOpts();
        const dpr = Math.min(window.devicePixelRatio || 1, 2), w = Math.max(200, box.clientWidth - 2), h = Math.max(170, so.size * 3.2);
        cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.width = w + 'px'; cv.style.height = h + 'px';
        box.style.minHeight = h + 'px'; pv.objs = null;
      };
      const tick = t => {
        if (!el.isConnected) { pv.raf = 0; return; }
        const cv = el.querySelector('.ejs-preview canvas'); if (!cv) { pv.raf = requestAnimationFrame(tick); return; }
        const so = followItOpts(), glasses = api.mode === 'anaglyph';
        const dpr = cv.width / parseFloat(cv.style.width), w = cv.width / dpr, h = cv.height / dpr, b = { x0: 4, y0: 22, x1: w - 4, y1: h - 4 };
        if (!pv.objs) { pv.objs = makeObjects(4, b, so.size); pv.objs.forEach((x, i) => { x.eye = i % 2 ? 'right' : 'left'; }); pv.objs[0].target = true; pv.last = t; pv.t = 0; }
        const dt = Math.min(0.1, (t - pv.last) / 1000); pv.last = t; pv.t += dt;
        moveObjects(pv.objs, dt, b, so.size, so.speed, so.meet);
        const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
        for (const x of pv.objs) {
          drawObj(c, so.shape, x.x, x.y, x.h, glasses ? rgbCss(lens(x.eye).rgb) : 'rgb(235,235,235)', so.size);
          if (x.target && (pv.t % 3) < 1.2) ring(c, x.x, x.y, so.size * 0.72, 'rgba(255,255,255,.9)', 2.5);
        }
        pv.raf = requestAnimationFrame(tick);
      };
      const set = (patch, focusSel) => { saveOpts({ ...followItOpts(), ...patch }); draw(); if (focusSel) { const nn = el.querySelector(focusSel); if (nn) nn.focus(); } };
      el.onclick = e => {
        const b = e.target.closest('button'); if (!b) return;
        const d = b.dataset;
        if (d.x === 'back') { cancelAnimationFrame(pv.raf); api.close(); }
        else if (d.x === 'lens') { cancelAnimationFrame(pv.raf); api.close('#setup-glasses'); }
        else if (d.x === 'help') { const hb = el.querySelector('.ejs-helpbox'); hb.hidden = !hb.hidden; b.setAttribute('aria-expanded', String(!hb.hidden)); }
        else if (d.x === 'start') { cancelAnimationFrame(pv.raf); const so = followItOpts(); api.start((so.fly + 20) / 60); }
        else if (d.mode) { api.setMode(d.mode); draw(); el.querySelector(`[data-mode="${d.mode}"]`).focus(); }
        else if (d.level) { const lv = LEVELS[d.level]; set(lv ? { level: d.level, size: lv.size, count: lv.count, follow: lv.follow, speed: lv.speed } : { level: 'custom' }, `[data-level="${d.level}"]`); }
        else if (d.shape) set({ shape: d.shape }, `[data-shape="${d.shape}"]`);
        else if (d.follow) set({ follow: +d.follow, level: 'custom' }, `[data-follow="${d.follow}"]`);
        else if (d.meet) set({ meet: d.meet }, `[data-meet="${d.meet}"]`);
        else if (d.fly) set({ fly: +d.fly }, `[data-fly="${d.fly}"]`);
      };
      el.oninput = e => {
        const r = e.target.closest('[data-range]'); if (!r) return;
        const so = followItOpts(), k = r.dataset.range, v = +r.value;
        so[k] = v; so.level = 'custom';
        el.querySelectorAll('[data-level]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.level === 'custom')));
        el.querySelector(`[data-out="${k}"]`).textContent = k === 'speed' ? `${speedWord(v)} · ${v} px/s` : k === 'size' ? `${v} px` : v;
        saveOpts(so);
        if (k === 'size') sizePreview();
      };
      el.onchange = e => {
        const r = e.target.closest('[data-range]'); if (!r) return;
        const so = followItOpts(); if (so.follow > maxFollow(so)) { so.follow = maxFollow(so); saveOpts(so); }
        draw(); const nn = el.querySelector(`[data-range="${r.dataset.range}"]`); if (nn) nn.focus();
      };
      draw();
      pv.raf = requestAnimationFrame(tick);
      el.querySelector('[data-x="start"]').focus({ preventScroll: true });
    },

    // ---------- play: one round ----------
    init(e) {
      env = e; o = followItOpts(); W = env.w; H = env.h;
      n = followN(o);
      objs = makeObjects(o.count, arena(), o.size);
      const idx = objs.map((_, i) => i).sort(() => Math.random() - 0.5);
      idx.forEach((k, j) => { objs[k].eye = env.mode === 'anaglyph' ? (j % 2 ? 'right' : 'left') : 'none'; });
      idx.slice(0, n).forEach(k => { objs[k].target = true; }); // the marked ones are shared between both eyes
      phase = 'mark'; phaseAt = 0;
      env.setTip(`Watch the ${n} marked ${word(n)}`);
      env.setCorner(`${levelName(o)} · following ${n}`);
    },
    onResize(w, h) { W = w; H = h; },
    update(dt) {
      const t = env.elapsed - phaseAt;
      if (phase === 'mark' && t > 3) { phase = 'move'; phaseAt = env.elapsed; env.setTip(''); }
      else if (phase === 'move') {
        moveObjects(objs, dt, arena(), o.size, o.speed, o.meet);
        env.setCorner(`${levelName(o)} · following ${n} · ${Math.max(0, Math.ceil(o.fly - t))} s`);
        if (t > o.fly) { phase = 'pick'; phaseAt = env.elapsed; env.setCorner(`${levelName(o)} · following ${n}`); env.setTip(`Tap the ${n} you followed`); env.sfx.tick(); }
      } else if (phase === 'reveal' && t > 2.6) { phase = 'done'; env.end(); }
    },
    draw(a, f) {
      const t = env.elapsed - phaseAt, amb = db.settings.amblyopicEye;
      for (const x of objs) {
        const layer = x.eye === 'none' || x.eye === amb ? a : f;
        drawObj(layer, o.shape, x.x, x.y, x.h, x.eye === 'none' ? 'rgb(235,235,235)' : '#fff', o.size);
      }
      // marks, picks and answers are drawn for both eyes
      for (const c of [a, f]) for (const x of objs) {
        const r = o.size * 0.75;
        if (phase === 'mark' && x.target && (t % 0.6) < 0.4) ring(c, x.x, x.y, r, '#fff', 3);
        if (phase === 'pick' && x.picked) ring(c, x.x, x.y, r, '#fff', 3);
        if (phase === 'reveal' || phase === 'done') {
          if (x.target && x.picked) ring(c, x.x, x.y, r, '#fff', 4);
          else if (x.target) ring(c, x.x, x.y, r, '#fff', 3, [6, 6]);
          else if (x.picked) { const q = o.size * 0.4; c.strokeStyle = '#fff'; c.lineWidth = 3; c.beginPath(); c.moveTo(x.x - q, x.y - q); c.lineTo(x.x + q, x.y + q); c.moveTo(x.x + q, x.y - q); c.lineTo(x.x - q, x.y + q); c.stroke(); }
        }
      }
    },
    params() { return { bgA: 0, bgF: 0 }; },
    onPointer(x, y, type) {
      if (type !== 'pointerdown' || phase !== 'pick') return;
      let best = null, bd = Infinity;
      for (const ob of objs) { const d = Math.hypot(ob.x - x, ob.y - y); if (d < bd) { bd = d; best = ob; } }
      if (!best || bd > o.size * 1.1) return;
      best.picked = !best.picked; picks += best.picked ? 1 : -1; env.sfx.tick();
      if (picks >= n) endRound();
    },
    onKey() { return false; },
    result() {
      env.setTip(''); env.setCorner('');
      const r = result, glasses = env.mode === 'anaglyph', L = lens('left'), R = lens('right');
      if (!r) return null; // stopped before the end: nothing to save
      const lv = levelName(o);
      const next = r.got === r.n
        ? (o.level === 'extreme' ? 'Perfect at Extreme. Try more on screen or a longer flight.' : `Perfect. Next time try ${o.level === 'custom' ? 'one more to follow' : LEVELS[NEXT[o.level]].label}.`)
        : r.got >= r.n - 1 ? 'Close. Try this level again.' : `Next time try ${o.level === 'easy' || o.level === 'custom' ? 'fewer to follow or a slower speed' : LEVELS[PREV[o.level]].label}.`;
      const summary = [['Level', lv], ['Found', `${r.got} of ${r.n}`]];
      if (glasses) summary.push([`Seen by left eye (${esc(L.name)})`, `${r.left.got} of ${r.left.of}`], [`Seen by right eye (${esc(R.name)})`, `${r.right.got} of ${r.right.of}`]);
      summary.push(['Flight time', fmtDur(o.fly)], ['Next', next]);
      return {
        complete: true, trials: r.n, correct: r.got, threshold: null, unit: null, score: null,
        headline: r.got === r.n ? 'All correct!' : 'Well done', summary,
        extra: { level: o.level, count: o.count, follow: r.n, speed: o.speed, size: o.size, meet: o.meet, fly: o.fly, shape: o.shape, left: r.left, right: r.right },
      };
    },
  };
}
