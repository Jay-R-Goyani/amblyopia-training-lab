// Simple filled shapes used as symbols (Peripheral Chart). r = outer radius in px.
export const SHAPES = ['circle', 'square', 'triangle', 'star', 'heart', 'cross', 'diamond', 'moon', 'hexagon', 'arrow'];
export const SHAPE_NAMES = { circle: 'Circle', square: 'Square', triangle: 'Triangle', star: 'Star', heart: 'Heart', cross: 'Cross', diamond: 'Diamond', moon: 'Moon', hexagon: 'Hexagon', arrow: 'Arrow' };

function poly(ctx, pts) { ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); ctx.closePath(); }

// Adds the shape's path to ctx (caller does beginPath / fill / clip).
export function shapePath(ctx, name, x, y, r) {
  const P = (a, rr) => [x + Math.cos(a) * rr, y + Math.sin(a) * rr];
  switch (name) {
    case 'circle': ctx.moveTo(x + r, y); ctx.arc(x, y, r * 0.92, 0, Math.PI * 2); break;
    case 'square': ctx.rect(x - r * 0.78, y - r * 0.78, r * 1.56, r * 1.56); break;
    case 'triangle': poly(ctx, [P(-Math.PI / 2, r), P(Math.PI / 6, r), P(5 * Math.PI / 6, r)].map(([px, py]) => [px, py + r * 0.15])); break;
    case 'star': { const pts = []; for (let i = 0; i < 10; i++) pts.push(P(-Math.PI / 2 + i * Math.PI / 5, i % 2 ? r * 0.45 : r)); poly(ctx, pts); break; }
    case 'heart': {
      const s = r / 1.05;
      ctx.moveTo(x, y + s * 0.95);
      ctx.bezierCurveTo(x - s * 1.25, y + s * 0.1, x - s * 0.95, y - s * 1.05, x, y - s * 0.4);
      ctx.bezierCurveTo(x + s * 0.95, y - s * 1.05, x + s * 1.25, y + s * 0.1, x, y + s * 0.95);
      ctx.closePath(); break;
    }
    case 'cross': { const a = r * 0.32; poly(ctx, [[x - a, y - r], [x + a, y - r], [x + a, y - a], [x + r, y - a], [x + r, y + a], [x + a, y + a], [x + a, y + r], [x - a, y + r], [x - a, y + a], [x - r, y + a], [x - r, y - a], [x - a, y - a]]); break; }
    case 'diamond': poly(ctx, [[x, y - r], [x + r * 0.72, y], [x, y + r], [x - r * 0.72, y]]); break;
    case 'moon': ctx.moveTo(x + r * 0.9, y); ctx.arc(x, y, r * 0.9, 0, Math.PI * 2, false); ctx.moveTo(x + r * 1.25, y - r * 0.2); ctx.arc(x + r * 0.42, y - r * 0.2, r * 0.83, 0, Math.PI * 2, true); break;
    case 'hexagon': { const pts = []; for (let i = 0; i < 6; i++) pts.push(P(i * Math.PI / 3, r * 0.95)); poly(ctx, pts); break; }
    case 'arrow': poly(ctx, [[x - r, y - r * 0.28], [x + r * 0.1, y - r * 0.28], [x + r * 0.1, y - r * 0.75], [x + r, y], [x + r * 0.1, y + r * 0.75], [x + r * 0.1, y + r * 0.28], [x - r, y + r * 0.28]]); break;
    default: ctx.arc(x, y, r, 0, Math.PI * 2);
  }
}

export function fillShape(ctx, name, x, y, r, style) {
  ctx.fillStyle = style; ctx.beginPath(); shapePath(ctx, name, x, y, r); ctx.fill('evenodd');
}
export function strokeShape(ctx, name, x, y, r, style, width = 3) {
  ctx.strokeStyle = style; ctx.lineWidth = width; ctx.lineJoin = 'round'; ctx.beginPath(); shapePath(ctx, name, x, y, r); ctx.stroke();
}
