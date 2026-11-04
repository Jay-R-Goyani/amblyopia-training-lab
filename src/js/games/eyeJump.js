// Eye Jump (approved design): one circle at a time jumps along a path; read the number or letter in it out loud.
// With colour glasses each circle is drawn for one eye only, so both eyes have to stay switched on.
import { db, save, fellowEye } from '../store.js';
import { lens, rgbCss } from '../lens.js';
import { ICON } from '../icons.js';
import { esc } from '../util.js';

const ID = 'eye-jump';
// Look-alikes (I/1, O/0, l) are left out so every answer is clear.
const SETS = {
  num: { label: '123', name: 'Numbers', chars: '123456789' },
  upper: { label: 'ABC', name: 'Capital letters', chars: 'ABCDEFGHJKLMNPRSTUVWXYZ' },
  lower: { label: 'abc', name: 'Small letters', chars: 'abcdefghjkmnpqrstuvwxyz' },
  mix: { label: '1A', name: 'Numbers and letters', chars: '23456789ABCDEFGHJKLMNPRSTUVWXYZ' },
};
const sv = inner => `<svg viewBox="0 0 100 50" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const PATHS = [
  ['hline', 'Horizontal line', sv('<path d="M10 25H90"/>')],
  ['vline', 'Vertical line', sv('<path d="M50 6V44"/>')],
  ['diagonal', 'Diagonal', sv('<path d="M12 8L88 42M88 8L12 42"/>')],
  ['hzig', 'Horizontal zigzag', sv('<path d="M14 9H86L14 25H86L14 41H86"/>')],
  ['vzig', 'Vertical zigzag', sv('<path d="M14 42L28 8V42L44 8V42L60 8V42L76 8V42"/>')],
  ['ring', 'Ring', sv('<ellipse cx="50" cy="25" rx="36" ry="17"/>')],
  ['square', 'Square', sv('<rect x="32" y="7" width="36" height="36"/>')],
  ['random', 'Random', sv('<g fill="currentColor" stroke="none"><circle cx="22" cy="14" r="3.6"/><circle cx="44" cy="18" r="3.6"/><circle cx="62" cy="10" r="3.6"/><circle cx="84" cy="16" r="3.6"/><circle cx="14" cy="34" r="3.6"/><circle cx="38" cy="38" r="3.6"/><circle cx="62" cy="34" r="3.6"/><circle cx="82" cy="40" r="3.6"/></g>')],
];
const SPEEDS = [[4, '4'], [2, '2'], [1, '1'], [0.5, '0.5'], [0.25, '0.25'], ['custom', '']];
const DURS = [[15, '15 s'], [30, '30 s'], [60, '1 min'], [120, '2 min'], [180, '3 min'], [300, '5 min']];
const DEF = { content: 'num', circle: 56, char: 24, path: 'random', speed: 1, custom: 1.5, dur: 120 };
const GLYPH_FONT = 'Calibri, Carlito, "Segoe UI", Arial, sans-serif';

export function eyeJumpOpts() {
  const o = { ...DEF, ...((db.state.opts || {})[ID] || {}) };
  o.circle = +o.circle; o.char = +o.char; o.dur = +o.dur; o.custom = +o.custom;
  if (o.speed !== 'custom') o.speed = +o.speed;
  return o;
}
function saveOpts(o) { db.state.opts = db.state.opts || {}; db.state.opts[ID] = o; save(); }
const charWord = o => (o.content === 'num' ? 'number' : o.content === 'mix' ? 'number or letter' : 'letter');
const fmtDur = s => (s < 60 ? `${Math.round(s)} sec` : `${Math.floor(s / 60)} min${s % 60 >= 1 ? ` ${Math.round(s % 60)} sec` : ''}`);

// One target: a filled circle with a thin (regular-weight) character in black.
// `fill` is the circle colour; on the eye layers it's white and the renderer tints it with the lens colour.
function drawTarget(c, x, y, o, ch, fill) {
  const r = o.circle / 2, h = Math.min(o.char, o.circle * 0.82);
  c.fillStyle = fill; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#000';
  c.font = `400 ${h / 0.7}px ${GLYPH_FONT}`;
  c.textAlign = 'center'; c.textBaseline = 'alphabetic';
  c.fillText(ch, x, y + (/[0-9A-Z]/.test(ch) ? h / 2 : h * 0.36));
}

export function eyeJump() {
  let env, o, W = 0, H = 0, t = 0, nextAt = 0, path = null, pos = null, arc = 0, dir = 1;
  let cur = null, shown = 0, per = { left: 0, right: 0, none: 0 }, lastEyes = [];
  const rand = (a, b) => a + Math.random() * (b - a);

  function bounds() {
    const m = Math.max(24, Math.min(W, H) * 0.04) + o.circle / 2;
    return { x0: m, x1: W - m, y0: m, y1: H - m - 56 };
  }
  // Paths are polylines walked by distance. Closed ones wrap; open ones turn back at the ends.
  function buildPath() {
    const { x0, x1, y0, y1 } = bounds(), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, w = x1 - x0, h = y1 - y0;
    let pts, closed = false;
    switch (o.path) {
      case 'hline': pts = [[x0, cy], [x1, cy]]; break;
      case 'vline': pts = [[cx, y0], [cx, y1]]; break;
      case 'diagonal': pts = [[x0, y0], [x1, y1], [x1, y0], [x0, y1]]; closed = true; break;
      case 'hzig': pts = []; for (let i = 0; i < 4; i++) { const y = y0 + (h * i) / 3; pts.push([x0, y], [x1, y]); } break;
      case 'vzig': pts = []; for (let i = 0; i < 5; i++) { const x = x0 + (w * i) / 4; pts.push([x, y1], [x, y0]); } break;
      case 'ring': pts = []; for (let i = 0; i < 120; i++) { const a = (i / 120) * Math.PI * 2; pts.push([cx + Math.cos(a) * w / 2, cy + Math.sin(a) * h / 2]); } closed = true; break;
      case 'square': { const s = Math.min(w, h); pts = [[cx - s / 2, cy - s / 2], [cx + s / 2, cy - s / 2], [cx + s / 2, cy + s / 2], [cx - s / 2, cy + s / 2]]; closed = true; break; }
      default: return null;
    }
    if (closed) pts.push(pts[0]);
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    return { pts, cum, len: cum[cum.length - 1], closed };
  }
  function at(p, s) {
    let i = 1; while (i < p.cum.length - 1 && p.cum[i] < s) i++;
    const a = p.pts[i - 1], b = p.pts[i], f = (s - p.cum[i - 1]) / (p.cum[i] - p.cum[i - 1] || 1);
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  }
  function nextPos() {
    const { x0, x1, y0, y1 } = bounds();
    if (!path) {
      const minD = Math.hypot(x1 - x0, y1 - y0) * 0.22; // random, but always a real jump
      for (let k = 0; k < 50; k++) { const p = [rand(x0, x1), rand(y0, y1)]; if (!pos || Math.hypot(p[0] - pos[0], p[1] - pos[1]) > minD) return p; }
      return [rand(x0, x1), rand(y0, y1)];
    }
    const step = Math.min((x1 - x0) * 0.3, path.len * (path.closed ? 0.2 : 0.45));
    if (path.closed) arc = (arc + step) % path.len;
    else { arc += dir * step; if (arc > path.len) { arc = 2 * path.len - arc; dir = -1; } if (arc < 0) { arc = -arc; dir = 1; } }
    return at(path, arc);
  }
  function pickEye() {
    if (env.mode !== 'anaglyph') return 'none';
    let e = Math.random() < 0.5 ? 'left' : 'right';
    if (lastEyes.length >= 3 && lastEyes.slice(-3).every(x => x === e)) e = e === 'left' ? 'right' : 'left';
    return e;
  }
  function newTarget() {
    pos = nextPos();
    const set = SETS[o.content].chars;
    let ch; do { ch = set[Math.floor(Math.random() * set.length)]; } while (cur && ch === cur.ch);
    const eye = pickEye();
    lastEyes.push(eye); if (lastEyes.length > 5) lastEyes.shift();
    cur = { x: pos[0], y: pos[1], ch, eye }; shown++; per[eye]++;
    env.markDirty();
  }

  return {
    id: ID, title: 'Eye Jump', mode: 'anaglyph', modes: ['mono', 'anaglyph'], hiRes: true, staticLayers: true, hud: 'minimal',
    how: 'A circle jumps around the screen. Read the number or letter in it out loud.',
    countHint: () => `Say each ${charWord(eyeJumpOpts())} out loud`,

    // ---------- the approved settings page ----------
    renderSetup(el, api) {
      const draw = () => {
        const so = eyeJumpOpts(), glasses = api.mode === 'anaglyph';
        const L = lens('left'), R = lens('right'), cw = charWord(so);
        el.innerHTML = `
          <div class="ejs">
            <div class="ejs-top">
              <button class="ejs-back" data-x="back">${ICON.arrowLeft}<span>Back</span></button>
              <h1>Eye Jump</h1>
              <button class="ejs-help" data-x="help" aria-expanded="false">How it helps</button>
            </div>
            <div class="ejs-helpbox" hidden>
              <p><b>What you do:</b> keep your head still, move only your eyes, and say the ${cw} in each circle out loud as soon as you can read it.</p>
              <p><b>What it trains:</b> fast, accurate eye jumps (saccades), the movements you use for reading, and reading small detail quickly. The ${cw} is thin, not bold, so your eye has to focus on its shape.</p>
              <p><b>With colour glasses</b> each circle is in one lens colour, so only one eye sees it. Your brain has to keep both eyes switched on to catch every one.</p>
              <p><b>Make it harder:</b> a smaller ${cw}, then a smaller circle, then faster jumps.</p>
            </div>
            <div class="ejs-chips ejs-mode" role="radiogroup" aria-label="How to play">
              ${api.modes.map(m => `<button class="ejs-chip" data-mode="${m}" aria-pressed="${api.mode === m}">${m === 'anaglyph' ? `${ICON.glasses}<span>Colour glasses</span>` : `${ICON.patch}<span>Eye patch</span>`}</button>`).join('')}
            </div>
            <p class="ejs-note">${glasses
              ? `Glasses: <b><i class="sw" style="background:${rgbCss(L.rgb)}"></i>${esc(L.name)}</b> left · <b><i class="sw" style="background:${rgbCss(R.rgb)}"></i>${esc(R.name)}</b> right · <button class="ejs-link" data-x="lens">Change</button>`
              : `Patch over your <b>${fellowEye()}</b> (stronger) eye.`}</p>
            <div class="ejs-preview" aria-label="Preview at real size"><span class="cap">Preview · real size</span></div>
            <section class="ejs-sect"><div class="ejs-lab">Inside the circle</div>
              <div class="ejs-chips">${Object.entries(SETS).map(([k, v]) => `<button class="ejs-chip" data-content="${k}" aria-pressed="${so.content === k}" title="${v.name}"><span class="g">${v.label}</span></button>`).join('')}</div></section>
            <section class="ejs-sect"><div class="ejs-lab"><span>Circle size</span><output data-out="circle">${so.circle} px</output></div>
              <div class="ejs-slider"><span class="end" aria-hidden="true"><svg width="10" height="10"><circle cx="5" cy="5" r="4" fill="currentColor"/></svg></span>
              <input type="range" data-range="circle" min="16" max="240" step="2" value="${so.circle}" aria-label="Circle size">
              <span class="end" aria-hidden="true"><svg width="26" height="26"><circle cx="13" cy="13" r="12" fill="currentColor"/></svg></span></div></section>
            <section class="ejs-sect"><div class="ejs-lab"><span>${cw[0].toUpperCase() + cw.slice(1)} size</span><output data-out="char">${Math.min(so.char, Math.floor(so.circle * 0.82))} px</output></div>
              <div class="ejs-slider"><span class="end g" aria-hidden="true" style="font-size:.8rem">A</span>
              <input type="range" data-range="char" min="6" max="${Math.floor(so.circle * 0.82)}" step="1" value="${Math.min(so.char, Math.floor(so.circle * 0.82))}" aria-label="${cw} size">
              <span class="end g" aria-hidden="true" style="font-size:1.5rem">A</span></div></section>
            <section class="ejs-sect"><div class="ejs-lab">Path</div>
              <div class="ejs-paths">${PATHS.map(([k, l, ic]) => `<button class="ejs-ptile" data-path="${k}" aria-pressed="${so.path === k}"><span class="box">${ic}</span><span>${l}</span></button>`).join('')}</div></section>
            <section class="ejs-sect"><div class="ejs-lab">Jump every</div>
              <div class="ejs-chips">${SPEEDS.map(([v, l]) => `<button class="ejs-chip" data-speed="${v}" aria-pressed="${so.speed === v}">${v === 'custom' ? 'Custom' : `${l}<small>s</small>`}</button>`).join('')}</div>
              ${so.speed === 'custom' ? `<label class="ejs-custom">Custom: <input type="number" data-custom min="0.2" max="10" step="0.05" value="${so.custom}"> seconds</label>` : ''}</section>
            <section class="ejs-sect"><div class="ejs-lab">How long</div>
              <div class="ejs-dur">${DURS.map(([v, l]) => `<button data-dur="${v}" aria-pressed="${so.dur === v}"><span class="dot"></span>${l}</button>`).join('')}</div></section>
            <div class="ejs-startbar">
              <button class="ejs-start" data-x="start">${ICON.play}<span>Start</span></button>
              <p class="ejs-hint">During play: <b>Space</b> pauses · <b>Back</b> finishes</p>
            </div>
          </div>`;
        preview();
      };
      const preview = () => {
        const so = eyeJumpOpts(), box = el.querySelector('.ejs-preview');
        box.querySelectorAll('canvas').forEach(n => n.remove());
        const eyes = api.mode === 'anaglyph' ? ['left', 'right'] : ['none'], set = SETS[so.content].chars;
        eyes.forEach((eye, i) => {
          const cv = document.createElement('canvas'), dpr = Math.min(window.devicePixelRatio || 1, 2), d = so.circle + 8;
          cv.width = d * dpr; cv.height = d * dpr; cv.style.width = d + 'px'; cv.style.height = d + 'px';
          const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
          drawTarget(c, d / 2, d / 2, so, set[(i * 5 + 3) % set.length], eye === 'none' ? 'rgb(235,235,235)' : rgbCss(lens(eye).rgb));
          box.appendChild(cv);
        });
        box.style.minHeight = Math.max(144, so.circle + 40) + 'px';
      };
      const set = (patch, focusSel) => { saveOpts({ ...eyeJumpOpts(), ...patch }); draw(); if (focusSel) { const n = el.querySelector(focusSel); if (n) n.focus(); } };
      el.onclick = e => {
        const b = e.target.closest('button'); if (!b) return;
        const d = b.dataset;
        if (d.x === 'back') api.close();
        else if (d.x === 'lens') api.close('#setup-glasses');
        else if (d.x === 'help') { const h = el.querySelector('.ejs-helpbox'); h.hidden = !h.hidden; b.setAttribute('aria-expanded', String(!h.hidden)); }
        else if (d.x === 'start') { const so = eyeJumpOpts(); api.start(so.dur / 60); }
        else if (d.mode) { api.setMode(d.mode); draw(); el.querySelector(`[data-mode="${d.mode}"]`).focus(); }
        else if (d.content) set({ content: d.content }, `[data-content="${d.content}"]`);
        else if (d.path) set({ path: d.path }, `[data-path="${d.path}"]`);
        else if (d.speed) set({ speed: d.speed === 'custom' ? 'custom' : +d.speed }, `[data-speed="${d.speed}"]`);
        else if (d.dur) set({ dur: +d.dur }, `[data-dur="${d.dur}"]`);
      };
      el.oninput = e => {
        const r = e.target.closest('[data-range]'); if (!r) return;
        const so = eyeJumpOpts(), k = r.dataset.range, v = +r.value;
        if (k === 'circle') {
          so.circle = v;
          const max = Math.floor(v * 0.82), ch = el.querySelector('[data-range="char"]');
          ch.max = max; if (so.char > max) { so.char = max; ch.value = max; el.querySelector('[data-out="char"]').textContent = `${max} px`; }
        } else so.char = v;
        el.querySelector(`[data-out="${k}"]`).textContent = `${v} px`;
        saveOpts(so); preview();
      };
      el.onchange = e => {
        if (e.target.matches('[data-custom]')) { const v = Math.min(10, Math.max(0.2, +e.target.value || 1.5)); e.target.value = v; saveOpts({ ...eyeJumpOpts(), custom: v }); }
      };
      draw();
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (el.isConnected) preview(); });
      el.querySelector('[data-x="start"]').focus({ preventScroll: true });
    },

    // ---------- play ----------
    init(e) {
      env = e; o = eyeJumpOpts();
      W = env.w; H = env.h; path = buildPath();
      env.setStatus('');
    },
    onResize(w, h) { W = w; H = h; path = buildPath(); },
    update() {
      t = env.elapsed; // real active time, so jumps keep their rhythm even if a frame is slow
      if (t >= nextAt) { newTarget(); nextAt += o.speed === 'custom' ? o.custom : o.speed; }
    },
    draw(a, f) {
      if (!cur) return;
      // Patch: the weaker eye sees white circles. Glasses: each circle goes to one eye's layer and is tinted with that eye's lens colour.
      const c = cur.eye === 'none' || cur.eye === db.settings.amblyopicEye ? a : f;
      drawTarget(c, cur.x, cur.y, o, cur.ch, cur.eye === 'none' ? 'rgb(235,235,235)' : '#fff');
    },
    params() { return { bgA: 0, bgF: 0 }; },
    result() {
      const L = lens('left'), R = lens('right'), cw = charWord(o), glasses = env.mode === 'anaglyph';
      const sum = [['Time', fmtDur(Math.min(t, o.dur))], ['Circles shown', shown]];
      if (glasses) sum.push([`For your left eye (${esc(L.name)})`, per.left], [`For your right eye (${esc(R.name)})`, per.right]);
      return {
        trials: shown, threshold: null, unit: null, score: null, headline: 'Well done',
        summary: sum,
        extra: { content: o.content, circle: o.circle, char: o.char, path: o.path, speed: o.speed === 'custom' ? o.custom : o.speed, left: per.left, right: per.right },
        ask: {
          q: `How many ${cw}s could you read?`,
          options: [
            ['all', 'All of them', `Great. Next time try a smaller ${cw} or faster jumps.`],
            ['most', 'Most', 'Good. Stay at these settings until you can read every one.'],
            ['few', 'Only some', `Make it easier: a bigger ${cw} or slower jumps.${glasses ? ' If one colour was harder, that eye needs the most practice.' : ''}`],
          ],
        },
      };
    },
  };
}
