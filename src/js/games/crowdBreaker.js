// Crowd Breaker: (1) find the smallest letter you can read, then (2) train reading a letter
// surrounded by four flankers while the spacing shrinks (Hussain 2012 / Chung 2012 style). Monocular.
import { Staircase } from '../staircase.js';
import { db } from '../store.js';
import { SLOAN, letter, grey } from '../draw.js';
import { arcminToPx, logMAR, snellen, pick, shuffle, levelSpacing } from '../util.js';

export function crowdBreaker({ testOnly = false } = {}) {
  let env, stage = 'size', size, spacing, cur = null, phase = 'show', t = 0, fb = null, score = 0, sizeTrials = 0;
  const SIZE_TRIALS = testOnly ? 30 : 16;

  function nextTrial() {
    const target = pick(SLOAN);
    const others = shuffle(SLOAN.filter(c => c !== target)).slice(0, 4);
    cur = { target, flankers: others };
    phase = 'show'; t = 0; fb = null; env.markDirty();
  }

  return {
    id: testOnly ? 'letter-acuity' : 'crowd-breaker',
    title: testOnly ? 'Letter size test' : 'Crowd Breaker',
    mode: 'mono', staticLayers: true, hiRes: true,
    noDuration: testOnly,
    how: testOnly
      ? 'Read single letters as they get smaller. Guess if you are not sure. This gives a home estimate of the smallest letter your weaker eye can read at this distance.'
      : 'First, single letters get smaller until we find your limit. Then the letter in the middle gets crowded by four neighbours. Name the middle letter. The neighbours move closer as you improve.',
    keysHelp: 'Type the letter on your keyboard, or tap it below. Letters used: C D H K N O R S V Z.',
    init(e) {
      env = e;
      const startArc = db.state.letterSize ? db.state.letterSize * 1.6 : 25;
      size = new Staircase({ start: startArc, min: 2.5, max: 120, down: 2, up: 1, step: 0.1, stepAfter: 0.05 });
      env.setControls(SLOAN.map(c => ({ label: c, key: c.toLowerCase(), cls: 'letter' })));
      nextTrial();
    },
    update(dt) {
      t += dt;
      if (phase === 'fb' && t > 0.5) nextTrial();
      if (stage === 'size') env.setStatus('Finding the smallest letter you can read');
      else env.setStatus(`Level ${levelSpacing(spacing.value)} · ${score} points`);
    },
    draw(a) {
      const cx = env.w / 2, cy = env.h / 2 - 20;
      const arc = stage === 'size' ? size.value : this.letterArc;
      const h = arcminToPx(arc);
      // bright reading card
      const card = Math.min(Math.max(h * 9, Math.min(env.w, env.h) * 0.42), Math.min(env.w, env.h - 150) * 0.95);
      a.fillStyle = grey(0.92);
      a.fillRect(cx - card / 2, cy - card / 2, card, card);
      if (!cur) return;
      const v = fb ? (fb.ok ? 0 : 0.0) : 0;
      letter(a, cur.target, cx, cy, h, v);
      if (stage === 'crowd') {
        const d = h * spacing.value;
        const pos = [[-d, 0], [d, 0], [0, -d], [0, d]];
        cur.flankers.forEach((c, i) => letter(a, c, cx + pos[i][0], cy + pos[i][1], h, 0));
      }
      if (fb) {
        a.strokeStyle = grey(fb.ok ? 0.55 : 0.1); a.lineWidth = 4;
        a.strokeRect(cx - card / 2 + 4, cy - card / 2 + 4, card - 8, card - 8);
      }
    },
    params() { return { bgA: 0.02 }; },
    onKey(k) {
      const L = String(k).toUpperCase();
      if (!SLOAN.includes(L)) return false;
      if (phase !== 'show') return true;
      const ok = L === cur.target;
      if (ok) { score += stage === 'crowd' ? 12 : 5; env.sfx.good(); } else env.sfx.bad();
      if (stage === 'size') {
        size.update(ok); sizeTrials++;
        if (sizeTrials >= SIZE_TRIALS) {
          if (testOnly) { fb = { ok }; phase = 'fb'; env.markDirty(); setTimeout(() => env.end(), 300); return true; }
          this.letterArc = Math.min(120, size.threshold() * 1.4);
          spacing = new Staircase({ start: 2.4, min: 0.9, max: 6, down: 3, up: 1, step: 0.08, stepAfter: 0.04 });
          stage = 'crowd';
        }
      } else spacing.update(ok);
      fb = { ok }; phase = 'fb'; t = 0; env.markDirty();
      return true;
    },
    result() {
      const sz = size.threshold();
      const lm = logMAR(sz);
      const summary = [['Smallest letter you read', `about ${snellen(sz)} at this distance`]];
      let threshold = sz, unit = 'arcmin', key = 'letter-size';
      if (stage === 'crowd' && spacing && spacing.trials >= 6) {
        const sp = spacing.threshold();
        summary.push(['Crowding level reached', `${levelSpacing(sp)}`]); summary.push(['Letter gap (details)', `${sp.toFixed(2)}× the letter size`]);
        threshold = sp; unit = 'spacing'; key = 'crowd-spacing';
      }
      summary.push(['Letter size (details)', `${sz.toFixed(1)} arcmin, logMAR ${lm.toFixed(2)}. A home estimate; your eye doctor's chart is the real measure.`]);
      const trials = size.trials + (spacing ? spacing.trials : 0);
      const correct = size.correct + (spacing ? spacing.correct : 0);
      return {
        trials, correct, threshold, unit, thresholdKey: key, score, summary,
        extra: { letterArcmin: sz, logMAR: lm, spacing: spacing ? spacing.threshold() : null },
        apply: st => { if (size.trials >= 10) { st.letterSize = sz; st.thresholds['letter-size'] = sz; } },
      };
    },
  };
}
