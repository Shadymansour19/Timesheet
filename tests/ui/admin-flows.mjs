// Browser end-to-end test of the admin + super_admin UI against the REAL Supabase project.
// Creates temporary ui* users and "UI *" departments (ids 30000000-...), runs everything, then deletes them.
// Needs: `npm run build && npx vite preview --port 4173` running, TS_DB_URL in the environment,
// and Playwright's Chromium (`npx playwright install chromium`, or set CHROME=/path/to/chrome).
// Usage: node tests/ui/admin-flows.mjs [screenshot-dir]
import { chromium } from 'playwright';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import ExcelJS from 'exceljs';
const S = process.argv[2] ?? tmpdir();
const db = (q) => execSync(`psql "$TS_DB_URL" -X -q -At -c "${q.replace(/"/g, '\\"')}"`, { encoding: 'utf8' }).trim();
const PW = 'Ui-Test-Pass-1';
const DA = '30000000-0000-0000-0000-00000000000a', DB = '30000000-0000-0000-0000-00000000000b';
const ID = { adm: '30000000-0000-0000-0000-0000000000a1', u1: '30000000-0000-0000-0000-0000000000a2', u2: '30000000-0000-0000-0000-0000000000a3',
  admB: '30000000-0000-0000-0000-0000000000b1', ub: '30000000-0000-0000-0000-0000000000b2', sa: '30000000-0000-0000-0000-0000000000a0' };
const mk = (id, un, role, dept, name) => db(`
 insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change)
 values ('00000000-0000-0000-0000-000000000000','${id}','authenticated','authenticated','${un}@timesheet.local',crypt('${PW}',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',now(),now(),'','','','');
 insert into auth.identities (id,user_id,provider_id,identity_data,provider,last_sign_in_at,created_at,updated_at) values (gen_random_uuid(),'${id}','${id}','{"sub":"${id}"}','email',now(),now(),now());
 insert into public.profiles (id,username,full_name,opr,level,department_id,role) values ('${id}','${un}','${name}',${role === 'super_admin' ? 'null' : `'OPR-${un}'`},1,${dept ? `'${dept}'` : 'null'},'${role}');`);
function cleanup() {
  db(`delete from public.audit_log where department_id in ('${DA}','${DB}') or target_user::text like '30000000%' or actor::text like '30000000%' or table_name in ('departments');
      delete from auth.users where email like 'ui%@timesheet.local' or id::text like '30000000%';
      delete from public.departments where id in ('${DA}','${DB}') or name like 'UI %';
      delete from public.audit_log where (target_user is not null and target_user not in (select id from public.profiles)) or (department_id is not null and department_id not in (select id from public.departments)) or (table_name = 'departments' and new_value like 'UI %');`);
}
cleanup();
db(`insert into public.departments (id,name) values ('${DA}','UI Dept A'),('${DB}','UI Dept B')`);
mk(ID.sa, 'uisa', 'super_admin', null, 'UI Super');
mk(ID.adm, 'uiadm', 'admin', DA, 'UI Admin A'); mk(ID.u1, 'uiu1', 'user', DA, 'UI User One'); mk(ID.u2, 'uiu2', 'user', DA, 'UI User Two');
mk(ID.admB, 'uiadmb', 'admin', DB, 'UI Admin B'); mk(ID.ub, 'uiub', 'user', DB, 'UI User Bee');
db(`insert into public.day_status (user_id, day, status) values ('${ID.ub}', current_date, 'X'); insert into public.overtime (user_id,day,hours) values ('${ID.ub}', current_date, 9)`);

const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0;
const ok = (l, c, extra = '') => { if (!c) fails++; console.log((c ? 'PASS: ' : 'FAIL: ') + l + (c ? '' : ' ' + extra)); };
const month = db("select to_char(current_date,'YYYY-MM')");
const dstr = (d) => `${month}-${String(d).padStart(2, '0')}`;
const st = (uid, d) => db(`select coalesce((select status from public.day_status where user_id='${uid}' and day='${dstr(d)}'),'E')`);
const ot = (uid, d) => db(`select coalesce((select hours::text from public.overtime where user_id='${uid}' and day='${dstr(d)}'),'0')`);
async function session(un, pw = PW, viewport = { width: 390, height: 800 }) {
  const ctx = await b.newContext({ viewport, acceptDownloads: true });
  const p = await ctx.newPage(); p.errs = [];
  p.on('pageerror', (e) => p.errs.push(e.message));
  await p.goto('http://localhost:4173/');
  await p.fill('#username', un); await p.fill('#password', pw); await p.click('button[type=submit]');
  return p;
}
const tryLogin = async (un, pw) => { const ctx = await b.newContext(); const p = await ctx.newPage(); await p.goto('http://localhost:4173/'); await p.fill('#username', un); await p.fill('#password', pw); await p.click('button[type=submit]');
  const r = await Promise.race([p.waitForSelector('.topbar').then(() => true), p.waitForSelector('.error:not(:empty)').then(() => false)]); await ctx.close(); return r; };
