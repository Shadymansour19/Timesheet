// Browser E2E for the "new version available" banner: the service worker file changes while the app is open -> banner -> Refresh.
// Needs `npm run build && npx vite preview --port 4173`, Chromium. It appends a comment to dist/sw.js and restores the file afterwards.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
const SW = new URL('../../dist/sw.js', import.meta.url).pathname;
const original = readFileSync(SW, 'utf8');
const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0;
const ok = (l, c, extra = '') => { if (!c) fails++; console.log((c ? 'PASS: ' : 'FAIL: ') + l + (c ? '' : ' ' + extra)); };
const stubAudio = () => { window.__tones = 0; const AC = function () { this.currentTime = 0; this.state = 'running'; this.destination = {}; };
  AC.prototype = { resume() { return Promise.resolve(); }, close() { return Promise.resolve(); }, createBuffer() { return {}; }, createBufferSource() { return { connect() {}, start() {} }; }, createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; },
    createOscillator() { window.__tones++; return { frequency: {}, connect() {}, start() {}, stop() {} }; } };
  window.AudioContext = AC; };       // counts the notes instead of making a sound
async function bump(p) { writeFileSync(SW, original + `\n// test build ${Date.now()}\n`); await p.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); await r.update(); }); }
try {
  // the person has used the page (a click): banner at the very top across the whole width, a two-note chime, the tab title says it too
  { const ctx = await b.newContext({ viewport: { width: 1200, height: 800 }, serviceWorkers: 'allow' }); await ctx.addInitScript(stubAudio);
    const p = await ctx.newPage(); p.errs = []; p.on('pageerror', (e) => p.errs.push(e.message));
    await p.goto('http://localhost:4173/'); await p.waitForSelector('#username'); await p.mouse.click(600, 400);
    await p.evaluate(() => navigator.serviceWorker.ready);
    ok('no banner while the app is current', (await p.locator('.update-banner').count()) === 0);
    const title0 = await p.title();
    await bump(p);
    ok('a changed service worker shows the banner (not a silent swap)', await p.waitForSelector('.update-banner', { timeout: 20000 }).then(() => true, () => false));
    await p.waitForTimeout(300); await p.evaluate(() => document.querySelector('.update-banner').getAnimations().filter((a) => a.animationName === 'update-in').forEach((a) => a.finish()));       // a headless browser draws no frames: let the slide-in animation finish
    const r = await p.locator('.update-banner').evaluate((e) => { const b = e.getBoundingClientRect(); return { top: Math.round(b.top), w: Math.round(b.width), vw: innerWidth, role: e.getAttribute('role'), bg: getComputedStyle(e).backgroundColor }; });
    ok('desktop: the banner is a bar across the TOP of the page (full width, a strong colour)', r.top === 0 && r.w >= r.vw - 1 && r.bg !== 'rgba(0, 0, 0, 0)', JSON.stringify(r));
    ok('the banner is announced to screen readers (role alert)', r.role === 'alert');
    ok('the banner offers Refresh', (await p.locator('#update-now').count()) === 1);
    ok('a three-note chime plays once when it appears', (await p.evaluate(() => window.__tones)) === 3);
    ok('the tab title carries a marker while the banner is there', (await p.title()) !== title0 && (await p.title()).endsWith(title0));
    await p.evaluate(() => window.scrollTo(0, 500));
    ok('the banner stays visible when the page scrolls (sticky)', (await p.locator('.update-banner').evaluate((e) => Math.round(e.getBoundingClientRect().top))) === 0);
    if (process.env.SHOTS) await p.screenshot({ path: process.env.SHOTS + '/update-banner.png' });
    await p.click('.update-x');
    ok('the banner can be dismissed and the title comes back', (await p.locator('.update-banner').count()) === 0 && (await p.title()) === title0);
    ok('no page errors', p.errs.length === 0, p.errs.join('|'));
    await ctx.close(); }
  // a phone: the first TAP prepares the audio, then the chime plays (a suspended context that only starts inside a tap, like iOS, still works)
  { const ctx = await b.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true, serviceWorkers: 'allow' });
    await ctx.addInitScript(stubAudio);
    await ctx.addInitScript(() => { const AC = window.AudioContext; window.AudioContext = function () { const c = new AC(); c.state = 'suspended'; c.resume = function () { c.state = 'running'; return Promise.resolve(); }; return c; }; window.AudioContext.prototype = AC.prototype; });
    const p = await ctx.newPage(); await p.goto('http://localhost:4173/'); await p.waitForSelector('#username'); await p.tap('#username'); await p.evaluate(() => navigator.serviceWorker.ready);
    await bump(p); await p.waitForSelector('.update-banner', { timeout: 20000 }); await p.waitForTimeout(500);
    ok('phone: after a tap the chime plays too (three notes), even when the audio context starts suspended like on iOS', (await p.evaluate(() => window.__tones)) === 3);
    await ctx.close(); }
  // a newer build is announced through /version.json within seconds, long before the service worker has the new files
  { const cur = JSON.parse(readFileSync(new URL('../../dist/version.json', import.meta.url).pathname, 'utf8')).id;
    const ctx = await b.newContext({ viewport: { width: 1200, height: 800 }, serviceWorkers: 'allow' }); await ctx.addInitScript(stubAudio); await ctx.addInitScript(() => localStorage.setItem('ts.versionPollMs', '1000'));
    let served = cur; await ctx.route('**/version.json*', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: served }) }));
    const p = await ctx.newPage(); await p.goto('http://localhost:4173/'); await p.waitForSelector('#username'); await p.mouse.click(600, 400); await p.waitForTimeout(3500);
    ok('version.json says the same build: no banner, however often it is polled', (await p.locator('.update-banner').count()) === 0);
    served = 'a-newer-build'; const t0 = Date.now();
    ok('a different build id shows the banner within a few seconds (no waiting for the service worker)', await p.waitForSelector('.update-banner', { timeout: 6000 }).then(() => true, () => false), `${Date.now() - t0} ms`);
    ok('...with the chime', (await p.evaluate(() => window.__tones)) === 3);
    await p.click('#update-now');
    ok('Refresh shows "Updating…" while the new worker is fetched', (await p.locator('#update-now').innerText()) === 'Updating…' && await p.locator('#update-now').isDisabled());
    await ctx.close(); }
  // nobody has touched the page yet: browsers forbid sound, so it stays silent (the banner still shows)
  { const ctx = await b.newContext({ viewport: { width: 1200, height: 800 }, serviceWorkers: 'allow' }); await ctx.addInitScript(stubAudio);
    await ctx.addInitScript(() => Object.defineProperty(navigator, 'userActivation', { value: { hasBeenActive: false } }));       // (the test driver itself counts as activity otherwise)
    const p = await ctx.newPage(); await p.goto('http://localhost:4173/'); await p.waitForSelector('#username'); await p.evaluate(() => navigator.serviceWorker.ready);
    await bump(p); await p.waitForSelector('.update-banner', { timeout: 20000 }); await p.waitForTimeout(500);
    ok('no sound before the person has used the page (browser rule), but the banner shows', (await p.evaluate(() => window.__tones)) === 0);
    await p.mouse.click(20, 20); await p.waitForTimeout(400);
    ok('...and the waiting chime plays on the person\'s next tap (a cold start on a phone: the app was opened, no tap yet)', (await p.evaluate(() => window.__tones)) === 3);
    await p.mouse.click(30, 30); await p.waitForTimeout(300);
    ok('...only once', (await p.evaluate(() => window.__tones)) === 3);
    await ctx.close(); }
} finally { writeFileSync(SW, original); await b.close(); }
console.log(fails ? `=== ${fails} FAILURES ===` : '=== ALL UPDATE-BANNER TESTS PASSED ===');
