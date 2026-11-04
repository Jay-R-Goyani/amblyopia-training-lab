// Contrast Finder (approved design): a faint patch appears somewhere on a grey board. Find it and tap it.
// Auto difficulty: 3 finds in a row -> fainter, a miss -> a little stronger (3-down-1-up, about 79% correct).
// Patches are drawn by the WebGL compositor (gamma-corrected, dithered), so very faint contrasts stay accurate.
import { db, save, fellowEye } from '../store.js';
import { lens, rgbCss } from '../lens.js';
import { ICON } from '../icons.js';
import { esc, fmtPct, levelContrast } from '../util.js';

const ID = 'contrast-finder';
const C_MIN = 0.005, C_MAX = 0.8; // contrast slider range (log scale)
const sliderToC = v => C_MIN * Math.pow(C_MAX / C_MIN, v / 100);
const cToSlider = c => Math.max(0, Math.min(100, Math.round(100 * Math.log(c / C_MIN) / Math.log(C_MAX / C_MIN))));
const pct = c => `${(c * 100).toFixed(c < 0.1 ? 1 : 0)}%`;
const LIMITS = [[0, 'No limit'], [5, '5 s'], [3, '3 s'], [1.5, '1.5 s']];
const DURS = [[60, '1 min'], [120, '2 min'], [180, '3 min'], [300, '5 min'], [600, '10 min']];
const DEF = { look: 'blur', size: 90, lines: 4, start: 60, auto: true, limit: 0, dur: 180 };
const BG = 0.5; // board brightness (linear)

// How many stripe lines fit in a patch: at least 3 px per stripe so they stay sharp.
const maxLines = size => Math.max(1, Math.min(20, Math.floor((4 * size / 6) / 3)));

export function contrastFinderOpts() {
  const o = { ...DEF, ...((db.state.opts || {})[ID] || {}) };
  for (const k of ['size', 'lines', 'start', 'limit', 'dur']) o[k] = +o[k];
  o.auto = o.auto === true || o.auto === 'true';
  return o;
}
function saveOpts(o) { db.state.opts = db.state.opts || {}; db.state.opts[ID] = o; save(); }
const linesFor = o => Math.min(o.lines, maxLines(o.size));

const ICON_BLUR = '<svg viewBox="0 0 32 32" aria-hidden="true"><defs><radialGradient id="cfgb"><stop offset="0" stop-color="currentColor"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></radialGradient></defs><circle cx="16" cy="16" r="14" fill="url(#cfgb)"/></svg>';
const ICON_STRIPE = '<svg viewBox="0 0 32 32" aria-hidden="true"><defs><radialGradient id="cfgs"><stop offset=".3" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient><mask id="cfms"><circle cx="16" cy="16" r="14" fill="url(#cfgs)"/></mask></defs><g mask="url(#cfms)" fill="currentColor"><rect x="4" y="2" width="4" height="28"/><rect x="12" y="2" width="4" height="28"/><rect x="20" y="2" width="4" height="28"/></g></svg>';
const ICON_MIX = '<svg viewBox="0 0 32 32" aria-hidden="true"><defs><radialGradient id="cfgm"><stop offset="0" stop-color="currentColor"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></radialGradient><radialGradient id="cfgm2"><stop offset=".3" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient><mask id="cfmm"><circle cx="21" cy="19" r="10" fill="url(#cfgm2)"/></mask></defs><circle cx="11" cy="12" r="10" fill="url(#cfgm)"/><g mask="url(#cfmm)" fill="currentColor"><rect x="13" y="8" width="3" height="22"/><rect x="19" y="8" width="3" height="22"/><rect x="25" y="8" width="3" height="22"/></g></svg>';

