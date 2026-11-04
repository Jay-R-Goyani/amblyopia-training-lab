// Jump Read (approved design): find the letters in order.
// Lines of text (default): rows of random letter "words", read left to right, line by line; only letters ahead of
// the last one found count. Scattered: single letters spread over the screen. One round per game.
// With colour glasses, letters come in three colours: one eye, the other eye, or both eyes.
import { db, save, fellowEye } from '../store.js';
import { lens, rgbCss } from '../lens.js';
import { ICON } from '../icons.js';
import { esc } from '../util.js';

const ID = 'jump-read';
const GLYPH = 'Calibri, Carlito, "Segoe UI", Arial, sans-serif';
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', LOWER = 'abcdefghijklmnopqrstuvwxyz';
const SETS = { upper: 'Capitals A–Z', lower: 'Small letters a–z', num: 'Numbers 1–30' };
const LEVELS = {
  easy: { label: 'Easy', set: 'upper', count: 13, size: 40, extra: 0 },
  medium: { label: 'Medium', set: 'upper', count: 26, size: 32, extra: 0 },
  hard: { label: 'Hard', set: 'upper', count: 26, size: 26, extra: 12 },
  extreme: { label: 'Extreme', set: 'lower', count: 26, size: 20, extra: 24 },
};
const EXTRAS = [[0, 'None'], [12, 'Some'], [24, 'Many']];
const DEF = { layout: 'lines', level: 'easy', set: 'upper', count: 13, size: 40, extra: 0, best: {} };
const fmtTime = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function jumpReadOpts() {
  const o = { ...DEF, ...((db.state.opts || {})[ID] || {}) };
  for (const k of ['count', 'size', 'extra']) o[k] = +o[k];
  if (o.layout === 'lines' && o.set === 'num') o.set = 'upper';
  o.best = o.best || {};
  return o;
}
function saveOpts(o) { db.state.opts = db.state.opts || {}; db.state.opts[ID] = o; save(); }
const levelName = o => (LEVELS[o.level] ? LEVELS[o.level].label : 'Custom');
const maxCount = o => (o.set === 'num' ? 30 : 26);
function sequence(o) {
  const n = Math.min(o.count, maxCount(o));
  if (o.set === 'num') return Array.from({ length: n }, (_, i) => String(i + 1));
  return (o.set === 'upper' ? UPPER : LOWER).slice(0, n).split('');
}
function extrasFor(o, seq) {
  if (!o.extra || o.layout === 'lines') return [];
  const pool = o.set === 'num' ? Array.from({ length: 60 }, (_, i) => String(i + 31)).filter(x => !seq.includes(x))
    : ((o.set === 'upper' ? UPPER : LOWER) + '23456789').split('').filter(c => !seq.includes(c));
  return Array.from({ length: o.extra }, () => pool[Math.floor(Math.random() * pool.length)]);
}
const bothRgb = () => [0, 1, 2].map(i => Math.min(255, lens('left').rgb[i] + lens('right').rgb[i]));
function drawChar(c, ch, x, y, size, fill) {
  c.fillStyle = fill; c.font = `400 ${size / 0.7}px ${GLYPH}`; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(ch, x, y);
}

