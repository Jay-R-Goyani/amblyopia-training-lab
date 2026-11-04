// Rotation Match (approved design): a letter or block shape at the top; below it 2, 4 or 6 turned copies. Only one is the
// same figure turned around; the rest are mirror images. Tap the real one. Wrong taps are crossed out; a right tap brings
// the next round straight away. With colour glasses the top figure is seen by one eye and the choices by the other,
// swapping every round, so both eyes have to work together.
import { db, save, fellowEye } from '../store.js';
import { lens, rgbCss } from '../lens.js';
import { ICON } from '../icons.js';
import { esc } from '../util.js';

const ID = 'rotation-match';
const GLYPH = 'Calibri, Carlito, "Segoe UI", Arial, sans-serif';
const LEVELS = {
  easy: { label: 'Easy', kind: 'letters', choices: 2, turn: 'right', size: 100 },
  medium: { label: 'Medium', kind: 'letters', choices: 4, turn: 'any', size: 80 },
  hard: { label: 'Hard', kind: 'blocks', choices: 4, turn: 'any', size: 70 },
  extreme: { label: 'Extreme', kind: 'blocks', choices: 6, turn: 'any', size: 50 },
};
const NEXT = { easy: 'medium', medium: 'hard', hard: 'extreme' };
// Only shapes with no mirror symmetry, so a mirror image can never be turned into the original.
const LETTERS = 'FGJLNPQRSZ2457'.split('');
const BLOCKS = {
  L4: [[0, 0], [0, 1], [0, 2], [1, 2]], S4: [[1, 0], [2, 0], [0, 1], [1, 1]], F5: [[1, 0], [2, 0], [0, 1], [1, 1], [1, 2]],
  P5: [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2]], N5: [[0, 0], [0, 1], [1, 1], [1, 2], [1, 3]], Y5: [[1, 0], [0, 1], [1, 1], [1, 2], [1, 3]], L5: [[0, 0], [0, 1], [0, 2], [0, 3], [1, 3]],
};
const DURS = [[30, '30 sec.'], [60, '1 min.'], [120, '2 min.'], [180, '3 min.']];
const DEF = { level: 'easy', kind: 'letters', choices: 2, turn: 'right', size: 100, dur: 60 };
const BLOCK_ICON = '<svg class="fig" viewBox="0 0 12 18" fill="currentColor" aria-hidden="true" style="width:1.1rem;height:1.1rem"><rect x="0" y="0" width="5.4" height="5.4" rx=".8"/><rect x="0" y="6" width="5.4" height="5.4" rx=".8"/><rect x="0" y="12" width="5.4" height="5.4" rx=".8"/><rect x="6" y="12" width="5.4" height="5.4" rx=".8"/></svg>';
const FRAME_TOP = 'rgb(74,85,87)', FRAME = 'rgb(46,54,56)';
// In play, layers hold linear brightness (the screen shader brightens dark greys), so the same look needs lower values.
const FRAME_TOP_LIN = 'rgb(18,18,18)', FRAME_LIN = 'rgb(7,7,7)';
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const deg = a => ((Math.round(a * 180 / Math.PI) % 360) + 360) % 360;
const avgOf = a => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);

export function rotationMatchOpts() {
  const o = { ...DEF, ...((db.state.opts || {})[ID] || {}) };
  o.choices = +o.choices; o.size = +o.size; o.dur = +o.dur;
  return o;
}
function saveOpts(o) { db.state.opts = db.state.opts || {}; db.state.opts[ID] = o; save(); }
const levelName = o => (LEVELS[o.level] ? LEVELS[o.level].label : 'Custom');

