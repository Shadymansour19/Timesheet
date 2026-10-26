// Browser E2E of account switching against the REAL Supabase project (temporary sw* users, ids 40000000-...).
// Needs `npm run build && npx vite preview --port 4173`, TS_DB_URL, and Chromium (CHROME=/path or `npx playwright install chromium`).
// Usage: node tests/ui/account-switch.mjs [screenshot-dir]
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
const S = process.argv[2] ?? tmpdir();
const db = (q) => execSync(`psql "$TS_DB_URL" -X -q -At -c "${q.replace(/"/g, '\\"')}"`, { encoding: 'utf8' }).trim();
const PW = 'Sw-Pass-12345';
const D = '40000000-0000-0000-0000-00000000000a';
const ID = { adm: '40000000-0000-0000-0000-0000000000a1', u1: '40000000-0000-0000-0000-0000000000a2', u2: '40000000-0000-0000-0000-0000000000a3' };
const mk = (id, un, role, name) => db(`
 insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change)
 values ('00000000-0000-0000-0000-000000000000','${id}','authenticated','authenticated','${un}@timesheet.local',crypt('${PW}',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',now(),now(),'','','','');
 insert into auth.identities (id,user_id,provider_id,identity_data,provider,last_sign_in_at,created_at,updated_at) values (gen_random_uuid(),'${id}','${id}','{"sub":"${id}"}','email',now(),now(),now());
 insert into public.profiles (id,username,full_name,opr,level,department_id,role) values ('${id}','${un}','${name}','OPR-${un}',1,'${D}','${role}');`);
const cleanup = () => db(`delete from auth.users where id::text like '40000000%';
  delete from public.departments where id='${D}';
  delete from public.audit_log where (target_user is not null and target_user not in (select id from public.profiles)) or (department_id is not null and department_id not in (select id from public.departments));`);
cleanup();
db(`insert into public.departments (id,name) values ('${D}','SW Dept')`);
mk(ID.adm, 'swadm', 'admin', 'Switch Admin'); mk(ID.u1, 'swu1', 'user', 'Switch User'); mk(ID.u2, 'swu2', 'user', 'Switch Other');

const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0;
const ok = (l, c, extra = '') => { if (!c) fails++; console.log((c ? 'PASS: ' : 'FAIL: ') + l + (c ? '' : ' ' + extra)); };
const ctx = await b.newContext({ viewport: { width: 390, height: 800 } });
await ctx.addInitScript(() => { const g = Storage.prototype.getItem; Storage.prototype.getItem = function (k) { return String(k).startsWith('ts.guideSeen.') ? '1' : g.call(this, k); }; });   // the phone tour is tested in guide.mjs; here it must not cover the page
const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const who = async (pg = p) => (await pg.locator('.acct > summary strong').textContent()).trim();
const openMenu = async (pg = p) => { if (!(await pg.locator('.acct').getAttribute('open') !== null)) await pg.locator('.acct > summary').click(); };
const rows = async () => (await p.locator('.acct-row').allTextContents()).length;
const login = async (un) => { await p.fill('#username', un); await p.fill('#password', PW); await p.click('button[type=submit]'); await p.waitForSelector('.topbar'); };
const today = db("select to_char(current_date,'YYYY-MM-DD')");
const statusBy = (uid) => db(`select status||'|'||(updated_by='${uid}') from public.day_status where user_id='${uid}' and day=current_date`);
const tapToday = async () => { await p.locator('.day.today').click(); await p.waitForTimeout(1000); };
const stored = () => p.evaluate(() => JSON.parse(localStorage.getItem('ts.accounts') ?? '[]').map((a) => a.username));
const dialogErr = async () => { await p.waitForFunction(() => document.querySelector('dialog[open] .error')?.textContent.length > 0); return p.locator('dialog[open] .error').textContent(); };

await p.goto('http://localhost:4173/');
await login('swu1');
ok('login as user shows name', (await who()) === 'Switch User');
await openMenu();
ok('menu lists 1 account, no "sign out all" yet', (await rows()) === 1 && (await p.locator('.menu-item:text("Sign out of all")').count()) === 0);
const raw = await p.evaluate(() => localStorage.getItem('ts.accounts') + Object.values(localStorage).join(''));
ok('no password is stored anywhere in localStorage', !raw.includes(PW));
await p.screenshot({ path: S + '/menu-1.png' });

// add account: wrong password keeps the current session
await p.click('.menu-item:text("Add account")'); await p.waitForSelector('dialog[open]');
await p.locator('dialog[open]').getByLabel('Username').fill('swadm'); await p.locator('dialog[open]').getByLabel('Password', { exact: true }).fill('wrong-wrong'); await p.locator('dialog[open] button.primary').click();
ok('wrong password is rejected in the dialog', (await dialogErr()).includes('Invalid username or password'));
await p.locator('dialog[open] button:text-is("Cancel")').click(); await p.waitForSelector('dialog[open]', { state: 'detached' });
ok('still signed in as the original user', (await who()) === 'Switch User' && (await stored()).join() === 'swu1');
await tapToday();
ok('...and the session still works (write lands as that user)', (await statusBy(ID.u1)) === 'X|true', await statusBy(ID.u1));

