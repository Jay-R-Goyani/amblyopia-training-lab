// Display preferences: theme (auto/light/dark/contrast) and text size.
// Uses its own attribute (data-ui) so it never fights the host page's data-theme.
import { db } from './store.js';
import { me } from './accounts.js';

// Patients keep display preferences with their data; doctors and admins on their account.
const prefs = () => { const u = me(); return !u || u.role === 'patient' ? db.settings : u.prefs; };

const SIZES = { m: '18px', l: '20px', xl: '23px' };

function systemDark() {
  const host = document.documentElement.getAttribute('data-theme');
  if (host === 'dark') return true;
  if (host === 'light') return false;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function effectiveTheme() {
  const t = prefs().theme || 'auto';
  if (t === 'auto') return systemDark() ? 'dark' : 'light';
  return t;
}

export function applyDisplay() {
  const b = document.body;
  b.dataset.ui = effectiveTheme();
  document.documentElement.style.fontSize = SIZES[prefs().textSize] || SIZES.m;
}

let watching = false;
export function watchSystemTheme(onChange) {
  if (watching) return; watching = true;
  try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { applyDisplay(); onChange && onChange(); }); } catch (e) { /* old browsers */ }
  try { new MutationObserver(() => { if ((prefs().theme || 'auto') === 'auto') applyDisplay(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] }); } catch (e) { /* ignore */ }
}

export const THEME_LABELS = { auto: 'Match my device', light: 'Light', dark: 'Dark', contrast: 'High contrast' };
export const SIZE_LABELS = { m: 'Standard', l: 'Large', xl: 'Extra large' };
