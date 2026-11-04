// Split Vision (approved design, after EYEBAB): keep your eyes on the small object in the centre; around it, 3-6 objects
// sit on a ring that can turn slowly. Tap the one that matches the centre. Settings follow EYEBAB: what to match
// (Colors, Numbers, Letters, Figures, Mixed), how many objects, size and distance, plus ring movement.
// With colour glasses the centre is seen by both eyes and the ring objects are split between the eyes.
// Colors need the eye patch (glasses change colours); they are drawn on the runner's colour layer.
import { db, save, fellowEye } from '../store.js';
import { lens, rgbCss } from '../lens.js';
import { ICON } from '../icons.js';
import { esc } from '../util.js';

const ID = 'split-vision';
const GLYPH = 'Calibri, Carlito, "Segoe UI", Arial, sans-serif';
const SHAPES = ['circle', 'square', 'triangle', 'diamond', 'star', 'plus', 'heart', 'moon', 'hexagon', 'arrow', 'cross', 'drop'];
const DOTS = { red: '#ff3b30', orange: '#ff9500', yellow: '#ffd60a', green: '#34c759', blue: '#3a6bff', purple: '#b05cf0', pink: '#ff6fae', white: '#f2f2f2' };
const CONTENT = {
  colors: { label: 'Colors', set: Object.keys(DOTS).map(k => '@' + k) },
  numbers: { label: 'Numbers', set: '0123456789'.split('') },
  letters: { label: 'Letters', set: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('') },
  figures: { label: 'Figures', set: SHAPES.map(s => '#' + s) },
  mixed: { label: 'Mixed', set: null },
};
const COUNTS = [[3, 'Three objects'], [4, 'Four objects'], [5, 'Five objects'], [6, 'Six objects']];
const SIZES = [['large', 'Large', 0.12], ['medium', 'Medium', 0.085], ['small', 'Small', 0.06], ['xsmall', 'Extra small', 0.035]];
const DISTS = [['low', 'Low distance', 0.38], ['medium', 'Medium distance', 0.64], ['high', 'High distance', 0.9]];
const SPINS = [['still', 'Still', 0], ['slow', 'Slow turn', 14], ['fast', 'Faster turn', 30]]; // degrees per second
const DURS = [[30, '30 sec.'], [60, '1 min.'], [120, '2 min.'], [180, '3 min.'], [300, '5 min.']];
const DEF = { content: 'numbers', count: 4, size: 'medium', dist: 'medium', spin: 'slow', dur: 60 };
const SECTOR_NAMES = ['right', 'lower right', 'below', 'lower left', 'left', 'upper left', 'above', 'upper right'];
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const avgOf = a => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
const find = (list, k) => list.find(x => x[0] === k) || list[1];

export function splitVisionOpts() {
  const o = { ...DEF, ...((db.state.opts || {})[ID] || {}) };
  o.count = +o.count; o.dur = +o.dur;
  if (!CONTENT[o.content]) o.content = DEF.content;
  return o;
}
function saveOpts(o) { db.state.opts = db.state.opts || {}; db.state.opts[ID] = o; save(); }
const bothRgb = () => [0, 1, 2].map(i => Math.min(255, lens('left').rgb[i] + lens('right').rgb[i]));
const contentFor = (o, glasses) => (glasses && o.content === 'colors' ? 'mixed' : o.content);
const poolFor = (c, glasses) => (c === 'mixed' ? [...CONTENT.numbers.set, ...CONTENT.letters.set, ...CONTENT.figures.set, ...(glasses ? [] : CONTENT.colors.set)] : CONTENT[c].set);

