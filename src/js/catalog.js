import { eyeJump, eyeJumpOpts } from './games/eyeJump.js';
import { contrastFinder, contrastFinderOpts } from './games/contrastFinder.js';
import { eyeMotion, eyeMotionOpts } from './games/eyeMotion.js';
import { followIt, followItOpts } from './games/followIt.js';
import { fovSpot, fovSpotOpts } from './games/fovSpot.js';
import { jumpRead } from './games/jumpRead.js';
import { oknStripes, oknStripesOpts } from './games/oknStripes.js';
import { peripheralChart, peripheralChartOpts } from './games/peripheralChart.js';
import { precision, precisionOpts } from './games/precision.js';
import { rotationMatch, rotationMatchOpts } from './games/rotationMatch.js';
import { splitVision, splitVisionOpts } from './games/splitVision.js';
import { visualPower, visualPowerOpts } from './games/visualPower.js';
import { crowdBreaker } from './games/crowdBreaker.js';
import { balanceTest } from './games/balanceTest.js';
import { db, todayKey, sessionsOn, dichOff, planOn, planMinutes } from './store.js';

// The twelve games of the platform.
// module: 'mono' (patch only), 'dich' (glasses only) or 'both' (the person chooses in the game).
export const CATALOG = [
  { id: 'contrast-finder', make: contrastFinder, module: 'both', defaultMode: 'mono', name: 'Contrast Finder', trains: 'Seeing faint things',
    get minutes() { return Math.max(1, Math.round(contrastFinderOpts().dur / 60)); },
    blurb: 'Find the faint patch on the grey board and tap it. It gets fainter as you improve.',
    basis: 'perceptual learning with faint patches, which improved contrast sensitivity and sharpness in adults (Polat 2004; Zhou 2006). With colour glasses, only the weaker eye sees the patch' },
  { id: 'eye-jump', make: eyeJump, module: 'both', defaultMode: 'anaglyph', name: 'Eye Jump', trains: 'Eye jumps and quick reading',
    get minutes() { return Math.max(1, Math.round(eyeJumpOpts().dur / 60)); },
    blurb: 'A circle jumps around the screen. Read the number or letter inside it out loud.',
    basis: 'saccade (eye jump) training, a standard part of vision therapy. With colour glasses, each circle is seen by one eye only, so both eyes have to stay switched on' },
  { id: 'eye-motion', make: eyeMotion, module: 'both', defaultMode: 'anaglyph', name: 'Eye Motion', trains: 'Smooth following',
    get minutes() { return Math.max(1, Math.round(eyeMotionOpts().dur / 60)); },
    blurb: 'Follow a gliding circle with your eyes and read each new number or letter out loud.',
    basis: 'pursuit (smooth following) training, a standard part of vision therapy. With colour glasses, the circle switches between your eyes' },
  { id: 'follow-it', make: followIt, module: 'both', defaultMode: 'anaglyph', name: 'Follow It', trains: 'Tracking several things at once',
    get minutes() { return Math.max(1, Math.round((followItOpts().fly + 20) / 60)); },
    blurb: 'Remember the marked planes, follow them while they fly, then tap them. Easy to Extreme.',
    basis: 'multiple-object tracking, which trains attention, side vision and visual memory. With colour glasses, half the planes are seen by each eye' },
  { id: 'fov-spot', make: fovSpot, module: 'both', defaultMode: 'anaglyph', name: 'FOV Spot', trains: 'Side vision and reaction',
    get minutes() { return Math.max(1, Math.round(fovSpotOpts().dur / 60)); },
    blurb: 'Keep your eyes on the centre and tap the spot that appears around it. A map shows which directions you missed.',
    basis: 'peripheral awareness training: noticing things to the side while looking straight ahead. With colour glasses, each spot is seen by one eye' },
  { id: 'jump-read', make: jumpRead, module: 'both', defaultMode: 'anaglyph', name: 'Jump Read', trains: 'Scanning and reading',
    minutes: 2,
    blurb: 'Read rows of letters left to right and find the alphabet in order, as fast as you can.',
    basis: 'visual scanning and saccade training for reading. With colour glasses, letters are split between one eye, the other eye, and both' },
  { id: 'okn-stripes', make: oknStripes, module: 'both', defaultMode: 'anaglyph', name: 'OKN Stripes', trains: 'Following and re-fixing',
    get minutes() { return Math.max(1, Math.round(oknStripesOpts().dur / 60)); },
    blurb: 'Let your eyes follow drifting stripes, and tap the star when it rides past. Easy to Extreme.',
    basis: 'optokinetic (OKN) stripe training, a classic eye-care tool for smooth following and quick re-fixation. With colour glasses, the stripes alternate between your eyes' },
  { id: 'peripheral-chart', make: peripheralChart, module: 'both', defaultMode: 'anaglyph', name: 'Peripheral Chart', trains: 'Side vision for detail',
    get minutes() { return Math.max(1, Math.round(peripheralChartOpts().dur / 60)); },
    blurb: 'Keep your eyes on the centre letter and tap its match on the spokes around it.',
    basis: 'peripheral chart training from vision therapy: picking out detail with side vision while fixing the centre. With colour glasses, the chart uses left-eye, right-eye and both-eye colours' },
  { id: 'precision', make: precision, module: 'both', defaultMode: 'anaglyph', name: 'Precision', trains: 'Accurate eye-hand aim',
    get minutes() { return Math.max(1, Math.round(precisionOpts().dur / 60)); },
    blurb: 'Tap the exact centre of each ringed target. 10 points for the middle. Easy to Extreme.',
    basis: 'eye-hand coordination and fine localisation practice. With colour glasses, each target is seen by one eye, so you can compare how precise each eye is' },
  { id: 'rotation-match', make: rotationMatch, module: 'both', defaultMode: 'anaglyph', name: 'Rotation Match', trains: 'Shape, direction and mental rotation',
    get minutes() { return Math.max(1, Math.round(rotationMatchOpts().dur / 60)); },
    blurb: 'Find the copy that is only turned around, not flipped over. Letters or block shapes.',
    basis: 'mental rotation and form discrimination (the skill behind telling b from d). With colour glasses, one eye sees the figure to match and the other eye sees the choices' },
  { id: 'split-vision', make: splitVision, module: 'both', defaultMode: 'anaglyph', name: 'Split Vision', trains: 'Centre and side together',
    get minutes() { return Math.max(1, Math.round(splitVisionOpts().dur / 60)); },
    blurb: 'Keep your eyes on the centre and tap the object on the turning ring that matches it.',
    basis: 'divided attention between central and peripheral vision. With colour glasses, the centre is seen by both eyes and the ring objects are split between the eyes' },
  { id: 'visual-power', make: visualPower, module: 'dich', defaultMode: 'anaglyph', name: 'Visual Power', trains: 'Eyes turning in and out together',
    get minutes() { const o = visualPowerOpts(); return o.mode === 'max' ? 2 : Math.max(1, Math.round(o.dur / 60)); },
    blurb: 'Keep the two dot diamonds as one and click the hidden 3D circle. Each find pulls them further apart.',
    basis: 'fusional vergence training with random-dot pictures, like the vectograms used in vision therapy. Needs colour glasses: each eye sees only random dots, and the 3D circle appears only when both eyes merge them' },
];

