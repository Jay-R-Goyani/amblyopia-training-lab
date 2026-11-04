// FOV Spot (approved design): keep your eyes on the centre mark; tap the spot that appears around it.
// On the spot = found, anywhere else = missed; either way the spot moves straight to a new place.
import { db, save, fellowEye } from '../store.js';
import { lens, rgbCss } from '../lens.js';
import { ICON } from '../icons.js';
import { esc } from '../util.js';

const ID = 'fov-spot';
const LEVELS = {
  easy: { label: 'Easy', size: 48, reach: 45 },
  medium: { label: 'Medium', size: 36, reach: 70 },
  hard: { label: 'Hard', size: 26, reach: 90 },
  extreme: { label: 'Extreme', size: 18, reach: 100 },
};
const DURS = [[60, '1 min'], [120, '2 min'], [180, '3 min'], [300, '5 min']];
const DEF = { level: 'easy', size: 48, reach: 45, dur: 120 };
const SECTOR_NAMES = ['right', 'lower right', 'below', 'lower left', 'left', 'upper left', 'above', 'upper right'];

export function fovSpotOpts() {
  const o = { ...DEF, ...((db.state.opts || {})[ID] || {}) };
  for (const k of ['size', 'reach', 'dur']) o[k] = +o[k];
  return o;
}
function saveOpts(o) { db.state.opts = db.state.opts || {}; db.state.opts[ID] = o; save(); }
const levelName = o => (LEVELS[o.level] ? LEVELS[o.level].label : 'Custom');

function drawCentre(c, x, y) {
  c.strokeStyle = 'rgba(255,255,255,0.85)'; c.lineWidth = 2; c.beginPath(); c.arc(x, y, 9, 0, Math.PI * 2); c.stroke();
  c.fillStyle = '#fff'; c.beginPath(); c.arc(x, y, 2.5, 0, Math.PI * 2); c.fill();
}
function disc(c, x, y, r, fill) { c.fillStyle = fill; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); }

// Map of the 8 directions, coloured by how many spots were found there.
function fovMap(sectors) {
  const cx = 60, cy = 60, R = 52;
  let paths = '';
  sectors.forEach(([h, n], i) => {
    const a0 = (i - 0.5) * Math.PI / 4, a1 = (i + 0.5) * Math.PI / 4, rate = n ? h / n : null;
    const fill = rate == null ? '#e3ebea' : rate >= 0.85 ? '#1b7a4b' : rate >= 0.6 ? '#7cc29c' : rate >= 0.35 ? '#f0b45a' : '#d9534f';
    const p = (a, r) => `${(cx + Math.cos(a) * r).toFixed(1)},${(cy + Math.sin(a) * r).toFixed(1)}`;
    paths += `<path d="M${p(a0, 10)} L${p(a0, R)} A${R},${R} 0 0 1 ${p(a1, R)} L${p(a1, 10)} A10,10 0 0 0 ${p(a0, 10)} Z" fill="${fill}" stroke="#fff" stroke-width="2"><title>${SECTOR_NAMES[i]}: ${h} of ${n}</title></path>`;
  });
  return `<div class="fovmap"><svg viewBox="0 0 120 120" role="img" aria-label="Map of which directions you found spots in">${paths}<circle cx="60" cy="60" r="4" fill="#17292c"/></svg>
    <div class="fovlegend"><b>Directions</b><span><i style="background:#1b7a4b"></i>found most</span><span><i style="background:#f0b45a"></i>found some</span><span><i style="background:#d9534f"></i>missed most</span><span><i style="background:#e3ebea"></i>no spots yet</span></div></div>`;
}

