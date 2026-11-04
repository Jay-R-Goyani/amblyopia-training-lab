// Balance test: dichoptic overlapping letters (Kwon et al. 2015 style).
// Amblyopic eye sees letter X at full brightness; fellow eye sees letter Y at level c, in the same place.
// 1-up-1-down on c finds the level where each letter wins half the time: the balance point.
// 1.0 means the eyes are balanced; lower means the stronger eye suppresses the weaker one.
import { Staircase } from '../staircase.js';
import { both, letter, ring, grey } from '../draw.js';
import { shuffle } from '../util.js';

const SET = ['H', 'N', 'O', 'S', 'V', 'Z', 'K', 'D', 'R', 'C'];
const TRIALS = 28;

export function balanceTest() {
  let env, sc, cur, phase = 'fix', t = 0, maxHits = 0, n = 0;

  function nextTrial() {
    const [x, y] = shuffle([...SET]);
    cur = { a: x, f: y, order: Math.random() < 0.5 ? [x, y] : [y, x] };
    env.setControls(cur.order.map(L => ({ label: L, key: 'pick-' + L, cls: 'letter' })).concat([{ label: 'Can\'t tell', key: 'pick-?', cls: 'ghost' }]));
    phase = 'fix'; t = 0;
  }

  return {
    id: 'balance-test', title: 'Balance test', mode: 'anaglyph', noDuration: true,
    how: 'Two different letters are shown in the same spot, one to each eye. Say which letter you see more clearly. There are no right answers. This measures how much your stronger eye overpowers your weaker one, and sets the brightness for the two-eye games.',
    keysHelp: 'Tap the letter you saw, or type it. Choose "Can\'t tell" if they look equally strong. About 2 minutes.',
    init(e) {
      env = e;
      sc = new Staircase({ start: 0.45, min: 0.02, max: 1, down: 1, up: 1, step: 0.15, stepAfter: 0.07 });
      nextTrial();
    },
    update(dt) {
      t += dt;
      if (phase === 'fix' && t > 0.5) { phase = 'show'; t = 0; }
      else if (phase === 'show' && t > 1.0) { phase = 'resp'; t = 0; }
      env.setStatus(`Question ${Math.min(n + 1, TRIALS)} of ${TRIALS}`);
    },
    draw(a, f) {
      const cx = env.w / 2, cy = env.h / 2 - 30, h = env.ppd * 1.6;
      both(a, f, c => { ring(c, cx, cy, h * 1.3, 0.35, 2); });
      if (phase === 'fix') both(a, f, c => { c.fillStyle = grey(0.6); c.fillRect(cx - 3, cy - 3, 6, 6); });
      if (phase === 'show') { letter(a, cur.a, cx, cy, h, 1); letter(f, cur.f, cx, cy, h, sc.value); }
      if (phase === 'resp') both(a, f, c => { c.fillStyle = grey(0.35); c.font = '600 18px "Atkinson Hyperlegible", Arial, sans-serif'; c.textAlign = 'center'; c.fillText('Which letter did you see?', cx, cy); });
    },
    onKey(k) {
      let L = String(k);
      if (L.startsWith('pick-')) L = L.slice(5); else L = L.toUpperCase();
      if (phase !== 'resp' && phase !== 'show') return L.length === 1;
      if (L === '?') { /* equal: hold level, count trial */ }
      else if (L === cur.a) { if (sc.value >= 0.999) maxHits++; sc.update(false); }   // weaker eye won -> brighten fellow eye
      else if (L === cur.f) { sc.update(true); }                                    // stronger eye won -> dim it
      else return true;
      n++;
      if (n >= TRIALS) { env.end(); return true; }
      nextTrial();
      return true;
    },
    result() {
      let bp = sc.threshold();
      if (maxHits >= 3) bp = 1;
      bp = Math.max(0.02, Math.min(1, bp));
      return {
        trials: n, correct: n, threshold: bp, unit: 'balance', thresholdKey: 'balance',
        summary: [
          ['Balance point', `${Math.round(bp * 100)}% (100% = balanced)`],
          ['What it means', bp >= 0.9 ? 'Your eyes are working about equally.' : bp >= 0.5 ? 'Your stronger eye still overpowers your weaker eye a little.' : 'Your stronger eye overpowers your weaker eye a lot. Training aims to change this.'],
          ['Two-eye games', `now start with your stronger eye's view at ${Math.round(Math.max(0.05, bp) * 100)}% brightness`],
        ],
        apply: st => { st.balance = bp; st.feLevel = Math.max(0.05, bp); },
      };
    },
  };
}
