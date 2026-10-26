// Browser E2E for the super manager (read-only, all departments) and the super admin's bulk add of departments / admins across departments.
// Fixtures: temporary ids 3d000000-... and departments named "SM ...". Needs `npx vite preview --port 4173`, TS_DB_URL, Chromium.
// The "Add super manager" dialog needs the Edge Function with migration 23 deployed.
import { chromium } from 'playwright';
import ExcelJS from 'exceljs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';
const S = tmpdir();
const sql = (q) => execSync(`psql "$TS_DB_URL" -X -q -At -c "${q.replace(/"/g, '\\"')}"`, { encoding: 'utf8' }).trim();
const PW = 'Sm-Pass-12345', DA = '3d000000-0000-0000-0000-00000000000a', DB = '3d000000-0000-0000-0000-00000000000b';
const uid = (i) => `3d000000-0000-0000-0000-0000000001${String(i).padStart(2, '0')}`;
const cleanup = () => sql(`delete from auth.users where id::text ~ '^3d000000-' or id in (select id from public.profiles where department_id in (select id from public.departments where name ~ '^SM '))
  or id in (select id from public.profiles where username in ('smnew1'));
  delete from public.departments where id::text ~ '^3d000000-' or name ~ '^SM ';
  delete from public.audit_log where (target_user is not null and target_user not in (select id from public.profiles)) or (department_id is not null and department_id not in (select id from public.departments));`);
cleanup();
sql(`insert into public.departments (id,name) values ('${DA}','SM Alpha'),('${DB}','SM Beta')`);
const mk = (i, un, name, role, dept) => sql(`
 insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change)
 values ('00000000-0000-0000-0000-000000000000','${uid(i)}','authenticated','authenticated','${un}@timesheet.local',crypt('${PW}',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',now(),now(),'','','','');
 insert into auth.identities (id,user_id,provider_id,identity_data,provider,last_sign_in_at,created_at,updated_at) values (gen_random_uuid(),'${uid(i)}','${uid(i)}','{"sub":"${uid(i)}"}','email',now(),now(),now());
 insert into public.profiles (id,username,full_name,opr,payroll,level,department_id,role) values ('${uid(i)}','${un}','${name}',${dept ? `'SMO-${i}'` : 'null'},${dept ? `'SMP-${i}'` : 'null'},'2',${dept ? `'${dept}'` : 'null'},'${role}');`);
mk(0, 'smsup', 'SM Super', 'super_admin', null); mk(1, 'smgr', 'SM Super Manager', 'super_manager', null);
mk(2, 'smuser', 'SM Person Alpha', 'user', DA); mk(3, 'smuserb', 'SM Person Beta', 'user', DB); mk(4, 'smadm', 'SM Admin Alpha', 'admin', DA);
sql(`insert into public.day_status (user_id, day, status) values ('${uid(2)}', current_date, 'X'), ('${uid(3)}', current_date, 'Y')`);

const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0;
const ok = (l, c, extra = '') => { if (!c) fails++; console.log((c ? 'PASS: ' : 'FAIL: ') + l + (c ? '' : ' ' + extra)); };
async function login(un) {
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } }); const p = await ctx.newPage(); p.errs = []; p.on('pageerror', (e) => p.errs.push(e.message));
  await p.goto('http://localhost:4173/'); await p.fill('#username', un); await p.fill('#password', PW); await p.click('button[type=submit]'); await p.waitForSelector('.topbar');
  return p;
}
const eventually = async (fn, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch { /* retry */ } await new Promise((r) => setTimeout(r, 300)); } return false; };

// ---- the super manager
{ const p = await login('smgr');
  await p.waitForSelector('.tgrid');
  const tabs = (await p.locator('nav a').allTextContents()).join('|');
  ok('super manager: only Team and Overtime tabs', /^Department\|Overtime$/.test(tabs) && !/Users|Departments|Calendar/.test(tabs), tabs);
  ok('super manager: department switcher is there', (await p.locator('.dept-switch').count()) === 1);
  const names = await p.locator('.tgrid tbody').innerText();
  ok('super manager: sees the people of a department', /SM Person (Alpha|Beta)/.test(names), names);
  ok('super manager: no bulk fill / undo / report settings', (await p.locator('button:text-is("Bulk fill")').count()) === 0 && (await p.locator('button:text-is("Report settings")').count()) === 0);
  const before = sql(`select string_agg(user_id||status, ',' order by user_id) from public.day_status where user_id::text ~ '^3d000000-'`);
  await p.locator('.tgrid td.c.today, .tgrid td.c').first().click(); await p.keyboard.press('x'); await p.waitForTimeout(1200);
  ok('super manager: clicking / typing in the grid changes nothing in the database', sql(`select string_agg(user_id||status, ',' order by user_id) from public.day_status where user_id::text ~ '^3d000000-'`) === before);
  // the other department through the switcher
  await p.click('.dept-switch'); await p.waitForSelector('dialog[open]');
  const labels = await p.locator('dialog[open] label').allTextContents();
  ok('super manager: can pick any department (both fixtures listed)', labels.some((x) => /SM Alpha/.test(x)) && labels.some((x) => /SM Beta/.test(x)), labels.join('|'));
  await p.keyboard.press('Escape');
  await p.goto('http://localhost:4173/#/overtime'); await p.waitForSelector('.ot-view .grid');
  ok('super manager: no overtime scan button', (await p.locator('#scan-open').count()) === 0);
  await p.locator('.ot-view .grid button, .ot-view .grid .day').first().click(); await p.waitForSelector('dialog[open]');
  ok('super manager: the overtime dialog is view only (no Save, inputs disabled)', (await p.locator('dialog[open] button:text-is("Save")').count()) === 0 && (await p.locator('dialog[open] input.ot-hours:not([disabled])').count()) === 0);
  ok('super manager: no page errors', p.errs.length === 0, p.errs.join('|'));
  await p.context().close(); }

