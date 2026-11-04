// Tiny SVG charts, colored through CSS tokens.
import { esc } from './util.js';

const fmtDay = d => { const x = new Date(d); return `${x.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][x.getMonth()]}`; };

function niceTicks(lo, hi, n = 4) {
  const span = hi - lo || 1, raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => span / s <= n) || mag * 10;
  const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

// points: [{t: Date|string, y: number}] ; fmt: value -> label ; lowerIsBetter: draws a note
export function lineChart(points, { fmt = v => v.toFixed(2), log = false, height = 170, width = 440, empty = 'No results yet. Play this activity to see your progress here.', lowerIsBetter = false } = {}) {
  if (!points.length) return `<div class="chart-empty">${esc(empty)}</div>`;
  const W = width, H = height, L = 58, R = 16, T = 20, B = 28;
  const ys = points.map(p => (log ? Math.log10(p.y) : p.y));
  let lo = Math.min(...ys), hi = Math.max(...ys);
  if (lo === hi) { lo -= log ? 0.1 : Math.abs(lo) * 0.1 + 0.01; hi += log ? 0.1 : Math.abs(hi) * 0.1 + 0.01; }
  const pad = (hi - lo) * 0.12; lo -= pad; hi += pad;
  const n = points.length;
  const X = i => L + (n === 1 ? (W - L - R) / 2 : (i / (n - 1)) * (W - L - R));
  // Lower-is-better measures are drawn flipped, so up always means better.
  const Y = v => (lowerIsBetter ? T + ((v - lo) / (hi - lo)) * (H - T - B) : T + (1 - (v - lo) / (hi - lo)) * (H - T - B));
  const ticks = niceTicks(lo, hi, 4);
  const path = ys.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join('');
  const area = `${path}L${X(n - 1).toFixed(1)},${H - B}L${X(0).toFixed(1)},${H - B}Z`;
  const lastI = n - 1;
  const xl = [0, Math.floor((n - 1) / 2), n - 1].filter((v, i, a) => a.indexOf(v) === i);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Trend over ${n} sessions">
    ${ticks.map(t => `<line x1="${L}" x2="${W - R}" y1="${Y(t)}" y2="${Y(t)}" class="grid"/><text x="${L - 8}" y="${Y(t) + 4}" class="tick" text-anchor="end">${esc(fmt(log ? Math.pow(10, t) : t))}</text>`).join('')}
    <path d="${area}" class="area"/>
    <path d="${path}" class="line"/>
    ${ys.map((v, i) => `<circle cx="${X(i)}" cy="${Y(v)}" r="${i === lastI ? 5 : 2.5}" class="${i === lastI ? 'pt last' : 'pt'}"/>`).join('')}
    <text x="${X(lastI)}" y="${Math.max(T + 12, Y(ys[lastI]) - 10)}" class="lastlabel" text-anchor="${n === 1 ? 'middle' : 'end'}">${esc(fmt(points[lastI].y))}</text>
    ${xl.map(i => `<text x="${X(i)}" y="${H - 6}" class="tick" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${esc(fmtDay(points[i].t))}</text>`).join('')}
    <text x="${L + 4}" y="${T + 2}" class="note">↑ better</text>
  </svg>`;
}

// bars: [{label, v, today}]
export function barChart(bars, { height = 140, target = null, unit = 'min' } = {}) {
  const W = 560, H = height, L = 34, R = 10, T = 12, B = 24;
  const max = Math.max(target || 0, ...bars.map(b => b.v), 1) * 1.1;
  const bw = (W - L - R) / bars.length;
  const Y = v => T + (1 - v / max) * (H - T - B);
  const ticks = niceTicks(0, max, 3);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Training minutes per day">
    ${ticks.map(t => `<line x1="${L}" x2="${W - R}" y1="${Y(t)}" y2="${Y(t)}" class="grid"/><text x="${L - 6}" y="${Y(t) + 4}" class="tick" text-anchor="end">${t}</text>`).join('')}
    ${target ? `<line x1="${L}" x2="${W - R}" y1="${Y(target)}" y2="${Y(target)}" class="target"/><text x="${W - R}" y="${Y(target) - 4}" class="note" text-anchor="end">goal ${target} ${unit}</text>` : ''}
    ${bars.map((b, i) => `<rect x="${L + i * bw + bw * 0.18}" y="${Y(b.v)}" width="${bw * 0.64}" height="${Math.max(0, H - B - Y(b.v))}" rx="3" class="${b.today ? 'bar today' : target && b.v >= target ? 'bar met' : 'bar'}"><title>${esc(b.label)}: ${Math.round(b.v)} ${unit}</title></rect>
      ${bars.length <= 16 || i % 2 === bars.length % 2 || b.today ? `<text x="${L + i * bw + bw / 2}" y="${H - 7}" class="tick" text-anchor="middle">${esc(b.short)}</text>` : ''}`).join('')}
  </svg>`;
}
