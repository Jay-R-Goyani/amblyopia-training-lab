// Small drawing helpers for the eye layers. Grey values are linear luminance 0..1.
export const grey = v => { const c = Math.round(Math.max(0, Math.min(1, v)) * 255); return `rgb(${c},${c},${c})`; };

export function cross(ctx, x, y, size, v = 0.15, width = 2) {
  ctx.strokeStyle = grey(v); ctx.lineWidth = width; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x - size, y); ctx.lineTo(x + size, y); ctx.moveTo(x, y - size); ctx.lineTo(x, y + size); ctx.stroke();
}

export function dot(ctx, x, y, r, v = 1) {
  ctx.fillStyle = grey(v); ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
}

export function ring(ctx, x, y, r, v = 1, width = 3) {
  ctx.strokeStyle = grey(v); ctx.lineWidth = width; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
}

export function xMark(ctx, x, y, r, v = 0.05, width = 3) {
  ctx.strokeStyle = grey(v); ctx.lineWidth = width; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r); ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r); ctx.stroke();
}

export function text(ctx, str, x, y, size, v = 1, align = 'center', weight = 700) {
  ctx.fillStyle = grey(v);
  ctx.font = `${weight} ${size}px "Atkinson Hyperlegible", "Segoe UI", Arial, sans-serif`;
  ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.fillText(str, x, y);
}

// Draw the same thing in both eye layers (fusion locks: frames, fixation marks, HUD)
export function both(ctxA, ctxF, fn) { fn(ctxA); fn(ctxF); }

export const SLOAN = ['C', 'D', 'H', 'K', 'N', 'O', 'R', 'S', 'V', 'Z'];

// Draw a letter so that its cap height is exactly `h` px (Arial-like fonts: cap height ~0.716 em)
export function letter(ctx, ch, x, y, h, v = 0) {
  const size = h / 0.716;
  ctx.fillStyle = grey(v);
  ctx.font = `700 ${size}px Arial, "Helvetica Neue", Helvetica, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.fillText(ch, x, y + h / 2);
}