// add account for real
await openMenu(); await p.click('.menu-item:text("Add account")'); await p.waitForSelector('dialog[open]');
await p.locator('dialog[open]').getByLabel('Username').fill('swadm'); await p.locator('dialog[open]').getByLabel('Password', { exact: true }).fill(PW); await p.locator('dialog[open] button.primary').click();
await p.waitForSelector('dialog[open]', { state: 'detached' }); await p.waitForSelector('.tgrid');
ok('adding the admin switches to it and lands on its home (department grid)', (await who()) === 'Switch Admin' && p.url().endsWith('#/team'));
await openMenu();
ok('menu now lists both, admin marked current', (await rows()) === 2 && (await p.locator('.acct-row.active').textContent()).includes('Switch Admin'));
ok('"Sign out of all accounts" appears with 2 accounts', (await p.locator('.menu-item:text("Sign out of all")').count()) === 1);
await p.screenshot({ path: S + '/menu-2.png' });

// switch back and forth; prove identity through writes
await p.locator('.acct-pick', { hasText: 'Switch User' }).click(); await p.waitForSelector('.day');
ok('switch to the user: name, role view, calendar', (await who()) === 'Switch User' && (await p.locator('.nav a').allTextContents()).join('|') === 'My calendar');
await tapToday();   // X -> Y as the user
ok('after switching, writes are performed AS THE USER', (await statusBy(ID.u1)) === 'Y|true', await statusBy(ID.u1));
await openMenu(); await p.locator('.acct-pick', { hasText: 'Switch Admin' }).click(); await p.waitForSelector('.tgrid');
await p.locator(`td.c[data-u="${ID.u1}"][data-d="${today}"]`).click({ modifiers: ['Shift'] }); await p.waitForSelector('dialog[open]');
await p.locator('dialog[open] input[name=st][value=E]').check(); await p.locator('dialog[open] button.primary').click(); await p.waitForSelector('dialog[open]', { state: 'detached' });
ok('after switching back, admin edits are performed AS THE ADMIN (and E clears the row)', db(`select count(*) from public.day_status where user_id='${ID.u1}' and day=current_date`) === '0');
ok('audit shows the admin as actor of that change', db(`select count(*) from public.audit_log where actor='${ID.adm}' and target_user='${ID.u1}' and table_name='day_status'`) !== '0');

// reload keeps accounts, switching still works
await p.reload(); await p.waitForSelector('.acct');
ok('after reload: same active account', (await who()) === 'Switch Admin');
await openMenu(); ok('after reload: both accounts still listed', (await rows()) === 2);
await p.locator('.acct-pick', { hasText: 'Switch User' }).click();
await p.waitForSelector('.day', { timeout: 20000 }).catch(async () => {   // diagnostics for a stuck switch
  console.log('DIAG url:', p.url(), '| body:', JSON.stringify((await p.textContent('body')).replace(/\s+/g, ' ').slice(0, 200)), '| accounts:', await stored(), '| toast:', JSON.stringify(await p.locator('.toast').allTextContents()));
});
ok('switch works after a reload', (await who()) === 'Switch User');

// a saved account whose session was revoked server-side: the CURRENT session must survive the failed switch
await openMenu(); await p.click('.menu-item:text("Add account")'); await p.waitForSelector('dialog[open]');
await p.locator('dialog[open]').getByLabel('Username').fill('swu2'); await p.locator('dialog[open]').getByLabel('Password', { exact: true }).fill(PW); await p.locator('dialog[open] button.primary').click();
await p.waitForSelector('dialog[open]', { state: 'detached' }); await p.waitForSelector('.day');
ok('third account added, active', (await who()) === 'Switch Other');
await openMenu(); await p.locator('.acct-pick', { hasText: 'Switch User' }).click(); await p.waitForSelector('.day'); await p.waitForTimeout(500);
db(`delete from auth.sessions where user_id='${ID.u2}'`);          // swu2's saved session is now dead
await openMenu(); await p.locator('.acct-pick', { hasText: 'Switch Other' }).click();
await p.waitForSelector('.toast');
ok('switching to a revoked account shows a clear message', (await p.locator('.toast').first().textContent()).includes('must sign in again'));
ok('...stays signed in as the previous account', (await who()) === 'Switch User');
ok('...and removes the dead account from the device', (await stored()).sort().join() === 'swadm,swu1');
await tapToday();
ok('...and the previous session still works (write lands as that user)', (await statusBy(ID.u1)).endsWith('|true'));

// another tab follows the switch instead of acting as a stale account
const p2 = await ctx.newPage(); await p2.goto('http://localhost:4173/'); await p2.waitForSelector('.acct');
ok('second tab shows the same active account', (await who(p2)) === 'Switch User');
await openMenu(); await p.locator('.acct-pick', { hasText: 'Switch Admin' }).click(); await p.waitForSelector('.tgrid');
await p2.waitForFunction(() => document.querySelector('.acct > summary strong')?.textContent.trim() === 'Switch Admin', null, { timeout: 8000 }).catch(() => {});
ok('second tab follows the switch (no stale identity)', (await who(p2)) === 'Switch Admin', await who(p2));
await p2.close();