const cell = (p, uid, d) => p.locator(`td.c[data-u="${uid}"][data-d="${dstr(d)}"]`);
const dlg = (p) => p.locator('dialog[open]');
const settle = (p) => p.waitForTimeout(900);

// ================= department admin =================
let p = await session('uiadm');
await p.waitForSelector('.tgrid tbody tr');
ok('admin lands on department grid', p.url().endsWith('#/team'));
ok('grid shows exactly the 3 people of own department', (await p.locator('.tgrid tbody tr').count()) === 3);
const bodyText = await p.textContent('.tgrid');
ok('other department people are not shown', !bodyText.includes('UI User Bee') && !bodyText.includes('UI Admin B'));
ok('heading shows own department', (await p.textContent('.cal-head h2')).includes('UI Dept A'));
await p.screenshot({ path: S + '/team.png' });

// edit dialog: status + overtime
await cell(p, ID.u1, 5).click(); await p.waitForSelector('dialog[open]');
await dlg(p).locator('input[name=st][value=X]').check();
await dlg(p).locator('input[type=number]').fill('25'); await dlg(p).locator('button.primary').click();
await p.waitForFunction(() => document.querySelector('dialog[open] .error')?.textContent.length > 0);
ok('overtime 25 is rejected in the dialog', (await dlg(p).locator('.error').textContent()).includes('0 to 24'));
await dlg(p).locator('input[type=number]').fill('4'); await dlg(p).locator('input[type=text]').fill('late shift'); await dlg(p).locator('button.primary').click();
await p.waitForSelector('dialog[open]', { state: 'detached' });
ok('edit: status X saved', (await st(ID.u1, 5)) === 'X');
ok('edit: overtime 4 saved with note and entered_by admin', db(`select hours||'|'||note||'|'||(entered_by='${ID.adm}') from public.overtime where user_id='${ID.u1}' and day='${dstr(5)}'`) === '4|late shift|true');
ok('cell shows X with overtime 4', (await cell(p, ID.u1, 5).textContent()) === 'X4');

// brush mode
await p.click('.seg button:text-is("X")');
await cell(p, ID.u2, 6).click(); await cell(p, ID.u2, 7).click(); await settle(p);
ok('brush X writes two days', (await st(ID.u2, 6)) === 'X' && (await st(ID.u2, 7)) === 'X');
await p.click('.seg button:text-is("E")'); await cell(p, ID.u2, 6).click(); await settle(p);
ok('brush E clears the day (row deleted)', (await st(ID.u2, 6)) === 'E');

// holiday mode
await p.click('.seg button:text-is("Holiday")');
await p.locator(`th.dh[data-d="${dstr(5)}"]`).click(); await settle(p);
ok('holiday row stored for own department', db(`select count(*) from public.holidays where department_id='${DA}' and day='${dstr(5)}'`) === '1');
ok('X on holiday shows XH in grid', (await cell(p, ID.u1, 5).textContent()).startsWith('XH'));
ok('raw status still plain X', (await st(ID.u1, 5)) === 'X');
await p.locator(`th.dh[data-d="${dstr(5)}"]`).click(); await settle(p);
ok('holiday unmarked: row gone, XH back to X', db(`select count(*) from public.holidays where day='${dstr(5)}'`) === '0' && (await cell(p, ID.u1, 5).textContent()).startsWith('X') && !(await cell(p, ID.u1, 5).textContent()).startsWith('XH'));
await p.click('.seg button:text-is("Edit")');

