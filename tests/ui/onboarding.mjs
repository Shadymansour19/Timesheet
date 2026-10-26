// Browser E2E for the first-run checklist (Users tab): add people -> department data -> start filling; ticked from real data; Hide is remembered.
// Fixtures: temporary ids 3e000000-.... Needs `npx vite preview --port 4173`, TS_DB_URL, Chromium.
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
const sql = (q) => execSync(`psql "$TS_DB_URL" -X -q -At -c "${q.replace(/"/g, '\\"')}"`, { encoding: 'utf8' }).trim();
const PW = 'Ob-Pass-12345', DA = '3e000000-0000-0000-0000-00000000000a';
const uid = (i) => `3e000000-0000-0000-0000-0000000001${String(i).padStart(2, '0')}`;
const cleanup = () => sql(`delete from auth.users where id::text ~ '^3e000000-' or id in (select id from public.profiles where department_id::text ~ '^3e000000-');
  delete from public.departments where id::text ~ '^3e000000-';
  delete from public.audit_log where (target_user is not null and target_user not in (select id from public.profiles)) or (department_id is not null and department_id not in (select id from public.departments));`);
cleanup();
sql(`insert into public.departments (id,name) values ('${DA}','OB Alpha')`);
sql(`
 insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change)
 values ('00000000-0000-0000-0000-000000000000','${uid(0)}','authenticated','authenticated','obadm@timesheet.local',crypt('${PW}',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',now(),now(),'','','','');
 insert into auth.identities (id,user_id,provider_id,identity_data,provider,last_sign_in_at,created_at,updated_at) values (gen_random_uuid(),'${uid(0)}','${uid(0)}','{"sub":"${uid(0)}"}','email',now(),now(),now());
 insert into public.profiles (id,username,full_name,opr,payroll,level,department_id,role) values ('${uid(0)}','obadm','OB Admin','OBO-0','OBP-0','2','${DA}','admin');`);

const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0;
const ok = (l, c, extra = '') => { if (!c) fails++; console.log((c ? 'PASS: ' : 'FAIL: ') + l + (c ? '' : ' ' + extra)); };
const eventually = async (fn, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch { /* retry */ } await new Promise((r) => setTimeout(r, 300)); } return false; };
const ctx = await b.newContext({ viewport: { width: 1300, height: 900 } }); const p = await ctx.newPage(); p.errs = []; p.on('pageerror', (e) => p.errs.push(e.message));
await p.goto('http://localhost:4173/'); await p.fill('#username', 'obadm'); await p.fill('#password', PW); await p.click('button[type=submit]'); await p.waitForSelector('.topbar');
await p.goto('http://localhost:4173/#/users'); await p.waitForSelector('#onboarding');
const marks = () => p.locator('#onboarding .ob-step').evaluateAll((e) => e.map((x) => x.classList.contains('done')));
ok('a new department shows the 3-step checklist, nothing done', (await p.locator('#onboarding .ob-step').count()) === 3 && (await marks()).join() === 'false,false,false', (await marks()).join());
// step 1: add a person
await p.click('#onboarding button:text-is("Add user")'); await p.waitForSelector('dialog[open]');
await p.fill('dialog[open] input[autocapitalize="none"]', 'obu1'); await p.getByRole('textbox', { name: 'Full name' }).fill('OB Person'); await p.getByLabel('Payroll number').fill('OBP-1'); await p.click('dialog[open] button:text-is("Add")');
ok('step 1 is ticked after adding a person', await eventually(async () => (await marks())[0] === true));
// step 2: department data
await p.click('#onboarding button:text-is("Department data")'); await p.waitForSelector('dialog[open]');
await p.getByLabel('Department code').fill('77'); await p.click('dialog[open] button:text-is("Save")');
ok('step 2 is ticked after saving the department data', await eventually(async () => (await marks())[1] === true));
// Hide is remembered
await p.click('#onboarding button:text-is("Hide")');
ok('Hide removes the card', (await p.locator('#onboarding').count()) === 0);
await p.reload(); await p.waitForSelector('.person');
ok('...and it stays hidden after a reload', (await p.locator('#onboarding').count()) === 0);
await p.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('ts.onboardingHidden')).forEach((k) => localStorage.removeItem(k)));
await p.reload(); await p.waitForSelector('#onboarding');
ok('clearing the flag shows it again (step 3 still open)', (await marks()).join() === 'true,true,false', (await marks()).join());
// step 3: a status exists -> everything done -> the card disappears
sql(`insert into public.day_status (user_id, day, status) select id, current_date, 'X' from public.profiles where username='obu1'`);
await p.reload(); await p.waitForSelector('.person');
ok('when all three are done the card is gone', await eventually(async () => (await p.locator('#onboarding').count()) === 0));
ok('no page errors', p.errs.length === 0, p.errs.join('|'));
cleanup();
await b.close();
console.log(fails ? `=== ${fails} FAILURES ===` : '=== ALL ONBOARDING TESTS PASSED ===');