export function jumpRead() {
  let env, o, W = 0, H = 0, items = [], seq = [], idx = 0, lastIdx = -1, errors = 0, wrongFx = [], foundAt = [], perEye = { left: [], right: [], both: [], none: [] };
  let begun = false, hidden = false, ctxM = null;

  const pageBox = () => { const side = Math.max(30, W * 0.06); return { left: side, right: W - side, top: 96, bottom: H - 72 }; };
  function flowLines() {
    ctxM.font = `400 ${o.size / 0.7}px ${GLYPH}`;
    const b = pageBox(), lh = o.size * 1.75, gap = o.size * 0.06, space = ctxM.measureText(' ').width * 1.3, maxW = b.right - b.left;
    const words = []; for (const it of items) { it.w = ctxM.measureText(it.ch).width; (words[it.word] = words[it.word] || []).push(it); }
    const lines = []; let cur = [], curW = 0;
    for (const wd of words.filter(Boolean)) {
      const ww = wd.reduce((a, it) => a + it.w + gap, 0) - gap;
      if (cur.length && curW + space + ww > maxW) { lines.push({ words: cur, w: curW }); cur = []; curW = 0; }
      curW += (cur.length ? space : 0) + ww; cur.push(wd);
    }
    if (cur.length) lines.push({ words: cur, w: curW, last: true });
    const rowsFit = Math.max(1, Math.floor((b.bottom - b.top) / lh)), used = Math.min(lines.length, rowsFit);
    const y0 = b.top + ((b.bottom - b.top) - used * lh) / 2 + lh / 2;
    lines.forEach((ln, r) => { // justified lines, block centred on the screen
      const extra = !ln.last && ln.words.length > 1 ? (maxW - ln.w) / (ln.words.length - 1) : 0;
      let x = b.left; const y = y0 + r * lh, fits = r < rowsFit;
      ln.words.forEach(wd => { wd.forEach(it => { it.x = x + it.w / 2; it.y = y; it.fits = fits; x += it.w + gap; }); x += space - gap + extra; });
    });
  }
  function layoutLines() {
    const pool = o.set === 'lower' ? LOWER : UPPER;
    ctxM.font = `400 ${o.size / 0.7}px ${GLYPH}`;
    const b = pageBox(), rows = Math.max(1, Math.floor((b.bottom - b.top) / (o.size * 1.75)));
    const avg = ctxM.measureText(LOWER).width / 26 + o.size * 0.06, fits = Math.floor(rows * (b.right - b.left) / avg * 0.86);
    let order = 0, word = 0, runEye = 'none', runLeft = 0;
    const nextEye = () => { if (env.mode !== 'anaglyph') return 'none'; if (runLeft <= 0) { runEye = ['left', 'right', 'both'][Math.floor(Math.random() * 3)]; runLeft = 2 + Math.floor(Math.random() * 5); } runLeft--; return runEye; };
    items = [];
    while (order < fits) {
      const len = 2 + Math.floor(Math.random() * 5);
      for (let k = 0; k < len; k++) items.push({ ch: pool[Math.floor(Math.random() * 26)], word, order: order++, target: false, done: false, eye: nextEye() });
      word++;
    }
    flowLines();
    items = items.filter(it => it.fits); items.forEach((it, i) => { it.order = i; });
    // plant the sequence in reading order, one in each equal slice of the visible text, so every round can be finished
    const n = seq.length, per = items.length / n;
    for (let i = 0; i < n; i++) { const at = Math.min(items.length - 1, Math.floor(i * per + Math.random() * per * 0.8)); items[at].ch = seq[i]; items[at].target = true; }
    flowLines();
  }
  function layoutScatter() {
    const chars = [...seq, ...extrasFor(o, seq)], n = chars.length;
    const top = 70, side = 30, aw = W - 2 * side, ah = H - 140;
    let cols = Math.ceil(Math.sqrt(n * aw / ah)), rows = Math.ceil(n / cols);
    while (cols * rows < n * 1.25) { if (aw / cols > ah / rows) cols++; else rows++; }
    const cw = aw / cols, chh = ah / rows, cells = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push([c, r]);
    cells.sort(() => Math.random() - 0.5);
    const jx = Math.max(0, cw - o.size * 1.2) / 2, jy = Math.max(0, chh - o.size * 1.2) / 2;
    items = chars.map((ch, i) => {
      const [c, r] = cells[i], x = side + (c + 0.5) * cw + (Math.random() * 2 - 1) * jx, y = top + (r + 0.5) * chh + (Math.random() * 2 - 1) * jy;
      return { ch, x, y, fx: (x - side) / aw, fy: (y - top) / ah, w: o.size, target: i < seq.length, done: false, fits: true, eye: env.mode === 'anaglyph' ? (Math.random() < 0.5 ? 'left' : 'right') : 'none' };
    });
    if (env.mode === 'anaglyph') items.filter(it => it.target).sort(() => Math.random() - 0.5).forEach((it, k) => { it.eye = k % 2 ? 'right' : 'left'; });
  }
  function strip() {
    env.setStrip(seq.map((c, i) => `<span class="${i < idx ? 'done' : i === idx ? 'now' : ''}">${esc(c)}</span>`).join(''));
  }
  const corner = () => env.setCorner(`${idx < seq.length ? `Find: ${seq[idx]} · ` : ''}${fmtTime(env.elapsed)}`);
  let hintT = 0;
  function hint(t) { env.setTip(t); clearTimeout(hintT); hintT = setTimeout(() => env.setTip(''), 1800); }
  function found(it) {
    it.done = true; if (o.layout === 'lines') lastIdx = it.order;
    perEye[it.eye].push(env.elapsed - (foundAt.length ? foundAt[foundAt.length - 1] : 0)); foundAt.push(env.elapsed);
    idx++; env.sfx.tick(); strip(); env.markDirty();
    if (idx >= seq.length) setTimeout(() => env.end(), 350);
  }
  function wrong(it, behind) {
    errors++; wrongFx.push({ x: it.x, y: it.y, t0: env.elapsed }); env.sfx.bad(); env.markDirty();
    if (behind) hint('That one is behind you. Keep reading forward.');
  }

  return {
    id: ID, title: 'Jump Read', mode: 'anaglyph', modes: ['mono', 'anaglyph'], hiRes: true, hud: 'minimal', noDuration: true, staticLayers: true,
    how: 'Find the letters in order, reading line by line from left to right.',
    countHint: () => { const so = jumpReadOpts(), sq = sequence(so); return so.layout === 'lines' ? `Read line by line, left to right. Find ${sq[0]} to ${sq[sq.length - 1]} in order` : `Find ${sq[0]} to ${sq[sq.length - 1]} in order, as fast as you can`; },

    // ---------- the approved settings page ----------
    renderSetup(el, api) {
      const draw = () => {
        const so = jumpReadOpts(), glasses = api.mode === 'anaglyph', L = lens('left'), R = lens('right'), sq = sequence(so), best = so.best[`${so.layout}-${so.level}`];
        el.innerHTML = `
          <div class="ejs">
            <div class="ejs-top">
              <button class="ejs-back" data-x="back">${ICON.arrowLeft}<span>Back</span></button>
              <h1>Jump Read</h1>
              <button class="ejs-help" data-x="help" aria-expanded="false">How it helps</button>
            </div>
            <div class="ejs-helpbox" hidden>
              <p><b>What you do (Lines of text):</b> the screen is full of rows of letters, like a page. Start at the top left and read each line from left to right. Find A and tap it, then keep reading on from there to find B, then C, and so on. A letter that's behind you (before the last one you found) doesn't count. The row at the top shows how far you've got.</p>
              <p><b>Scattered:</b> single letters spread over the screen; find them in order anywhere.</p>
              <p><b>What it trains:</b> scanning a page with quick, accurate eye jumps, spotting the right shape among others, and eye–hand coordination, the skills behind fluent reading.</p>
              <p><b>With colour glasses</b> letters come in three colours: one lens colour (only that eye sees them), the other lens colour, and a mix of both (both eyes see them). You need both eyes to read every line.</p>
            </div>
            <div class="ejs-chips" role="radiogroup" aria-label="How to play">
              ${api.modes.map(m => `<button class="ejs-chip" data-mode="${m}" aria-pressed="${api.mode === m}">${m === 'anaglyph' ? `${ICON.glasses}<span>Colour glasses</span>` : `${ICON.patch}<span>Eye patch</span>`}</button>`).join('')}
            </div>
            <p class="ejs-note">${glasses
              ? `Glasses: <b><i class="sw" style="background:${rgbCss(L.rgb)}"></i>${esc(L.name)}</b> left · <b><i class="sw" style="background:${rgbCss(R.rgb)}"></i>${esc(R.name)}</b> right · <button class="ejs-link" data-x="lens">Change</button>`
              : `Patch over your <b>${fellowEye()}</b> (stronger) eye.`}</p>
            <div class="ejs-preview em" aria-label="Preview at real size"><span class="cap">Preview · real size</span><canvas></canvas></div>
            <section class="ejs-sect"><div class="ejs-lab">Level</div>
              <div class="ejs-chips">${Object.entries(LEVELS).map(([k, v]) => `<button class="ejs-chip" data-level="${k}" aria-pressed="${so.level === k}">${v.label}</button>`).join('')}<button class="ejs-chip" data-level="custom" aria-pressed="${so.level === 'custom'}">Custom</button></div>
              <p class="ejs-hint" style="text-align:left">${so.level === 'custom' ? 'Your own mix of the settings below.' : `${levelName(so)}: find ${sq[0]} to ${sq[sq.length - 1]} (${sq.length}), ${so.size} px${so.extra && so.layout === 'scatter' ? `, plus ${so.extra} extra characters` : ''}.`}${best ? ` Your best: <b style="color:#eef3f3">${fmtTime(best)}</b>.` : ''}</p></section>
            <section class="ejs-sect"><div class="ejs-lab">Layout</div>
              <div class="ejs-chips"><button class="ejs-chip" data-layout="lines" aria-pressed="${so.layout === 'lines'}">Lines of text</button><button class="ejs-chip" data-layout="scatter" aria-pressed="${so.layout === 'scatter'}">Scattered</button></div>
              <p class="ejs-hint" style="text-align:left">${so.layout === 'lines' ? 'Rows of letters like a page. Read each line left to right and find the letters in order.' : 'Single letters spread over the screen. Find them in order anywhere.'}</p></section>
            <section class="ejs-sect"><div class="ejs-lab">What to find</div>
              <div class="ejs-chips">${Object.entries(SETS).map(([k, l]) => `<button class="ejs-chip" data-set="${k}" aria-pressed="${so.set === k}" ${so.layout === 'lines' && k === 'num' ? 'disabled style="opacity:.35" title="Numbers work in Scattered layout"' : ''}>${l}</button>`).join('')}</div></section>
            <section class="ejs-sect"><div class="ejs-lab"><span>How many to find</span><output data-out="count">${sq[0]} to ${sq[sq.length - 1]} (${sq.length})</output></div>
              <div class="ejs-slider"><span class="end txt">Fewer</span><input type="range" data-range="count" min="5" max="${maxCount(so)}" step="1" value="${Math.min(so.count, maxCount(so))}" aria-label="How many to find"><span class="end txt">All</span></div></section>
            <section class="ejs-sect"><div class="ejs-lab"><span>Letter size</span><output data-out="size">${so.size} px</output></div>
              <div class="ejs-slider"><span class="end g" aria-hidden="true" style="font-size:.8rem">A</span><input type="range" data-range="size" min="10" max="80" step="1" value="${so.size}" aria-label="Letter size"><span class="end g" aria-hidden="true" style="font-size:1.5rem">A</span></div></section>
            <section class="ejs-sect" ${so.layout === 'lines' ? 'hidden' : ''}><div class="ejs-lab">Extra characters</div>
              <div class="ejs-chips">${EXTRAS.map(([v, l]) => `<button class="ejs-chip" data-extra="${v}" aria-pressed="${so.extra === v}">${l}</button>`).join('')}</div></section>
            <div class="ejs-startbar">
              <button class="ejs-start" data-x="start">${ICON.play}<span>Start</span></button>
              <p class="ejs-hint">${so.layout === 'lines' ? 'Read left to right, line by line' : 'Tap the letters in order'} · <b>Esc</b> pauses · <b>Back</b> finishes</p>
            </div>
          </div>`;
        preview();
      };
      const preview = () => {
        const so = jumpReadOpts(), glasses = api.mode === 'anaglyph', box = el.querySelector('.ejs-preview'), cv = box.querySelector('canvas'), dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = Math.max(200, box.clientWidth - 2), h = Math.max(140, so.size * 3 + 30);
        cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.width = w + 'px'; cv.style.height = h + 'px'; box.style.minHeight = h + 'px';
        const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
        const fill = eye => (!glasses ? 'rgb(235,235,235)' : eye === 'both' ? rgbCss(bothRgb()) : rgbCss(lens(eye).rgb));
        if (so.layout === 'lines') {
          const pool = so.set === 'lower' ? LOWER : UPPER; let x = 12; const y = h / 2 + 10;
          c.font = `400 ${so.size / 0.7}px ${GLYPH}`; c.textBaseline = 'middle'; c.textAlign = 'left';
          outer: for (let wd = 0; wd < 30; wd++) {
            const len = 3 + (wd * 5) % 4;
            for (let k = 0; k < len; k++) {
              const ch = pool[(wd * 7 + k * 11) % 26], wch = c.measureText(ch).width;
              if (x + wch > w - 10) break outer;
              c.fillStyle = fill(['left', 'right', 'both'][Math.floor((wd * 7 + k * 3) / 4) % 3]); c.fillText(ch, x, y); x += wch + so.size * 0.06;
            }
            x += c.measureText(' ').width * 1.2;
          }
          return;
        }
        const sq = sequence(so), sample = [...sq.slice(0, 6), ...extrasFor(so, sq).slice(0, 3)], step = w / (sample.length + 1);
        sample.forEach((ch, i) => drawChar(c, ch, step * (i + 1), h / 2 + 10 + (i % 2 ? -1 : 1) * Math.min(18, h / 6), so.size, fill(i % 2 ? 'right' : 'left')));
      };
      const set = (patch, focusSel) => { const so = { ...jumpReadOpts(), ...patch }; if (so.layout === 'lines' && so.set === 'num') so.set = 'upper'; so.count = Math.min(so.count, maxCount(so)); saveOpts(so); draw(); if (focusSel) { const nn = el.querySelector(focusSel); if (nn) nn.focus(); } };
      el.onclick = e => {
        const b = e.target.closest('button'); if (!b) return;
        const d = b.dataset;
        if (d.x === 'back') api.close();
        else if (d.x === 'lens') api.close('#setup-glasses');
        else if (d.x === 'help') { const hb = el.querySelector('.ejs-helpbox'); hb.hidden = !hb.hidden; b.setAttribute('aria-expanded', String(!hb.hidden)); }
        else if (d.x === 'start') api.start(5);
        else if (d.mode) { api.setMode(d.mode); draw(); el.querySelector(`[data-mode="${d.mode}"]`).focus(); }
        else if (d.level) { const lv = LEVELS[d.level]; set(lv ? { level: d.level, set: lv.set, count: lv.count, size: lv.size, extra: lv.extra } : { level: 'custom' }, `[data-level="${d.level}"]`); }
        else if (d.layout) set({ layout: d.layout }, `[data-layout="${d.layout}"]`);
        else if (d.set) set({ set: d.set, level: 'custom' }, `[data-set="${d.set}"]`);
        else if (d.extra) set({ extra: +d.extra, level: 'custom' }, `[data-extra="${d.extra}"]`);
      };
      el.oninput = e => {
        const r = e.target.closest('[data-range]'); if (!r) return;
        const so = jumpReadOpts(), k = r.dataset.range, v = +r.value;
        so[k] = v; so.level = 'custom';
        el.querySelectorAll('[data-level]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.level === 'custom')));
        const sq = sequence(so);
        el.querySelector(`[data-out="${k}"]`).textContent = k === 'size' ? `${v} px` : `${sq[0]} to ${sq[sq.length - 1]} (${sq.length})`;
        saveOpts(so); preview();
      };
      el.onchange = e => { const r = e.target.closest('[data-range]'); if (!r) return; draw(); const nn = el.querySelector(`[data-range="${r.dataset.range}"]`); if (nn) nn.focus(); };
      draw();
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (el.isConnected) preview(); });
      el.querySelector('[data-x="start"]').focus({ preventScroll: true });
    },

    // ---------- play: one round ----------
    init(e) {
      env = e; o = jumpReadOpts(); W = env.w; H = env.h; ctxM = env.ctxA;
      seq = sequence(o); idx = 0; lastIdx = -1;
      if (o.layout === 'lines') layoutLines(); else layoutScatter();
      begun = false; strip(); env.setCorner('');
      if (/[?&]test\b/.test(location.search)) window.__jr = () => ({ items: items.filter(it => it.fits).map(it => ({ ch: it.ch, x: it.x, y: it.y, target: it.target, order: it.order })), seq }); // automated checks only
    },
    start() { begun = true; env.markDirty(); },
    onResize(w, h) {
      W = w; H = h;
      if (!items.length) return;
      if (o.layout === 'lines') flowLines(); // re-flow to fill the new size; progress is kept
      else { const aw = W - 60, ah = H - 140; items.forEach(it => { it.x = 30 + it.fx * aw; it.y = 70 + it.fy * ah; }); }
    },
    onPause(p) { hidden = p; env.markDirty(); }, // letters are hidden while paused, so the clock is fair
    update() {
      if (begun) corner();
      if (wrongFx.length) { wrongFx = wrongFx.filter(f => env.elapsed - f.t0 < 0.6); env.markDirty(); }
    },
    draw(a, f) {
      if (!begun || hidden) return;
      const amb = db.settings.amblyopicEye;
      for (const it of items) {
        if (!it.fits) continue;
        const alpha = it.done && o.layout === 'scatter' ? 0.28 : 1;
        const targets = it.eye === 'none' ? [a] : it.eye === 'both' ? [a, f] : [it.eye === amb ? a : f];
        for (const c of targets) { c.globalAlpha = alpha; drawChar(c, it.ch, it.x, it.y, o.size, it.eye === 'none' ? 'rgb(235,235,235)' : '#fff'); c.globalAlpha = 1; }
        if (it.done && o.layout === 'lines') for (const c of [a, f]) { c.strokeStyle = '#fff'; c.lineWidth = 3; c.beginPath(); c.moveTo(it.x - it.w / 2 - 2, it.y + o.size * 0.62); c.lineTo(it.x + it.w / 2 + 2, it.y + o.size * 0.62); c.stroke(); }
      }
      for (const fx of wrongFx) {
        const k = Math.min(1, (env.elapsed - fx.t0) / 0.6), q = Math.max(10, o.size * 0.45);
        for (const c of [a, f]) { c.globalAlpha = 0.8 * (1 - k); c.strokeStyle = '#fff'; c.lineWidth = 3; c.beginPath(); c.moveTo(fx.x - q, fx.y - q); c.lineTo(fx.x + q, fx.y + q); c.moveTo(fx.x + q, fx.y - q); c.lineTo(fx.x - q, fx.y + q); c.stroke(); c.globalAlpha = 1; }
      }
    },
    params() { return { bgA: 0, bgF: 0 }; },
    onPointer(x, y, type) {
      if (type !== 'pointerdown' || !begun || hidden || idx >= seq.length) return;
      if (o.layout === 'lines') {
        let hit = null, bd = Infinity;
        for (const it of items) { if (!it.fits) continue; const dx = Math.abs(it.x - x), dy = Math.abs(it.y - y); if (dx <= it.w / 2 + o.size * 0.12 && dy <= o.size * 0.85) { const d = dx + dy; if (d < bd) { bd = d; hit = it; } } }
        if (!hit || hit.done) return;
        if (hit.ch === seq[idx] && hit.order > lastIdx) found(hit); else wrong(hit, hit.ch === seq[idx]);
        return;
      }
      let best = null, bd = Infinity;
      for (const it of items) { if (it.done) continue; const d = Math.hypot(it.x - x, it.y - y); if (d < bd) { bd = d; best = it; } }
      if (!best || bd > Math.max(o.size * 0.85, 22)) return; // a tap on empty space is ignored
      if (best.target && best.ch === seq[idx]) found(best); else wrong(best, false);
    },
    onKey() { return false; },
    result() {
      env.setStrip(''); env.setCorner(''); env.setTip(''); clearTimeout(hintT);
      if (!idx) return null;
      const complete = idx >= seq.length, time = env.elapsed, glasses = env.mode === 'anaglyph', L = lens('left'), R = lens('right');
      const key = `${o.layout}-${o.level}`, opts = jumpReadOpts(), prev = opts.best[key];
      const isBest = complete && o.level !== 'custom' && (prev == null || time < prev);
      const avg = arr => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null);
      const summary = [['Level', `${levelName(o)} · ${o.layout === 'lines' ? 'Lines of text' : 'Scattered'}`], [complete ? 'Time' : 'Found', complete ? fmtTime(time) : `${idx} of ${seq.length} in ${fmtTime(time)}`], ['Mistakes', errors], [`Average per ${o.set === 'num' ? 'number' : 'letter'}`, `${(time / Math.max(1, idx)).toFixed(1)} s`]];
      const aL = avg(perEye.left), aR = avg(perEye.right);
      if (glasses && aL != null && aR != null) summary.push([`Left-eye letters (${esc(L.name)})`, `${aL.toFixed(1)} s each`], [`Right-eye letters (${esc(R.name)})`, `${aR.toFixed(1)} s each`]);
      const bestNow = isBest ? time : prev;
      if (bestNow != null && o.level !== 'custom') summary.push([`Your best at ${levelName(o)}`, fmtTime(bestNow)]);
      return {
        complete: true, trials: seq.length, correct: idx, threshold: null, unit: null, score: null,
        headline: isBest && prev != null ? 'New personal best!' : complete ? (errors === 0 ? 'Perfect run!' : 'Well done') : 'Stopped early',
        summary,
        extra: { layout: o.layout, level: o.level, set: o.set, size: o.size, time: complete ? time : null, errors, found: idx },
        apply: st => { if (isBest) { st.opts = st.opts || {}; const cur = { ...jumpReadOpts() }; cur.best = { ...cur.best, [key]: time }; st.opts[ID] = cur; } },
      };
    },
  };
}