export const TESTS = [
  { id: 'balance-test', make: balanceTest, module: 'dich', name: 'Balance test', trains: 'Suppression level', minutes: 2,
    blurb: 'Two letters, one per eye. Sets the starting brightness for two-eye games.', basis: 'Dichoptic letters (Kwon 2015)' },
  { id: 'letter-acuity', make: () => crowdBreaker({ testOnly: true }), module: 'mono', name: 'Letter size test', trains: 'Home acuity estimate', minutes: 2,
    blurb: 'Smallest letter your weaker eye reads at this distance. A home estimate only.', basis: 'Adaptive letter staircase' },
];

export const ALL = [...CATALOG, ...TESTS];
export const byId = id => ALL.find(g => g.id === id);


// Today's plan: the games, plus the check-ups when they are due.
export function todaysPlan() {
  const plan = [];
  const last = id => [...db.sessions].reverse().find(s => s.game === id);
  const ago = s => (s ? (Date.now() - new Date(s.date)) / 864e5 : Infinity);
  const locked = dichOff();
  const bal = last('balance-test');
  if (!locked && ago(bal) > 7) plan.push({ id: 'balance-test', why: bal ? 'Weekly check of how your eyes work together' : 'Measures how your two eyes work together' });
  plan.push({ id: 'contrast-finder', why: 'Seeing faint things with your weaker eye' });
  plan.push({ id: 'eye-jump', why: 'Fast, accurate eye jumps and reading small detail' });
  plan.push({ id: 'eye-motion', why: 'Smoothly following a moving target' });
  plan.push({ id: 'follow-it', why: 'Keeping track of several moving things' });
  plan.push({ id: 'fov-spot', why: 'Noticing things out of the corner of your eye' });
  plan.push({ id: 'jump-read', why: 'Scanning lines of text like reading' });
  plan.push({ id: 'okn-stripes', why: 'Following moving stripes and flicking back' });
  plan.push({ id: 'peripheral-chart', why: 'Reading detail out of the corner of your eye' });
  plan.push({ id: 'precision', why: 'Putting your finger exactly where you look' });
  plan.push({ id: 'rotation-match', why: 'Seeing shape and direction precisely' });
  plan.push({ id: 'split-vision', why: 'Watching the centre and the side at once' });
  if (!locked) plan.push({ id: 'visual-power', why: 'Both eyes turning together as a team' });
  const lt = last('letter-acuity');
  if (ago(lt) > 14) plan.push({ id: 'letter-acuity', why: lt ? 'Check-up every two weeks' : 'A first check of how small you can read' });
  const today = sessionsOn(todayKey());
  return plan.filter(p => planOn(p.id)).map(p => { const g = byId(p.id); return { ...p, game: { ...g, minutes: planMinutes(p.id, g.minutes) }, done: today.some(s => s.game === p.id) }; });
}

export function lastSession(id) {
  for (let i = db.sessions.length - 1; i >= 0; i--) if (db.sessions[i].game === id) return db.sessions[i];
  return null;
}
