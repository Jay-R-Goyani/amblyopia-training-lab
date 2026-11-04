// Visual Power (approved design, after EYEBAB): vergence training with random dots. Each eye gets its own copy of a
// diamond of dots; merged into one, a hidden circle floats in 3D. Click the circle: each right click moves the two
// copies a step further (crossing for eyes in, moving away for eyes out). Mixed swaps between in and out every click.
// Arrow keys and dragging fine-tune the gap. Glasses only: the picture only exists when both eyes work together.
import { db, save } from '../store.js';
import { lens, rgbCss } from '../lens.js';
import { ICON } from '../icons.js';
import { esc } from '../util.js';

const ID = 'visual-power';
const MODES = [['timed', 'Timed'], ['max', 'Max distance']];
const DIRS = [['in', 'Eyes in'], ['out', 'Eyes out'], ['mixed', 'Mixed']];
const DURS = [[30, '30 sec.'], [60, '1 min.'], [120, '2 min.'], [180, '3 min.'], [300, '5 min.']];
const MOVE = 30, NUDGE = 2, LOCAL = 8, START_SEP = 8; // px/s while an arrow is held · px per short press · depth of the circle · starting gap
const STEP = { in: 6, out: 3 }, GLIDE = 80; // px further apart after each right click (eyes turn out less far) · px/s the copies glide
const DEF = { mode: 'timed', dir: 'in', dur: 120 };
const avgOf = a => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);

export function visualPowerOpts() {
  const o = { ...DEF, ...((db.state.opts || {})[ID] || {}) };
  o.dur = +o.dur;
  return o;
}
function saveOpts(o) { db.state.opts = db.state.opts || {}; db.state.opts[ID] = o; save(); }

const TILE = {
  timed: '<svg viewBox="-17 -13 34 26" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle r="10"/><path d="M0 -5.5V0l3.5 3.5"/></svg>',
  max: '<svg viewBox="-17 -13 34 26" aria-hidden="true"><path d="M-15 0H1M-3 -4L1 0L-3 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 -9L16 0L10 9L4 0Z" fill="currentColor"/></svg>',
  in: '<svg viewBox="-17 -13 34 26" fill="currentColor" aria-hidden="true"><path d="M-11 -8L-3 0L-11 8Z"/><path d="M11 -8L3 0L11 8Z"/></svg>',
  out: '<svg viewBox="-17 -13 34 26" fill="currentColor" aria-hidden="true"><path d="M-3 -8L-11 0L-3 8Z"/><path d="M3 -8L11 0L3 8Z"/></svg>',
  mixed: '<svg viewBox="-17 -13 34 26" fill="currentColor" aria-hidden="true"><path d="M-15 -7L-8 0L-15 7Z"/><path d="M3 -7L-4 0L3 7Z"/><path d="M8 -7L15 0L8 7Z"/></svg>',
};
const tile = (attr, val, on, icon, label) => `<button class="ejs-ptile" data-${attr}="${val}" aria-pressed="${on}"><span class="box">${icon}</span><span>${label}</span></button>`;

