// Browser E2E for the phone bottom tab bar (icons + labels), on the REAL Supabase project.
// Temporary bn* users / "BN *" department (ids 35000000-...), removed afterwards.
// Needs `npx vite preview --port 4173` (or BASE_URL=...), TS_DB_URL, Chromium. Usage: node tests/ui/bottom-nav.mjs [screenshot-dir]
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
const S = process.argv[2] ?? tmpdir();
const BASE = process.env.BASE_URL ?? 'http://localhost:4173';
const sql = (q) => execSync(`psql "$TS_DB_URL" -X -q -At -c "${q.replace(/"/g, '\\"')}"`, { encoding: 'utf8' }).trim();
const PW = 'Bn-Pass-12345', D = '35000000-0000-0000-0000-00000000000a';
const ID = { sa: '35000000-0000-0000-0000-0000000000a0', adm: '35000000-0000-0000-0000-0000000000a1', u: '35000000-0000-0000-0000-0000000000a2', u2: '35000000-0000-0000-0000-0000000000a3' };
const cleanup = () => sql(`delete from auth.users where id::text ~ '^35000000-' or id in (select id from public.profiles where department_id::text ~ '^35000000-');
  delete from public.departments where id::text ~ '^35000000-';
  delete from public.audit_log where (target_user is not null and target_user not in (select id from public.profiles)) or (department_id is not null and department_id not in (select id from public.departments));`);
cleanup(); sql(`insert into public.departments (id,name) values ('${D}','BN Dept')`);
for (const [id, un, role, name] of [[ID.sa, 'bnsa', 'super_admin', 'BN Super'], [ID.adm, 'bnadm', 'admin', 'BN Admin'], [ID.u, 'bnu', 'user', 'BN User'], [ID.u2, 'bnu2', 'user', 'BN User Two']]) {
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
async function open(w, scheme, un) {
  const ctx = await b.newContext({ viewport: { width: w, height: 800 }, colorScheme: scheme });
  await ctx.addInitScript(() => { try { if (!localStorage.getItem('ts.teamView')) localStorage.setItem('ts.teamView', 'month'); } catch { /* ignore */ } });
  const p = await ctx.newPage(); p.errs = []; p.on('pageerror', (e) => p.errs.push(e.message));
  await p.goto(BASE + '/');
  if (un) { await p.fill('#username', un); await p.fill('#password', PW); await p.click('button[type=submit]'); await p.waitForSelector('.topbar'); }
  return p;
}
const bar = async (pg) => pg.locator('.shell > .nav').evaluate((e) => { const c = getComputedStyle(e), r = e.getBoundingClientRect(); return { pos: c.position, display: c.display, top: r.top, bottom: r.bottom, h: r.height, w: r.width, vh: window.innerHeight }; });

const ph = await open(390, 'light', 'bnadm');
let nb = await bar(ph);
ok('phone: the tabs are a bar FIXED to the bottom of the screen', nb.pos === 'fixed' && Math.abs(nb.bottom - nb.vh) < 1.5 && nb.w >= 388, JSON.stringify(nb));
const links = ph.locator('.shell > .nav a');
ok('admin has 4 tabs, each with an icon AND a label', (await links.count()) === 4 && (await ph.locator('.shell > .nav a svg').count()) === 4 && (await links.allTextContents()).map((s) => s.trim()).join('|') === 'Department|Overtime|Users|My calendar');
const boxes = await links.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
ok('tabs share the width evenly', Math.max(...boxes) - Math.min(...boxes) <= 2, JSON.stringify(boxes));
ok('the active tab icon has NO highlight background (colour of icon and text only)', (await ph.locator('.nav a.active .ico').evaluate((e) => getComputedStyle(e).backgroundColor)) === 'rgba(0, 0, 0, 0)');
ok('tap targets are at least 44px tall', (await links.evaluateAll((els) => els.every((e) => e.getBoundingClientRect().height >= 44))));
await ph.waitForSelector('.tgrid'); await ph.waitForTimeout(600);
const gw = await ph.locator('.gridwrap').boundingBox(), lg = await ph.locator('.legend-row').boundingBox();
ok('department grid + legend end above the bar (nothing hidden under it)', lg.y + lg.height <= nb.top + 1 && gw.y + gw.height <= nb.top + 1, JSON.stringify({ gw, lg, top: nb.top }));
const ft = await ph.locator('tfoot th').boundingBox();
ok('the pinned headcount row is visible above the bar', ft && ft.y + ft.height <= nb.top + 1);
await ph.screenshot({ path: S + '/bn-team.png' });
for (const [label, hash, sel] of [['Overtime', '#/overtime', '.ot-day'], ['Users', '#/users', '.person'], ['My calendar', '#/calendar', '.day'], ['Department', '#/team', '.tgrid']]) {
  await ph.locator(`.shell > .nav a:has(.lbl:text-is("${label}"))`).click(); await ph.waitForSelector(sel);
  ok(`tap "${label}" opens it and marks it active`, ph.url().endsWith(hash) && (await ph.locator('.nav a.active .lbl').textContent()) === label);
}
await ph.locator('.shell > .nav a:has(.lbl:text-is("Users"))').click(); await ph.waitForSelector('.person');
await ph.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await ph.waitForTimeout(300);
const lastCard = await ph.locator('.person').last().boundingBox(); nb = await bar(ph);
ok('Users page scrolled to the end: the last card is fully above the bar', lastCard.y + lastCard.height <= nb.top + 1, JSON.stringify({ lastCard, top: nb.top }));
await ph.locator('.shell > .nav a:has(.lbl:text-is("Department"))').click(); await ph.waitForSelector('.tgrid');
// toast above the bar: bulk fill with nothing to change
await ph.click('button:text-is("Bulk fill")'); await ph.waitForSelector('dialog[open]');
const today = sql("select to_char(current_date,'YYYY-MM-DD')");
await ph.locator('dialog[open] label.choice-card:has(input[value=\"X\"])').click(); await ph.locator('dialog[open] input[type=date]').nth(0).fill(today); await ph.locator('dialog[open] input[type=date]').nth(1).fill(today);
await ph.locator('dialog[open] label.check.strong input').uncheck(); await ph.locator('dialog[open] label.check:has-text("BN User") input').first().check();
await ph.waitForFunction(() => /^0 cells will change/.test(document.querySelector('dialog[open] .bulk-preview')?.textContent ?? ''), null, { timeout: 8000 });
await ph.locator('dialog[open] button.primary').click(); await ph.waitForSelector('.toast');
const tb = await ph.locator('.toast').first().boundingBox();
ok('a toast appears ABOVE the bar, not behind it', tb.y + tb.height <= nb.top + 1, JSON.stringify({ tb, top: nb.top }));
await ph.locator('.team-search').focus(); await ph.waitForTimeout(300);
ok('focusing a text field hides the bar (so it does not ride on the on-screen keyboard)', (await ph.evaluate(() => document.body.classList.contains('kbd'))) && (await bar(ph)).display === 'none');
await ph.evaluate(() => document.activeElement.blur()); await ph.waitForTimeout(300);
ok('...and it comes back when the field loses focus', (await bar(ph)).display !== 'none' && (await bar(ph)).pos === 'fixed');
await ph.click('.acct > summary'); await ph.click('.menu a.menu-item'); await ph.waitForSelector('#cur');
const back = await ph.locator('.back-link').boundingBox(); nb = await bar(ph);
ok('change-password page: Back link visible; the form ends above the bar after scrolling', back.y + back.height < nb.top && await (async () => { await ph.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); const f = await ph.locator('form button.primary').boundingBox(); return f.y + f.height <= nb.top + 1; })());
await ph.click('.back-link'); await ph.waitForSelector('.tgrid'); await ph.click('.acct > summary'); await ph.locator('.theme-seg [data-theme-opt="dark"]').click(); await ph.click('.acct > summary');
ok('dark theme: the bar uses the dark card colour', (await ph.locator('.shell > .nav').evaluate((e) => getComputedStyle(e).backgroundColor)) === 'rgb(26, 35, 44)');
await ph.screenshot({ path: S + '/bn-dark.png' });
await ph.click('text=العربية'); await ph.waitForSelector('.tgrid');
const ab = await ph.locator('.shell > .nav a').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
ok('Arabic: the bar is mirrored (first tab on the right)', ab[0] > ab[1] && ab[1] > ab[2] && ab[2] > ab[3], JSON.stringify(ab));
ok('Arabic: no label is cut off', await ph.locator('.nav .lbl').evaluateAll((els) => els.every((e) => e.scrollWidth <= e.clientWidth + 1)));
await ph.screenshot({ path: S + '/bn-ar.png' });
ok('phone admin: no page errors ' + JSON.stringify(ph.errs), ph.errs.length === 0);
await ph.close();