export function fovSpot() {
  let env, o, W = 0, H = 0, spot = null, hits = 0, misses = 0, times = [], flashes = [];
  let sectors = [], perEye = { left: [0, 0], right: [0, 0], none: [0, 0] };
  const centre = () => [W / 2, (H - 40) / 2 + 20];

  function newSpot() {
    const [cx, cy] = centre(), rx = (W / 2 - o.size - 20) * o.reach / 100, ry = ((H - 40) / 2 - o.size - 50) * o.reach / 100;
    // spread out: use one of the directions shown least so far
    const counts = sectors.map(x => x[1]), min = Math.min(...counts), choices = counts.map((c, i) => (c <= min + 1 ? i : -1)).filter(i => i >= 0);
    const sec = choices[Math.floor(Math.random() * choices.length)];
    const a = sec * Math.PI / 4 + (Math.random() - 0.5) * (Math.PI / 4), k = 0.35 + Math.random() * 0.65;
    const eye = env.mode === 'anaglyph' ? (Math.random() < 0.5 ? 'left' : 'right') : 'none';
    spot = { x: cx + Math.cos(a) * rx * k, y: cy + Math.sin(a) * ry * k, t0: env.elapsed, sec, eye };
    sectors[sec][1]++; perEye[eye][1]++;
    env.markDirty();
  }
  const corner = () => env.setCorner(`${levelName(o)} · found ${hits} of ${hits + misses}`);

  return {
    id: ID, title: 'FOV Spot', mode: 'anaglyph', modes: ['mono', 'anaglyph'], hud: 'minimal',
    how: 'Keep your eyes on the centre mark and tap the spot that appears around it.',
    countHint: () => 'Keep your eyes on the centre mark and tap the spot',

    // ---------- the approved settings page ----------
    renderSetup(el, api) {
      let pv = { raf: 0, t: 0, last: 0, spot: null, next: 0.6 };
      const draw = () => {
        const so = fovSpotOpts(), glasses = api.mode === 'anaglyph', L = lens('left'), R = lens('right');
        el.innerHTML = `
          <div class="ejs">
            <div class="ejs-top">
              <button class="ejs-back" data-x="back">${ICON.arrowLeft}<span>Back</span></button>
              <h1>FOV Spot</h1>
              <button class="ejs-help" data-x="help" aria-expanded="false">How it helps</button>
            </div>
            <div class="ejs-helpbox" hidden>
              <p><b>What you do:</b> keep your eyes on the centre mark the whole time. A spot appears somewhere around it. Notice it out of the corner of your eye and tap it. Tapping the spot counts as found; tapping anywhere else counts as missed. Either way, the spot then moves to a new place.</p>
              <p><b>What it trains:</b> side (peripheral) vision and reaction: noticing things around you while you look straight ahead, like cars at a junction or people in a crowd.</p>
              <p><b>With colour glasses</b> each spot is in one lens colour, so only one eye sees it. Both eyes have to keep watching their side.</p>
              <p><b>The map at the end</b> shows which directions you found well and which you missed, so you can see where to practise.</p>
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
              <p class="ejs-hint" style="text-align:left">${so.level === 'custom' ? 'Your own mix of the settings below.' : `${levelName(so)}: ${so.size} px spots, up to ${so.reach}% of the way out. Change anything below to make your own.`}</p></section>
            <section class="ejs-sect"><div class="ejs-lab"><span>Spot size</span><output data-out="size">${so.size} px</output></div>
              <div class="ejs-slider"><span class="end txt">Small</span><input type="range" data-range="size" min="8" max="90" step="2" value="${so.size}" aria-label="Spot size"><span class="end txt">Big</span></div></section>
            <section class="ejs-sect"><div class="ejs-lab"><span>How far out spots appear</span><output data-out="reach">${so.reach}%</output></div>
              <div class="ejs-slider"><span class="end txt">Near centre</span><input type="range" data-range="reach" min="20" max="100" step="5" value="${so.reach}" aria-label="How far from the centre"><span class="end txt">Screen edge</span></div></section>
            <section class="ejs-sect"><div class="ejs-lab">How long</div>
              <div class="ejs-dur">${DURS.map(([v, l]) => `<button data-dur="${v}" aria-pressed="${so.dur === v}"><span class="dot"></span>${l}</button>`).join('')}</div></section>
            <div class="ejs-startbar">
              <button class="ejs-start" data-x="start">${ICON.play}<span>Start</span></button>
              <p class="ejs-hint">Eyes on the centre · tap the spot · <b>Esc</b> pauses · <b>Back</b> finishes</p>
            </div>
          </div>`;
        const box = el.querySelector('.ejs-preview'), cv = box.querySelector('canvas'), dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = Math.max(200, box.clientWidth - 2), h = 190;
        cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.width = w + 'px'; cv.style.height = h + 'px';
        box.style.minHeight = h + 'px';
      };
      // The preview moves a spot to a new place every 1.3 s, as if tapped.
      const tick = t => {
        if (!el.isConnected) { pv.raf = 0; return; }
        const cv = el.querySelector('.ejs-preview canvas'); if (!cv) { pv.raf = requestAnimationFrame(tick); return; }
        const so = fovSpotOpts(), glasses = api.mode === 'anaglyph';
        const dpr = cv.width / parseFloat(cv.style.width), w = cv.width / dpr, h = cv.height / dpr, cx = w / 2, cy = h / 2 + 8;
        const dt = Math.min(0.1, (t - (pv.last || t)) / 1000); pv.last = t; pv.t += dt;
        if (!pv.spot && pv.t >= pv.next) {
          const a = Math.random() * Math.PI * 2, rx = (w / 2 - so.size) * so.reach / 100, ry = (h / 2 - so.size / 2 - 14) * so.reach / 100, k = 0.45 + Math.random() * 0.55;
          pv.spot = { x: cx + Math.cos(a) * rx * k, y: cy + Math.sin(a) * ry * k, t0: pv.t, eye: Math.random() < 0.5 ? 'left' : 'right' };
        }
        if (pv.spot && pv.t - pv.spot.t0 > 1.3) { pv.spot = null; pv.next = pv.t; }
        const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
        drawCentre(c, cx, cy);
        if (pv.spot) disc(c, pv.spot.x, pv.spot.y, so.size / 2, glasses ? rgbCss(lens(pv.spot.eye).rgb) : 'rgb(235,235,235)');
        pv.raf = requestAnimationFrame(tick);
      };
      const set = (patch, focusSel) => { saveOpts({ ...fovSpotOpts(), ...patch }); draw(); if (focusSel) { const nn = el.querySelector(focusSel); if (nn) nn.focus(); } };
      el.onclick = e => {
        const b = e.target.closest('button'); if (!b) return;
        const d = b.dataset;
        if (d.x === 'back') { cancelAnimationFrame(pv.raf); api.close(); }
        else if (d.x === 'lens') { cancelAnimationFrame(pv.raf); api.close('#setup-glasses'); }
        else if (d.x === 'help') { const hb = el.querySelector('.ejs-helpbox'); hb.hidden = !hb.hidden; b.setAttribute('aria-expanded', String(!hb.hidden)); }
        else if (d.x === 'start') { cancelAnimationFrame(pv.raf); api.start(fovSpotOpts().dur / 60); }
        else if (d.mode) { api.setMode(d.mode); draw(); el.querySelector(`[data-mode="${d.mode}"]`).focus(); }
        else if (d.level) { const lv = LEVELS[d.level]; set(lv ? { level: d.level, size: lv.size, reach: lv.reach } : { level: 'custom' }, `[data-level="${d.level}"]`); }
        else if (d.dur) set({ dur: +d.dur }, `[data-dur="${d.dur}"]`);
      };
      el.oninput = e => {
        const r = e.target.closest('[data-range]'); if (!r) return;
        const so = fovSpotOpts(), k = r.dataset.range, v = +r.value;
        so[k] = v; so.level = 'custom';
        el.querySelectorAll('[data-level]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.level === 'custom')));
        el.querySelector(`[data-out="${k}"]`).textContent = k === 'size' ? `${v} px` : `${v}%`;
        saveOpts(so);
      };
      el.onchange = e => { const r = e.target.closest('[data-range]'); if (!r) return; draw(); const nn = el.querySelector(`[data-range="${r.dataset.range}"]`); if (nn) nn.focus(); };
      draw();
      pv.raf = requestAnimationFrame(tick);
      el.querySelector('[data-x="start"]').focus({ preventScroll: true });
    },

    // ---------- play ----------
    init(e) {
      env = e; o = fovSpotOpts(); W = env.w; H = env.h;
      sectors = Array.from({ length: 8 }, () => [0, 0]);
      newSpot(); corner();
    },
    onResize(w, h) { W = w; H = h; },
    update() {
      const t = env.elapsed;
      if (flashes.length) { flashes = flashes.filter(f => t - f.t0 < (f.ok ? 0.45 : 0.7)); env.markDirty(); }
    },
    draw(a, f) {
      const [cx, cy] = centre(), t = env.elapsed, amb = db.settings.amblyopicEye;
      drawCentre(a, cx, cy); drawCentre(f, cx, cy); // both eyes see the centre mark
      if (spot) disc(spot.eye === 'none' || spot.eye === amb ? a : f, spot.x, spot.y, o.size / 2, spot.eye === 'none' ? 'rgb(235,235,235)' : '#fff');
      for (const c of [a, f]) for (const fl of flashes) {
        const k = Math.min(1, (t - fl.t0) / (fl.ok ? 0.45 : 0.7));
        c.globalAlpha = (fl.ok ? 0.8 : 0.5) * (1 - k); c.strokeStyle = '#fff'; c.lineWidth = fl.ok ? 3 : 2;
        if (fl.cross) { const q = 9; c.beginPath(); c.moveTo(fl.x - q, fl.y - q); c.lineTo(fl.x + q, fl.y + q); c.moveTo(fl.x + q, fl.y - q); c.lineTo(fl.x - q, fl.y + q); c.stroke(); }
        else { if (!fl.ok) c.setLineDash([4, 5]); c.beginPath(); c.arc(fl.x, fl.y, o.size / 2 + 8 + 10 * k, 0, Math.PI * 2); c.stroke(); c.setLineDash([]); }
        c.globalAlpha = 1;
      }
    },
    params() { return { bgA: 0, bgF: 0 }; },
    onPointer(x, y, type) {
      if (type !== 'pointerdown' || !spot) return;
      if (Math.hypot(x - spot.x, y - spot.y) <= o.size / 2 + 6) { // on the spot
        hits++; times.push(env.elapsed - spot.t0); sectors[spot.sec][0]++; perEye[spot.eye][0]++;
        flashes.push({ x: spot.x, y: spot.y, t0: env.elapsed, ok: true }); env.sfx.good();
      } else { // anywhere else
        misses++;
        flashes.push({ x: spot.x, y: spot.y, t0: env.elapsed, ok: false }, { x, y, t0: env.elapsed, ok: false, cross: true }); env.sfx.bad();
      }
      newSpot(); corner();
    },
    onKey() { return false; },
    result() {
      env.setCorner('');
      if (spot) { sectors[spot.sec][1]--; perEye[spot.eye][1]--; spot = null; } // the last spot was never answered
      const tries = hits + misses;
      if (!tries) return null;
      const pct = Math.round((hits / tries) * 100), avg = times.length ? times.reduce((s, v) => s + v, 0) / times.length : null;
      const worst = sectors.map(([h, n], i) => ({ i, rate: n ? h / n : 1, n })).filter(x => x.n >= 2).sort((p, q) => p.rate - q.rate)[0];
      const glasses = env.mode === 'anaglyph', L = lens('left'), R = lens('right');
      const summary = [['Found', `${hits} of ${tries} (${pct}%) · ${levelName(o)}`]];
      if (avg != null) summary.push(['Average time to tap', `${avg.toFixed(2)} s`]);
      if (glasses) summary.push([`Left eye (${esc(L.name)})`, `${perEye.left[0]} of ${perEye.left[1]}`], [`Right eye (${esc(R.name)})`, `${perEye.right[0]} of ${perEye.right[1]}`]);
      summary.push(['Hardest direction', worst && worst.rate < 0.8 ? SECTOR_NAMES[worst.i] : 'none, well done']);
      return {
        complete: true, trials: tries, correct: hits, threshold: null, unit: null, score: null,
        headline: pct >= 90 ? 'Excellent' : 'Well done', summary, html: fovMap(sectors),
        extra: { level: o.level, size: o.size, reach: o.reach, avgTap: avg, sectors, left: perEye.left, right: perEye.right },
      };
    },
  };
}
