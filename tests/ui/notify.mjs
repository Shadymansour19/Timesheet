// Browser E2E for the admin desktop notifications ("somebody filled his timesheet"): per-person quiet timer, own edits only,
// not while the window is focused, off by default, toggled in the account menu. REAL Supabase project, temporary ids 3a000000-...
// Needs `npx vite preview --port 4173`, TS_DB_URL, Chromium. Usage: node tests/ui/notify.mjs
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
const sql = (q) => execSync(`psql "$TS_DB_URL" -X -q -At -c "${q.replace(/"/g, '\\"')}"`, { encoding: 'utf8' }).trim();
const PW = 'Nt-Pass-12345', DA = '3a000000-0000-0000-0000-00000000000a';
const uid = (i) => `3a000000-0000-0000-0000-0000000001${String(i).padStart(2, '0')}`;   // 0 admin, 1-3 users, 4 second admin
const cleanup = () => sql(`delete from auth.users where id::text ~ '^3a000000-' or id in (select id from public.profiles where department_id::text ~ '^3a000000-');
  delete from public.departments where id::text ~ '^3a000000-';
  delete from public.audit_log where (target_user is not null and target_user not in (select id from public.profiles)) or (department_id is not null and department_id not in (select id from public.departments));`);
cleanup();
sql(`insert into public.departments (id,name) values ('${DA}','NT Alpha')`);
const people = [[0, 'ntadm', 'NT Admin', 'admin'], [1, 'ntu1', 'NT User One', 'user'], [2, 'ntu2', 'NT User Two', 'user'], [3, 'ntu3', 'NT User Three', 'user'], [4, 'ntadm2', 'NT Admin Two', 'admin']];
for (const [i, un, name, role] of people) sql(`
 insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change)
 values ('00000000-0000-0000-0000-000000000000','${uid(i)}','authenticated','authenticated','${un}@timesheet.local',crypt('${PW}',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',now(),now(),'','','','');
 insert into auth.identities (id,user_id,provider_id,identity_data,provider,last_sign_in_at,created_at,updated_at) values (gen_random_uuid(),'${uid(i)}','${uid(i)}','{"sub":"${uid(i)}"}','email',now(),now(),now());
 insert into public.profiles (id,username,full_name,opr,payroll,level,department_id,role) values ('${uid(i)}','${un}','${name}','NTO-${i}','NTP-${i}','2','${DA}','${role}');`);

const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0;
const ok = (l, c, extra = '') => { if (!c) fails++; console.log((c ? 'PASS: ' : 'FAIL: ') + l + (c ? '' : ' ' + extra)); };
const eventually = async (fn, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await fn()) return true; } catch { /* retry */ } await new Promise((r) => setTimeout(r, 250)); } return false; };
const T = sql("select to_char(current_date,'YYYY-MM-DD')");

// an admin on the INSTALLED DESKTOP app: standalone display mode, a fake Notification that records, a window that is not focused, a short quiet time
async function adminApp(un, { delay = 12000, granted = true, focused = false } = {}) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(({ delay, granted, focused }) => {
    const mm = window.matchMedia.bind(window);
    window.matchMedia = (q) => (/display-mode:\s*standalone/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : mm(q));
    window.__notes = [];
    window.Notification = class { constructor(title, o) { this.title = title; this.o = o; window.__notes.push({ title, body: o?.body, tag: o?.tag, at: Date.now() }); } close() {} static get permission() { return window.__perm ?? (granted ? 'granted' : 'default'); } static async requestPermission() { window.__perm = granted ? 'granted' : 'denied'; return window.__perm; } };
    try { localStorage.setItem('ts.notifyDelayMs', String(delay)); localStorage.setItem('ts.teamView', 'week'); } catch { /* ignore */ }
    if (!focused) { document.hasFocus = () => false; }
  }, { delay, granted, focused });
  const p = await ctx.newPage(); p.errs = []; p.on('pageerror', (e) => p.errs.push(e.message));
  await p.goto('http://localhost:4173/'); await p.fill('#username', un); await p.fill('#password', PW); await p.click('button[type=submit]'); await p.waitForSelector('.topbar');
  await p.waitForSelector('.live-dot.live', { timeout: 20000 });
  return p;
}
const userApp = async (un) => { const ctx = await b.newContext({ viewport: { width: 420, height: 800 } }); const p = await ctx.newPage(); await p.goto('http://localhost:4173/'); await p.fill('#username', un); await p.fill('#password', PW); await p.click('button[type=submit]'); await p.waitForSelector('.cal .day'); return p; };
const notes = (p) => p.evaluate(() => window.__notes);