// remove a saved account (inactive one)
let nativeDialogs = 0; p.on('dialog', (d) => { nativeDialogs++; d.dismiss(); });   // any browser confirm()/alert() would land here
await openMenu(); await p.locator('.acct-row', { hasText: 'Switch User' }).locator('.acct-x').click(); await p.waitForSelector('dialog[open]');
const confirmTitle = (await p.textContent('dialog[open] h3')).trim(), confirmBody = (await p.textContent('dialog[open]'));
ok('the ✕ asks first, in OUR dialog: names the account and explains the consequence', confirmTitle === 'Remove Switch User from this device?' && confirmBody.includes('enter their password') && confirmBody.includes('Nothing is deleted'), confirmTitle);
ok('...the account is still there while the question is open', (await stored()).includes('swu1'));
await p.locator('dialog[open] button:text-is("Cancel")').click(); await p.waitForSelector('dialog[open]', { state: 'detached' });
await openMenu();
ok('Cancel keeps the account (still listed and still stored)', (await stored()).includes('swu1') && (await rows()) === 2);
await p.locator('.acct-row', { hasText: 'Switch User' }).locator('.acct-x').click(); await p.waitForSelector('dialog[open]');
ok('the confirm button is a red "Remove" button', (await p.locator('dialog[open] button.danger').textContent()) === 'Remove');
await p.locator('dialog[open] button.danger').click(); await p.waitForSelector('dialog[open]', { state: 'detached' });
await p.waitForFunction(() => JSON.parse(localStorage.getItem('ts.accounts') ?? '[]').length === 1 && document.querySelectorAll('.acct-row').length === 1, null, { timeout: 8000 }).catch(() => {});
ok('no browser dialog (confirm/alert) was ever used', nativeDialogs === 0);
ok('remove: only the active account remains listed', (await stored()).join() === 'swadm' && (await rows()) === 1);
ok('...and its session was revoked on the server', db(`select count(*) from auth.sessions where user_id='${ID.u1}'`) === '0', db(`select count(*) from auth.sessions where user_id='${ID.u1}'`));

// sign out: falls back to another saved account; sign out of last -> login screen
await openMenu(); await p.click('.menu-item:text("Add account")'); await p.waitForSelector('dialog[open]');
await p.locator('dialog[open]').getByLabel('Username').fill('swu1'); await p.locator('dialog[open]').getByLabel('Password', { exact: true }).fill(PW); await p.locator('dialog[open] button.primary').click();
await p.waitForSelector('dialog[open]', { state: 'detached' }); await p.waitForSelector('.day');
await openMenu(); await p.click('.menu-item:text-is("Sign out")'); await p.waitForSelector('.tgrid');
ok('sign out of one account falls back to the other saved account', (await who()) === 'Switch Admin' && (await stored()).join() === 'swadm');
ok('...only that session was revoked (admin session intact)', db(`select count(*) from auth.sessions where user_id='${ID.u1}'`) === '0' && db(`select count(*) from auth.sessions where user_id='${ID.adm}'`) !== '0');
await openMenu(); await p.click('.menu-item:text("Add account")'); await p.waitForSelector('dialog[open]');
await p.locator('dialog[open]').getByLabel('Username').fill('swu1'); await p.locator('dialog[open]').getByLabel('Password', { exact: true }).fill(PW); await p.locator('dialog[open] button.primary').click();
await p.waitForSelector('dialog[open]', { state: 'detached' }); await p.waitForSelector('.day');
await openMenu(); await p.click('.menu-item:text("Sign out of all")'); await p.waitForSelector('#username');
ok('sign out of all: login screen, nothing stored', (await stored()).length === 0);
ok('...and every session of both users is revoked on the server', db(`select count(*) from auth.sessions where user_id in ('${ID.adm}','${ID.u1}')`) === '0', db(`select count(*) from auth.sessions where user_id in ('${ID.adm}','${ID.u1}')`));
await p.reload(); await p.waitForSelector('#username');
ok('after reload still on the login screen', true);

// Arabic menu
await login('swadm'); await p.click('text=العربية'); await openMenu(); await p.waitForTimeout(300);
ok('Arabic menu text and RTL', (await p.locator('.menu > .menu-title').textContent()).includes('الحسابات') && (await p.getAttribute('html', 'dir')) === 'rtl');
await p.screenshot({ path: S + '/menu-ar.png' });
ok('no page errors ' + JSON.stringify(errs), errs.length === 0);

cleanup();
ok('cleanup removed every test row (real data untouched)', db("select count(*) from auth.users where email like 'sw%@timesheet.local'") === '0' && db("select count(*) from public.departments where name like 'SW %'") === '0');
await b.close();
console.log(fails ? `=== ${fails} FAILURES ===` : '=== ALL ACCOUNT-SWITCH TESTS PASSED ===');
