// Browser E2E for the how-to guide: plain users on a PHONE only (card for a new account, menu entry always), not on desktop, not for admins.
// Fixtures: temporary ids 3f000000-.... Needs `npx vite preview --port 4173`, TS_DB_URL, Chromium.
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
const sql = (q) => execSync(`psql "$TS_DB_URL" -X -q -At -c "${q.replace(/"/g, '\\"')}"`, { encoding: 'utf8' }).trim();
const PW = 'Gd-Pass-12345', DA = '3f000000-0000-0000-0000-00000000000a';
const uid = (i) => `3f000000-0000-0000-0000-0000000001${String(i).padStart(2, '0')}`;
const cleanup = () => sql(`delete from auth.users where id::text ~ '^3f000000-' or id in (select id from public.profiles where department_id::text ~ '^3f000000-');
  delete from public.departments where id::text ~ '^3f000000-';
  delete from public.audit_log where (target_user is not null and target_user not in (select id from public.profiles)) or (department_id is not null and department_id not in (select id from public.departments));`);
cleanup();
sql(`insert into public.departments (id,name) values ('${DA}','GD Alpha')`);
const people = [[0, 'gdnew', 'GD New User', 'user', '0 days'], [1, 'gdold', 'GD Old User', 'user', '90 days'], [2, 'gdadm', 'GD Admin', 'admin', '0 days']];
for (const [i, un, name, role, age] of people) sql(`
 insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change)
 values ('00000000-0000-0000-0000-000000000000','${uid(i)}','authenticated','authenticated','${un}@timesheet.local',crypt('${PW}',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',now(),now(),'','','','');
 insert into auth.identities (id,user_id,provider_id,identity_data,provider,last_sign_in_at,created_at,updated_at) values (gen_random_uuid(),'${uid(i)}','${uid(i)}','{"sub":"${uid(i)}"}','email',now(),now(),now());
 insert into public.profiles (id,username,full_name,opr,payroll,level,department_id,role,created_at) values ('${uid(i)}','${un}','${name}','GDO-${i}','GDP-${i}','2','${DA}','${role}', now() - interval '${age}');`);

