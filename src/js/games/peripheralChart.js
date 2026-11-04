// Peripheral Chart (approved design, after EYEBAB): a circle in the middle shows a character. Characters run out
// from it on 4, 6 or 8 spokes, four per spoke, growing bigger towards the edge. Exactly one matches the centre;
// find it with side vision and tap it. A helper slowly blinks the match after 5 or 10 seconds.
// With colour glasses the chart uses three colours: left eye only, right eye only, and both eyes (combined).
import { db, save, fellowEye } from '../store.js';
import { lens, rgbCss } from '../lens.js';
import { ICON } from '../icons.js';
import { esc } from '../util.js';

const ID = 'peripheral-chart';
const GLYPH = 'Calibri, Carlito, "Segoe UI", Arial, sans-serif';
const SHAPES = ['circle', 'square', 'triangle', 'diamond', 'star', 'plus', 'heart', 'moon', 'hexagon', 'arrow', 'cross', 'drop'];
const CONTENT = {
  figures: { label: 'Figures', set: SHAPES.map(s => '#' + s), word: 'figure' },
  numbers: { label: 'Numbers', set: '0123456789'.split(''), word: 'number' },
  letters: { label: 'Letters', set: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''), word: 'letter' },
};
// Spoke directions in steps of 45° (0 = right, 2 = down, 4 = left, 6 = up).
const DIRS = {
  four: { label: 'Four directions', steps: [1, 3, 5, 7] },
  six: { label: 'Six directions', steps: [1, 2, 3, 5, 6, 7] },
  eight: { label: 'Eight directions', steps: [0, 1, 2, 3, 4, 5, 6, 7] },
};
// Four characters per spoke: how far out (fraction of the way) and how big (fraction of half the screen).
const RING_U = [0.25, 0.43, 0.67, 1];
const SIZES = { large: { label: 'Large', k: [0.096, 0.15, 0.21, 0.27] }, normal: { label: 'Normal', k: [0.08, 0.125, 0.175, 0.225] } };
const HELPERS = [[5, 'Helper 5 sec.'], [10, 'Helper 10 sec.'], [0, 'Helper off']];
const DURS = [[30, '30 sec.'], [60, '1 min.'], [120, '2 min.'], [180, '3 min.']];
const BLINK_PERIOD = 1.6; // one slow fade out and back in
const blinkAlpha = t => 0.12 + 0.88 * (0.5 + 0.5 * Math.cos(2 * Math.PI * t / BLINK_PERIOD));
const DEF = { dirs: 'eight', content: 'letters', size: 'normal', helper: 10, dur: 60 };
const SECTOR_NAMES = ['right', 'lower right', 'below', 'lower left', 'left', 'upper left', 'above', 'upper right'];
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const avgOf = a => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);

export function peripheralChartOpts() {
  const o = { ...DEF, ...((db.state.opts || {})[ID] || {}) };
  o.helper = +o.helper; o.dur = +o.dur;
  if (!DIRS[o.dirs]) o.dirs = DEF.dirs;
  if (!CONTENT[o.content]) o.content = DEF.content;
  if (!SIZES[o.size]) o.size = DEF.size;
  return o;
}
function saveOpts(o) { db.state.opts = db.state.opts || {}; db.state.opts[ID] = o; save(); }
const bothRgb = () => [0, 1, 2].map(i => Math.min(255, lens('left').rgb[i] + lens('right').rgb[i]));