// One diamond of random dots per eye: the same dots for both eyes, except inside a hidden circle, where one pattern is
// shifted a little right for one eye and left for the other, so the merged circle floats in 3D.
function buildPicture(r, cell, dir) {
  const size = Math.ceil(r * 2), make = () => { const cv = document.createElement('canvas'); cv.width = cv.height = size; return cv; };
  const L = make(), R = make(), cl = L.getContext('2d'), cr = R.getContext('2d');
  const rad = Math.round(r * 0.17); let px, py;
  do { px = r + (Math.random() * 2 - 1) * r; py = r + (Math.random() * 2 - 1) * r; } while (Math.abs(px - r) + Math.abs(py - r) > r - rad * 1.7 || Math.hypot(px - r, py - r) < rad * 1.2);
  const inDiamond = (x, y) => Math.abs(x - r) + Math.abs(y - r) <= r, inCircle = (x, y) => Math.hypot(x - px, y - py) <= rad;
  const p = 0.36, dot = Math.max(2, cell - 1), jit = () => (Math.random() - 0.5) * cell * 0.5, sz = () => dot + (Math.random() < 0.3 ? 1 : 0);
  cl.fillStyle = cr.fillStyle = '#fff';
  for (let y = 0; y < size; y += cell) for (let x = 0; x < size; x += cell) {
    const mx = x + cell / 2, my = y + cell / 2;
    if (inDiamond(mx, my) && !inCircle(mx, my) && Math.random() < p) { const dx = x + jit(), dy = y + jit(), s1 = sz(); cl.fillRect(dx, dy, s1, s1); cr.fillRect(dx, dy, s1, s1); }
  }
  const pat = document.createElement('canvas'), m = LOCAL; pat.width = 2 * rad + 2 * m; pat.height = 2 * rad;
  const pc = pat.getContext('2d'); pc.fillStyle = '#fff';
  for (let y = 0; y < pat.height; y += cell) for (let x = 0; x < pat.width; x += cell) if (Math.random() < p) pc.fillRect(x + jit(), y + jit(), sz(), sz());
  const lx = (dir === 'in' ? 1 : -1) * LOCAL / 2; // in front for eyes in, behind for eyes out
  for (const [c, shift] of [[cl, lx], [cr, -lx]]) { c.save(); c.beginPath(); c.arc(px, py, rad, 0, Math.PI * 2); c.clip(); c.drawImage(pat, px - rad - m + shift, py - rad); c.restore(); }
  return { L, R, circle: { x: px, y: py, r: rad } };
}
// Where each eye's copy goes for a signed separation s: + = crossed (eyes in: the left eye's copy moves right), - = the other way.
const copyX = (cx, r, s) => ({ left: cx - r + s / 2, right: cx - r - s / 2 });
function triangle(c, x, y, size, fill) { c.fillStyle = fill; c.beginPath(); c.moveTo(x, y - size * 0.8); c.lineTo(x + size, y + size * 0.4); c.lineTo(x - size, y + size * 0.4); c.closePath(); c.fill(); }

