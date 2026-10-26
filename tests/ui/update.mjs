// Browser E2E for the "new version available" banner: the service worker file changes while the app is open -> banner -> Refresh.
// Needs `npm run build && npx vite preview --port 4173`, Chromium. It appends a comment to dist/sw.js and restores the file afterwards.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
const SW = new URL('../../dist/sw.js', import.meta.url).pathname;
const original = readFileSync(SW, 'utf8');
const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0;
const ok = (l, c, extra = '') => { if (!c) fails++; console.log((c ? 'PASS: ' : 'FAIL: ') + l + (c ? '' : ' ' + extra)); };
try {
  const ctx = await b.newContext({ viewport: { width: 1200, height: 800 }, serviceWorkers: 'allow' }); const p = await ctx.newPage(); p.errs = []; p.on('pageerror', (e) => p.errs.push(e.message));
  await p.goto('http://localhost:4173/'); await p.waitForSelector('#username');
  await p.evaluate(() => navigator.serviceWorker.ready);
  await p.waitForFunction(() => navigator.serviceWorker.controller || true);
  ok('no banner while the app is current', (await p.locator('.update-banner').count()) === 0);
  writeFileSync(SW, original + `\n// test build ${Date.now()}\n`);
  await p.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); await r.update(); });
  ok('a changed service worker shows the banner (not a silent swap)', await p.waitForSelector('.update-banner', { timeout: 20000 }).then(() => true, () => false));
  ok('the banner offers Refresh', (await p.locator('#update-now').count()) === 1);
  await p.click('.update-banner button[aria-label]');
  ok('the banner can be dismissed', (await p.locator('.update-banner').count()) === 0);
  ok('no page errors', p.errs.length === 0, p.errs.join('|'));
  await ctx.close();
} finally { writeFileSync(SW, original); await b.close(); }
console.log(fails ? `=== ${fails} FAILURES ===` : '=== ALL UPDATE-BANNER TESTS PASSED ===');