// 1. off by default: nothing is shown until the admin switches it on in the account menu
const A = await adminApp('ntadm', { granted: true });
const U1 = await userApp('ntu1');
await U1.locator(`.cal .day[data-d="${T}"]`).click(); await A.waitForTimeout(4500);
ok('notifications are OFF until switched on: a user\'s activity shows nothing', (await notes(A)).length === 0);
await A.click('.who'); 
ok('the account menu offers the notification switch (installed desktop admin), showing Off', (await A.locator('.menu .menu-item:has-text("Notify me")').textContent()).includes('Off'));
await A.locator('.menu .menu-item:has-text("Notify me")').click();
ok('switching it on (permission asked from the click) shows On', await eventually(async () => (await A.locator('.menu .menu-item:has-text("Notify me")').textContent()).includes('On'), 8000));
await A.keyboard.press('Escape'); await A.mouse.click(5, 5);

// 2. a burst of one person's clicks = ONE notification, only after that person has been quiet; per person timers
const u1day = (n) => U1.locator(`.cal .day[data-d="${sql(`select to_char(date_trunc('month',current_date)::date + ${n}, 'YYYY-MM-DD')`)}"]`);
const U2 = await userApp('ntu2');
for (const n of [3, 4, 5]) { await u1day(n).click(); await U1.waitForTimeout(500); }     // three clicks in ~1.5 s (E -> X)
await U2.locator(`.cal .day[data-d="${sql(`select to_char(date_trunc('month',current_date)::date + 9, 'YYYY-MM-DD')`)}"]`).click();     // another person, a little later
await A.waitForTimeout(600);
ok('nothing yet while the people are still within their quiet time (no notification per click)', (await notes(A)).length === 0, JSON.stringify(await notes(A)));
ok('then each PERSON gets their own notification after their own quiet time: one for user 1 (3+ changes), one for user 2', await eventually(async () => (await notes(A)).length >= 2, 60000), JSON.stringify(await notes(A)));
const got = await notes(A);
const one = got.find((x) => x.title.includes('NT User One')), two = got.find((x) => x.title.includes('NT User Two'));
ok('user 1: ONE notification for the whole burst ("NT User One updated the timesheet", 3+ changes), user 2 separate', !!one && !!two && /\b([3-9]|\d\d)\b/.test(one.body) && got.filter((x) => x.title.includes('NT User One')).length === 1 && one.tag !== two.tag, JSON.stringify(got));
ok('the quiet time is PER PERSON: user 2 (who clicked later) was notified later than user 1', two.at >= one.at, `${one.at} ${two.at}`);

// 3. not for an admin's own edits of someone, nor for another admin editing
const A2 = await adminApp('ntadm2', { granted: true });
const nBefore = (await notes(A)).length;
sql(`select set_config('request.jwt.claims', '', true)`);
await A2.goto('http://localhost:4173/#/person/' + uid(3)); await A2.waitForSelector('.cal .day');
await A2.locator('.cal .day:not(.ctx)').nth(12).click(); await A.waitForTimeout(16000);
ok('an ADMIN editing a person\'s days does not trigger a notification', (await notes(A)).length === nBefore, JSON.stringify(await notes(A)));
ok('the admin\'s own edits never notify himself', (await notes(A2)).length === 0);

// 4. no notification while the app window is focused (the grid already shows it live)
const F = await adminApp('ntadm2', { granted: true, focused: true });
await F.click('.who'); await F.locator('.menu .menu-item:has-text("Notify me")').click(); await F.waitForTimeout(500);
const U3 = await userApp('ntu3');
await U3.locator(`.cal .day[data-d="${T}"]`).click(); await F.waitForTimeout(16000);
ok('while the app window has focus nothing is shown', (await notes(F)).length === 0, JSON.stringify(await notes(F)));

// 5. a plain browser tab / phone sees no switch (installed desktop app only)
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } }); const P = await ctx.newPage();
await P.goto('http://localhost:4173/'); await P.fill('#username', 'ntadm'); await P.fill('#password', PW); await P.click('button[type=submit]'); await P.waitForSelector('.topbar'); await P.click('.who');
ok('in a normal browser tab (app not installed) there is no notification switch', (await P.locator('.menu .menu-item:has-text("Notify me")').count()) === 0);
ok('no page errors in the admin app ' + JSON.stringify(A.errs), A.errs.length === 0);

cleanup();
await b.close();
console.log(fails ? `=== ${fails} FAILURES ===` : '=== ALL NOTIFY TESTS PASSED ===');
process.exit(fails ? 1 : 0);