export function visualPower() {
  let env, o, W = 0, H = 0, R = 0, pic = null, dir = 'in', sep = { in: START_SEP, out: START_SEP }, shownS = START_SEP, hold = 0, drag = null, lastT = 0;
  let found = [], misses = 0, missRun = 0, roundAt = 0, best = { in: 0, out: 0 }, done = { in: false, out: false }, ended = false, hintCount = 0;
  const cx = () => W / 2, cy = () => (H - 70) / 2, maxSep = () => Math.max(0, W - 2 * R - 40), clampSep = v => Math.max(0, Math.min(maxSep(), v));
  const targetS = () => (dir === 'in' ? sep.in : -sep.out);
  function newCircle() { pic = buildPicture(R, Math.max(3, Math.round(Math.min(W, H) / 220)), dir); roundAt = env.elapsed; missRun = 0; env.markDirty(); }
  const corner = () => env.setCorner(`Eyes ${dir} · ${Math.round(sep[dir])} px apart · found ${found.length}${best[dir] ? ` · best ${best[dir]} px` : ''}`);
  const hint = () => env.setTip(hintCount < 3 ? 'Click the 3D circle · ← → fine-tune' : '');
  function clickAt(x, y) {
    const c = pic.circle, px = cx() - R + c.x, py = cy() - R + c.y; // the merged diamond is seen in the middle
    if (Math.hypot(x - px, y - py) <= c.r * 1.5) {
      const gap = Math.round(sep[dir]); found.push({ dir, sep: gap, time: env.elapsed - roundAt });
      best[dir] = Math.max(best[dir], gap); env.sfx.good(); hintCount++; hint();
      sep[dir] = clampSep(sep[dir] + STEP[dir]); // a step further: crossing for eyes in, moving away for eyes out
      if (o.dir === 'mixed') { const other = dir === 'in' ? 'out' : 'in'; if (!done[other]) dir = other; } // swap every click
      newCircle();
    } else {
      misses++; missRun++; env.sfx.bad();
      if (missRun >= 3) {
        if (o.mode === 'max') {
          done[dir] = true;
          const left = o.dir === 'mixed' ? ['in', 'out'].filter(d => !done[d]) : [];
          if (!left.length) { ended = true; env.end(); return; }
          dir = left[0];
        } else sep[dir] = Math.max(START_SEP, sep[dir] - 2 * STEP[dir]); // timed: back a little so you can find it again
        newCircle();
      }
    }
    corner();
  }

  const game = {
    id: ID, title: 'Visual Power', mode: 'anaglyph', modes: ['anaglyph'], hud: 'minimal', hiRes: true, staticLayers: true,
    how: 'Keep the two copies as one, find the 3D circle and click it.',
    countHint: () => 'Glasses on. Find the 3D circle and click it. Each right click moves the copies a step further.',

    // ---------- the approved settings page ----------
    renderSetup(el, api) {
      let raf = 0;
      const draw = () => {
        const so = visualPowerOpts(), L = lens('left'), Rl = lens('right');
        el.innerHTML = `
          <div class="ejs">
            <div class="ejs-top">
              <button class="ejs-back" data-x="back">${ICON.arrowLeft}<span>Back</span></button>
              <h1>Visual Power</h1>
              <button class="ejs-help" data-x="help" aria-expanded="false">How it helps</button>
            </div>
            <div class="ejs-helpbox" hidden>
              <p><b>What you see:</b> each eye gets its own copy of a diamond of dots, one in each lens colour. Merged into one, a <b>3D circle</b> appears somewhere in the diamond, floating ${so.dir === 'out' ? 'behind' : so.dir === 'in' ? 'in front of' : 'in front of or behind'} the rest. Each eye alone sees only random dots, so the circle only shows up when both eyes work together.</p>
              <p><b>What you do:</b> find the 3D circle and click (or tap) it. Each right click moves the two copies a step further: <b>crossing</b> over each other for eyes in, <b>moving away</b> from each other for eyes out. Then a new circle appears somewhere else. With <b>Mixed</b>, every click swaps between eyes in and eyes out. You can fine-tune the gap yourself with the <b>← →</b> arrow keys or by dragging.</p>
              <p><b>What it trains:</b> your vergence power: how far your eyes can turn together while keeping one picture. <b>Eyes in</b> is converging (as for close work), <b>eyes out</b> is diverging, <b>Mixed</b> trains switching quickly.</p>
              <p>If your eyes feel strained, stop and rest.</p>
            </div>
            <p class="ejs-needs">This game needs your colour glasses: it trains your two eyes working together, so there's no eye-patch version.</p>
            <p class="ejs-note">Glasses: <b><i class="sw" style="background:${rgbCss(L.rgb)}"></i>${esc(L.name)}</b> left · <b><i class="sw" style="background:${rgbCss(Rl.rgb)}"></i>${esc(Rl.name)}</b> right · <button class="ejs-link" data-x="lens">Change</button></p>
            <div class="ejs-preview em" aria-label="Preview"><span class="cap">Preview · the two copies moving apart</span><canvas></canvas></div>
            <section class="ejs-sect"><div class="ejs-lab">Mode</div>
              <div class="ejs-paths pc t2">${MODES.map(([k, l]) => tile('mode', k, so.mode === k, TILE[k], l)).join('')}</div>
              <p class="ejs-hint" style="text-align:left">${so.mode === 'timed' ? 'Each right click moves the copies a step further. Three misses in a row bring them back a little.' : 'Each right click moves the copies a step further, until you miss three times in a row. Then it shows how far you got.'}</p></section>
            <section class="ejs-sect"><div class="ejs-lab">Direction</div>
              <div class="ejs-paths pc t3">${DIRS.map(([k, l]) => tile('dir', k, so.dir === k, TILE[k], l)).join('')}</div></section>
            <section class="ejs-sect" ${so.mode === 'timed' ? '' : 'hidden'}><div class="ejs-lab">How long</div>
              <div class="ejs-dur">${DURS.map(([v, l]) => `<button data-dur="${v}" aria-pressed="${so.dur === v}"><span class="dot"></span>${l}</button>`).join('')}</div></section>
            <div class="ejs-startbar">
              <button class="ejs-start" data-x="start">${ICON.play}<span>Start</span></button>
              <p class="ejs-hint">Glasses on · click the 3D circle · each right click moves the copies further · <b>← →</b> fine-tune · <b>Space</b> pauses</p>
            </div>
          </div>`;
        // preview: the two copies drifting apart and back, in the real lens colours
        cancelAnimationFrame(raf);
        const box = el.querySelector('.ejs-preview'), cv = box.querySelector('canvas'), dpr = Math.min(window.devicePixelRatio || 1, 2), r = 80;
        const w = Math.max(240, box.clientWidth - 2), h = 2 * r + 60, d = so.dir === 'out' ? 'out' : 'in';
        cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.width = w + 'px'; cv.style.height = h + 'px'; box.style.minHeight = h + 'px';
        const pv = buildPicture(r, 3, d), tint = (src, col) => { const t = document.createElement('canvas'); t.width = src.width; t.height = src.height; const c = t.getContext('2d'); c.drawImage(src, 0, 0); c.globalCompositeOperation = 'source-in'; c.fillStyle = rgbCss(col); c.fillRect(0, 0, t.width, t.height); return t; };
        const tl = tint(pv.L, lens('left').rgb), tr = tint(pv.R, lens('right').rgb), both = rgbCss([0, 1, 2].map(i => Math.min(255, lens('left').rgb[i] + lens('right').rgb[i])));
        const tick = t => {
          if (!cv.isConnected) return;
          const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
          const s = (d === 'in' ? 1 : -1) * (0.5 - 0.5 * Math.cos(t / 1000 * 0.7)) * Math.min(110, w - 2 * r - 30), x = copyX(w / 2, r, s);
          c.save(); c.imageSmoothingEnabled = false; c.globalCompositeOperation = 'lighter'; c.drawImage(tl, Math.round(x.left), 24); c.drawImage(tr, Math.round(x.right), 24); c.restore();
          const xs = Math.abs(s) < 1 ? [w / 2] : [x.left + r, x.right + r]; xs.forEach(xx => triangle(c, xx, h - 14, 7, both));
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      };
      const set = (patch, focusSel) => { saveOpts({ ...visualPowerOpts(), ...patch }); draw(); if (focusSel) { const nn = el.querySelector(focusSel); if (nn) nn.focus(); } };
      el.onclick = e => {
        const b = e.target.closest('button'); if (!b) return;
        const d = b.dataset;
        if (d.x === 'back') { cancelAnimationFrame(raf); api.close(); }
        else if (d.x === 'lens') { cancelAnimationFrame(raf); api.close('#setup-glasses'); }
        else if (d.x === 'help') { const hb = el.querySelector('.ejs-helpbox'); hb.hidden = !hb.hidden; b.setAttribute('aria-expanded', String(!hb.hidden)); }
        else if (d.x === 'start') { cancelAnimationFrame(raf); const so = visualPowerOpts(); api.start(so.mode === 'max' ? 30 : so.dur / 60); }
        else if (d.mode) set({ mode: d.mode }, `[data-mode="${d.mode}"]`);
        else if (d.dir) set({ dir: d.dir }, `[data-dir="${d.dir}"]`);
        else if (d.dur) set({ dur: +d.dur }, `[data-dur="${d.dur}"]`);
      };
      draw();
      el.querySelector('[data-x="start"]').focus({ preventScroll: true });
    },

    // ---------- play ----------
    init(e) {
      env = e; o = visualPowerOpts(); W = env.w; H = env.h; R = Math.round(Math.min(W * 0.3, (H - 140) * 0.42)); lastT = env.elapsed;
      game.noDuration = o.mode === 'max'; // Max distance runs until you miss three times in a row
      sep = { in: START_SEP, out: START_SEP }; best = { in: 0, out: 0 }; done = { in: false, out: false }; found = []; misses = 0; ended = false; hintCount = 0; hold = 0; drag = null;
      dir = o.dir === 'mixed' ? 'in' : o.dir; shownS = targetS();
      newCircle(); corner(); hint();
      if (/[?&]test\b/.test(location.search)) window.__vp = () => ({ sep: { ...sep }, shownS, dir, found: found.length, misses, best: { ...best }, circle: { x: cx() - R + pic.circle.x, y: cy() - R + pic.circle.y, r: pic.circle.r } }); // automated checks only
    },
    onResize(w, h) { W = w; H = h; const r = Math.round(Math.min(W * 0.3, (H - 140) * 0.42)); if (r !== R) { R = r; newCircle(); } sep.in = clampSep(sep.in); sep.out = clampSep(sep.out); },
    update() {
      const dt = Math.min(0.25, env.elapsed - lastT); lastT = env.elapsed;
      if (hold) { sep[dir] = clampSep(sep[dir] + hold * MOVE * dt); corner(); }
      const tgt = targetS(), stepPx = (drag || hold ? 4000 : GLIDE) * dt; // follow your hand at once; glide after a click
      if (shownS !== tgt) { shownS = Math.abs(tgt - shownS) <= stepPx ? tgt : shownS + Math.sign(tgt - shownS) * stepPx; env.markDirty(); }
    },
    draw(a, f) {
      if (!pic) return;
      const amb = db.settings.amblyopicEye, layerOf = eye => (eye === amb ? a : f), x = copyX(cx(), R, shownS), y = Math.round(cy() - R);
      for (const [eye, img, xx] of [['left', pic.L, x.left], ['right', pic.R, x.right]]) {
        const c = layerOf(eye); c.save(); c.imageSmoothingEnabled = false; c.drawImage(img, Math.round(xx * 2) / 2, y); c.restore();
      }
      const xs = Math.abs(shownS) < 1 ? [cx()] : [x.left + R, x.right + R]; // small triangles under each copy, seen by both eyes
      for (const c of [a, f]) xs.forEach(xx => triangle(c, xx, H - 26, 11, '#fff'));
    },
    params() { return { bgA: 0, bgF: 0 }; },
    // a quick click answers; a drag left/right moves the copies (right = further apart)
    onPointer(x, y, type) {
      if (type === 'pointerdown') drag = { x0: x, y0: y, sep0: sep[dir], moved: false };
      else if (type === 'pointermove' && drag) {
        if (!drag.moved && Math.abs(x - drag.x0) > 6) drag.moved = true;
        if (drag.moved) { sep[dir] = clampSep(drag.sep0 + (x - drag.x0)); corner(); }
      } else if ((type === 'pointerup' || type === 'pointercancel') && drag) {
        const d = drag; drag = null;
        if (!d.moved && type === 'pointerup') clickAt(d.x0, d.y0);
      }
    },
    onKey(key, e) {
      if (key !== 'ArrowRight' && key !== 'ArrowLeft') return false;
      const d = key === 'ArrowRight' ? 1 : -1;
      if (!e || !e.repeat) { sep[dir] = clampSep(sep[dir] + d * NUDGE); corner(); } // a short press moves a little
      hold = d; // holding glides smoothly
      return true;
    },
    onKeyUp(key) { if ((key === 'ArrowRight' && hold === 1) || (key === 'ArrowLeft' && hold === -1)) hold = 0; },
    onPause() { hold = 0; drag = null; },
    result() {
      env.setCorner(''); env.setTip('');
      if (!found.length && !misses) return null;
      const used = o.dir === 'mixed' ? ['in', 'out'] : [o.dir], summary = [];
      for (const d of used) {
        const fd = found.filter(x => x.dir === d);
        summary.push([`Eyes ${d}: furthest apart you found the circle`, fd.length ? `${best[d]} px` : 'not yet']);
        if (fd.length) summary.push([`Eyes ${d}: circles found · average gap`, `${fd.length} · ${Math.round(avgOf(fd.map(x => x.sep)))} px`]);
      }
      const avgT = avgOf(found.map(x => x.time));
      summary.push(['Circles found', `${found.length}${avgT != null ? ` · ${avgT.toFixed(1)} s each` : ''}`], ['Clicks that missed', `${misses}`]);
      summary.push(['Mode', `${MODES.find(m => m[0] === o.mode)[1]} · ${DIRS.find(d => d[0] === o.dir)[1]}`]);
      summary.push(['Next', found.length ? 'Try to push the copies a little further apart next time.' : 'If the circle never appears, check your glasses (left and right colours) and start again.']);
      return {
        complete: ended || (o.mode === 'timed' && env.elapsed >= o.dur - 0.5), trials: found.length + misses, correct: found.length, threshold: null, unit: null, score: null,
        headline: found.length ? 'Well done' : 'Good try', summary,
        extra: { mode: o.mode, dir: o.dir, found: found.length, misses, bestIn: best.in, bestOut: best.out },
      };
    },
  };
  return game;
}