// ---------- tile icons (like EYEBAB's) ----------
function spokeIcon(steps, scale = 1, dot = 1.6) {
  let d = '';
  for (const s of steps) { const a = s * Math.PI / 4; for (const r of [5, 9.5, 14]) d += `<circle cx="${(Math.cos(a) * r * scale).toFixed(1)}" cy="${(Math.sin(a) * r * scale).toFixed(1)}" r="${(dot * (0.8 + r / 25)).toFixed(2)}"/>`; }
  return `<svg viewBox="-17 -17 34 34" fill="currentColor" aria-hidden="true">${d}<circle r="${dot}"/></svg>`;
}
const helperIcon = n => `<svg viewBox="-17 -17 34 34" aria-hidden="true"><g stroke="currentColor" stroke-width="1.6" stroke-linecap="round">${Array.from({ length: 16 }, (_, i) => { const a = i * Math.PI / 8; return `<line x1="${(Math.cos(a) * 11).toFixed(1)}" y1="${(Math.sin(a) * 11).toFixed(1)}" x2="${(Math.cos(a) * 15).toFixed(1)}" y2="${(Math.sin(a) * 15).toFixed(1)}"/>`; }).join('')}</g><circle r="8" fill="none" stroke="currentColor" stroke-width="1.6"/>${n ? `<text y="3.6" text-anchor="middle" font-size="${n > 9 ? 9 : 10}" font-weight="700" fill="currentColor" font-family="Arial">${n}</text>` : '<path d="M-13-13L13 13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'}</svg>`;
const TILE_ICON = {
  four: spokeIcon(DIRS.four.steps), six: spokeIcon(DIRS.six.steps), eight: spokeIcon(DIRS.eight.steps),
  figures: '<svg class="wide" viewBox="0 0 44 22" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="2" y="3" width="16" height="16" rx="1.5"/><circle cx="33" cy="11" r="9"/></svg>',
  numbers: '<span class="txt">123</span>', letters: '<span class="txt">ABC</span>',
  large: spokeIcon(DIRS.eight.steps, 1.12, 1.9), normal: spokeIcon(DIRS.eight.steps, 0.8, 1.3),
};
const tile = (attr, val, on, icon, label) => `<button class="ejs-ptile" data-${attr}="${val}" aria-pressed="${on}"><span class="box">${icon}</span><span>${label}</span></button>`;

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
// One character or figure, regular weight (not bold). Figures are thin outlines.
function drawGlyph(c, ch, x, y, size, colour) {
  if (ch[0] === '#') { c.strokeStyle = colour; c.lineWidth = Math.max(1.5, size / 16); c.lineJoin = 'round'; shapePath(c, ch.slice(1), x, y, size * 0.72); c.stroke(); return; }
  c.fillStyle = colour; c.font = `400 ${size}px ${GLYPH}`; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(ch, x, y + size * 0.04);
}
// Chart geometry for a w x h area: spoke positions and character sizes, kept clear of the edges.
function geometry(o, w, h) {
  const U = Math.min(w, h) / 2, sizes = SIZES[o.size].k.map(v => Math.max(12, v * U));
  const padX = Math.max(48, w * 0.06), padY = Math.max(40, h * 0.07);
  const cx = w / 2, cy = h / 2, rx = w / 2 - sizes[3] * 0.5 - padX, ry = h / 2 - sizes[3] * 0.6 - padY;
  const pos = [];
  for (const s of DIRS[o.dirs].steps) { const a = s * Math.PI / 4; RING_U.forEach((u, ring) => pos.push({ x: cx + Math.cos(a) * rx * u, y: cy + Math.sin(a) * ry * u, size: sizes[ring], ring, sector: s })); }
  return { cx, cy, sizes, ringR: sizes[0] * 0.78 + 6, pos };
}
function drawCentre(c, g, ch, colour) {
  c.strokeStyle = colour; c.lineWidth = Math.max(2, g.sizes[0] / 18); c.beginPath(); c.arc(g.cx, g.cy, g.ringR, 0, Math.PI * 2); c.stroke();
  if (ch) drawGlyph(c, ch, g.cx, g.cy, g.sizes[0] * 0.9, colour);
}
// A new chart: the centre's character appears exactly once; the rest are random (repeats allowed).
function buildChart(o, g, glasses, target, targetGroup) {
  const others = CONTENT[o.content].set.filter(ch => ch !== target), n = g.pos.length, ti = Math.floor(Math.random() * n);
  const groups = glasses ? shuffle(Array.from({ length: n }, (_, i) => ['left', 'right', 'both'][i % 3])) : null;
  return g.pos.map((p, i) => ({ ...p, ch: i === ti ? target : others[Math.floor(Math.random() * others.length)], group: !glasses ? 'none' : i === ti ? targetGroup : groups[i], target: i === ti }));
}

