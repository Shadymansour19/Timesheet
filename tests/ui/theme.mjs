// Browser E2E for the Light/Dark/System theme choice, on the REAL Supabase project.
// Temporary th* users / "TH *" department (ids 70000000-...), removed afterwards.
// Needs `npx vite preview --port 4173`, TS_DB_URL, Chromium. Usage: node tests/ui/theme.mjs [screenshot-dir]
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
const S = process.argv[2] ?? tmpdir();
const sql = (q) => execSync(`psql "$TS_DB_URL" -X -q -At -c "${q.replace(/"/g, '\\"')}"`, { encoding: 'utf8' }).trim();
const PW = 'Th-Pass-12345', D = '70000000-0000-0000-0000-00000000000a';
const ID = { sa: '70000000-0000-0000-0000-0000000000a0', adm: '70000000-0000-0000-0000-0000000000a1', u: '70000000-0000-0000-0000-0000000000a2', u2: '70000000-0000-0000-0000-0000000000a3' };
const cleanup = () => sql(`delete from auth.users where id::text ~ '^70000000-' or id in (select id from public.profiles where department_id::text ~ '^70000000-');
  delete from public.departments where id::text ~ '^70000000-';
  delete from public.audit_log where (target_user is not null and target_user not in (select id from public.profiles)) or (department_id is not null and department_id not in (select id from public.departments));`);
cleanup(); sql(`insert into public.departments (id,name) values ('${D}','TH Dept')`);
for (const [id, un, role, name] of [[ID.sa, 'thsa', 'super_admin', 'TH Super'], [ID.adm, 'thadm', 'admin', 'TH Admin'], [ID.u, 'thu', 'user', 'TH User'], [ID.u2, 'thu2', 'user', 'TH User Two']]) {
  const sa = role === 'super_admin';
  sql(`insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change)
   values ('00000000-0000-0000-0000-000000000000','${id}','authenticated','authenticated','${un}@timesheet.local',crypt('${PW}',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',now(),now(),'','','','');
   insert into auth.identities (id,user_id,provider_id,identity_data,provider,last_sign_in_at,created_at,updated_at) values (gen_random_uuid(),'${id}','${id}','{"sub":"${id}"}','email',now(),now(),now());
   insert into public.profiles (id,username,full_name,opr,level,department_id,role) values ('${id}','${un}','${name}',${sa ? 'null' : `'OPR-${un}'`},1,${sa ? 'null' : `'${D}'`},'${role}');`);
}
sql(`insert into public.day_status (user_id, day, status) values ('${ID.u}', current_date, 'X')`);

const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0;
const ok = (l, c, extra = '') => { if (!c) fails++; console.log((c ? 'PASS: ' : 'FAIL: ') + l + (c ? '' : ' ' + extra)); };
const LIGHT_BG = 'rgb(244, 246, 248)', DARK_BG = 'rgb(17, 24, 31)';
async function open(w, scheme, un) {
  const ctx = await b.newContext({ viewport: { width: w, height: 800 }, colorScheme: scheme });
  await ctx.addInitScript(() => { try { if (!localStorage.getItem('ts.teamView')) localStorage.setItem('ts.teamView', 'month'); } catch { /* ignore */ } });
  const p = await ctx.newPage(); p.errs = []; p.on('pageerror', (e) => p.errs.push(e.message));
  await p.goto('http://localhost:4173/');
  if (un) { await p.fill('#username', un); await p.fill('#password', PW); await p.click('button[type=submit]'); await p.waitForSelector('.topbar'); }
  return p;
}
const bg = (p) => p.evaluate(() => getComputedStyle(document.body).backgroundColor);
const attr = (p) => p.evaluate(() => document.documentElement.getAttribute('data-theme'));
const xbg = (p) => p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--s-x-bg').trim());
const cscheme = (p) => p.evaluate(() => getComputedStyle(document.documentElement).colorScheme);
const meta = (p) => p.evaluate(() => document.querySelector('meta[name="theme-color"]').getAttribute('content'));
const menu = async (p) => { if ((await p.locator('details.acct').getAttribute('open')) === null) await p.locator('.acct > summary').click(); };
const themeBtn = (p, v) => p.locator(`.theme-seg [data-theme-opt="${v}"]`);

// ================= THEME =================
let p = await open(390, 'light');
ok('device LIGHT, no choice: no data-theme, light colours, light browser chrome', (await attr(p)) === null && (await bg(p)) === LIGHT_BG && (await meta(p)) === '#0f766e');
let q = await open(390, 'dark');
ok('device DARK, no choice: follows the device automatically (dark colours + dark browser chrome)', (await attr(q)) === null && (await bg(q)) === DARK_BG && (await meta(q)) === '#11181f');
await q.close();

