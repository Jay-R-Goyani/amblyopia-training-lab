// One comparable measure per activity, shared by the Progress page and the report.
// Results depend on the level the person picked, so trends compare sessions played at the same level.
import { db, todayKey } from './store.js';
import { fmtPct, logMAR, snellen } from './util.js';

const pct = v => `${Math.round(v * 100)}%`;
const secs = v => `${v.toFixed(1)} s`;
const ratio = s => (s.trials ? s.correct / s.trials : null);
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// get(session) -> number or null. lowerIsBetter flips trend direction and charts.
export const METRICS = {
  'contrast-finder': { label: 'Faintest contrast found', get: s => num(s.threshold), fmt: v => fmtPct(v, 1), lowerIsBetter: true, log: true },
  'eye-jump': { label: 'Could read the characters', get: s => ({ all: 1, most: 0.66, few: 0.33 })[s.extra && s.extra.selfReport] ?? null, fmt: v => (v > 0.8 ? 'all' : v > 0.5 ? 'most' : 'some'), selfReport: true },
  'eye-motion': { label: 'Could read the characters', get: s => ({ all: 1, most: 0.66, few: 0.33 })[s.extra && s.extra.selfReport] ?? null, fmt: v => (v > 0.8 ? 'all' : v > 0.5 ? 'most' : 'some'), selfReport: true },
  'follow-it': { label: 'Planes found', get: ratio, fmt: pct },
  'fov-spot': { label: 'Side spots found', get: ratio, fmt: pct },
  'jump-read': { label: 'Time per letter', get: s => (s.extra && num(s.extra.time) && s.correct ? s.extra.time / s.correct : null), fmt: secs, lowerIsBetter: true },
  'okn-stripes': { label: 'Stars tapped', get: s => (s.trials ? s.correct / s.trials : null), fmt: pct },
  'peripheral-chart': { label: 'Time to find the match', get: s => num(s.extra && s.extra.avg), fmt: secs, lowerIsBetter: true },
  precision: { label: 'Points per tap', get: s => num(s.extra && s.extra.avgPts), fmt: v => `${v.toFixed(1)} / 10` },
  'rotation-match': { label: 'Right first time', get: ratio, fmt: pct },
  'split-vision': { label: 'Time to find the match', get: s => num(s.extra && s.extra.avg), fmt: secs, lowerIsBetter: true },
  'visual-power': { label: 'Furthest gap merged (eyes in)', get: s => num(s.extra && (s.extra.bestIn || s.extra.bestOut)) || null, fmt: v => `${Math.round(v)} px` },
  'balance-test': { label: 'Eye balance', get: s => num(s.threshold), fmt: pct },
  'letter-acuity': { label: 'Smallest letter (logMAR)', get: s => { const a = s.extra && s.extra.letterArcmin != null ? s.extra.letterArcmin : s.unit === 'arcmin' ? s.threshold : null; return a ? logMAR(a) : null; }, fmt: v => v.toFixed(2), lowerIsBetter: true, snellen: v => snellen(5 * Math.pow(10, v)) },
};

const levelOf = s => (s.extra && (s.extra.level || s.extra.mode)) || null;
const median = a => { const b = [...a].sort((x, y) => x - y); const m = Math.floor(b.length / 2); return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };

export function inRange(from) { return db.sessions.filter(s => !from || new Date(s.date) >= from); }

// All values for an activity, oldest first: [{t, y, s}]
export function points(id, from, sameLevelAs) {
  const m = METRICS[id];
  if (!m) return [];
  return inRange(from).filter(s => s.game === id && (!sameLevelAs || levelOf(s) === levelOf(sameLevelAs)))
    .map(s => ({ t: s.date, y: m.get(s), s })).filter(p => p.y != null);
}

// First and latest (medians of up to 3 at each end, same level as the latest), and the direction.
export function trend(id, from) {
  const m = METRICS[id];
  const all = points(id, from);
  if (!all.length) return null;
  const latest = all[all.length - 1];
  const pts = points(id, from, latest.s);
  const k = Math.min(3, Math.floor(pts.length / 2));
  const first = k ? median(pts.slice(0, k).map(p => p.y)) : pts[0].y;
  const last = k ? median(pts.slice(-k).map(p => p.y)) : latest.y;
  let gain = null, dir = null;
  if (pts.length >= 2) {
    const base = Math.abs(first) > 1e-9 ? Math.abs(first) : 1;
    gain = (m.lowerIsBetter ? first - last : last - first) / base;
    dir = gain > 0.05 ? 'up' : gain < -0.05 ? 'down' : 'flat';
  }
  return { first, last, latest: latest.y, n: pts.length, total: all.length, gain, dir, level: levelOf(latest.s) };
}

// Days in a period and minutes on each.
export function dayList(from, to = new Date()) {
  const out = [];
  const d = new Date(from); d.setHours(12, 0, 0, 0);
  const end = new Date(to); end.setHours(12, 0, 0, 0);
  while (d <= end) { out.push(todayKey(d)); d.setDate(d.getDate() + 1); }
  return out;
}