// Draw a figure turned by `ang` radians, mirrored if `flip`, centred in a box of `size`.
function drawFigure(c, fig, x, y, size, ang, flip, colour) {
  c.save(); c.translate(x, y); c.rotate(ang); if (flip) c.scale(-1, 1);
  c.fillStyle = colour;
  if (fig.type === 'letter') {
    c.font = `400 ${size}px ${GLYPH}`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(fig.ch, 0, size * 0.04);
  } else {
    const cells = BLOCKS[fig.key], w = Math.max(...cells.map(p => p[0])) + 1, h = Math.max(...cells.map(p => p[1])) + 1;
    const u = size / Math.max(w, h, 3), g = Math.max(1.5, u * 0.08);
    for (const [cx, cy] of cells) { const px = (cx - w / 2) * u, py = (cy - h / 2) * u; c.beginPath(); if (c.roundRect) c.roundRect(px + g / 2, py + g / 2, u - g, u - g, u * 0.12); else c.rect(px + g / 2, py + g / 2, u - g, u - g); c.fill(); }
  }
  c.restore();
}
function frame(c, x, y, s, colour, lw = 1.5) { const r = s * 0.12; c.strokeStyle = colour; c.lineWidth = lw; c.beginPath(); if (c.roundRect) c.roundRect(x - s / 2, y - s / 2, s, s, r); else c.rect(x - s / 2, y - s / 2, s, s); c.stroke(); }
// A round: the figure, its turn on top, and the choices (one turned copy, the rest turned mirror images).
function makeRound(o) {
  const fig = o.kind === 'letters' ? { type: 'letter', ch: LETTERS[Math.floor(Math.random() * LETTERS.length)] } : { type: 'block', key: shuffle(Object.keys(BLOCKS))[0] };
  const pick = () => (o.turn === 'right' ? Math.floor(Math.random() * 4) * Math.PI / 2 : Math.random() * Math.PI * 2);
  const refAng = pick(), gapOf = a => Math.abs(((deg(a) - deg(refAng) + 540) % 360) - 180);
  let ang; do { ang = pick(); } while (gapOf(ang) < (o.turn === 'right' ? 45 : 40)); // the match always needs turning
  const choices = [{ ang, flip: false, correct: true, crossed: false }];
  while (choices.length < o.choices) choices.push({ ang: pick(), flip: true, correct: false, crossed: false });
  return { fig, refAng, choices: shuffle(choices), turnBy: gapOf(ang) };
}
// Positions for a w x h area: the top figure in the upper part, choices in one row (or two rows of three).
function layout(w, h, o) {
  const box = o.size * 1.45, top = { x: w / 2, y: h * 0.3 }, rows = o.choices === 6 ? [3, 3] : [o.choices], pos = [];
  const gap = Math.min(box * 0.5, (w - 40 - box * rows[0]) / Math.max(1, rows[0] - 1));
  rows.forEach((n, r) => {
    const y = rows.length === 1 ? h * 0.68 : h * (0.6 + r * 0.24), total = n * box + (n - 1) * gap;
    for (let i = 0; i < n; i++) pos.push({ x: w / 2 - total / 2 + box / 2 + i * (box + gap), y });
  });
  return { top, pos, box };
}