const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0;
const ok = (l, c, extra = '') => { if (!c) fails++; console.log((c ? 'PASS: ' : 'FAIL: ') + l + (c ? '' : ' ' + extra)); };
async function open(un, { phone = true } = {}) {
  const ctx = await b.newContext(phone ? { viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true } : { viewport: { width: 1300, height: 900 } });
  const p = await ctx.newPage(); p.errs = []; p.on('pageerror', (e) => p.errs.push(e.message));
  await p.goto('http://localhost:4173/'); await p.fill('#username', un); await p.fill('#password', PW); await p.click('button[type=submit]'); await p.waitForSelector('.topbar');
  return p;
}
const TARGETS = ['.cal > .cal-head', '.grid .day.today', '.grid', '.totals', '.cal-tools .icon-only', '.acct'];
const inView = (p) => p.locator('.tour-card').evaluate((e) => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1; });
{ const p = await open('gdnew');
  // the app re-renders (a profile refresh, a route change) while the first tour is still waiting for the calendar: no second tour may start behind it
  await p.evaluate(() => { window.dispatchEvent(new HashChangeEvent('hashchange')); setTimeout(() => window.dispatchEvent(new HashChangeEvent('hashchange')), 120); });
  await p.waitForSelector('.day'); await p.waitForSelector('.tour'); await p.waitForTimeout(1500);
  ok('re-rendering while the tour is starting does not stack a second tour (one overlay, one card)', (await p.locator('.tour').count()) === 1 && (await p.locator('.tour-card').count()) === 1, `${await p.locator('.tour').count()} / ${await p.locator('.tour-card').count()}`);
  ok('phone, new user: the tour starts by itself with a welcome card', /Welcome/.test(await p.locator('.tour-title').innerText()) && (await p.locator('.tour-dot').count()) === 7);
  const bf = await p.locator('.tour-dim').first().evaluate((e) => getComputedStyle(e).backdropFilter + '|' + getComputedStyle(e).backgroundColor);
  ok('the page behind is blurred and dimmed (backdrop blur on the panels)', bf.includes('blur'), bf);
  if (process.env.SHOTS) await p.screenshot({ path: process.env.SHOTS + '/tour-0.png' });
  await p.tap('#tour-next');
  ok('after Next the welcome text is gone from the page', !(await p.locator('body').innerText()).includes('Take a quick tour'));
  for (let i = 0; i < TARGETS.length; i++) {
    await p.waitForTimeout(500);                                  // the spotlight glides to the next area
    const m = await p.evaluate((sel) => { const t = document.querySelector(sel).getBoundingClientRect(), r = document.querySelector('.tour-ring').getBoundingClientRect(); return { covers: r.left <= t.left + 1 && r.top <= t.top + 1 && r.right >= t.right - 1 && r.bottom >= t.bottom - 1, small: r.width < innerWidth * 1.2 }; }, TARGETS[i]);
    ok(`step ${i + 1}: the spotlight ring surrounds ${TARGETS[i]}`, m.covers && m.small, JSON.stringify(m));
    ok(`step ${i + 1}: the explanation card is fully on screen and shows a title`, (await inView(p)) && (await p.locator('.tour-title').innerText()).length > 2);
    if (process.env.SHOTS && i === 1) await p.screenshot({ path: process.env.SHOTS + '/tour-2.png' });
    if (i < TARGETS.length - 1) await p.tap('#tour-next');
  }
  ok('the last step says Done', (await p.locator('#tour-next').innerText()) === 'Done');
  await p.tap('#tour-next'); await p.waitForSelector('.tour', { state: 'detached' });
  ok('finishing the tour removes it', (await p.locator('.tour').count()) === 0);
  await p.reload(); await p.waitForSelector('.day'); await p.waitForTimeout(1500);
  ok('...and it does not start again after a reload', (await p.locator('.tour').count()) === 0);
  await p.tap('.acct > summary');
  ok('the menu has "How to use the app" on a phone', (await p.locator('#guide-open').isVisible()));
  await p.tap('#guide-open'); await p.waitForSelector('.tour');
  ok('the menu entry starts the tour again', (await p.locator('.tour-dot').count()) === 7);
  await p.keyboard.press('Escape'); await p.waitForSelector('.tour', { state: 'detached' });
  ok('Esc skips the tour', (await p.locator('.tour').count()) === 0);
  ok('no page errors', p.errs.length === 0, p.errs.join('|'));
  await p.context().close(); }
// the Arabic tour: the letter legend must not display flipped ("Y. E" next to each other)
{ const ctx = await b.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true }); await ctx.addInitScript(() => localStorage.setItem('lang', 'ar'));
  const p = await ctx.newPage(); await p.goto('http://localhost:4173/'); await p.fill('#username', 'gdnew'); await p.fill('#password', PW); await p.click('button[type=submit]');
  await p.waitForSelector('.tour'); await p.tap('#tour-next'); await p.tap('#tour-next'); await p.waitForTimeout(600);
  const txt = await p.locator('.tour-text').innerText();
  ok('Arabic tour, step "tap a day": the sentences end in Arabic words (no "Y. E" run of Latin text)', txt.includes('ثم Y وهكذا. E يعني راحة') && !/[A-Za-z]\.\s+[A-Za-z]/.test(txt), txt);
  if (process.env.SHOTS) await p.screenshot({ path: process.env.SHOTS + '/tour-ar.png' });
  await ctx.close(); }
{ const p = await open('gdold'); await p.waitForSelector('.day');
  await p.waitForTimeout(1500);
  ok('phone, an older account: no tour by itself', (await p.locator('.tour').count()) === 0);
  await p.tap('.acct > summary');
  ok('...but the menu entry is there', (await p.locator('#guide-open').isVisible()));
  await p.context().close(); }
{ const p = await open('gdnew', { phone: false }); await p.waitForSelector('.day');
  await p.waitForTimeout(1500);
  ok('desktop: no tour, no menu entry', (await p.locator('.tour').count()) === 0 && (await p.locator('#guide-open').count()) === 0);
  await p.context().close(); }
{ const p = await open('gdadm'); await p.waitForSelector('.tgrid');
  await p.waitForTimeout(1000);
  ok('phone, an admin: no tour and no menu entry (admins have the checklist)', (await p.locator('.tour').count()) === 0 && (await p.locator('#guide-open').count()) === 0);
  await p.context().close(); }
cleanup();
await b.close();
console.log(fails ? `=== ${fails} FAILURES ===` : '=== ALL GUIDE TESTS PASSED ===');