for (const un of ['bnu']) {
  const r = await open(390, 'light', un); await r.waitForTimeout(500);
  const pad = await r.evaluate(() => parseFloat(getComputedStyle(document.getElementById('app')).paddingBottom));
  ok(`phone, ${un}: one tab only -> no bottom bar and no wasted space`, (await bar(r)).display === 'none' && pad < 40, `${(await bar(r)).display} ${pad}`);
  await r.close();
}
{ const r = await open(390, 'light', 'bnsa'); await r.waitForTimeout(500);
  ok('phone, super admin (Departments + the admin tabs): the bottom bar shows 4 tabs', (await bar(r)).display !== 'none' && (await r.locator('.nav a').count()) === 4); await r.close(); }
const dk = await open(1280, 'light', 'bnadm'); await dk.waitForSelector('.tgrid');
const dn = await bar(dk);
ok('desktop: tabs stay at the top (not fixed), icons hidden, labels only', dn.pos !== 'fixed' && dn.top < 200 && !(await dk.locator('.nav .ico').first().isVisible()) && (await dk.locator('.shell > .nav a').allTextContents()).map((s) => s.trim()).join('|') === 'Department|Overtime|Users|My calendar');
await dk.screenshot({ path: S + '/bn-desktop.png' });
ok('desktop: no page errors ' + JSON.stringify(dk.errs), dk.errs.length === 0);

cleanup();
ok('cleanup removed every test row (real data untouched)', sql("select count(*) from auth.users where email like 'bn%@timesheet.local'") === '0' && sql("select count(*) from public.departments where name like 'BN %'") === '0');
await b.close();
console.log(fails ? `=== ${fails} FAILURES ===` : '=== ALL BOTTOM-NAV TESTS PASSED ===');