p = await open(390, 'dark', 'thadm');
await menu(p);
ok('account menu has a Theme row with Light / Dark / System; System is selected by default', (await p.locator('.theme-seg button').count()) === 3 && (await themeBtn(p, 'system').getAttribute('aria-pressed')) === 'true' && (await p.locator('.menu-theme .menu-title').textContent()) === 'Theme');
await themeBtn(p, 'light').click();
ok('choosing LIGHT on a dark device switches at once (attribute, colours, colour-scheme, chrome)', (await attr(p)) === 'light' && (await bg(p)) === LIGHT_BG && (await xbg(p)) === '#d1fae5' && (await cscheme(p)) === 'light' && (await meta(p)) === '#0f766e');
ok('...the button shows as pressed and the menu stays open', (await themeBtn(p, 'light').getAttribute('aria-pressed')) === 'true' && (await themeBtn(p, 'system').getAttribute('aria-pressed')) === 'false' && (await p.locator('details.acct').getAttribute('open')) !== null);
await p.screenshot({ path: S + '/th-light-on-dark-device.png' });
await p.reload(); await p.waitForSelector('.topbar');
ok('the choice survives a reload', (await attr(p)) === 'light' && (await bg(p)) === LIGHT_BG);
// no flash: applied by an inline script in index.html, before any app code runs
const blocked = await b.newContext({ viewport: { width: 390, height: 800 }, colorScheme: 'dark' });
await blocked.addInitScript(() => { try { localStorage.setItem('ts.theme', 'light'); } catch { /* ignore */ } });
await blocked.route('**/assets/*.js', (r) => r.abort());
const bp = await blocked.newPage(); await bp.goto('http://localhost:4173/'); await bp.waitForTimeout(800);
ok('applied BEFORE the app loads (app scripts blocked: still light on a dark device = no flash)', (await attr(bp)) === 'light' && (await bg(bp)) === LIGHT_BG);
await blocked.close();
await menu(p); await themeBtn(p, 'dark').click();
ok('choosing DARK: dark colours, dark chrome', (await attr(p)) === 'dark' && (await bg(p)) === DARK_BG && (await xbg(p)) === '#064e3b' && (await cscheme(p)) === 'dark' && (await meta(p)) === '#11181f');
await themeBtn(p, 'system').click();
ok('choosing SYSTEM removes the override and follows the device again (dark device = dark)', (await attr(p)) === null && (await bg(p)) === DARK_BG);
await p.emulateMedia({ colorScheme: 'light' }); await p.waitForTimeout(300);
ok('...and follows a live device change (device switches to light)', (await bg(p)) === LIGHT_BG && (await meta(p)) === '#0f766e');
await p.emulateMedia({ colorScheme: 'dark' });
await themeBtn(p, 'dark').click();
// the choice is per device: it also applies to the login screen after signing out
await p.locator('.menu-item:text-is("Sign out")').click(); await p.waitForSelector('#username');
ok('per device: the login screen is dark after signing out (dark was chosen)', (await attr(p)) === 'dark' && (await bg(p)) === DARK_BG);
await p.screenshot({ path: S + '/th-login-dark.png' });
// Arabic labels
await p.fill('#username', 'thadm'); await p.fill('#password', PW); await p.click('button[type=submit]'); await p.waitForSelector('.topbar');
await p.click('text=العربية'); await menu(p);
ok('Arabic: Theme row labels (المظهر / فاتح / داكن / الجهاز) and Dark pressed', (await p.locator('.menu-theme .menu-title').textContent()) === 'المظهر' && (await p.locator('.theme-seg button').allTextContents()).join('|') === 'فاتح|داكن|الجهاز' && (await themeBtn(p, 'dark').getAttribute('aria-pressed')) === 'true');
await p.screenshot({ path: S + '/th-menu-ar-dark.png' });
await p.click('text=English');
// every role has the row
for (const un of ['thu', 'thsa']) { const r = await open(390, 'light', un); await menu(r); ok(`role ${un}: the Theme row is in the account menu`, (await r.locator('.theme-seg button').count()) === 3); await r.close(); }

// navigation is unchanged by the theme work: plain top tabs on every screen size (the phone bottom bar is backlog)
await p.close();
for (const w of [390, 1280]) {
  const r = await open(w, 'dark', 'thadm'); await r.waitForSelector('.tgrid');
  const pos = await r.locator('.shell > .nav').evaluate((e) => getComputedStyle(e).position);
  ok(`navigation at ${w}px: ordinary top tabs (not a fixed bottom bar), labels only`, pos !== 'fixed' && (await r.locator('.nav svg').count()) === 0 && (await r.locator('.shell > .nav a').allTextContents()).map((x) => x.trim()).join('|') === 'Department|Overtime|Users|My calendar');
  ok(`dark theme at ${w}px: no page errors ${JSON.stringify(r.errs)}`, r.errs.length === 0);
  if (w === 390) await r.screenshot({ path: S + '/th-admin-dark-phone.png' });
  await r.close();
}

cleanup();
ok('cleanup removed every test row (real data untouched)', sql("select count(*) from auth.users where email like 'th%@timesheet.local'") === '0' && sql("select count(*) from public.departments where name like 'TH %'") === '0');
await b.close();
console.log(fails ? `=== ${fails} FAILURES ===` : '=== ALL THEME TESTS PASSED ===');