// ---- the super admin: bulk departments, bulk admins across departments
{ const p = await login('smsup');
  await p.goto('http://localhost:4173/#/departments'); await p.waitForSelector('.dept');
  const dw = new ExcelJS.Workbook(); const ds = dw.addWorksheet('D'); ds.addRow(['Department']); ['SM Gamma', 'sm  alpha', 'SM Delta'].forEach((n) => ds.addRow([n]));
  await dw.xlsx.writeFile(S + '/sm-depts.xlsx');
  await p.click('button:text-is("Bulk add departments (Excel)")'); await p.waitForSelector('dialog[open]');
  // dropped on the drop zone (not picked)
  await p.evaluate((b64) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); const dt = new DataTransfer();
    dt.items.add(new File([bin], 'sm-depts.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    document.querySelector('dialog[open] .scan-drop').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, readFileSync(S + '/sm-depts.xlsx').toString('base64'));
  ok('bulk departments: a dropped file is read (3 found)', await eventually(async () => (await p.locator('dialog[open] p.muted').nth(1).textContent()).includes('3 departments')));
  await p.click('dialog[open] button:text-is("Create departments")');
  ok('bulk departments: 2 created, 1 already existing (any capitalisation / spacing)', await eventually(async () => (await p.locator('dialog[open]').textContent()).includes('Created: 2 · Already exists: 1 · Failed: 0'), 60000));
  ok('bulk departments: in the database', sql(`select count(*) from public.departments where name in ('SM Gamma','SM Delta')`) === '2' && sql(`select count(*) from public.departments where name ilike 'sm  alpha' or name ilike 'sm alpha'`) === '1');
  await p.click('dialog[open] button:text-is("Close")'); await p.waitForSelector('dialog[open]', { state: 'detached' });

  const bw = new ExcelJS.Workbook(); const bs = bw.addWorksheet('U');
  bs.addRow(['Department', 'Full name', 'OPR', 'Payroll', 'Username', 'Password', 'Level', 'Job title', 'Contract no', 'Work location', 'Position', 'Residence', 'Y allowed', 'Role']);
  bs.addRow(['SM Alpha', 'SM Bulk Admin A', 'SMOPRA', 'SMB-1']);
  bs.addRow(['sm gamma', 'SM Bulk Mgr G', 'SMOPRG', '', '', '', '', '', '', '', '', '', '', 'manager']);
  bs.addRow(['SM Delta', 'SM Bulk Admin D', '', 'SMB-3', '', '', '', '', '', '', '', '', '', 'admin']);
  bs.addRow(['Nowhere', 'SM Bad Row', '', 'SMB-4']);
  bs.addRow(['SM Beta', 'SM Plain User', '', 'SMB-5', '', '', '', '', '', '', '', '', '', 'user']);
  await bw.xlsx.writeFile(S + '/sm-admins.xlsx');
  await p.click('button:text-is("Bulk add admins and managers (Excel)")'); await p.waitForSelector('dialog[open]');
  await p.locator('#bulk-file').setInputFiles(S + '/sm-admins.xlsx');
  ok('bulk admins: the file is read (5 rows)', await eventually(async () => (await p.locator('dialog[open] p.muted').nth(1).textContent()).includes('5 users')));
  await p.click('dialog[open] button:text-is("Create people")');
  ok('bulk admins: 3 created, 2 failed (unknown department, plain user not allowed)', await eventually(async () => (await p.locator('dialog[open]').textContent()).includes('Created: 3 · Failed: 2'), 120000));
  ok('bulk admins: admin in Alpha, manager in Gamma (username = OPR), admin in Delta; roles as given', sql(`select string_agg(p.username||'/'||p.role||'/'||d.name, ',' order by p.username) from public.profiles p join public.departments d on d.id=p.department_id where p.full_name like 'SM Bulk %'`) === 'smb1/admin/SM Alpha,smb3/admin/SM Delta,smoprg/manager/SM Gamma', sql(`select string_agg(p.username||'/'||p.role, ',') from public.profiles p where p.full_name like 'SM Bulk %'`));
  ok('bulk admins: no row for the unknown department / the plain user', sql(`select count(*) from public.profiles where full_name in ('SM Bad Row','SM Plain User')`) === '0');
  ok('super admin: no page errors', p.errs.length === 0, p.errs.join('|'));
  await p.context().close(); }
cleanup();
await b.close();
console.log(fails ? `=== ${fails} FAILURES ===` : '=== ALL SUPER-MANAGER TESTS PASSED ===');