export function rotationMatch() {
  let env, o, W = 0, H = 0, L = null, round = null, shownAt = 0, refEye = 'left', results = [], wrongNow = 0, fx = [];
  const glasses = () => env.mode === 'anaglyph';
  const choiceEye = () => (glasses() ? (refEye === 'left' ? 'right' : 'left') : 'none');
  function newRound() { round = makeRound(o); shownAt = env.elapsed; wrongNow = 0; if (glasses()) refEye = refEye === 'left' ? 'right' : 'left'; }
  const corner = () => env.setCorner(`${results.filter(r => r.mistakes === 0).length} of ${results.length} right first time`);

  return {
    id: ID, title: 'Rotation Match', mode: 'anaglyph', modes: ['mono', 'anaglyph'], hud: 'minimal',
    how: 'Tap the copy that is only turned around, not flipped over.',
    countHint: () => 'Tap the copy that is only turned, not flipped',

    // ---------- the approved settings page ----------
    renderSetup(el, api) {
      let pv = { raf: 0, t: 0, last: 0, round: null, shown: 0, eye: 'left' };
      const draw = () => {
        const so = rotationMatchOpts(), gl = api.mode === 'anaglyph', Lc = lens('left'), Rc = lens('right'), what = so.kind === 'letters' ? 'letter' : 'block shape';
        el.innerHTML = `
          <div class="ejs">
            <div class="ejs-top">
              <button class="ejs-back" data-x="back">${ICON.arrowLeft}<span>Back</span></button>
              <h1>Rotation Match</h1>
              <button class="ejs-help" data-x="help" aria-expanded="false">How it helps</button>
            </div>
            <div class="ejs-helpbox" hidden>
              <p><b>What you do:</b> a ${what} appears at the top. Below it are ${so.choices} turned copies. Only one is the same ${so.kind === 'letters' ? 'letter' : 'shape'}, just turned around. The others are mirror images (flipped over), which no amount of turning will match. Tap the real one. A wrong tap is crossed out and you try again; a right tap brings the next one straight away.</p>
              <p><b>What it trains:</b> seeing shape and direction precisely, and turning things in your mind (mental rotation). It's the skill behind telling b from d, reading maps, and fitting things together.</p>
              <p><b>With colour glasses</b> the top figure is in one lens colour and the choices in the other, so one eye sees what to match and the other eye must find it. They swap every round, so both eyes have to work together.</p>
              <p>The summary shows how much longer big turns take you than small ones; that gap usually shrinks with practice.</p>
            </div>
            <div class="ejs-chips" role="radiogroup" aria-label="How to play">
              ${api.modes.map(m => `<button class="ejs-chip" data-mode="${m}" aria-pressed="${api.mode === m}">${m === 'anaglyph' ? `${ICON.glasses}<span>Colour glasses</span>` : `${ICON.patch}<span>Eye patch</span>`}</button>`).join('')}
            </div>
            <p class="ejs-note">${gl
              ? `Glasses: <b><i class="sw" style="background:${rgbCss(Lc.rgb)}"></i>${esc(Lc.name)}</b> left · <b><i class="sw" style="background:${rgbCss(Rc.rgb)}"></i>${esc(Rc.name)}</b> right · <button class="ejs-link" data-x="lens">Change</button>`
              : `Patch over your <b>${fellowEye()}</b> (stronger) eye.`}</p>
            <div class="ejs-preview em" aria-label="Preview at real size"><span class="cap">Preview · real size</span><canvas></canvas></div>
            <section class="ejs-sect"><div class="ejs-lab">Level</div>
              <div class="ejs-chips">${Object.entries(LEVELS).map(([k, v]) => `<button class="ejs-chip" data-level="${k}" aria-pressed="${so.level === k}">${v.label}</button>`).join('')}<button class="ejs-chip" data-level="custom" aria-pressed="${so.level === 'custom'}">Custom</button></div>
              <p class="ejs-hint" style="text-align:left">${so.level === 'custom' ? 'Your own mix of the settings below.' : `${levelName(so)}: ${so.kind === 'letters' ? 'letters' : 'block shapes'}, ${so.choices} choices, ${so.turn === 'right' ? 'turned in quarter turns' : 'turned to any angle'}, ${so.size} px. Change anything below to make your own.`}</p></section>
            <section class="ejs-sect"><div class="ejs-lab">What to match</div>
              <div class="ejs-chips"><button class="ejs-chip" data-kind="letters" aria-pressed="${so.kind === 'letters'}"><span class="g">R</span><span>Letters</span></button><button class="ejs-chip" data-kind="blocks" aria-pressed="${so.kind === 'blocks'}">${BLOCK_ICON}<span>Block shapes</span></button></div></section>
            <section class="ejs-sect"><div class="ejs-lab">Choices</div>
              <div class="ejs-chips">${[2, 4, 6].map(n => `<button class="ejs-chip" data-choices="${n}" aria-pressed="${so.choices === n}">${n}</button>`).join('')}</div></section>
            <section class="ejs-sect"><div class="ejs-lab">Turning</div>
              <div class="ejs-chips"><button class="ejs-chip" data-turn="right" aria-pressed="${so.turn === 'right'}">Quarter turns (90°)</button><button class="ejs-chip" data-turn="any" aria-pressed="${so.turn === 'any'}">Any angle</button></div></section>
            <section class="ejs-sect"><div class="ejs-lab"><span>Size</span><output data-out="size">${so.size} px</output></div>
              <div class="ejs-slider"><span class="end g" aria-hidden="true" style="font-size:.8rem">R</span><input type="range" data-range="size" min="30" max="140" step="2" value="${so.size}" aria-label="Size"><span class="end g" aria-hidden="true" style="font-size:1.5rem">R</span></div></section>
            <section class="ejs-sect"><div class="ejs-lab">How long</div>
              <div class="ejs-dur">${DURS.map(([v, l]) => `<button data-dur="${v}" aria-pressed="${so.dur === v}"><span class="dot"></span>${l}</button>`).join('')}</div></section>
            <div class="ejs-startbar">
              <button class="ejs-start" data-x="start">${ICON.play}<span>Start</span></button>
              <p class="ejs-hint">Tap the turned copy, not a mirror image · <b>Space</b> pauses · <b>Back</b> finishes</p>
            </div>
          </div>`;
        sizePreview();
      };
      const sizePreview = () => {
        const so = rotationMatchOpts(), box = el.querySelector('.ejs-preview'), cv = box.querySelector('canvas'), dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = Math.max(200, box.clientWidth - 2), rows = so.choices === 6 ? 2 : 1, h = Math.round(so.size * 1.45 * (1 + rows) + so.size * 0.5 * rows + 50);
        cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.width = w + 'px'; cv.style.height = h + 'px';
        box.style.minHeight = h + 'px'; pv.round = null;
      };
      // Sample rounds at real size: after a moment the real match is outlined, then a new round comes.
      const tick = t => {
        if (!el.isConnected) { pv.raf = 0; return; }
        const cv = el.querySelector('.ejs-preview canvas'); if (!cv) { pv.raf = requestAnimationFrame(tick); return; }
        const so = rotationMatchOpts(), gl = api.mode === 'anaglyph';
        const dpr = cv.width / parseFloat(cv.style.width), w = cv.width / dpr, h = cv.height / dpr;
        const dt = Math.min(0.1, (t - (pv.last || t)) / 1000); pv.last = t; pv.t += dt;
        if (!pv.round || pv.t - pv.shown > 2.6) { pv.round = makeRound(so); pv.shown = pv.t; pv.eye = pv.eye === 'left' ? 'right' : 'left'; }
        const bx = so.size * 1.45, rows = so.choices === 6 ? [3, 3] : [so.choices], top = { x: w / 2, y: 24 + bx / 2 };
        const gap = Math.min(bx * 0.4, (w - 20 - bx * rows[0]) / Math.max(1, rows[0] - 1)), pos = [];
        rows.forEach((n, r) => { const y = top.y + bx + so.size * 0.5 + r * (bx + so.size * 0.3), total = n * bx + (n - 1) * gap; for (let i = 0; i < n; i++) pos.push({ x: w / 2 - total / 2 + bx / 2 + i * (bx + gap), y }); });
        const col = eye => (!gl ? 'rgb(235,235,235)' : rgbCss(lens(eye).rgb)), refE = pv.eye, chE = pv.eye === 'left' ? 'right' : 'left';
        const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
        frame(c, top.x, top.y, bx, FRAME_TOP);
        drawFigure(c, pv.round.fig, top.x, top.y, so.size, pv.round.refAng, false, col(refE));
        const showAns = pv.t - pv.shown > 1.3;
        pv.round.choices.forEach((ch, i) => {
          const p = pos[i]; frame(c, p.x, p.y, bx, ch.correct && showAns ? '#ffffff' : FRAME, ch.correct && showAns ? 3 : 1.5);
          drawFigure(c, pv.round.fig, p.x, p.y, so.size, ch.ang, ch.flip, col(chE));
        });
        pv.raf = requestAnimationFrame(tick);
      };
      const set = (patch, focusSel) => { saveOpts({ ...rotationMatchOpts(), ...patch }); draw(); if (focusSel) { const nn = el.querySelector(focusSel); if (nn) nn.focus(); } };
      el.onclick = e => {
        const b = e.target.closest('button'); if (!b) return;
        const d = b.dataset;
        if (d.x === 'back') { cancelAnimationFrame(pv.raf); api.close(); }
        else if (d.x === 'lens') { cancelAnimationFrame(pv.raf); api.close('#setup-glasses'); }
        else if (d.x === 'help') { const hb = el.querySelector('.ejs-helpbox'); hb.hidden = !hb.hidden; b.setAttribute('aria-expanded', String(!hb.hidden)); }
        else if (d.x === 'start') { cancelAnimationFrame(pv.raf); api.start(rotationMatchOpts().dur / 60); }
        else if (d.mode) { api.setMode(d.mode); draw(); el.querySelector(`[data-mode="${d.mode}"]`).focus(); }
        else if (d.level) { const lv = LEVELS[d.level]; set(lv ? { level: d.level, kind: lv.kind, choices: lv.choices, turn: lv.turn, size: lv.size } : { level: 'custom' }, `[data-level="${d.level}"]`); }
        else if (d.kind) set({ kind: d.kind, level: 'custom' }, `[data-kind="${d.kind}"]`);
        else if (d.choices) set({ choices: +d.choices, level: 'custom' }, `[data-choices="${d.choices}"]`);
        else if (d.turn) set({ turn: d.turn, level: 'custom' }, `[data-turn="${d.turn}"]`);
        else if (d.dur) set({ dur: +d.dur }, `[data-dur="${d.dur}"]`);
      };
      el.oninput = e => {
        const r = e.target.closest('[data-range]'); if (!r) return;
        const so = rotationMatchOpts(); so.size = +r.value; so.level = 'custom';
        el.querySelectorAll('[data-level]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.level === 'custom')));
        el.querySelector('[data-out="size"]').textContent = `${so.size} px`;
        saveOpts(so); sizePreview();
      };
      el.onchange = e => { const r = e.target.closest('[data-range]'); if (!r) return; draw(); const nn = el.querySelector('[data-range="size"]'); if (nn) nn.focus(); };
      draw();
      pv.raf = requestAnimationFrame(tick);
      el.querySelector('[data-x="start"]').focus({ preventScroll: true });
    },

    // ---------- play ----------
    init(e) {
      env = e; o = rotationMatchOpts(); W = env.w; H = env.h; L = layout(W, H, o);
      results = []; fx = []; refEye = Math.random() < 0.5 ? 'left' : 'right';
      newRound(); corner();
      if (/[?&]test\b/.test(location.search)) window.__rm = () => ({ choices: round.choices.map((c, i) => ({ x: L.pos[i].x, y: L.pos[i].y, correct: c.correct, flip: c.flip, crossed: c.crossed })), refEye, turnBy: round.turnBy, results: results.length }); // automated checks only
    },
    onResize(w, h) { W = w; H = h; L = layout(W, H, o); },
    update() { if (fx.length) fx = fx.filter(f => env.elapsed - f.t0 < 0.45); },
    draw(a, f) {
      if (!round) return;
      const amb = db.settings.amblyopicEye, gl = glasses(), both = gl ? [a, f] : [a];
      const layerOf = eye => (eye === 'none' || eye === amb ? a : f), fill = eye => (eye === 'none' ? 'rgb(235,235,235)' : '#fff');
      for (const c of both) { frame(c, L.top.x, L.top.y, L.box, FRAME_TOP_LIN); L.pos.forEach(p => frame(c, p.x, p.y, L.box, FRAME_LIN)); }
      const rE = gl ? refEye : 'none', cE = choiceEye();
      drawFigure(layerOf(rE), round.fig, L.top.x, L.top.y, o.size, round.refAng, false, fill(rE));
      round.choices.forEach((ch, i) => {
        const p = L.pos[i], c = layerOf(cE);
        c.globalAlpha = ch.crossed ? 0.25 : 1; drawFigure(c, round.fig, p.x, p.y, o.size, ch.ang, ch.flip, fill(cE)); c.globalAlpha = 1;
        if (ch.crossed) for (const cc of both) { const q = L.box * 0.3; cc.strokeStyle = 'rgba(255,255,255,0.8)'; cc.lineWidth = 3; cc.beginPath(); cc.moveTo(p.x - q, p.y - q); cc.lineTo(p.x + q, p.y + q); cc.moveTo(p.x + q, p.y - q); cc.lineTo(p.x - q, p.y + q); cc.stroke(); }
      });
      for (const c of both) for (const fl of fx) { const k = (env.elapsed - fl.t0) / 0.45; frame(c, fl.x, fl.y, L.box * (1 + 0.15 * k), `rgba(255,255,255,${0.9 * (1 - k)})`, 3); }
    },
    params() { return { bgA: 0, bgF: 0 }; },
    onPointer(x, y, type) {
      if (type !== 'pointerdown' || !round) return;
      const i = L.pos.findIndex(p => Math.abs(x - p.x) <= L.box / 2 + 6 && Math.abs(y - p.y) <= L.box / 2 + 6);
      if (i < 0) return; // not on a choice
      const ch = round.choices[i];
      if (ch.crossed) return;
      if (ch.correct) {
        results.push({ time: env.elapsed - shownAt, mistakes: wrongNow, turnBy: round.turnBy, eye: choiceEye() });
        fx.push({ x: L.pos[i].x, y: L.pos[i].y, t0: env.elapsed }); env.sfx.good();
        newRound(); corner(); // straight to the next one
      } else { ch.crossed = true; wrongNow++; env.sfx.bad(); }
    },
    onKey() { return false; },
    result() {
      env.setCorner('');
      const n = results.length;
      if (!n) return null;
      const gl = glasses(), Lc = lens('left'), Rc = lens('right');
      const firsts = results.filter(r => r.mistakes === 0).length, mistakes = results.reduce((s, r) => s + r.mistakes, 0), pct = Math.round(firsts / n * 100);
      const avg = avgOf(results.map(r => r.time)), small = avgOf(results.filter(r => r.turnBy < 90).map(r => r.time)), big = avgOf(results.filter(r => r.turnBy >= 90).map(r => r.time));
      const eyeLine = eye => { const arr = results.filter(r => r.eye === eye); return arr.length ? `${arr.filter(r => !r.mistakes).length} of ${arr.length} right · ${avgOf(arr.map(r => r.time)).toFixed(1)} s each` : 'none'; };
      const summary = [['Matched', `${n}`], ['Right first time', `${firsts} of ${n} (${pct}%)`], ['Average time per match', `${avg.toFixed(1)} s`]];
      if (small != null && big != null) summary.push(['Small turns · big turns', `${small.toFixed(1)} s · ${big.toFixed(1)} s`]);
      summary.push(['Mirror images tapped', `${mistakes}`]);
      if (gl) summary.push([`Choices seen by left eye (${esc(Lc.name)})`, eyeLine('left')], [`Choices seen by right eye (${esc(Rc.name)})`, eyeLine('right')]);
      summary.push(['Level', levelName(o)]);
      summary.push(['Next', pct >= 90 ? (o.level === 'extreme' || o.level === 'custom' ? 'Excellent. Try more choices or a smaller size.' : `Excellent. Next time try ${LEVELS[NEXT[o.level]].label}.`)
        : small != null && big != null && big > small * 1.25 ? 'Big turns take longer than small ones, which is normal. That gap usually shrinks with practice.' : 'Keep practising at this level.']);
      return {
        complete: env.elapsed >= o.dur - 0.5, trials: n, correct: firsts, threshold: null, unit: null, score: null,
        headline: pct >= 90 ? 'Excellent!' : 'Well done', summary,
        extra: { level: o.level, kind: o.kind, choices: o.choices, turn: o.turn, size: o.size, matched: n, firsts, mistakes, avg, small, big },
      };
    },
  };
}