// ---------- tile icons (like EYEBAB's) ----------
const dotsIcon = n => { const pos = { 3: [[-8, 0], [0, 0], [8, 0]], 4: [[-12, 0], [-4, 0], [4, 0], [12, 0]], 5: [[-4, -4], [4, -4], [-8, 4], [0, 4], [8, 4]], 6: [[-8, -4], [0, -4], [8, -4], [-8, 4], [0, 4], [8, 4]] }[n]; return `<svg viewBox="-17 -9 34 18" fill="currentColor" aria-hidden="true">${pos.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3.9"/>`).join('')}</svg>`; };
const sizeIcon = r => `<svg viewBox="-12 -9 24 18" fill="currentColor" aria-hidden="true"><circle r="${r}"/></svg>`;
const arrowIcon = l => `<svg viewBox="-17 -9 34 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M${-l} 0H${l}M${-l + 4} -3.5L${-l} 0L${-l + 4} 3.5M${l - 4} -3.5L${l} 0L${l - 4} 3.5"/></svg>`;
const spinIcon = k => (k === 'still' ? '<svg viewBox="-17 -9 34 18" fill="currentColor" aria-hidden="true"><circle r="1.6"/><circle cx="7" r="2.2"/><circle cx="-3.5" cy="6" r="2.2"/><circle cx="-3.5" cy="-6" r="2.2"/></svg>'
  : `<svg viewBox="-17 -9 34 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 0A7 7 0 1 1 0 -7"/><path d="M-2.5 -9.5L0 -7L-2.5 -4.5"/>${k === 'fast' ? '<path d="M11.5 -5A12 12 0 0 1 11.5 5"/><path d="M-11.5 5A12 12 0 0 1 -11.5 -5"/>' : ''}</svg>`);
const colorsIcon = '<svg viewBox="-17 -9 34 18" aria-hidden="true"><circle cx="-4" cy="0" r="6.5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="4" cy="0" r="6.5" fill="currentColor"/></svg>';
const TILE_ICON = {
  colors: colorsIcon, numbers: '<span class="txt">5</span>', letters: '<span class="txt">A</span>',
  figures: '<svg class="wide" viewBox="0 0 44 22" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="3" width="15" height="15" rx="1.5"/><circle cx="33" cy="11" r="8.5"/></svg>',
  mixed: `<span class="mix">${colorsIcon}<span class="txt">5A</span></span>`,
};
const tile = (attr, val, on, icon, label, disabled) => `<button class="ejs-ptile" data-${attr}="${val}" aria-pressed="${on}" ${disabled ? 'disabled title="Colors need the eye patch: colour glasses change the colours"' : ''}><span class="box">${icon}</span><span>${label}</span></button>`;

// ---------- drawing ----------
function shapePath(c, name, x, y, s) {
  const r = s / 2;
  c.beginPath();
  switch (name) {
    case 'circle': c.arc(x, y, r * 0.85, 0, Math.PI * 2); break;
    case 'square': c.rect(x - r * 0.75, y - r * 0.75, r * 1.5, r * 1.5); break;
    case 'triangle': c.moveTo(x, y - r * 0.9); c.lineTo(x + r * 0.9, y + r * 0.72); c.lineTo(x - r * 0.9, y + r * 0.72); c.closePath(); break;
    case 'diamond': c.moveTo(x, y - r * 0.95); c.lineTo(x + r * 0.7, y); c.lineTo(x, y + r * 0.95); c.lineTo(x - r * 0.7, y); c.closePath(); break;
    case 'star': for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.4 : r * 0.95; c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } c.closePath(); break;
    case 'plus': { const t = r * 0.28, l = r * 0.85; c.moveTo(x - t, y - l); c.lineTo(x + t, y - l); c.lineTo(x + t, y - t); c.lineTo(x + l, y - t); c.lineTo(x + l, y + t); c.lineTo(x + t, y + t); c.lineTo(x + t, y + l); c.lineTo(x - t, y + l); c.lineTo(x - t, y + t); c.lineTo(x - l, y + t); c.lineTo(x - l, y - t); c.lineTo(x - t, y - t); c.closePath(); break; }
    case 'heart': c.moveTo(x, y + r * 0.8); c.bezierCurveTo(x - r * 1.2, y - r * 0.1, x - r * 0.55, y - r * 1.0, x, y - r * 0.35); c.bezierCurveTo(x + r * 0.55, y - r * 1.0, x + r * 1.2, y - r * 0.1, x, y + r * 0.8); c.closePath(); break;
    case 'moon': c.arc(x, y, r * 0.85, Math.PI * 0.3, Math.PI * 1.7); c.arc(x + r * 0.42, y, r * 0.62, Math.PI * 1.25, Math.PI * 0.75, true); c.closePath(); break;
    case 'hexagon': for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; c.lineTo(x + Math.cos(a) * r * 0.88, y + Math.sin(a) * r * 0.88); } c.closePath(); break;
    case 'arrow': c.moveTo(x, y - r * 0.9); c.lineTo(x + r * 0.75, y - r * 0.1); c.lineTo(x + r * 0.3, y - r * 0.1); c.lineTo(x + r * 0.3, y + r * 0.85); c.lineTo(x - r * 0.3, y + r * 0.85); c.lineTo(x - r * 0.3, y - r * 0.1); c.lineTo(x - r * 0.75, y - r * 0.1); c.closePath(); break;
    case 'cross': { const t = r * 0.2, l = r * 0.8; c.moveTo(x - l, y - l + t); c.lineTo(x - l + t, y - l); c.lineTo(x, y - t); c.lineTo(x + l - t, y - l); c.lineTo(x + l, y - l + t); c.lineTo(x + t, y); c.lineTo(x + l, y + l - t); c.lineTo(x + l - t, y + l); c.lineTo(x, y + t); c.lineTo(x - l + t, y + l); c.lineTo(x - l, y + l - t); c.lineTo(x - t, y); c.closePath(); break; }
    case 'drop': c.moveTo(x, y - r * 0.95); c.bezierCurveTo(x + r * 0.35, y - r * 0.4, x + r * 0.78, y + r * 0.05, x + r * 0.78, y + r * 0.35); c.arc(x, y + r * 0.35, r * 0.78, 0, Math.PI); c.bezierCurveTo(x - r * 0.78, y + r * 0.05, x - r * 0.35, y - r * 0.4, x, y - r * 0.95); c.closePath(); break;
  }
}
// One object: a number or letter (regular weight), a thin outline figure, or a coloured dot.
function drawObj(c, ch, x, y, size, colour) {
  if (ch[0] === '@') { c.fillStyle = DOTS[ch.slice(1)]; c.beginPath(); c.arc(x, y, size * 0.36, 0, Math.PI * 2); c.fill(); return; }
  if (ch[0] === '#') { c.strokeStyle = colour; c.lineWidth = Math.max(1.4, size / 18); c.lineJoin = 'round'; shapePath(c, ch.slice(1), x, y, size * 0.72); c.stroke(); return; }
  c.fillStyle = colour; c.font = `400 ${size}px ${GLYPH}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(ch, x, y + size * 0.04);
}
function geometry(o, w, h) {
  const U = Math.min(w, h), size = Math.max(14, U * find(SIZES, o.size)[2]), centre = Math.max(14, size * 0.6);
  const R = Math.max(size * 1.6, (U / 2 - size * 0.7 - 30) * find(DISTS, o.dist)[2]);
  return { cx: w / 2, cy: h / 2, size, centre, R };
}
// A round: the centre object and the ring, exactly one object of which matches it.
function makeRound(o, g, glasses, matchEye) {
  const pool = poolFor(contentFor(o, glasses), glasses), target = pool[Math.floor(Math.random() * pool.length)];
  const objs = shuffle([target, ...shuffle(pool.filter(x => x !== target)).slice(0, o.count - 1)]);
  const off = Math.random() * Math.PI * 2, step = Math.PI * 2 / o.count;
  // with glasses the match goes to matchEye and the rest are shared so both eyes get an even half
  const n = objs.length, wantMatch = Math.ceil(n / 2) - 1, otherEye = matchEye === 'left' ? 'right' : 'left';
  const restEyes = glasses ? shuffle(Array.from({ length: n - 1 }, (_, i) => (i < wantMatch ? matchEye : otherEye))) : null;
  let ri = 0;
  return {
    target, rot: 0, dir: Math.random() < 0.5 ? 1 : -1,
    items: objs.map((ch, i) => {
      const a = off + i * step + (Math.random() - 0.5) * step * 0.25;
      return { ch, a, x: g.cx + Math.cos(a) * g.R, y: g.cy + Math.sin(a) * g.R, target: ch === target, eye: !glasses ? 'none' : ch === target ? matchEye : restEyes[ri++], crossed: false };
    }),
  };
}
function turnRing(o, r, g, dt) {
  r.rot += r.dir * find(SPINS, o.spin)[2] * Math.PI / 180 * dt;
  for (const it of r.items) { it.x = g.cx + Math.cos(it.a + r.rot) * g.R; it.y = g.cy + Math.sin(it.a + r.rot) * g.R; }
}
function timeMap(sectors) {
  const cx = 60, cy = 60, R = 52;
  let paths = '';
  sectors.forEach((ts, i) => {
    const a0 = (i - 0.5) * Math.PI / 4, a1 = (i + 0.5) * Math.PI / 4, av = avgOf(ts);
    const fill = av == null ? '#e3ebea' : av < 1.5 ? '#1b7a4b' : av < 3 ? '#7cc29c' : av < 5 ? '#f0b45a' : '#d9534f';
    const p = (a, r) => `${(cx + Math.cos(a) * r).toFixed(1)},${(cy + Math.sin(a) * r).toFixed(1)}`;
    paths += `<path d="M${p(a0, 10)} L${p(a0, R)} A${R},${R} 0 0 1 ${p(a1, R)} L${p(a1, 10)} A10,10 0 0 0 ${p(a0, 10)} Z" fill="${fill}" stroke="#fff" stroke-width="2"><title>${SECTOR_NAMES[i]}: ${av == null ? 'none yet' : av.toFixed(1) + ' s'}</title></path>`;
  });
  return `<div class="fovmap"><svg viewBox="0 0 120 120" role="img" aria-label="Map of how quickly you found the match in each direction">${paths}<circle cx="60" cy="60" r="4" fill="#17292c"/></svg>
    <div class="fovlegend"><b>Time to find</b><span><i style="background:#1b7a4b"></i>quick</span><span><i style="background:#7cc29c"></i>good</span><span><i style="background:#f0b45a"></i>slower</span><span><i style="background:#d9534f"></i>slowest</span></div></div>`;
}

