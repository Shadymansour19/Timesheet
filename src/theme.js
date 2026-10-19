// Light / Dark / System. "System" (default) follows the device; Light and Dark are a manual override remembered on this device.
const KEY = 'ts.theme';
export const THEMES = ['light', 'dark', 'system'];
const COLORS = { light: '#0f766e', dark: '#11181f' };     // browser chrome colour (meta theme-color)

export function getTheme() {
  try { const v = localStorage.getItem(KEY); if (v === 'light' || v === 'dark') return v; } catch { /* storage unavailable */ }
  return 'system';
}

const effective = () => { const v = getTheme(); return v !== 'system' ? v : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; };

export function applyTheme() {
  const v = getTheme(), root = document.documentElement;
  if (v === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', v);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', COLORS[effective()]);
}

export function setTheme(v) {
  try { if (v === 'light' || v === 'dark') localStorage.setItem(KEY, v); else localStorage.removeItem(KEY); } catch { /* ignore */ }
  applyTheme();
}

// while on "System", keep the browser chrome colour in step with the device
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (getTheme() === 'system') applyTheme(); });
