// Full-screen session runner: get ready -> (glasses check) -> countdown -> game loop -> summary -> how do your eyes feel -> up next.
import { Renderer } from './gl.js';
import { db, save, addSession, addSymptoms, todayKey, fellowEye, dichOff, planMode } from './store.js';
import { pxPerDeg, initAudio, sfx, esc, rand, clamp } from './util.js';
import { lens, pairName, swapLenses } from './lens.js';
import { ICON, GAME_ICON } from './icons.js';

export function feLevelStart() {
  const v = db.state.feLevel ?? db.state.balance ?? 0.3;
  return clamp(v, 0.05, 1);
}

const LOWER_BETTER = { contrast: true, coherence: true, spacing: true, arcmin: true, balance: false, seconds: true, level: false, prism: false, fe: false };

function previousBest(gameId, unit) {
  const vals = db.sessions.filter(s => s.game === gameId && s.threshold != null && s.unit === unit && !s.example).map(s => s.threshold);
  if (!vals.length) return null;
  return LOWER_BETTER[unit] ? Math.min(...vals) : Math.max(...vals);
}

// What to change between two activities (patch <-> glasses)
export function changeSteps(fromMode, toMode) {
  const fel = fellowEye();
  const L = lens('left'), R = lens('right');
  if (fromMode === toMode) {
    return [toMode === 'anaglyph'
      ? `${ICON.glasses}<span>Keep your two-colour glasses on. Blink and look away for a moment.</span>`
      : `${ICON.patch}<span>Keep the patch on your ${fel} eye. Blink and look away for a moment.</span>`];
  }
  if (toMode === 'anaglyph') {
    return [
      fromMode === 'mono' ? `${ICON.patch}<span>Take off the eye patch.</span>` : null,
      `${ICON.glasses}<span>Glasses on: ${esc(L.name)} lens left, ${esc(R.name)} lens right.</span>`,
    ].filter(Boolean);
  }
  return [
    fromMode === 'anaglyph' ? `${ICON.glasses}<span>Take off the two-colour glasses.</span>` : null,
    `${ICON.patch}<span>Patch on your ${fel} (stronger) eye.</span>`,
  ].filter(Boolean);
}

// The mode a game will run in: the person's last choice for it, else the game's default.
export function gameModeFor(game) {
  const modes = game.modes || [game.mode];
  const saved = (db.state.modes || {})[game.id];
  return modes.includes(saved) ? saved : (modes.includes(game.mode) ? game.mode : modes[0]);
}