// bulk fill
await p.click('button:text-is("Bulk fill")'); await p.waitForSelector('dialog[open]');
await dlg(p).locator('input[type=date]').nth(0).fill(dstr(10)); await dlg(p).locator('input[type=date]').nth(1).fill(dstr(12));
await dlg(p).locator('select').selectOption('Y'); await dlg(p).locator('button.primary').click();
await p.waitForSelector('dialog[open]', { state: 'detached' }); await p.waitForSelector('.tgrid tbody tr');
ok('bulk fill: 3 people x 3 days = 9 rows of Y', db(`select count(*) from public.day_status where status='Y' and day between '${dstr(10)}' and '${dstr(12)}' and user_id in ('${ID.adm}','${ID.u1}','${ID.u2}')`) === '9');
ok('bulk fill did not touch other department', (await st(ID.ub, 10)) === 'E');
ok('other department data untouched', db(`select status||'|'||(select hours from public.overtime where user_id='${ID.ub}' and day=current_date) from public.day_status where user_id='${ID.ub}' and day=current_date`) === 'X|9');

// export (real download, parsed back)
await p.click('.seg button:text-is("Holiday")'); await p.locator(`th.dh[data-d="${dstr(5)}"]`).click(); await settle(p); await p.click('.seg button:text-is("Edit")');
const [dl] = await Promise.all([p.waitForEvent('download'), p.click('button:text-is("Export Excel")')]);
const file = S + '/export.xlsx'; await dl.saveAs(file);
ok('download filename', dl.suggestedFilename() === `timesheet_UI_Dept_A_${month}.xlsx`, dl.suggestedFilename());
const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(file); const ws = wb.worksheets[0];
const nD = Number(db("select extract(day from (date_trunc('month',current_date)+interval '1 month - 1 day'))"));
const rowFor = (name) => { for (let r = 6; r < 12; r++) if (ws.getCell(r, 2).value === name) return r; return -1; };
const r1 = rowFor('UI User One'), r2 = rowFor('UI User Two'), ra = rowFor('UI Admin A');
ok('export has exactly the 3 department employees, none from other dept', r1 > 0 && r2 > 0 && ra > 0 && rowFor('UI User Bee') === -1);
const dayCell = (r, d) => ws.getCell(r, 4 + d).value;
ok('export: u1 day5 = XH (holiday), days 10-12 = Y', dayCell(r1, 5) === 'XH' && [10, 11, 12].every((d) => dayCell(r1, d) === 'Y'));
ok('export: u2 day7 = X, day6 = E', dayCell(r2, 7) === 'X' && dayCell(r2, 6) === 'E');
const tot = (r, k) => { const v = ws.getCell(r, 4 + nD + 1 + k).value; return typeof v === 'object' ? v.result : v; };
ok('export totals for u1: X=0 Y=3 XH=1 OT=4', tot(r1, 0) === 0 && tot(r1, 1) === 3 && tot(r1, 2) === 1 && tot(r1, 4) === 4, [0, 1, 2, 3, 4].map((k) => tot(r1, k)).join());
// compare every exported cell with the database
const rows = db(`select p.full_name, to_char(d.day,'DD')::int, coalesce(s.status,'E'), (h.day is not null) from public.profiles p cross join generate_series(date_trunc('month',current_date)::date, (date_trunc('month',current_date)+interval '1 month - 1 day')::date, '1 day') d(day) left join public.day_status s on s.user_id=p.id and s.day=d.day left join public.holidays h on h.department_id=p.department_id and h.day=d.day where p.department_id='${DA}' and p.active`).split('\n').map((l) => l.split('|'));
let mism = 0; for (const [name, day, status, hol] of rows) { const exp = status === 'E' ? 'E' : hol === 't' ? status + 'H' : status; if (dayCell(rowFor(name), Number(day)) !== exp) mism++; }
ok(`all ${rows.length} exported cells equal the database`, mism === 0, `${mism} mismatches`);