export function splitVision() {
  let env, o, W = 0, H = 0, G = null, round = null, shownAt = 0, matchTurn = 0, lastT = 0;
  let hits = 0, wrong = 0, times = [], sectors = [], perEye = {}, fx = [];
  const glasses = () => env.mode === 'anaglyph';
  function newRound() { round = makeRound(o, G, glasses(), ['left', 'right'][matchTurn++ % 2]); shownAt = env.elapsed; }
  const corner = () => env.setCorner(`Found ${hits}`);

  return {
    id: ID, title: 'Split Vision', mode: 'anaglyph', modes: ['mono', 'anaglyph'], hud: 'minimal',
    how: 'Keep your eyes on the centre and tap the object around it that matches.',
    countHint: () => 'Keep your eyes on the centre. Tap the object around it that matches.',

    // ---------- the approved settings page ----------
    renderSetup(el, api) {
      let pv = { raf: 0, t: 0, last: 0, round: null, shown: 0, eye: 'left' };
      const draw = () => {
        const so = splitVisionOpts(), gl = api.mode === 'anaglyph', L = lens('left'), R = lens('right');
        el.innerHTML = `
          <div class="ejs">
            <div class="ejs-top">
              <button class="ejs-back" data-x="back">${ICON.arrowLeft}<span>Back</span></button>
              <h1>Split Vision</h1>
              <button class="ejs-help" data-x="help" aria-expanded="false">How it helps</button>
            </div>
            <div class="ejs-helpbox" hidden>
              <p><b>What you do:</b> keep your eyes on the small object in the centre. Around it, ${so.count} objects sit at the same distance. One of them matches the centre. Find it with your side vision and tap it, and the next round comes straight away. A wrong tap is crossed out and you try again.</p>
              <p><b>What it trains:</b> splitting your attention between the centre and the side: holding your gaze still while you take in what's around you. Higher distance pushes the objects further into your side vision. With ring movement on, the ring turns slowly, so you also follow it with your side vision while your eyes stay still.</p>
              <p><b>With colour glasses</b> the centre object is seen by both eyes, and the objects around it are split between your left and right eye. The match takes turns between the eyes. Colors need the eye patch, because the glasses change every colour.</p>
              <p>The map at the end shows which directions took you longest.</p>
            </div>
            <div class="ejs-chips" role="radiogroup" aria-label="How to play">
              ${api.modes.map(m => `<button class="ejs-chip" data-mode="${m}" aria-pressed="${api.mode === m}">${m === 'anaglyph' ? `${ICON.glasses}<span>Colour glasses</span>` : `${ICON.patch}<span>Eye patch</span>`}</button>`).join('')}
            </div>
            <p class="ejs-note">${gl
              ? `Glasses: <b><i class="sw" style="background:${rgbCss(L.rgb)}"></i>${esc(L.name)}</b> left · <b><i class="sw" style="background:${rgbCss(R.rgb)}"></i>${esc(R.name)}</b> right · <button class="ejs-link" data-x="lens">Change</button>`
              : `Patch over your <b>${fellowEye()}</b> (stronger) eye.`}</p>
            <div class="ejs-preview em" aria-label="Preview"><span class="cap">Preview · smaller than on screen</span><canvas></canvas></div>
            <section class="ejs-sect"><div class="ejs-lab">What to match</div>
              <div class="ejs-paths pc t5">${Object.entries(CONTENT).map(([k, v]) => tile('content', k, contentFor(so, gl) === k, TILE_ICON[k], v.label, k === 'colors' && gl)).join('')}</div>
              ${gl ? '<p class="ejs-hint" style="text-align:left">Colors need the eye patch: colour glasses change the colours. Mixed uses numbers, letters and figures.</p>' : ''}</section>
            <section class="ejs-sect"><div class="ejs-lab">Objects</div>
              <div class="ejs-paths pc t4">${COUNTS.map(([n, l]) => tile('count', n, so.count === n, dotsIcon(n), l)).join('')}</div></section>
            <section class="ejs-sect"><div class="ejs-lab">Size</div>
              <div class="ejs-paths pc t4">${SIZES.map(([k, l], i) => tile('size', k, so.size === k, sizeIcon([7.5, 5.5, 3.8, 2.2][i]), l)).join('')}</div></section>
            <section class="ejs-sect"><div class="ejs-lab">Distance</div>
              <div class="ejs-paths pc t3n">${DISTS.map(([k, l], i) => tile('dist', k, so.dist === k, arrowIcon([7, 11, 15][i]), l)).join('')}</div></section>
            <section class="ejs-sect"><div class="ejs-lab">Ring movement</div>
              <div class="ejs-paths pc t3n">${SPINS.map(([k, l]) => tile('spin', k, so.spin === k, spinIcon(k), l)).join('')}</div></section>
            <section class="ejs-sect"><div class="ejs-lab">How long</div>
              <div class="ejs-dur">${DURS.map(([v, l]) => `<button data-dur="${v}" aria-pressed="${so.dur === v}"><span class="dot"></span>${l}</button>`).join('')}</div></section>
            <div class="ejs-startbar">
              <button class="ejs-start" data-x="start">${ICON.play}<span>Start</span></button>
              <p class="ejs-hint">Eyes on the centre · tap the matching object · <b>Space</b> pauses · <b>Back</b> finishes</p>
            </div>
          </div>`;
        const box = el.querySelector('.ejs-preview'), cv = box.querySelector('canvas'), dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = Math.max(200, box.clientWidth - 2), h = Math.round(w * 0.58) + 24;
        cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.width = w + 'px'; cv.style.height = h + 'px';
        box.style.minHeight = h + 'px'; pv.round = null;
      };
      const tick = t => {
        if (!el.isConnected) { pv.raf = 0; return; }
        const cv = el.querySelector('.ejs-preview canvas'); if (!cv) { pv.raf = requestAnimationFrame(tick); return; }
        const so = splitVisionOpts(), gl = api.mode === 'anaglyph';
        const dpr = cv.width / parseFloat(cv.style.width), w = cv.width / dpr, h = cv.height / dpr;
        const dt = Math.min(0.1, (t - (pv.last || t)) / 1000); pv.last = t; pv.t += dt;
        const g = geometry(so, w, h - 24);
        if (!pv.round || pv.t - pv.shown > 2.6) { pv.eye = pv.eye === 'left' ? 'right' : 'left'; pv.round = makeRound(so, g, gl, pv.eye); pv.shown = pv.t; }
        turnRing(so, pv.round, g, dt);
        const col = eye => (eye === 'none' ? 'rgb(235,235,235)' : rgbCss(eye === 'both' ? bothRgb() : lens(eye).rgb));
        const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h); c.translate(0, 24);
        drawObj(c, pv.round.target, g.cx, g.cy, g.centre, col(gl ? 'both' : 'none'));
        for (const it of pv.round.items) {
          drawObj(c, it.ch, it.x, it.y, g.size, col(it.eye));
          if (it.target && pv.t - pv.shown > 1.3) { c.strokeStyle = 'rgba(255,255,255,.85)'; c.lineWidth = 2; c.beginPath(); c.arc(it.x, it.y, g.size * 0.72, 0, Math.PI * 2); c.stroke(); }
        }
        pv.raf = requestAnimationFrame(tick);
      };
      const set = (patch, focusSel) => { saveOpts({ ...splitVisionOpts(), ...patch }); draw(); if (focusSel) { const nn = el.querySelector(focusSel); if (nn) nn.focus(); } };
      el.onclick = e => {
        const b = e.target.closest('button'); if (!b || b.disabled) return;
        const d = b.dataset;
        if (d.x === 'back') { cancelAnimationFrame(pv.raf); api.close(); }
        else if (d.x === 'lens') { cancelAnimationFrame(pv.raf); api.close('#setup-glasses'); }
        else if (d.x === 'help') { const hb = el.querySelector('.ejs-helpbox'); hb.hidden = !hb.hidden; b.setAttribute('aria-expanded', String(!hb.hidden)); }
        else if (d.x === 'start') { cancelAnimationFrame(pv.raf); api.start(splitVisionOpts().dur / 60); }
        else if (d.mode) {
          api.setMode(d.mode);
          if (d.mode === 'anaglyph' && splitVisionOpts().content === 'colors') saveOpts({ ...splitVisionOpts(), content: 'mixed' });
          draw(); el.querySelector(`[data-mode="${d.mode}"]`).focus();
        }
        else if (d.content) set({ content: d.content }, `[data-content="${d.content}"]`);
        else if (d.count) set({ count: +d.count }, `[data-count="${d.count}"]`);
        else if (d.size) set({ size: d.size }, `[data-size="${d.size}"]`);
        else if (d.dist) set({ dist: d.dist }, `[data-dist="${d.dist}"]`);
        else if (d.spin) set({ spin: d.spin }, `[data-spin="${d.spin}"]`);
        else if (d.dur) set({ dur: +d.dur }, `[data-dur="${d.dur}"]`);
      };
      draw();
      pv.raf = requestAnimationFrame(tick);
      el.querySelector('[data-x="start"]').focus({ preventScroll: true });
    },

    // ---------- play ----------
    init(e) {
      env = e; o = splitVisionOpts(); W = env.w; H = env.h; G = geometry(o, W, H); lastT = env.elapsed;
      hits = 0; wrong = 0; times = []; fx = []; perEye = {}; sectors = Array.from({ length: 8 }, () => []); matchTurn = Math.floor(Math.random() * 2);
      newRound(); corner();
      if (/[?&]test\b/.test(location.search)) window.__sv = () => ({ target: round.target, items: round.items.map(({ ch, x, y, target, eye }) => ({ ch, x, y, target, eye })), hits, wrong, G, rot: round.rot }); // automated checks only
    },
    onResize(w, h) { W = w; H = h; G = geometry(o, W, H); if (round) turnRing(o, round, G, 0); },
    update() {
      const dt = Math.min(0.25, env.elapsed - lastT); lastT = env.elapsed; // real time, so the turn speed holds even if a frame is slow
      if (round) turnRing(o, round, G, dt);
      if (fx.length) fx = fx.filter(f => env.elapsed - f.t0 < 0.45);
    },
    draw(a, f) {
      if (!round) return;
      const amb = db.settings.amblyopicEye, gl = glasses(), both = gl ? [a, f] : [a];
      const layerOf = eye => (eye === 'none' || eye === amb ? a : f), fill = eye => (eye === 'none' ? 'rgb(235,235,235)' : '#fff');
      if (round.target[0] !== '@') for (const c of both) drawObj(c, round.target, G.cx, G.cy, G.centre, gl ? '#fff' : 'rgb(235,235,235)');
      for (const it of round.items) {
        if (it.ch[0] !== '@') { const c = layerOf(it.eye); c.globalAlpha = it.crossed ? 0.25 : 1; drawObj(c, it.ch, it.x, it.y, G.size, fill(it.eye)); c.globalAlpha = 1; }
        if (it.crossed) for (const c of both) { const q = G.size * 0.4; c.strokeStyle = 'rgba(255,255,255,0.8)'; c.lineWidth = 2.5; c.beginPath(); c.moveTo(it.x - q, it.y - q); c.lineTo(it.x + q, it.y + q); c.moveTo(it.x + q, it.y - q); c.lineTo(it.x - q, it.y + q); c.stroke(); }
      }
      for (const c of both) for (const fl of fx) { const k = (env.elapsed - fl.t0) / 0.45; c.strokeStyle = `rgba(255,255,255,${0.85 * (1 - k)})`; c.lineWidth = 3; c.beginPath(); c.arc(fl.x, fl.y, G.size * 0.6 + 14 * k, 0, Math.PI * 2); c.stroke(); }
    },
    // Coloured dots go on the runner's colour layer (only with the eye patch).
    drawColour(c) {
      if (!round) return;
      if (round.target[0] === '@') drawObj(c, round.target, G.cx, G.cy, G.centre);
      for (const it of round.items) if (it.ch[0] === '@') { c.globalAlpha = it.crossed ? 0.25 : 1; drawObj(c, it.ch, it.x, it.y, G.size); c.globalAlpha = 1; }
    },
    params() { return { bgA: 0, bgF: 0 }; },
    onPointer(x, y, type) {
      if (type !== 'pointerdown' || !round) return;
      let best = null, bd = Infinity;
      for (const it of round.items) { const d = Math.hypot(x - it.x, y - it.y); if (d < bd) { bd = d; best = it; } }
      if (!best || bd > Math.max(G.size * 0.8, 26) || best.crossed) return; // empty space: nothing happens
      if (best.target) {
        const tt = env.elapsed - shownAt, sec = ((Math.round((best.a + round.rot) / (Math.PI / 4)) % 8) + 8) % 8;
        hits++; times.push(tt); sectors[sec].push(tt); (perEye[best.eye] = perEye[best.eye] || []).push(tt);
        fx.push({ x: best.x, y: best.y, t0: env.elapsed }); env.sfx.good();
        newRound(); corner(); // straight to the next one
      } else { best.crossed = true; wrong++; env.sfx.bad(); }
    },
    onKey() { return false; },
    result() {
      env.setCorner('');
      if (!hits && !wrong) return null;
      const gl = glasses(), L = lens('left'), R = lens('right'), avg = avgOf(times);
      const rated = sectors.map((ts, i) => ({ i, av: avgOf(ts), n: ts.length })).filter(s => s.n >= 1);
      const slow = [...rated].sort((p, q) => q.av - p.av)[0], quick = [...rated].sort((p, q) => p.av - q.av)[0];
      const eyeLine = eye => { const arr = perEye[eye] || []; return arr.length ? `${arr.length} · ${avgOf(arr).toFixed(1)} s each` : 'none'; };
      const summary = [['Found', `${hits}`]];
      if (avg != null) summary.push(['Average time to find', `${avg.toFixed(1)} s`]);
      summary.push(['Wrong taps', `${wrong}`]);
      if (gl) summary.push([`Match for left eye (${esc(L.name)})`, eyeLine('left')], [`Match for right eye (${esc(R.name)})`, eyeLine('right')]);
      summary.push(['Settings', `${CONTENT[contentFor(o, gl)].label} · ${o.count} objects · ${find(SIZES, o.size)[1]} · ${find(DISTS, o.dist)[1]} · ${find(SPINS, o.spin)[1]}`]);
      summary.push(['Slowest direction', slow && quick && slow.i !== quick.i && slow.av > quick.av * 1.3 ? `${SECTOR_NAMES[slow.i]} (${slow.av.toFixed(1)} s)` : 'none, about equal']);
      return {
        complete: env.elapsed >= o.dur - 0.5, trials: hits + wrong, correct: hits, threshold: null, unit: null, score: null,
        headline: 'Well done', summary, html: hits >= 3 ? timeMap(sectors) : '',
        extra: { content: contentFor(o, gl), count: o.count, size: o.size, dist: o.dist, spin: o.spin, found: hits, wrong, avg,
          left: perEye.left ? perEye.left.length : 0, right: perEye.right ? perEye.right.length : 0 },
      };
    },
  };
}
