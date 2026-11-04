// Eye Motion (approved design): a circle glides smoothly along a path; follow it with the eyes and
// read the number or letter out loud when it changes. With colour glasses the circle switches eyes on each change.
import { db, save, fellowEye } from '../store.js';
import { lens, rgbCss } from '../lens.js';
import { ICON } from '../icons.js';
import { esc } from '../util.js';

const ID = 'eye-motion';
const SETS = {
  num: { label: '123', name: 'Numbers', chars: '123456789' },
  upper: { label: 'ABC', name: 'Capital letters', chars: 'ABCDEFGHJKLMNPRSTUVWXYZ' },
  lower: { label: 'abc', name: 'Small letters', chars: 'abcdefghjkmnpqrstuvwxyz' },
  mix: { label: '1A', name: 'Numbers and letters', chars: '23456789ABCDEFGHJKLMNPRSTUVWXYZ' },
  dot: { label: '●', name: 'Dot only', chars: '' },
};
const sv = inner => `<svg viewBox="0 0 100 50" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const PATHS = [
  ['random', 'Random', sv('<path d="M8 36C18 6 36 46 50 22S78 6 92 34"/><circle cx="8" cy="36" r="4" fill="currentColor"/>')],
  ['hline', 'Horizontal line', sv('<path d="M10 25H90"/>')],
  ['vline', 'Vertical line', sv('<path d="M50 6V44"/>')],
  ['diagonal', 'Diagonal', sv('<path d="M12 8L88 42M88 8L12 42"/>')],
  ['hzig', 'Zigzag', sv('<path d="M14 9H86L14 25H86L14 41H86"/><circle cx="14" cy="9" r="4" fill="currentColor"/>')],
  ['ring', 'Ring', sv('<ellipse cx="50" cy="25" rx="36" ry="17"/>')],
  ['square', 'Square', sv('<rect x="32" y="7" width="36" height="36"/>')],
  ['eight', 'Figure 8', sv('<path d="M50 25C40 8 14 8 14 25S40 42 50 25S86 8 86 25S60 42 50 25Z"/>')],
];
const CHANGES = [[1, '1'], [2, '2'], [3, '3'], [5, '5']];
const DURS = [[15, '15 s'], [30, '30 s'], [60, '1 min'], [120, '2 min'], [180, '3 min'], [300, '5 min']];
const DEF = { content: 'num', circle: 48, char: 22, path: 'random', speed: 240, change: 2, dur: 120 };
const GLYPH_FONT = 'Calibri, Carlito, "Segoe UI", Arial, sans-serif';
const speedWord = v => (v < 160 ? 'Slow' : v < 320 ? 'Medium' : v < 520 ? 'Fast' : 'Very fast');
const fmtDur = s => (s < 60 ? `${Math.round(s)} sec` : `${Math.floor(s / 60)} min${s % 60 >= 1 ? ` ${Math.round(s % 60)} sec` : ''}`);

export function eyeMotionOpts() {
  const o = { ...DEF, ...((db.state.opts || {})[ID] || {}) };
  for (const k of ['circle', 'char', 'speed', 'change', 'dur']) o[k] = +o[k];
  return o;
}
function saveOpts(o) { db.state.opts = db.state.opts || {}; db.state.opts[ID] = o; save(); }
const hasChar = o => o.content !== 'dot';
const charWord = o => (o.content === 'num' ? 'number' : o.content === 'mix' ? 'number or letter' : 'letter');

function drawTarget(c, x, y, o, ch, fill) {
  const r = o.circle / 2;
  c.fillStyle = fill; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
  if (!ch) return;
  const h = Math.min(o.char, o.circle * 0.82);
  c.fillStyle = '#000'; c.font = `400 ${h / 0.7}px ${GLYPH_FONT}`;
  c.textAlign = 'center'; c.textBaseline = 'alphabetic';
  c.fillText(ch, x, y + (/[0-9A-Z]/.test(ch) ? h / 2 : h * 0.36));
}

export function eyeMotion() {
  let env, o, W = 0, H = 0, nextChange = 0, cur = null, shown = 0, per = { left: 0, right: 0, none: 0 }, lastEyes = [];
  let fixed = null, rnd = null, hint = 1;

  const bounds = () => { const m = Math.max(24, Math.min(W, H) * 0.05) + o.circle / 2; return { x0: m, x1: W - m, y0: m, y1: H - m - 56 }; };
  // Fixed paths: polylines walked at a steady speed. Closed ones loop; open ones go back and forth.
  function buildFixed() {
    const { x0, x1, y0, y1 } = bounds(), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, w = x1 - x0, h = y1 - y0;
    let pts = [], closed = false;
    switch (o.path) {
      case 'hline': pts = [[x0, cy], [x1, cy]]; break;
      case 'vline': pts = [[cx, y0], [cx, y1]]; break;
      case 'diagonal': pts = [[x0, y0], [x1, y1], [x1, y0], [x0, y1]]; closed = true; break;
      case 'hzig': for (let i = 0; i < 4; i++) { const y = y0 + (h * i) / 3; pts.push([x0, y], [x1, y]); } break;
      case 'ring': for (let i = 0; i < 180; i++) { const a = (i / 180) * Math.PI * 2; pts.push([cx + Math.cos(a) * w / 2, cy + Math.sin(a) * h / 2]); } closed = true; break;
      case 'square': { const q = Math.min(w, h); pts = [[cx - q / 2, cy - q / 2], [cx + q / 2, cy - q / 2], [cx + q / 2, cy + q / 2], [cx - q / 2, cy + q / 2]]; closed = true; break; }
      case 'eight': for (let i = 0; i < 240; i++) { const a = (i / 240) * Math.PI * 2; pts.push([cx + Math.sin(a) * w / 2, cy + Math.sin(2 * a) * h / 2]); } closed = true; break;
    }
    if (closed) pts.push(pts[0]);
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    return { pts, cum, len: cum[cum.length - 1], closed };
  }
  function fixedAt(d) {
    const p = fixed, m = p.closed ? d % p.len : (d % (2 * p.len) <= p.len ? d % (2 * p.len) : 2 * p.len - d % (2 * p.len));
    let i = 1; while (i < p.cum.length - 1 && p.cum[i] < m) i++;
    const a = p.pts[i - 1], b = p.pts[i], f = (m - p.cum[i - 1]) / (p.cum[i] - p.cum[i - 1] || 1);
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  }
  // Random: a smooth curve (Catmull-Rom spline) through random points spread over the screen, extended as it goes.
  function randomPoint(prev) {
    const { x0, x1, y0, y1 } = bounds(), minD = Math.hypot(x1 - x0, y1 - y0) * 0.28;
    for (let k = 0; k < 40; k++) { const p = [x0 + Math.random() * (x1 - x0), y0 + Math.random() * (y1 - y0)]; if (!prev || Math.hypot(p[0] - prev[0], p[1] - prev[1]) > minD) return p; }
    return [x0 + Math.random() * (x1 - x0), y0 + Math.random() * (y1 - y0)];
  }
  function extend() {
    const w = rnd.way, i = rnd.seg;
    while (w.length < i + 3) w.push(randomPoint(w[w.length - 1]));
    const p0 = w[i - 1], p1 = w[i], p2 = w[i + 1], p3 = w[i + 2];
    for (let k = 1; k <= 40; k++) {
      const t = k / 40, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      const pt = [f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])], q = rnd.pts[rnd.pts.length - 1];
      rnd.pts.push(pt); rnd.cum.push(rnd.cum[rnd.cum.length - 1] + Math.hypot(pt[0] - q[0], pt[1] - q[1]));
    }
    rnd.seg++;
  }
  function setupPath() {
    hint = 1;
    if (o.path === 'random') { fixed = null; const way = [randomPoint()]; for (let i = 0; i < 3; i++) way.push(randomPoint(way[way.length - 1])); rnd = { way, pts: [way[1]], cum: [0], seg: 1 }; extend(); extend(); }
    else { rnd = null; fixed = buildFixed(); }
  }
  function position(d) {
    if (fixed) return fixedAt(d);
    while (rnd.cum[rnd.cum.length - 1] < d + 50) extend();
    let i = Math.max(1, hint); while (i < rnd.cum.length - 1 && rnd.cum[i] < d) i++; hint = i;
    const a = rnd.pts[i - 1], b = rnd.pts[i], f = (d - rnd.cum[i - 1]) / (rnd.cum[i] - rnd.cum[i - 1] || 1);
    const { x0, x1, y0, y1 } = bounds();
    return [Math.min(x1, Math.max(x0, a[0] + (b[0] - a[0]) * f)), Math.min(y1, Math.max(y0, a[1] + (b[1] - a[1]) * f))];
  }
  function pickEye() {
    if (env.mode !== 'anaglyph') return 'none';
    let e = Math.random() < 0.5 ? 'left' : 'right';
    if (lastEyes.length >= 2 && lastEyes.slice(-2).every(x => x === e)) e = e === 'left' ? 'right' : 'left';
    return e;
  }
  function changeTarget() {
    const set = SETS[o.content].chars;
    let ch = ''; if (set) { do { ch = set[Math.floor(Math.random() * set.length)]; } while (cur && ch === cur.ch); }
    const eye = pickEye(); lastEyes.push(eye); if (lastEyes.length > 4) lastEyes.shift();
    cur = { ch, eye }; shown++; per[eye]++;
  }
  const changeEvery = () => (hasChar(o) ? o.change : 3); // dot only: switches eye every 3 s with glasses

  return {
    id: ID, title: 'Eye Motion', mode: 'anaglyph', modes: ['mono', 'anaglyph'], hud: 'minimal',
    how: 'Follow the gliding circle with your eyes. Say each new number or letter out loud.',
    countHint: () => { const so = eyeMotionOpts(); return hasChar(so) ? `Follow the circle. Say each new ${charWord(so)}` : 'Follow the dot with your eyes'; },

    // ---------- the approved settings page ----------
    renderSetup(el, api) {
      let pv = { raf: 0, x: 0, dir: 1, last: 0, t: 0, next: 0, ch: '', eye: 'left' };
      const draw = () => {
        const so = eyeMotionOpts(), glasses = api.mode === 'anaglyph', L = lens('left'), R = lens('right'), cw = charWord(so), maxCh = Math.floor(so.circle * 0.82);
        el.innerHTML = `
          <div class="ejs">
            <div class="ejs-top">
              <button class="ejs-back" data-x="back">${ICON.arrowLeft}<span>Back</span></button>
              <h1>Eye Motion</h1>
              <button class="ejs-help" data-x="help" aria-expanded="false">How it helps</button>
            </div>
            <div class="ejs-helpbox" hidden>
              <p><b>What you do:</b> a circle glides smoothly along the path you choose (<b>Random</b> is a smooth curve you can't predict). Keep your head still and follow it with your eyes. ${hasChar(so) ? `When the ${cw} inside changes, say it out loud. That's how you know your eyes are really on it.` : 'Keep your eyes right on the dot the whole time.'}</p>
              <p><b>What it trains:</b> smooth following (pursuit), keeping a moving target sharp in the centre of your vision. You use it to follow a ball, a moving car, or text as you scroll.</p>
              <p><b>With colour glasses</b> the circle switches colour now and then, changing which eye can see it. Both eyes have to keep up.</p>
              <p><b>How it helps:</b> the weaker eye often follows less smoothly and loses the target. Pursuit practice is a standard part of vision therapy and works best alongside the contrast and two-eye games.</p>
            </div>
            <div class="ejs-chips" role="radiogroup" aria-label="How to play">
              ${api.modes.map(m => `<button class="ejs-chip" data-mode="${m}" aria-pressed="${api.mode === m}">${m === 'anaglyph' ? `${ICON.glasses}<span>Colour glasses</span>` : `${ICON.patch}<span>Eye patch</span>`}</button>`).join('')}
            </div>
            <p class="ejs-note">${glasses
              ? `Glasses: <b><i class="sw" style="background:${rgbCss(L.rgb)}"></i>${esc(L.name)}</b> left · <b><i class="sw" style="background:${rgbCss(R.rgb)}"></i>${esc(R.name)}</b> right · <button class="ejs-link" data-x="lens">Change</button>`
              : `Patch over your <b>${fellowEye()}</b> (stronger) eye.`}</p>
            <div class="ejs-preview em" aria-label="Preview at real size and speed"><span class="cap">Preview · real size and speed</span><canvas></canvas></div>
            <section class="ejs-sect"><div class="ejs-lab">Inside the circle</div>
              <div class="ejs-chips">${Object.entries(SETS).map(([k, v]) => `<button class="ejs-chip" data-content="${k}" aria-pressed="${so.content === k}" title="${v.name}"><span class="g">${v.label}</span></button>`).join('')}</div></section>
            <section class="ejs-sect"><div class="ejs-lab"><span>Circle size</span><output data-out="circle">${so.circle} px</output></div>
              <div class="ejs-slider"><span class="end" aria-hidden="true"><svg width="10" height="10"><circle cx="5" cy="5" r="4" fill="currentColor"/></svg></span>
              <input type="range" data-range="circle" min="12" max="200" step="2" value="${so.circle}" aria-label="Circle size">
              <span class="end" aria-hidden="true"><svg width="26" height="26"><circle cx="13" cy="13" r="12" fill="currentColor"/></svg></span></div></section>
            <section class="ejs-sect" ${hasChar(so) ? '' : 'hidden'}><div class="ejs-lab"><span>${cw[0].toUpperCase() + cw.slice(1)} size</span><output data-out="char">${Math.min(so.char, maxCh)} px</output></div>
              <div class="ejs-slider"><span class="end g" aria-hidden="true" style="font-size:.8rem">A</span>
              <input type="range" data-range="char" min="6" max="${maxCh}" step="1" value="${Math.min(so.char, maxCh)}" aria-label="${cw} size">
              <span class="end g" aria-hidden="true" style="font-size:1.5rem">A</span></div></section>
            <section class="ejs-sect"><div class="ejs-lab">Path</div>
              <div class="ejs-paths">${PATHS.map(([k, l, ic]) => `<button class="ejs-ptile" data-path="${k}" aria-pressed="${so.path === k}"><span class="box">${ic}</span><span>${l}</span></button>`).join('')}</div></section>
            <section class="ejs-sect"><div class="ejs-lab"><span>Speed</span><output data-out="speed">${speedWord(so.speed)} · ${so.speed} px/s</output></div>
              <div class="ejs-slider"><span class="end txt">Slow</span><input type="range" data-range="speed" min="60" max="800" step="10" value="${so.speed}" aria-label="Speed"><span class="end txt">Fast</span></div></section>
            <section class="ejs-sect" ${hasChar(so) ? '' : 'hidden'}><div class="ejs-lab">New ${cw} every</div>
              <div class="ejs-chips">${CHANGES.map(([v, l]) => `<button class="ejs-chip" data-change="${v}" aria-pressed="${so.change === v}">${l}<small>s</small></button>`).join('')}</div></section>
            <section class="ejs-sect"><div class="ejs-lab">How long</div>
              <div class="ejs-dur">${DURS.map(([v, l]) => `<button data-dur="${v}" aria-pressed="${so.dur === v}"><span class="dot"></span>${l}</button>`).join('')}</div></section>
            <div class="ejs-startbar">
              <button class="ejs-start" data-x="start">${ICON.play}<span>Start</span></button>
              <p class="ejs-hint">During play: <b>Space</b> pauses · <b>Back</b> finishes</p>
            </div>
          </div>`;
        sizePreview();
      };
      // The preview moves the circle back and forth at the real speed.
      const sizePreview = () => {
        const box = el.querySelector('.ejs-preview'), cv = box.querySelector('canvas'), so = eyeMotionOpts();
        const dpr = Math.min(window.devicePixelRatio || 1, 2), w = Math.max(200, box.clientWidth - 2), h = Math.max(144, so.circle + 40);
        cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.width = w + 'px'; cv.style.height = h + 'px';
        box.style.minHeight = h + 'px';
      };
      const tick = t => {
        if (!el.isConnected) { pv.raf = 0; return; }
        const cv = el.querySelector('.ejs-preview canvas'); if (!cv) { pv.raf = requestAnimationFrame(tick); return; }
        const so = eyeMotionOpts(), glasses = api.mode === 'anaglyph';
        const dt = Math.min(0.1, (t - (pv.last || t)) / 1000); pv.last = t; pv.t += dt;
        const dpr = cv.width / parseFloat(cv.style.width), w = cv.width / dpr, h = cv.height / dpr, r = so.circle / 2, span = Math.max(0, w - 2 * r - 20);
        pv.x += pv.dir * so.speed * dt;
        if (pv.x > span) { pv.x = span; pv.dir = -1; pv.eye = pv.eye === 'left' ? 'right' : 'left'; }
        if (pv.x < 0) { pv.x = 0; pv.dir = 1; pv.eye = pv.eye === 'left' ? 'right' : 'left'; }
        if (hasChar(so) && (pv.t >= pv.next || !pv.ch || !SETS[so.content].chars.includes(pv.ch))) { const set = SETS[so.content].chars; pv.ch = set[Math.floor(Math.random() * set.length)]; pv.next = pv.t + so.change; }
        const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
        drawTarget(c, r + 10 + pv.x, h / 2 + 6, so, hasChar(so) ? pv.ch : '', glasses ? rgbCss(lens(pv.eye).rgb) : 'rgb(235,235,235)');
        pv.raf = requestAnimationFrame(tick);
      };
      const set = (patch, focusSel) => { saveOpts({ ...eyeMotionOpts(), ...patch }); draw(); if (focusSel) { const n = el.querySelector(focusSel); if (n) n.focus(); } };
      el.onclick = e => {
        const b = e.target.closest('button'); if (!b) return;
        const d = b.dataset;
        if (d.x === 'back') { cancelAnimationFrame(pv.raf); api.close(); }
        else if (d.x === 'lens') { cancelAnimationFrame(pv.raf); api.close('#setup-glasses'); }
        else if (d.x === 'help') { const h = el.querySelector('.ejs-helpbox'); h.hidden = !h.hidden; b.setAttribute('aria-expanded', String(!h.hidden)); }
        else if (d.x === 'start') { cancelAnimationFrame(pv.raf); api.start(eyeMotionOpts().dur / 60); }
        else if (d.mode) { api.setMode(d.mode); draw(); el.querySelector(`[data-mode="${d.mode}"]`).focus(); }
        else if (d.content) set({ content: d.content }, `[data-content="${d.content}"]`);
        else if (d.path) set({ path: d.path }, `[data-path="${d.path}"]`);
        else if (d.change) set({ change: +d.change }, `[data-change="${d.change}"]`);
        else if (d.dur) set({ dur: +d.dur }, `[data-dur="${d.dur}"]`);
      };
      el.oninput = e => {
        const r = e.target.closest('[data-range]'); if (!r) return;
        const so = eyeMotionOpts(), k = r.dataset.range, v = +r.value;
        so[k] = v;
        if (k === 'circle') {
          const max = Math.floor(v * 0.82), ch = el.querySelector('[data-range="char"]');
          ch.max = max; if (so.char > max) { so.char = max; ch.value = max; }
          el.querySelector('[data-out="char"]').textContent = `${Math.min(so.char, max)} px`;
        }
        el.querySelector(`[data-out="${k}"]`).textContent = k === 'speed' ? `${speedWord(v)} · ${v} px/s` : `${v} px`;
        saveOpts(so);
        if (k === 'circle') sizePreview();
      };
      draw();
      pv.raf = requestAnimationFrame(tick);
      el.querySelector('[data-x="start"]').focus({ preventScroll: true });
    },

    // ---------- play ----------
    init(e) {
      env = e; o = eyeMotionOpts(); W = env.w; H = env.h;
      setupPath(); changeTarget(); nextChange = changeEvery();
    },
    onResize(w, h) { W = w; H = h; setupPath(); },
    update() {
      // Driven by real active time, so speed and timing stay exact even if a frame is slow.
      if (env.elapsed >= nextChange) { changeTarget(); nextChange += changeEvery(); }
    },
    draw(a, f) {
      if (!cur) return;
      const [x, y] = position(o.speed * env.elapsed);
      const c = cur.eye === 'none' || cur.eye === db.settings.amblyopicEye ? a : f;
      drawTarget(c, x, y, o, cur.ch, cur.eye === 'none' ? 'rgb(235,235,235)' : '#fff');
    },
    params() { return { bgA: 0, bgF: 0 }; },
    result() {
      const L = lens('left'), R = lens('right'), glasses = env.mode === 'anaglyph', pname = PATHS.find(p => p[0] === o.path)[1];
      const sum = [['Time', fmtDur(Math.min(env.elapsed, o.dur))], ['Path', pname], ['Speed', speedWord(o.speed)]];
      if (hasChar(o)) sum.push([`${charWord(o)[0].toUpperCase() + charWord(o).slice(1)}s shown`, shown]);
      if (glasses) sum.push([`Turns for your left eye (${esc(L.name)})`, per.left], [`Turns for your right eye (${esc(R.name)})`, per.right]);
      const cw = charWord(o);
      return {
        trials: shown, threshold: null, unit: null, score: null, headline: 'Well done', summary: sum,
        extra: { content: o.content, circle: o.circle, char: o.char, path: o.path, speed: o.speed, change: o.change, left: per.left, right: per.right },
        ask: hasChar(o)
          ? { q: `How many ${cw}s could you read?`, options: [
              ['all', 'All of them', `Great. Next time try faster or a smaller ${cw}.`],
              ['most', 'Most', 'Good. Stay at this speed until it feels easy.'],
              ['few', 'Only some', `Make it easier: slower or a bigger ${cw}.${glasses ? ' If one colour was harder to follow, that eye needs the most practice.' : ''}`]] }
          : { q: 'How well could you follow it?', options: [
              ['all', 'Easily', 'Great. Next time try faster or a smaller dot.'],
              ['most', 'Mostly', 'Good. Stay at this speed until it feels easy.'],
              ['few', 'Lost it often', `Make it easier: slower, or a simple path like a line or ring.${glasses ? ' If one colour was harder, that eye needs the most practice.' : ''}`]] },
      };
    },
  };
}