// ---- user management
await p.click('.nav a:text-is("Users")'); await p.waitForSelector('.person');
ok('users list shows own department only (3)', (await p.locator('.person').count()) === 3);
const self = p.locator('.person', { hasText: 'UI Admin A' });
ok('no delete/reset/demote buttons on own row', (await self.locator('button').allTextContents()).join('|') === 'Edit data');
await p.click('button:text-is("Add user")'); await p.waitForSelector('dialog[open]');
await dlg(p).getByLabel('Username').fill('uinew'); const tmpPw = await dlg(p).getByLabel('Temporary password').inputValue();
await dlg(p).getByLabel('Full name').fill('UI New Person'); await dlg(p).getByLabel('OPR').fill('OPR-NEW'); await dlg(p).getByLabel('Level').fill('4');
await dlg(p).locator('button.primary').click(); await p.waitForSelector('dialog[open]', { state: 'detached' });
await p.waitForSelector('.person:has-text("UI New Person")');
ok('add user: profile in own dept as plain user', db(`select role||'|'||department_id||'|'||level from public.profiles where username='uinew'`) === `user|${DA}|4`);
ok('add user: generated temp password has 10 chars', tmpPw.length === 10);
ok('new user can log in with the temp password', await tryLogin('uinew', tmpPw));
const newRow = p.locator('.person', { hasText: 'UI New Person' });
await newRow.locator('button:text-is("Edit data")').click(); await p.waitForSelector('dialog[open]');
await dlg(p).getByLabel('Level').fill('9'); await dlg(p).locator('button.primary').click(); await p.waitForSelector('dialog[open]', { state: 'detached' });
await settle(p); ok('edit data: level updated', db(`select level from public.profiles where username='uinew'`) === '9');
await newRow.locator('button:text-is("Reset password")').click(); await p.waitForSelector('dialog[open]');
await dlg(p).getByLabel('New password').fill('Reset-Pass-123'); await dlg(p).locator('button.primary').click(); await p.waitForSelector('dialog[open]', { state: 'detached' });
ok('reset password: new works, old fails', (await tryLogin('uinew', 'Reset-Pass-123')) && !(await tryLogin('uinew', tmpPw)));
await newRow.locator('button:text-is("Make admin")').click(); await p.locator('dialog[open] button.primary').click(); await settle(p);
ok('promote: role admin', db(`select role from public.profiles where username='uinew'`) === 'admin');
await p.locator('.person', { hasText: 'UI New Person' }).locator('button:text-is("Make user")').click(); await p.locator('dialog[open] button.primary').click(); await settle(p);
ok('demote: role user', db(`select role from public.profiles where username='uinew'`) === 'user');
await p.locator('.person', { hasText: 'UI New Person' }).locator('button:text-is("Delete")').click(); await p.locator('dialog[open] button.danger').click(); await settle(p);
ok('delete: inactive and cannot log in', db(`select active from public.profiles where username='uinew'`) === 'f' && !(await tryLogin('uinew', 'Reset-Pass-123')));
ok('deleted person disappears from list', (await p.locator('.person:has-text("UI New Person")').count()) === 0);
ok('admin: no page errors ' + JSON.stringify(p.errs), p.errs.length === 0);

// admin's own calendar tab still works and shows own data
await p.click('.nav a:text-is("My calendar")'); await p.waitForSelector('.day');
ok('admin own calendar: Y on days 10-12', (await p.locator('.day').nth(9).locator('.st').textContent()) === 'Y');