// Preview painter (2D canvas) that matches what the game shows: same gamma, same lens colours.
function paintPreview(img, w, h, cx, cy, sigma, c, look, lines, glasses, addOnly) {
  const d = img.data, g = 1 / (db.settings.gamma || 2.2), f = lines / (4 * sigma);
  const weak = lens(db.settings.amblyopicEye).rgb, other = lens(fellowEye()).rgb, E0 = 255 * Math.pow(BG, g);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = x - cx, dy = y - cy, env = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
    if (addOnly && env < 0.002) continue;
    const m = look === 'blur' ? env : env * Math.cos(2 * Math.PI * f * dy);
    const E = 255 * Math.pow(Math.max(0, Math.min(1, BG * (1 + c * m))), g) + Math.random() - 0.5, i = (y * w + x) * 4;
    if (!glasses) d[i] = d[i + 1] = d[i + 2] = E;
    else for (let ch = 0; ch < 3; ch++) d[i + ch] = Math.min(255, (E * weak[ch] + E0 * other[ch]) / 255);
    d[i + 3] = 255;
  }
}

export function contrastFinder() {
  let env, o, W = 0, H = 0, c = 0.1, run = 0, cur = null, phase = 'gap', phaseAt = 0;
  let total = 0, found = 0, faintest = null, reversals = [], lastDir = 0, findTimes = [], rings = [], mixRun = [];

  const board = () => ({ x0: 28, y0: 28, x1: W - 28, y1: H - 96 });
  function step(dir) {
    if (lastDir && dir !== lastDir) reversals.push(c);
    lastDir = dir;
    c = Math.min(0.9, Math.max(0.002, c * Math.pow(10, dir * 0.1)));
  }
  function newPatch() {
    const sigma = o.size / 6, pad = sigma * 3.2 + 4, b = board();
    let x, y, tries = 0;
    do { x = b.x0 + pad + Math.random() * Math.max(1, b.x1 - b.x0 - 2 * pad); y = b.y0 + pad + Math.random() * Math.max(1, b.y1 - b.y0 - 2 * pad); tries++; }
    while (cur && Math.hypot(x - cur.x, y - cur.y) < Math.min(W, H) * 0.25 && tries < 30);
    // Mixed: either kind at the same size and contrast, never more than 2 of the same in a row
    let look = o.look;
    if (o.look === 'mix') { look = Math.random() < 0.5 ? 'blur' : 'stripes'; if (mixRun.length >= 2 && mixRun.every(v => v === look)) look = look === 'blur' ? 'stripes' : 'blur'; mixRun = [...mixRun, look].slice(-2); }
    cur = { x, y, sigma, c, look, ori: Math.random() * Math.PI, ph: Math.random() * Math.PI * 2, shownAt: env.elapsed };
    phase = 'show'; phaseAt = env.elapsed; total++; env.markDirty();
  }
  function answer(ok) {
    if (phase !== 'show') return;
    if (ok) {
      found++; run++; findTimes.push(env.elapsed - cur.shownAt);
      if (faintest == null || cur.c < faintest) faintest = cur.c;
      env.sfx.good();
      rings.push({ x: cur.x, y: cur.y, r: cur.sigma * 3, t0: env.elapsed, dur: 0.35, v: 0.3, w: 3 });
      if (o.auto && run >= 3) { run = 0; step(-1); }
      newPatch(); // no waiting after a find
    } else {
      run = 0; env.sfx.bad();
      rings.push({ x: cur.x, y: cur.y, r: cur.sigma * 3, t0: env.elapsed, dur: 0.65, v: 0.15, w: 4 }); // show where it was
      if (o.auto) step(+1);
      phase = 'fb'; phaseAt = env.elapsed; env.markDirty();
    }
  }

  return {
    id: ID, title: 'Contrast Finder', mode: 'mono', modes: ['mono', 'anaglyph'], staticLayers: true, hud: 'minimal', spacePauses: false,
    how: 'Find the faint patch on the grey board and tap it.',
    countHint: () => 'Find the faint patch and tap it',

    // ---------- the approved settings page ----------
    renderSetup(el, api) {
      const draw = () => {
        const so = contrastFinderOpts(), glasses = api.mode === 'anaglyph';
        const L = lens('left'), R = lens('right'), weak = db.settings.amblyopicEye;
        el.innerHTML = `
          <div class="ejs">
            <div class="ejs-top">
              <button class="ejs-back" data-x="back">${ICON.arrowLeft}<span>Back</span></button>
              <h1>Contrast Finder</h1>
              <button class="ejs-help" data-x="help" aria-expanded="false">How it helps</button>
            </div>
            <div class="ejs-helpbox" hidden>
              <p><b>What you do:</b> a faint patch appears somewhere on the grey board. Find it and tap it. If you really can't see it, press <b>I can't see it</b> (or Space).</p>
              <p><b>What it trains:</b> contrast sensitivity, seeing faint, low-contrast things. Amblyopia lowers it, and it matters for faces, steps, driving at dusk and reading in poor light.</p>
              <p><b>How it helps:</b> practising right at the edge of what you can see is called perceptual learning. In adults it improved contrast sensitivity and sharpness in the weaker eye (Polat 2004; Zhou 2006). It takes regular practice over weeks.</p>
              <p><b>Patch look:</b> blurry spots, striped patches, or Mixed (either kind, same size and contrast). <b>Stripe lines</b> sets how many lines a striped patch has: more, thinner lines test finer detail.</p>
              <p><b>Auto difficulty:</b> after 3 finds in a row the next patch is fainter; after a miss it's a little stronger.</p>
            </div>
            <div class="ejs-chips" role="radiogroup" aria-label="How to play">
              ${api.modes.map(m => `<button class="ejs-chip" data-mode="${m}" aria-pressed="${api.mode === m}">${m === 'anaglyph' ? `${ICON.glasses}<span>Colour glasses</span>` : `${ICON.patch}<span>Eye patch</span>`}</button>`).join('')}
            </div>
            <p class="ejs-note">${glasses
              ? `Only your weaker (<b>${weak}</b>) eye sees the patch.<br>Glasses: <b><i class="sw" style="background:${rgbCss(L.rgb)}"></i>${esc(L.name)}</b> left · <b><i class="sw" style="background:${rgbCss(R.rgb)}"></i>${esc(R.name)}</b> right · <button class="ejs-link" data-x="lens">Change</button>`
              : `Patch over your stronger (<b>${fellowEye()}</b>) eye.`}</p>
            <div class="ejs-preview cf" aria-label="Preview at real size"><span class="cap"></span></div>
            <section class="ejs-sect"><div class="ejs-lab">Patch look</div>
              <div class="ejs-chips">
                <button class="ejs-chip" data-look="blur" aria-pressed="${so.look === 'blur'}">${ICON_BLUR}<span>Blurry spot</span></button>
                <button class="ejs-chip" data-look="stripes" aria-pressed="${so.look === 'stripes'}">${ICON_STRIPE}<span>Striped</span></button>
                <button class="ejs-chip" data-look="mix" aria-pressed="${so.look === 'mix'}">${ICON_MIX}<span>Mixed</span></button>
              </div></section>
            <section class="ejs-sect"><div class="ejs-lab"><span>Patch size</span><output data-out="size">${so.size} px</output></div>
              <div class="ejs-slider"><span class="end txt">Small</span><input type="range" data-range="size" min="24" max="320" step="2" value="${so.size}" aria-label="Patch size"><span class="end txt">Big</span></div></section>
            <section class="ejs-sect" data-lines ${so.look === 'blur' ? 'hidden' : ''}><div class="ejs-lab"><span>Stripe lines in a patch</span><output data-out="lines">${linesFor(so)}</output></div>
              <div class="ejs-slider"><span class="end txt">Few, wide</span><input type="range" data-range="lines" min="1" max="${maxLines(so.size)}" step="1" value="${linesFor(so)}" aria-label="Stripe lines in a patch"><span class="end txt">Many, thin</span></div></section>
            <section class="ejs-sect"><div class="ejs-lab"><span>${so.auto ? 'Starting contrast' : 'Contrast'}</span><output data-out="start">${pct(sliderToC(so.start))}</output></div>
              <div class="ejs-slider"><span class="end txt">Faint</span><input type="range" data-range="start" min="0" max="100" step="1" value="${so.start}" aria-label="Contrast"><span class="end txt">Strong</span></div>
              <div class="ejs-chips"><button class="ejs-chip" data-auto="1" aria-pressed="${so.auto}">Gets fainter as I improve</button><button class="ejs-chip" data-auto="0" aria-pressed="${!so.auto}">Stays the same</button></div></section>
            <section class="ejs-sect"><div class="ejs-lab">Time to find each patch</div>
              <div class="ejs-chips">${LIMITS.map(([v, l]) => `<button class="ejs-chip" data-limit="${v}" aria-pressed="${so.limit === v}">${l}</button>`).join('')}</div></section>
            <section class="ejs-sect"><div class="ejs-lab">How long</div>
              <div class="ejs-dur">${DURS.map(([v, l]) => `<button data-dur="${v}" aria-pressed="${so.dur === v}"><span class="dot"></span>${l}</button>`).join('')}</div></section>
            <div class="ejs-startbar">
              <button class="ejs-start" data-x="start">${ICON.play}<span>Start</span></button>
              <p class="ejs-hint">Tap the patch · <b>Space</b> = I can't see it · <b>Esc</b> pauses · <b>Back</b> finishes</p>
            </div>
          </div>`;
        preview();
      };
      const preview = () => {
        const so = contrastFinderOpts(), glasses = api.mode === 'anaglyph', box = el.querySelector('.ejs-preview');
        box.querySelectorAll('canvas').forEach(n => n.remove());
        const g = 1 / (db.settings.gamma || 2.2), E0 = 255 * Math.pow(BG, g);
        const bg = glasses ? [0, 1, 2].map(i => Math.min(255, Math.round((E0 * lens('left').rgb[i] + E0 * lens('right').rgb[i]) / 255))) : [E0, E0, E0].map(Math.round);
        box.style.background = `rgb(${bg.join(',')})`;
        box.classList.toggle('light', !glasses); // dark caption on the light-grey patch board
        const looks = so.look === 'mix' ? ['blur', 'stripes'] : [so.look];
        const d = so.size, w = Math.min(Math.max((d + 20) * looks.length, 200), box.clientWidth || 9999), h = Math.max(d + 20, 150);
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h; cv.style.width = w + 'px'; cv.style.height = h + 'px';
        const cx = cv.getContext('2d'), img = cx.createImageData(w, h);
        looks.forEach((lk, i) => paintPreview(img, w, h, (w * (2 * i + 1)) / (2 * looks.length), h / 2, d / 6, sliderToC(so.start), lk, linesFor(so), glasses, i > 0));
        cx.putImageData(img, 0, 0); box.appendChild(cv);
        box.style.minHeight = (h + 24) + 'px';
        box.querySelector('.cap').textContent = `Preview · real size · ${pct(sliderToC(so.start))} contrast`;
      };
      const set = (patch, focusSel) => { saveOpts({ ...contrastFinderOpts(), ...patch }); draw(); if (focusSel) { const n = el.querySelector(focusSel); if (n) n.focus(); } };
      el.onclick = e => {
        const b = e.target.closest('button'); if (!b) return;
        const d = b.dataset;
        if (d.x === 'back') api.close();
        else if (d.x === 'lens') api.close('#setup-glasses');
        else if (d.x === 'help') { const h = el.querySelector('.ejs-helpbox'); h.hidden = !h.hidden; b.setAttribute('aria-expanded', String(!h.hidden)); }
        else if (d.x === 'start') api.start(contrastFinderOpts().dur / 60);
        else if (d.mode) { api.setMode(d.mode); draw(); el.querySelector(`[data-mode="${d.mode}"]`).focus(); }
        else if (d.look) set({ look: d.look }, `[data-look="${d.look}"]`);
        else if (d.auto) set({ auto: d.auto === '1' }, `[data-auto="${d.auto}"]`);
        else if (d.limit) set({ limit: +d.limit }, `[data-limit="${d.limit}"]`);
        else if (d.dur) set({ dur: +d.dur }, `[data-dur="${d.dur}"]`);
      };
      el.oninput = e => {
        const r = e.target.closest('[data-range]'); if (!r) return;
        const so = contrastFinderOpts(), k = r.dataset.range, v = +r.value;
        so[k] = v;
        if (k === 'size') { // smaller patches fit fewer lines; keep the person's choice for when it grows again
          const ln = el.querySelector('[data-range="lines"]'); ln.max = maxLines(v); ln.value = linesFor(so);
          el.querySelector('[data-out="lines"]').textContent = linesFor(so);
        }
        el.querySelector(`[data-out="${k}"]`).textContent = k === 'start' ? pct(sliderToC(v)) : k === 'size' ? `${v} px` : v;
        saveOpts(so); preview();
      };
      draw();
      el.querySelector('[data-x="start"]').focus({ preventScroll: true });
    },

    // ---------- play ----------
    init(e) {
      env = e; o = contrastFinderOpts();
      W = env.w; H = env.h; c = sliderToC(o.start);
      env.setControls([{ label: 'I can\'t see it', key: ' ', aria: 'I can\'t see it' }]);
      phase = 'gap'; phaseAt = 0;
    },
    onResize(w, h) { W = w; H = h; },
    update() {
      const t = env.elapsed;
      if (phase === 'gap' && t - phaseAt > 0.3) newPatch();
      else if (phase === 'show' && o.limit && t - phaseAt > o.limit) answer(false);
      else if (phase === 'fb' && t - phaseAt > 0.55) newPatch();
      if (rings.length) { rings = rings.filter(g => t - g.t0 < g.dur); env.markDirty(); }
    },
    draw(a, f) {
      const b = board();
      // A soft frame both eyes see, which keeps the eyes lined up with glasses on.
      for (const ctx of [a, f]) { ctx.strokeStyle = 'rgba(0,0,0,0.16)'; ctx.lineWidth = 2; ctx.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0); }
      const t = env.elapsed;
      for (const g of rings) {
        const k = Math.min(1, (t - g.t0) / g.dur);
        for (const ctx of [a, f]) {
          ctx.globalAlpha = 1 - k * k; ctx.strokeStyle = `rgb(${Math.round(g.v * 255)},${Math.round(g.v * 255)},${Math.round(g.v * 255)})`; ctx.lineWidth = g.w;
          ctx.beginPath(); ctx.arc(g.x, g.y, g.r * (1 + 0.15 * k), 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
        }
      }
    },
    params() {
      const gs = [];
      if (cur && (phase === 'show' || phase === 'fb')) {
        const blur = cur.look === 'blur';
        gs.push({ x: cur.x, y: cur.y, sigma: cur.sigma, sf: blur ? 0 : linesFor(o) / (4 * cur.sigma), ori: cur.ori, phase: blur ? 0 : cur.ph, contrast: cur.c, eye: 'A' });
      }
      return { bgA: BG, bgF: BG, gabors: gs };
    },
    onPointer(x, y, type) {
      if (type !== 'pointerdown' || phase !== 'show') return;
      answer(Math.hypot(x - cur.x, y - cur.y) < Math.max(cur.sigma * 3, 30));
    },
    onKey(k) {
      if (k !== ' ') return false;
      if (phase === 'show') answer(false);
      return true;
    },
    result() {
      const th = reversals.length >= 4
        ? Math.pow(10, reversals.slice(-6).reduce((s, v) => s + Math.log10(v), 0) / Math.min(6, reversals.length))
        : (faintest ?? c);
      const avg = findTimes.length ? findTimes.reduce((s, v) => s + v, 0) / findTimes.length : null;
      const lv = levelContrast(o.auto ? th : c);
      const summary = [
        ['Your level', `${lv}`],
        ['Patches found', `${found} of ${total}`],
        ['Faintest you found', faintest != null ? `${pct(faintest)} contrast` : '–'],
      ];
      if (avg != null) summary.push(['Average time to find', `${avg.toFixed(1)} s`]);
      return {
        trials: total, correct: found, score: null,
        threshold: o.auto && found ? th : null, unit: o.auto && found ? 'contrast' : null,
        summary,
        extra: { look: o.look, size: o.size, lines: linesFor(o), auto: o.auto, faintest, avgFind: avg, fixedContrast: o.auto ? null : c },
        // Next time starts a little above today's level.
        apply: st => { if (o.auto && found) { st.opts = st.opts || {}; st.opts[ID] = { ...contrastFinderOpts(), start: cToSlider(Math.min(C_MAX, th * 2)) }; } },
        headline: 'Well done',
      };
    },
  };
}

export { fmtPct };
