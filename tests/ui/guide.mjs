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
{ const p = await open('gdnew'); await p.waitForSelector('.day');
  ok('phone, new user: the how-to card is shown with 5 steps', (await p.locator('#guide .guide-step').count()) === 5);
  if (process.env.SHOTS) await p.screenshot({ path: process.env.SHOTS + '/guide.png' });
  await p.tap('#guide-ok');
  ok('"Got it" removes the card', (await p.locator('#guide').count()) === 0);
  await p.reload(); await p.waitForSelector('.day');
  ok('...and it stays gone after a reload', (await p.locator('#guide').count()) === 0);
  await p.tap('.acct > summary');
  ok('the menu has "How to use the app" on a phone', (await p.locator('#guide-open').isVisible()));
  await p.tap('#guide-open'); await p.waitForSelector('dialog[open]');
  ok('the menu entry opens the same steps in a dialog', (await p.locator('dialog[open] .guide-step').count()) === 5);
  ok('no page errors', p.errs.length === 0, p.errs.join('|'));
  await p.context().close(); }
{ const p = await open('gdold'); await p.waitForSelector('.day');
  ok('phone, an older account: no card by itself', (await p.locator('#guide').count()) === 0);
  await p.tap('.acct > summary');
  ok('...but the menu entry is there', (await p.locator('#guide-open').isVisible()));
  await p.context().close(); }
{ const p = await open('gdnew', { phone: false }); await p.waitForSelector('.day');
  ok('desktop: no card, no menu entry', (await p.locator('#guide').count()) === 0 && (await p.locator('#guide-open').count()) === 0);
  await p.context().close(); }
{ const p = await open('gdadm'); await p.waitForSelector('.tgrid');
  ok('phone, an admin: no how-to card and no menu entry (admins have the checklist)', (await p.locator('#guide').count()) === 0 && (await p.locator('#guide-open').count()) === 0);
  await p.context().close(); }
cleanup();
await b.close();
console.log(fails ? `=== ${fails} FAILURES ===` : '=== ALL GUIDE TESTS PASSED ===');