// Map of the 8 directions, coloured by how quickly matches were found there (light grey = direction not used).
function timeMap(sectors, used) {
  const cx = 60, cy = 60, R = 52;
  let paths = '';
  sectors.forEach((ts, i) => {
    const a0 = (i - 0.5) * Math.PI / 4, a1 = (i + 0.5) * Math.PI / 4, av = avgOf(ts);
    const fill = !used.includes(i) ? '#f1f4f3' : av == null ? '#d9e2e0' : av < 1.5 ? '#1b7a4b' : av < 3 ? '#7cc29c' : av < 5 ? '#f0b45a' : '#d9534f';
    const p = (a, r) => `${(cx + Math.cos(a) * r).toFixed(1)},${(cy + Math.sin(a) * r).toFixed(1)}`;
    paths += `<path d="M${p(a0, 10)} L${p(a0, R)} A${R},${R} 0 0 1 ${p(a1, R)} L${p(a1, 10)} A10,10 0 0 0 ${p(a0, 10)} Z" fill="${fill}" stroke="#fff" stroke-width="2"><title>${SECTOR_NAMES[i]}: ${!used.includes(i) ? 'not used' : av == null ? 'none found' : av.toFixed(1) + ' s'}</title></path>`;
  });
  return `<div class="fovmap"><svg viewBox="0 0 120 120" role="img" aria-label="Map of how quickly you found matches in each direction">${paths}<circle cx="60" cy="60" r="4" fill="#17292c"/></svg>
    <div class="fovlegend"><b>Time to find</b><span><i style="background:#1b7a4b"></i>quick</span><span><i style="background:#7cc29c"></i>good</span><span><i style="background:#f0b45a"></i>slower</span><span><i style="background:#d9534f"></i>slowest</span></div></div>`;
}