// ================= super admin =================
const sa = await session('uisa'); await sa.waitForSelector('.dept');
ok('super_admin lands on departments', sa.url().endsWith('#/departments'));
ok('super_admin has no calendar/team/users tabs', (await sa.locator('.nav a').allTextContents()).join('|') === 'Departments|Change password');
ok('super_admin sees both departments', (await sa.locator('.dept').count()) >= 2);
await sa.click('button:text-is("Add department")'); await sa.waitForSelector('dialog[open]');
await dlg(sa).getByLabel('Department name').fill('UI New Dept'); await dlg(sa).locator('button.primary').click(); await sa.waitForSelector('dialog[open]', { state: 'detached' });
await sa.waitForSelector('.dept:has-text("UI New Dept")');
ok('department created', db(`select count(*) from public.departments where name='UI New Dept'`) === '1');
const nd = sa.locator('.dept', { hasText: 'UI New Dept' });
await nd.locator('summary').click(); await nd.locator('button:text-is("Rename")').click(); await sa.waitForSelector('dialog[open]');
await dlg(sa).getByLabel('Department name').fill('UI Renamed Dept'); await dlg(sa).locator('button.primary').click(); await sa.waitForSelector('dialog[open]', { state: 'detached' });
await sa.waitForSelector('.dept:has-text("UI Renamed Dept")');
ok('department renamed', db(`select count(*) from public.departments where name='UI Renamed Dept'`) === '1');
const rd = sa.locator('.dept', { hasText: 'UI Renamed Dept' });
await rd.locator('button:text-is("Add admin")').click(); await sa.waitForSelector('dialog[open]');
await dlg(sa).getByLabel('Username').fill('uinewadm'); const apw = await dlg(sa).getByLabel('Temporary password').inputValue();
await dlg(sa).getByLabel('Full name').fill('UI New Admin'); await dlg(sa).getByLabel('OPR').fill('OPR-NA'); await dlg(sa).locator('button.primary').click();
await sa.waitForSelector('dialog[open]', { state: 'detached' }); await sa.waitForSelector('.dept[open] .person:has-text("UI New Admin")');
ok('admin created with role admin in that department', db(`select p.role||'|'||d.name from public.profiles p join public.departments d on d.id=p.department_id where username='uinewadm'`) === 'admin|UI Renamed Dept');
const ctx2 = await b.newContext({ viewport: { width: 390, height: 800 } }); const np = await ctx2.newPage();
await np.goto('http://localhost:4173/'); await np.fill('#username', 'uinewadm'); await np.fill('#password', apw); await np.click('button[type=submit]'); await np.waitForSelector('.tgrid');
ok('new admin logs in and lands on an (empty-but-for-self) team grid', np.url().endsWith('#/team') && (await np.locator('.tgrid tbody tr').count()) === 1);
// promote / demote across departments (open Dept A)
const da = sa.locator('.dept', { hasText: 'UI Dept A' }); if (!(await da.getAttribute('open')) !== null) await da.locator('summary').click();
await da.locator('.person', { hasText: 'UI User Two' }).locator('button:text-is("Make admin")').click(); await sa.locator('dialog[open] button.primary').click(); await settle(sa);
ok('super_admin promotes user in another department', db(`select role from public.profiles where id='${ID.u2}'`) === 'admin');
await sa.locator('.dept', { hasText: 'UI Dept A' }).locator('.person', { hasText: 'UI User Two' }).locator('button:text-is("Make user")').click(); await sa.locator('dialog[open] button.primary').click(); await settle(sa);
ok('...and demotes back', db(`select role from public.profiles where id='${ID.u2}'`) === 'user');
ok('plain users have no reset/delete buttons for super_admin', (await sa.locator('.dept', { hasText: 'UI Dept A' }).locator('.person', { hasText: 'UI User One' }).locator('button').allTextContents()).join('|') === 'Make admin');
const rr = sa.locator('.dept', { hasText: 'UI Renamed Dept' }).locator('.person', { hasText: 'UI New Admin' });
await rr.locator('button:text-is("Reset password")').click(); await sa.waitForSelector('dialog[open]'); await dlg(sa).getByLabel('New password').fill('Admin-Reset-123'); await dlg(sa).locator('button.primary').click(); await sa.waitForSelector('dialog[open]', { state: 'detached' });
ok('super_admin resets an admin password', await tryLogin('uinewadm', 'Admin-Reset-123'));
await sa.locator('.dept', { hasText: 'UI Renamed Dept' }).locator('.person', { hasText: 'UI New Admin' }).locator('button:text-is("Delete")').click(); await sa.locator('dialog[open] button.danger').click(); await settle(sa);
ok('super_admin deletes an admin', db(`select active from public.profiles where username='uinewadm'`) === 'f' && !(await tryLogin('uinewadm', 'Admin-Reset-123')));
await sa.screenshot({ path: S + '/depts.png' });
ok('super_admin: no page errors ' + JSON.stringify(sa.errs), sa.errs.length === 0);

// route guard: admin cannot open super_admin page, user cannot open team
const u = await session('uiu1'); await u.waitForSelector('.day');
await u.evaluate(() => { location.hash = '#/team'; }); await u.waitForTimeout(500);
ok('plain user typing #/team gets "not found", no grid', (await u.locator('.tgrid').count()) === 0);

cleanup();
ok('cleanup left only real data', db(`select count(*) from auth.users`) === '1');
await b.close();
console.log(fails ? `=== ${fails} FAILURES ===` : '=== ALL ADMIN UI TESTS PASSED ===');