export function runGame(game, { minutes = 5, onExit, upNext = null, step = null } = {}) {
  const s = db.settings;
  if (!db.state.modes) db.state.modes = {};
  if (!db.state.opts) db.state.opts = {};
  // The doctor's plan can fix the mode, and two-eye play is removed while it's paused or not allowed.
  let modes = game.modes || [game.mode];
  const pm = planMode(game.id);
  if (dichOff() && modes.some(m => m !== 'anaglyph')) modes = modes.filter(m => m !== 'anaglyph');
  if (pm && modes.includes(pm)) modes = [pm];
  game.modes = modes;
  game.mode = gameModeFor(game);
  const optVals = () => {
    const saved = db.state.opts[game.id] || {}, o = {};
    for (const d of game.options || []) {
      const hit = d.choices.find(([v]) => String(v) === String(saved[d.key]));
      o[d.key] = hit ? hit[0] : d.default ?? d.choices[0][0];
    }
    return o;
  };
  const root = document.createElement('div');
  root.className = 'stage';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', game.title);
  root.innerHTML = `
    <canvas class="stage-gl" aria-label="Training display"></canvas>
    <canvas class="stage-colour" aria-hidden="true"></canvas>
    <div class="stage-top">
      <div class="stage-title"><span class="eye-dot ${game.mode === 'anaglyph' ? 'both' : ''}"></span>${esc(game.title)}${step ? `<span class="muted small" style="color:#b9c4c7">· ${step}</span>` : ''}</div>
      <div class="stage-stats" aria-live="polite">
        <span class="timebar" aria-hidden="true"><i></i></span>
        <span data-k="time"></span>
        <span data-k="status"></span>
      </div>
      <div class="stage-actions">
        <button class="hudbtn" data-act="pause" aria-label="Pause">${ICON.pause}<span>Pause</span></button>
        <button class="hudbtn" data-act="quit">${ICON.close}<span>End</span></button>
      </div>
    </div>
    <div class="toast" role="status"></div>
    <div class="stage-strip" aria-hidden="true"></div>
    <div class="stage-tip" aria-live="polite"></div>
    <div class="stage-corner"></div>
    <div class="stage-center"></div>
    <div class="stage-controls"></div>
    <button class="stage-back" data-act="back" aria-label="Finish and go back">${ICON.logout}<span>Back</span></button>`;
  if (game.hud === 'minimal') root.classList.add('minimal');
  if (game.pills) root.classList.add('pills'); // labels get a dark backing, for games with bright full-screen patterns
  document.body.appendChild(root);
  document.body.classList.add('stage-open');

  const glCanvas = root.querySelector('.stage-gl');
  // Optional full-colour layer on top, for games that show real colours with the eye patch (the shader shows grey).
  const colCanvas = root.querySelector('.stage-colour'), ctxC = colCanvas.getContext('2d');
  const clearColour = () => { ctxC.save(); ctxC.setTransform(1, 0, 0, 1, 0, 0); ctxC.clearRect(0, 0, colCanvas.width, colCanvas.height); ctxC.restore(); };
  const center = root.querySelector('.stage-center');
  const controls = root.querySelector('.stage-controls');
  const elTime = root.querySelector('[data-k=time]');
  const elStatus = root.querySelector('[data-k=status]');
  const elBar = root.querySelector('.timebar i');
  const elToast = root.querySelector('.toast');

  let renderer;
  try { renderer = new Renderer(glCanvas); }
  catch (e) {
    center.innerHTML = `<div class="panel"><h2>This screen can't show the training</h2><p>${esc(e.message)}</p><div class="row"><button class="btn primary" data-act="close">Go back</button></div></div>`;
    center.querySelector('[data-act=close]').onclick = () => close();
    return;
  }

  const layerA = document.createElement('canvas');
  const layerF = document.createElement('canvas');
  const ctxA = layerA.getContext('2d');
  const ctxF = layerF.getContext('2d');
  let W = 0, H = 0, scale = 1;

  function resize() {
    W = window.innerWidth; H = window.innerHeight;
    renderer.resize(W, H);
    scale = game.hiRes ? Math.min(window.devicePixelRatio || 1, 2) : 1;
    for (const c of [layerA, layerF]) { c.width = Math.round(W * scale); c.height = Math.round(H * scale); }
    ctxA.setTransform(scale, 0, 0, scale, 0, 0);
    ctxF.setTransform(scale, 0, 0, scale, 0, 0);
    if (game.drawColour) { const d = Math.min(window.devicePixelRatio || 1, 2); colCanvas.width = Math.round(W * d); colCanvas.height = Math.round(H * d); ctxC.setTransform(d, 0, 0, d, 0, 0); }
    dirty = true;
    if (game.onResize && started) game.onResize(W, H);
  }

  let dirty = true, started = false, paused = false, finished = false, raf = 0;
  let active = 0, last = 0, toastT = 0;
  const probe = { enabled: !!game.probes, next: rand(25, 45), cur: null, shown: 0, hit: 0 };

  const env = {
    get w() { return W; }, get h() { return H; },
    ppd: pxPerDeg(),
    ctxA, ctxF,
    settings: s,
    feLevel: feLevelStart(),
    get opts() { return optVals(); },
    get mode() { return game.mode; },
    // Brightness for stronger-eye content: dimmed only when glasses split the eyes.
    get fe() { return game.mode === 'anaglyph' ? env.feLevel : 1; },
    sfx,
    markDirty() { dirty = true; },
    setStatus(t) { if (elStatus.textContent !== t) elStatus.textContent = t; },
    // Plain-screen games: a short instruction at the top, and a small note in the corner.
    setTip(t) { const n = root.querySelector('.stage-tip'); if (n.textContent !== t) n.textContent = t; },
    setStrip(html) { const n = root.querySelector('.stage-strip'); n.innerHTML = html; root.classList.toggle('has-strip', !!html); },
    setCorner(t) { const n = root.querySelector('.stage-corner'); if (n.textContent !== t) n.textContent = t; },
    toast(t) {
      elToast.innerHTML = `${ICON.sun}<span>${esc(t)}</span>`;
      elToast.classList.add('show'); clearTimeout(toastT);
      toastT = setTimeout(() => elToast.classList.remove('show'), 1400);
    },
    setControls(defs) {
      controls.innerHTML = defs.map((d, i) => `<button class="btn ${d.cls || ''}" data-i="${i}" ${d.aria ? `aria-label="${esc(d.aria)}"` : ''}>${d.label}</button>`).join('');
      controls.querySelectorAll('button').forEach(b => {
        b.onclick = ev => { ev.preventDefault(); const d = defs[+b.dataset.i]; if (!paused && started && !finished) game.onKey && game.onKey(d.key); };
      });
    },
    end() { finish(); },
    get elapsed() { return active; },
  };
  env.feLevel0 = env.feLevel;

  // ---------- get ready ----------
  const fel = fellowEye();
  const L = lens('left'), R = lens('right');
  const readyList = () => {
    const ready = game.mode === 'anaglyph'
      ? [[ICON.glasses, `Colour glasses on: <b>${esc(L.name)}</b> lens over your left eye, <b>${esc(R.name)}</b> over your right.`],
         [ICON.eye, 'No patch. Keep both eyes open.']]
      : [[ICON.patch, `Patch over your <b>${fel}</b> (stronger) eye.`],
         [ICON.eye, 'Your normal glasses on, if you wear them.']];
    ready.push([ICON.ruler, `Sit about <b>${s.distanceCm} cm</b> from the screen (an arm's length).`]);
    return ready;
  };
  const seg = (name, choices, cur) => `<div class="seg">${choices.map(([v, l]) => `<label><input type="radio" name="${name}" value="${esc(v)}" ${String(v) === String(cur) ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>`;

  function showIntro() {
    const durs = [...new Set([2, 3, 5, minutes, 8, 10, 15])].sort((x, y) => x - y);
    const o = optVals();
    center.innerHTML = `
      <div class="panel intro">
        <span class="kicker">${game.mode === 'anaglyph' ? `${ICON.glasses} Colour glasses on` : `${ICON.patch} Patch on your stronger eye`}</span>
        <div class="row" style="gap:.9rem;flex-wrap:nowrap"><span class="gicon">${ICON[GAME_ICON[game.id]] || ICON.play}</span><h2>${esc(game.title)}</h2></div>
        <p class="lede">${game.how}</p>
        ${game.why ? `<details class="why"><summary>How this helps</summary><p class="muted small">${game.why}</p></details>` : ''}
        <div class="optgrid">
          ${modes.length > 1 ? `<fieldset class="field"><legend>How to play</legend>${seg('mode', [['mono', `${ICON.patch} Eye patch`], ['anaglyph', `${ICON.glasses} Colour glasses`]], game.mode)}</fieldset>` : ''}
          ${(game.options || []).map(d => `<fieldset class="field"><legend>${d.label}</legend>${seg('opt-' + d.key, d.choices, o[d.key])}</fieldset>`).join('')}
          ${game.noDuration ? '' : `<fieldset class="field"><legend>How long</legend>${seg('dur', durs.map(m => [m, `${m} min`]), minutes)}</fieldset>`}
        </div>
        <h3>Get ready</h3>
        <ul class="ready">${readyList().map(([ic, t], i) => `<li><label><input type="checkbox" id="rd${i}">${ic}<span>${t}</span></label></li>`).join('')}</ul>
        ${game.keysHelp ? `<p class="keys">${game.keysHelp}</p>` : ''}
        ${game.probes ? '<p class="keys">Now and then a small diamond appears. Press <kbd>B</kbd> or tap it when you see it.</p>' : ''}
        <div class="row">
          <button class="btn primary big" data-act="start">${ICON.play}<span>I'm ready</span></button>
          <button class="btn ghost" data-act="close">Not now</button>
        </div>
      </div>`;
    center.querySelectorAll('input[name=mode]').forEach(r => r.onchange = () => {
      game.mode = r.value; db.state.modes[game.id] = r.value; save();
      root.querySelector('.eye-dot').classList.toggle('both', game.mode === 'anaglyph');
      const y = center.querySelector('.panel').scrollTop; showIntro(); center.querySelector('.panel').scrollTop = y;
    });
    center.querySelectorAll('input[name^="opt-"]').forEach(r => r.onchange = () => {
      const key = r.name.slice(4);
      db.state.opts[game.id] = { ...(db.state.opts[game.id] || {}), [key]: r.value }; save();
    });
    center.querySelectorAll('input[name=dur]').forEach(r => r.onchange = () => { minutes = +r.value; });
    center.querySelector('[data-act=start]').onclick = () => beginStart();
    center.querySelector('[data-act=close]').onclick = () => close();
    center.querySelector('[data-act=start]').focus({ preventScroll: true });
  }

  function beginStart() {
    initAudio();
    const d = center.querySelector('input[name=dur]:checked');
    env.minutes = d ? +d.value : (game.noDuration ? 30 : minutes);
    try { if (document.documentElement.requestFullscreen && !document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {}); } catch (e) { /* not allowed here */ }
    const go = () => { if (game.mode === 'anaglyph' && db.state.glassesCheckDate !== todayKey()) glassesCheck(); else countdown(); };
    if (game.preStart) game.preStart(center, go); else go();
  }

  // Games with their own settings page (e.g. Eye Jump) draw it here instead of the standard intro.
  function showSetup() {
    root.classList.add('setup-open');
    const el = document.createElement('div');
    el.className = 'stage-setup';
    root.appendChild(el);
    game.renderSetup(el, {
      get mode() { return game.mode; },
      modes,
      setMode(m) {
        game.mode = m; db.state.modes[game.id] = m; save();
        root.querySelector('.eye-dot').classList.toggle('both', game.mode === 'anaglyph');
      },
      start(mins) { minutes = mins; el.remove(); root.classList.remove('setup-open'); beginStart(); },
      close: hash => close(hash),
    });
  }

  // ---------- glasses check ----------
  function glassesCheck() {
    const leftLayer = s.amblyopicEye === 'left' ? ctxA : ctxF;
    const rightLayer = s.amblyopicEye === 'left' ? ctxF : ctxA;
    for (const c of [ctxA, ctxF]) c.clearRect(0, 0, W, H);
    const r = Math.min(W, H) * 0.09, cx = W / 2, cy = H * 0.32;
    leftLayer.fillStyle = '#fff'; leftLayer.fillRect(cx - r * 2.6, cy - r, r * 2, r * 2);
    rightLayer.fillStyle = '#fff'; rightLayer.beginPath(); rightLayer.arc(cx + r * 1.6, cy, r, 0, Math.PI * 2); rightLayer.fill();
    renderer.render({ mode: 'anaglyph', layerA, layerF, bgA: 0, bgF: 0 });
    center.innerHTML = `
      <div class="panel low">
        <h2>Quick glasses check</h2>
        <p>With your glasses on, <b>close your right eye</b>. What do you see with your left eye?</p>
        <div class="row">
          <button class="btn" data-a="square">Only the square</button>
          <button class="btn" data-a="circle">Only the circle</button>
          <button class="btn" data-a="both">Both shapes</button>
        </div>
      </div>`;
    center.querySelectorAll('[data-a]').forEach(b => b.onclick = () => {
      const a = b.dataset.a;
      if (a === 'square') { db.state.glassesCheckDate = todayKey(); save(); countdown(); }
      else if (a === 'circle') {
        center.innerHTML = `<div class="panel low"><h2>Your glasses may be the other way round</h2>
          <p>Turn them around so the <b>${esc(lens('left').name)}</b> lens is over your left eye, or switch the setting to match how you wear them.</p>
          <div class="row"><button class="btn primary" data-x="retry">I turned them, check again</button>
          <button class="btn" data-x="swap">Switch setting</button></div></div>`;
        center.querySelector('[data-x=retry]').onclick = glassesCheck;
        center.querySelector('[data-x=swap]').onclick = () => { swapLenses(); save(); glassesCheck(); };
      } else {
        center.innerHTML = `<div class="panel low"><h2>A little colour is leaking through</h2>
          <p>Seeing both shapes with one eye means the screen colours don't fully match your lenses. You can still train, but it works better after a two-minute <b>black test</b> in Settings.</p>
          <div class="row"><button class="btn primary" data-x="go">Continue for now</button><button class="btn" data-x="close">Fix it in Settings</button></div></div>`;
        center.querySelector('[data-x=go]').onclick = () => { db.state.glassesCheckDate = todayKey(); save(); countdown(); };
        center.querySelector('[data-x=close]').onclick = () => close('#setup-glasses');
      }
    });
  }

  // ---------- countdown & loop ----------
  function countdown() {
    for (const c of [ctxA, ctxF]) c.clearRect(0, 0, W, H);
    game.init(env);
    started = true;
    let n = 3;
    const hint = game.countHint ? `<span>${esc(game.countHint())}</span>` : '';
    center.innerHTML = `<div class="count" aria-live="assertive"><b>${n}</b>${hint}</div>`;
    const tick = () => {
      n--;
      if (n <= 0) { center.innerHTML = ''; last = performance.now(); raf = requestAnimationFrame(loop); if (game.start) game.start(); return; }
      center.innerHTML = `<div class="count"><b>${n}</b>${hint}</div>`;
      sfx.tick();
      setTimeout(tick, 700);
    };
    renderFrame(0);
    setTimeout(tick, 700);
  }

  function renderFrame(dt) {
    const staticLayers = game.staticLayers && !dirty;
    if (!staticLayers) {
      ctxA.clearRect(0, 0, W, H); ctxF.clearRect(0, 0, W, H);
      game.draw(ctxA, ctxF, dt);
      // Patch mode: the weaker eye sees everything, so the stronger-eye layer is merged underneath.
      if (game.mode !== 'anaglyph') {
        ctxA.save(); ctxA.setTransform(1, 0, 0, 1, 0, 0); ctxA.globalCompositeOperation = 'destination-over';
        ctxA.drawImage(layerF, 0, 0); ctxA.restore();
      }
      if (probe.cur) drawProbe();
    }
    const p = game.params ? game.params() : {};
    if (game.mode !== 'anaglyph' && p.gabors) p.gabors = p.gabors.map(g => (g.eye === 'F' ? { ...g, eye: 'A' } : g));
    renderer.render({
      mode: game.mode, bgA: 0, bgF: 0, ...p,
      layerA: staticLayers ? null : layerA,
      layerF: staticLayers || game.mode !== 'anaglyph' ? null : layerF,
    });
    if (game.staticLayers) dirty = false;
    if (game.drawColour) { clearColour(); game.drawColour(ctxC); }
  }

  function drawProbe() {
    const p = probe.cur; const r = env.ppd * 0.35;
    ctxA.save(); ctxA.translate(p.x, p.y); ctxA.rotate(Math.PI / 4);
    ctxA.fillStyle = '#fff'; ctxA.fillRect(-r, -r, 2 * r, 2 * r); ctxA.restore();
  }
  function updateProbe() {
    if (!probe.enabled) return;
    if (probe.cur && active > probe.cur.until) { probe.cur = null; dirty = true; }
    if (!probe.cur && active >= probe.next) {
      const m = Math.min(W, H) * 0.12;
      probe.cur = { x: rand(m, W - m), y: rand(m + 60, H - m - 80), until: active + 1.6 };
      probe.shown++; probe.next = active + rand(30, 55); dirty = true;
    }
  }
  function hitProbe() { if (probe.cur) { probe.hit++; probe.cur = null; sfx.good(); env.toast('Diamond spotted'); dirty = true; } }

  function loop(t) {
    if (finished) return;
    const real = Math.max(0, (t - last) / 1000); last = t;
    const dt = Math.min(0.05, real);
    if (!paused) {
      active += Math.min(real, 0.25);
      updateProbe();
      game.update && game.update(dt);
      if (finished) return; // the game ended itself during this update
      renderFrame(dt);
      const total = (env.minutes || minutes) * 60;
      if (game.noDuration) { elTime.textContent = ''; elBar.parentElement.style.display = 'none'; }
      else {
        const rem = Math.max(0, total - active);
        const txt = rem >= 60 ? `${Math.ceil(rem / 60)} min left` : `${Math.ceil(rem)} s left`;
        if (elTime.textContent !== txt) elTime.textContent = txt;
        elBar.style.width = `${Math.min(100, (active / total) * 100)}%`;
      }
      if (!game.noDuration && active >= total) { finish(); return; }
    }
    raf = requestAnimationFrame(loop);
  }

  function setPause(v) {
    if (!started || finished) return;
    paused = v;
    root.querySelector('[data-act=pause] span').textContent = paused ? 'Resume' : 'Pause';
    if (paused) {
      center.innerHTML = `<div class="panel low"><h2>Paused</h2><p>Rest your eyes for a moment: blink a few times and look at something far away.</p><div class="row"><button class="btn primary big" data-x="r">${ICON.play}<span>Carry on</span></button><button class="btn" data-x="q">End this activity</button></div></div>`;
      center.querySelector('[data-x=r]').onclick = () => setPause(false);
      center.querySelector('[data-x=q]').onclick = () => finish();
      center.querySelector('[data-x=r]').focus({ preventScroll: true });
      game.onPause && game.onPause(true);
    } else { center.innerHTML = ''; last = performance.now(); game.onPause && game.onPause(false); }
  }

  // ---------- finish ----------
  function finish() {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(raf);
    controls.innerHTML = '';
    elStatus.textContent = '';
    elTime.textContent = '';
    elBar.parentElement.style.visibility = 'hidden';
    const res = started && game.result ? game.result() : null;
    const minutesPlayed = active / 60;
    destroyGame();
    // Clear the play area so the summary sits on a calm, empty screen.
    ctxA.clearRect(0, 0, W, H); ctxF.clearRect(0, 0, W, H); clearColour();
    renderer.render({ mode: 'mono', layerA, bgA: 0.02 });
    const minActive = Math.min(20, (env.minutes || minutes) * 60 * 0.8);
    if (!res || (!res.complete && active < minActive)) {
      center.innerHTML = `<div class="panel low"><h2>Stopped early</h2><p>That was too short to save. You can start again any time.</p><div class="row"><button class="btn primary" data-x="close">Back</button></div></div>`;
      center.querySelector('[data-x=close]').onclick = () => close();
      return;
    }
    const best = res.unit ? previousBest(game.id, res.unit) : null;
    const isBest = res.threshold != null && best != null && (LOWER_BETTER[res.unit] ? res.threshold < best * 0.98 : res.threshold > best * 1.02);
    const rec = {
      game: game.id, title: game.title, mode: game.mode,
      minutes: +minutesPlayed.toFixed(2),
      trials: res.trials || 0, correct: res.correct || 0,
      threshold: res.threshold ?? null, unit: res.unit || null,
      score: res.score ?? null,
      feStart: game.mode === 'anaglyph' ? env.feLevel0 ?? null : null,
      feEnd: res.feLevelEnd ?? null,
      probes: probe.enabled ? { shown: probe.shown, hit: probe.hit } : null,
      extra: res.extra || null,
    };
    if (res.feLevelEnd != null) db.state.feLevel = clamp(res.feLevelEnd, 0.05, 1);
    if (res.thresholdKey && res.threshold != null) db.state.thresholds[res.thresholdKey] = res.threshold;
    if (res.apply) res.apply(db.state);
    addSession(rec);
    const lines = (res.summary || []).map(([k, v]) => `<div class="kv"><span>${k}</span><b>${v}</b></div>`).join('');
    const probeLine = probe.enabled && probe.shown ? `<div class="kv"><span>Diamonds spotted</span><b>${probe.hit} of ${probe.shown}</b></div>` : '';
    center.innerHTML = `
      <div class="panel summary">
        <span class="kicker">${ICON.checkCircle} Saved · ${Math.max(1, Math.round(minutesPlayed))} min</span>
        <h2>${res.headline ? esc(res.headline) : 'Well done'}</h2>
        ${isBest ? `<div class="celebrate">${ICON.sun}<span>New personal best for ${esc(game.title)}!</span></div>` : ''}
        ${res.html || ''}
        <div class="kvs">${lines}${probeLine}</div>
        ${res.ask ? `<div class="ask"><h3>${esc(res.ask.q)}</h3><div class="sym" style="margin-top:.5rem">${res.ask.options.map(([k, l]) => `<button class="symbtn askbtn" data-ask="${k}" aria-pressed="false">${esc(l)}</button>`).join('')}</div><p class="muted small" id="askadv" style="min-height:1.4em;margin-top:.4rem"></p></div>` : ''}
        <div id="feel">
          <h3>How do your eyes feel?</h3>
          <div class="feel" style="margin-top:.6rem">
            <button class="btn primary big" data-x="fine">${ICON.heart}<span>All good</span></button>
            <button class="btn" data-x="notright">Something's not right</button>
          </div>
        </div>
      </div>`;
    if (res.ask) {
      center.querySelectorAll('[data-ask]').forEach(b => b.onclick = () => {
        center.querySelectorAll('[data-ask]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        const opt = res.ask.options.find(o => o[0] === b.dataset.ask);
        center.querySelector('#askadv').textContent = opt[2] || '';
        const lastRec = db.sessions[db.sessions.length - 1];
        lastRec.extra = { ...(lastRec.extra || {}), selfReport: opt[0] }; save();
      });
    }
    const feel = center.querySelector('#feel');
    const done = sym => {
      addSymptoms({ ...sym, game: game.id });
      if (sym.doubleVision) {
        center.querySelector('.panel').innerHTML = `
          <span class="kicker">${ICON.alert} Two-eye games paused</span>
          <h2>Thanks for telling us</h2>
          <p>Double vision can happen when the eyes start working together. As a safety step, two-eye games are paused. Please mention it to your eye-care professional before you use them again. Single-eye games stay available.</p>
          <div class="row"><button class="btn primary" data-x="close">OK</button></div>`;
        center.querySelector('[data-x=close]').onclick = () => close();
        return;
      }
      if (upNext && !(upNext.mode === 'anaglyph' && dichOff())) showUpNext(sym);
      else close();
    };
    feel.querySelector('[data-x=fine]').onclick = () => done({ doubleVision: false, headache: false, strain: false });
    feel.querySelector('[data-x=notright]').onclick = () => {
      feel.innerHTML = `
        <h3>What did you notice?</h3>
        <p class="muted small">Choose any that apply.</p>
        <div class="sym" style="margin:.6rem 0 .9rem">
          <button class="symbtn" data-k="doubleVision" aria-pressed="false">Double vision</button>
          <button class="symbtn" data-k="headache" aria-pressed="false">Headache</button>
          <button class="symbtn" data-k="strain" aria-pressed="false">Tired or sore eyes</button>
        </div>
        <div class="row"><button class="btn primary" data-x="save">Save</button></div>`;
      feel.querySelectorAll('.symbtn').forEach(b => b.onclick = () => b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') === 'true' ? 'false' : 'true'));
      feel.querySelector('[data-x=save]').onclick = () => {
        const v = k => feel.querySelector(`[data-k=${k}]`).getAttribute('aria-pressed') === 'true';
        done({ doubleVision: v('doubleVision'), headache: v('headache'), strain: v('strain') });
      };
    };
    center.querySelector('[data-x=fine]').focus({ preventScroll: true });
  }

  function showUpNext(sym) {
    const tired = sym.headache || sym.strain;
    const steps = changeSteps(game.mode, upNext.mode);
    center.querySelector('.panel').innerHTML = `
      <span class="kicker">${ICON.clock} Up next · ${esc(upNext.stepLabel || '')}</span>
      ${tired ? `<div class="alert warn">${ICON.info}<div>Your eyes feel tired. It's fine to stop here for today, or rest for a few minutes first.</div></div>` : ''}
      <div class="nextup"><span class="gicon">${ICON[GAME_ICON[upNext.id]] || ICON.play}</span><div><b>${esc(upNext.name)}</b><div class="muted small">${upNext.minutes} min</div></div></div>
      ${steps.length ? `<h3>Before you start</h3><ul class="change bullets">${steps.map(x => `<li>${x}</li>`).join('')}</ul>` : ''}
      <div class="row">
        <button class="btn primary big" data-x="next">${ICON.arrowRight}<span>Continue</span></button>
        <button class="btn" data-x="stop">Stop for today</button>
      </div>`;
    center.querySelector('[data-x=next]').onclick = () => { close(null, true); upNext.start(); };
    center.querySelector('[data-x=stop]').onclick = () => close();
    center.querySelector('[data-x=next]').focus({ preventScroll: true });
  }

  // ---------- input ----------
  function onKey(e) {
    if (game.hud === 'minimal' && game.spacePauses !== false && e.key === ' ' && started && !finished && !e.target.closest('button')) { e.preventDefault(); setPause(!paused); return; }
    if (e.key === 'Escape') { e.preventDefault(); if (started && !finished) setPause(!paused); return; }
    if (paused && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); setPause(false); return; }
    if (!started || paused || finished) return;
    if ((e.key === 'b' || e.key === 'B') && probe.enabled) { hitProbe(); e.preventDefault(); return; }
    if (game.onKey) { const used = game.onKey(e.key, e); if (used !== false) e.preventDefault(); }
  }
  function onPointer(e) {
    if (!started || paused || finished) return;
    if (e.target !== glCanvas) return;
    const x = e.clientX, y = e.clientY;
    if (e.type === 'pointerdown' && probe.cur && Math.hypot(x - probe.cur.x, y - probe.cur.y) < env.ppd * 1.2) { hitProbe(); return; }
    game.onPointer && game.onPointer(x, y, e.type);
  }
  function onVis() { if (document.hidden && started && !finished && !paused) setPause(true); }

  window.addEventListener('keydown', onKey);
  const onKeyUp = e => { if (game.onKeyUp && started && !finished) game.onKeyUp(e.key, e); };
  window.addEventListener('keyup', onKeyUp);
  glCanvas.addEventListener('pointerdown', onPointer);
  glCanvas.addEventListener('pointerup', onPointer); // games that need it (drag versus click) also get the release
  glCanvas.addEventListener('pointercancel', onPointer);
  glCanvas.addEventListener('pointermove', e => { if (e.buttons || e.pointerType === 'mouse') onPointer(e); });
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('resize', resize);
  root.querySelector('[data-act=pause]').onclick = () => setPause(!paused);
  root.querySelector('[data-act=quit]').onclick = () => { if (started && !finished) finish(); else close(); };
  root.querySelector('[data-act=back]').onclick = () => { if (started && !finished) finish(); else close(); };

  let destroyed = false;
  function destroyGame() {
    if (destroyed || !started) return;
    destroyed = true;
    try { game.destroy && game.destroy(); } catch (e) { /* ignore */ }
  }

  function close(hash, chaining = false) {
    finished = true;
    cancelAnimationFrame(raf);
    destroyGame();
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('keyup', onKeyUp);
    document.removeEventListener('visibilitychange', onVis);
    window.removeEventListener('resize', resize);
    if (!chaining) { try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) { /* ignore */ } }
    root.remove();
    if (!chaining) document.body.classList.remove('stage-open');
    if (hash) location.hash = hash;
    if (!chaining) onExit && onExit();
  }

  resize();
  renderer.render({ mode: 'mono', layerA, bgA: 0.02 });
  if (game.renderSetup) showSetup(); else showIntro();
}