export function peripheralChart() {
  let env, o, W = 0, H = 0, G = null, items = [], centreCh = null, shownAt = 0, groupTurn = 0;
  let hits = 0, wrong = 0, helped = 0, times = [], sectors = [], perGroup = {}, perRing = [], flashes = [];
  const glasses = () => env.mode === 'anaglyph';
  const helperOn = () => o.helper > 0 && env.elapsed - shownAt >= o.helper;

  function newChart() {
    const set = CONTENT[o.content].set; let ch;
    do { ch = set[Math.floor(Math.random() * set.length)]; } while (ch === centreCh);
    centreCh = ch; shownAt = env.elapsed;
    items = buildChart(o, G, glasses(), centreCh, glasses() ? ['left', 'right', 'both'][groupTurn++ % 3] : 'none');
  }
  const corner = () => env.setCorner(`Found ${hits}`);

  return {
    id: ID, title: 'Peripheral Chart', mode: 'anaglyph', modes: ['mono', 'anaglyph'], hud: 'minimal',
    how: 'Keep your eyes on the centre circle and tap its match in the chart around it.',
    countHint: () => 'Keep your eyes on the centre circle. Find its match with your side vision and tap it.',

    // ---------- the approved settings page ----------
    renderSetup(el, api) {
      let pv = { raf: 0, t: 0, last: 0, items: null, ch: null, next: 0, shown: 0 };
      const draw = () => {
        const so = peripheralChartOpts(), gl = api.mode === 'anaglyph', L = lens('left'), R = lens('right'), word = CONTENT[so.content].word;
        el.innerHTML = `
          <div class="ejs">
            <div class="ejs-top">
              <button class="ejs-back" data-x="back">${ICON.arrowLeft}<span>Back</span></button>
              <h1>Peripheral Chart</h1>
              <button class="ejs-help" data-x="help" aria-expanded="false">How it helps</button>
            </div>
            <div class="ejs-helpbox" hidden>
              <p><b>What you do:</b> a circle in the middle shows a ${word}. Keep your eyes on it. ${word[0].toUpperCase() + word.slice(1)}s run out from the centre in ${so.dirs} directions, getting bigger the further out they are. Exactly one matches the centre. Find it with your side vision and tap it, and a new chart comes up straight away.</p>
              <p><b>What it trains:</b> using side (peripheral) vision while looking straight ahead, and a wider field of attention. The characters grow towards the edge because side vision sees less detail, so far-out ones need to be bigger.</p>
              <p><b>With colour glasses</b> the chart uses three colours: one seen only by your left eye, one only by your right eye, and a combined colour seen by both. The match can be any of them, so both eyes have to keep working.</p>
              <p><b>Helper:</b> if you haven't found the match after 5 or 10 seconds, it slowly blinks. Turn the helper off for a harder game.</p>
            </div>
            <div class="ejs-chips" role="radiogroup" aria-label="How to play">
              ${api.modes.map(m => `<button class="ejs-chip" data-mode="${m}" aria-pressed="${api.mode === m}">${m === 'anaglyph' ? `${ICON.glasses}<span>Colour glasses</span>` : `${ICON.patch}<span>Eye patch</span>`}</button>`).join('')}
            </div>
            <p class="ejs-note">${gl
              ? `Glasses: <b><i class="sw" style="background:${rgbCss(L.rgb)}"></i>${esc(L.name)}</b> left · <b><i class="sw" style="background:${rgbCss(R.rgb)}"></i>${esc(R.name)}</b> right · <i class="sw" style="background:${rgbCss(bothRgb())}"></i>both · <button class="ejs-link" data-x="lens">Change</button>`
              : `Patch over your <b>${fellowEye()}</b> (stronger) eye.`}</p>
            <div class="ejs-preview em" aria-label="Preview"><span class="cap">Preview · smaller than on screen</span><canvas></canvas></div>
            <section class="ejs-sect"><div class="ejs-lab">Directions</div>
              <div class="ejs-paths pc t3">${Object.entries(DIRS).map(([k, v]) => tile('dirs', k, so.dirs === k, TILE_ICON[k], v.label)).join('')}</div></section>
            <section class="ejs-sect"><div class="ejs-lab">What's on the chart</div>
              <div class="ejs-paths pc t3">${Object.entries(CONTENT).map(([k, v]) => tile('content', k, so.content === k, TILE_ICON[k], v.label)).join('')}</div></section>
            <section class="ejs-sect"><div class="ejs-lab">Size</div>
              <div class="ejs-paths pc t2">${Object.entries(SIZES).map(([k, v]) => tile('size', k, so.size === k, TILE_ICON[k], v.label)).join('')}</div></section>
            <section class="ejs-sect"><div class="ejs-lab">Helper</div>
              <div class="ejs-paths pc t3">${HELPERS.map(([v, l]) => tile('helper', v, so.helper === v, helperIcon(v), l)).join('')}</div></section>
            <section class="ejs-sect"><div class="ejs-lab">How long</div>
              <div class="ejs-dur">${DURS.map(([v, l]) => `<button data-dur="${v}" aria-pressed="${so.dur === v}"><span class="dot"></span>${l}</button>`).join('')}</div></section>
            <div class="ejs-startbar">
              <button class="ejs-start" data-x="start">${ICON.play}<span>Start</span></button>
              <p class="ejs-hint">Eyes on the centre · tap the match · <b>Space</b> pauses · <b>Back</b> finishes</p>
            </div>
          </div>`;
        const box = el.querySelector('.ejs-preview'), cv = box.querySelector('canvas'), dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = Math.max(200, box.clientWidth - 2), h = Math.round(w * 0.56) + 24;
        cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.width = w + 'px'; cv.style.height = h + 'px';
        box.style.minHeight = h + 'px'; pv.items = null;
      };
      // A small copy of the chart; with the helper on, the match slowly blinks to show how the helper works.
      const tick = t => {
        if (!el.isConnected) { pv.raf = 0; return; }
        const cv = el.querySelector('.ejs-preview canvas'); if (!cv) { pv.raf = requestAnimationFrame(tick); return; }
        const so = peripheralChartOpts(), gl = api.mode === 'anaglyph';
        const dpr = cv.width / parseFloat(cv.style.width), w = cv.width / dpr, h = cv.height / dpr;
        const dt = Math.min(0.1, (t - (pv.last || t)) / 1000); pv.last = t; pv.t += dt;
        const g = geometry(so, w, h - 24);
        if (!pv.items || pv.t >= pv.next) {
          const set = CONTENT[so.content].set; pv.ch = set[Math.floor(Math.random() * set.length)];
          pv.items = buildChart(so, g, gl, pv.ch, ['left', 'right', 'both'][Math.floor(Math.random() * 3)]);
          pv.shown = pv.t; pv.next = pv.t + (so.helper ? 1.2 + BLINK_PERIOD * 2 : 2.4);
        }
        const col = grp => (grp === 'none' ? 'rgb(235,235,235)' : rgbCss(grp === 'both' ? bothRgb() : lens(grp).rgb));
        const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h); c.translate(0, 24);
        drawCentre(c, g, pv.ch, col(gl ? 'both' : 'none'));
        for (const it of pv.items) {
          c.globalAlpha = it.target && so.helper && pv.t - pv.shown > 1.2 ? blinkAlpha(pv.t - pv.shown - 1.2) : 1;
          drawGlyph(c, it.ch, it.x, it.y, it.size, col(it.group));
        }
        c.globalAlpha = 1;
        pv.raf = requestAnimationFrame(tick);
      };
      const set = (patch, focusSel) => { saveOpts({ ...peripheralChartOpts(), ...patch }); draw(); if (focusSel) { const nn = el.querySelector(focusSel); if (nn) nn.focus(); } };
      el.onclick = e => {
        const b = e.target.closest('button'); if (!b) return;
        const d = b.dataset;
        if (d.x === 'back') { cancelAnimationFrame(pv.raf); api.close(); }
        else if (d.x === 'lens') { cancelAnimationFrame(pv.raf); api.close('#setup-glasses'); }
        else if (d.x === 'help') { const hb = el.querySelector('.ejs-helpbox'); hb.hidden = !hb.hidden; b.setAttribute('aria-expanded', String(!hb.hidden)); }
        else if (d.x === 'start') { cancelAnimationFrame(pv.raf); api.start(peripheralChartOpts().dur / 60); }
        else if (d.mode) { api.setMode(d.mode); draw(); el.querySelector(`[data-mode="${d.mode}"]`).focus(); }
        else if (d.dirs) set({ dirs: d.dirs }, `[data-dirs="${d.dirs}"]`);
        else if (d.content) set({ content: d.content }, `[data-content="${d.content}"]`);
        else if (d.size) set({ size: d.size }, `[data-size="${d.size}"]`);
        else if (d.helper != null) set({ helper: +d.helper }, `[data-helper="${d.helper}"]`);
        else if (d.dur) set({ dur: +d.dur }, `[data-dur="${d.dur}"]`);
      };
      draw();
      pv.raf = requestAnimationFrame(tick);
      el.querySelector('[data-x="start"]').focus({ preventScroll: true });
    },

    // ---------- play ----------
    init(e) {
      env = e; o = peripheralChartOpts(); W = env.w; H = env.h; G = geometry(o, W, H);
      hits = 0; wrong = 0; helped = 0; times = []; flashes = []; perGroup = {}; perRing = [[], [], [], []];
      sectors = Array.from({ length: 8 }, () => []); groupTurn = Math.floor(Math.random() * 3); centreCh = null;
      newChart(); corner();
      if (/[?&]test\b/.test(location.search)) window.__pc = () => ({ items: items.map(({ x, y, ch, group, target, size, ring, sector }) => ({ x, y, ch, group, target, size, ring, sector })), centreCh, hits, wrong, helped, blink: helperOn() ? +blinkAlpha(env.elapsed - shownAt - o.helper).toFixed(2) : null }); // automated checks only
    },
    onResize(w, h) {
      W = w; H = h; G = geometry(o, W, H);
      if (items.length) { const old = items.find(i => i.target); items = buildChart(o, G, glasses(), centreCh, old.group); }
    },
    update() { const t = env.elapsed; if (flashes.length) flashes = flashes.filter(f => t - f.t0 < 0.45); },
    draw(a, f) {
      const amb = db.settings.amblyopicEye, gl = glasses(), t = env.elapsed;
      const layers = grp => (grp === 'none' ? [a] : grp === 'both' ? [a, f] : [grp === amb ? a : f]);
      for (const c of layers(gl ? 'both' : 'none')) drawCentre(c, G, centreCh, gl ? '#fff' : 'rgb(235,235,235)');
      const blinking = helperOn();
      for (const it of items) {
        const alpha = it.target && blinking ? blinkAlpha(t - shownAt - o.helper) : 1;
        for (const c of layers(it.group)) { c.globalAlpha = alpha; drawGlyph(c, it.ch, it.x, it.y, it.size, it.group === 'none' ? 'rgb(235,235,235)' : '#fff'); c.globalAlpha = 1; }
      }
      for (const c of gl ? [a, f] : [a]) for (const fl of flashes) {
        const k = Math.min(1, (t - fl.t0) / 0.45);
        c.globalAlpha = 0.85 * (1 - k); c.strokeStyle = '#fff'; c.lineWidth = 3;
        if (fl.cross) { const q = fl.r * 0.7; c.beginPath(); c.moveTo(fl.x - q, fl.y - q); c.lineTo(fl.x + q, fl.y + q); c.moveTo(fl.x + q, fl.y - q); c.lineTo(fl.x - q, fl.y + q); c.stroke(); }
        else { c.beginPath(); c.arc(fl.x, fl.y, fl.r + 14 * k, 0, Math.PI * 2); c.stroke(); }
        c.globalAlpha = 1;
      }
    },
    params() { return { bgA: 0, bgF: 0 }; },
    onPointer(x, y, type) {
      if (type !== 'pointerdown' || !items.length) return;
      let best = null, bd = Infinity;
      for (const it of items) { const d = Math.hypot(x - it.x, y - it.y) / it.size; if (d < bd) { bd = d; best = it; } }
      if (!best || bd > 0.62) return; // empty space: nothing happens
      if (best.target) {
        const tt = env.elapsed - shownAt;
        hits++; times.push(tt); sectors[best.sector].push(tt); (perGroup[best.group] = perGroup[best.group] || []).push(tt); perRing[best.ring].push(tt);
        if (helperOn()) helped++;
        flashes.push({ x: best.x, y: best.y, r: best.size * 0.6, t0: env.elapsed }); env.sfx.good();
        newChart(); corner(); // straight to the next one
      } else {
        wrong++; flashes.push({ x: best.x, y: best.y, r: best.size * 0.5, t0: env.elapsed, cross: true }); env.sfx.bad();
      }
    },
    onKey() { return false; },
    result() {
      env.setCorner('');
      if (!hits && !wrong) return null;
      const gl = glasses(), L = lens('left'), R = lens('right');
      const avg = avgOf(times), near = avgOf([...perRing[0], ...perRing[1]]), far = avgOf([...perRing[2], ...perRing[3]]);
      const rated = sectors.map((ts, i) => ({ i, av: avgOf(ts), n: ts.length })).filter(s => s.n >= 1);
      const slow = [...rated].sort((p, q) => q.av - p.av)[0], quick = [...rated].sort((p, q) => p.av - q.av)[0];
      const gLine = g => { const arr = perGroup[g] || []; return arr.length ? `${arr.length} · ${avgOf(arr).toFixed(1)} s each` : 'none'; };
      const summary = [['Found', `${hits}`]];
      if (avg != null) summary.push(['Average time to find', `${avg.toFixed(1)} s`]);
      if (near != null && far != null) summary.push(['Near the centre · far out', `${near.toFixed(1)} s · ${far.toFixed(1)} s`]);
      summary.push(['Wrong taps', `${wrong}`]);
      if (o.helper) summary.push(['Found with the helper blinking', `${helped}`]);
      if (gl) summary.push([`Left eye (${esc(L.name)})`, gLine('left')], [`Right eye (${esc(R.name)})`, gLine('right')], ['Both eyes', gLine('both')]);
      summary.push(['Slowest direction', slow && quick && slow.i !== quick.i && slow.av > quick.av * 1.3 ? `${SECTOR_NAMES[slow.i]} (${slow.av.toFixed(1)} s)` : 'none, about equal']);
      return {
        complete: env.elapsed >= o.dur - 0.5, trials: hits + wrong, correct: hits, threshold: null, unit: null, score: null,
        headline: 'Well done', summary, html: hits >= 3 ? timeMap(sectors, DIRS[o.dirs].steps) : '',
        extra: { dirs: o.dirs, content: o.content, size: o.size, helper: o.helper, found: hits, wrong, helped, avg, near, far,
          left: perGroup.left ? perGroup.left.length : 0, right: perGroup.right ? perGroup.right.length : 0, both: perGroup.both ? perGroup.both.length : 0 },
      };
    },
  };
}
