// Browser E2E for the OFFICIAL monthly report: job title / contract number on people, department Report settings, the export
// dialog (format + month), and the downloaded workbook checked against the database. REAL Supabase project; temporary xo* users
// and "XO *" departments (ids 37000000-...), removed afterwards.
// Needs `npx vite preview --port 4173` (or BASE_URL), TS_DB_URL, Chromium. Usage: node tests/ui/export-official.mjs [dir]
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import ExcelJS from 'exceljs';
const S = process.argv[2] ?? tmpdir();
const BASE = process.env.BASE_URL ?? 'http://localhost:4173';
const sql = (q) => execSync(`psql "$TS_DB_URL" -X -q -At -c "${q.replace(/"/g, '\\"')}"`, { encoding: 'utf8' }).trim();
const PW = 'Xo-Pass-12345', DA = '37000000-0000-0000-0000-00000000000a', DB = '37000000-0000-0000-0000-00000000000b', DL = '37000000-0000-0000-0000-00000000000c';
const uid = (i) => `37000000-0000-0000-0000-0000000001${String(i).padStart(2, '0')}`;
const cleanup = () => sql(`delete from auth.users where id::text ~ '^37000000-' or id in (select id from public.profiles where department_id::text ~ '^37000000-' or department_id in (select id from public.departments where name ~ '^XO '));
  delete from public.departments where id::text ~ '^37000000-' or name ~ '^XO ';
  delete from public.audit_log where (target_user is not null and target_user not in (select id from public.profiles)) or (department_id is not null and department_id not in (select id from public.departments));`);
cleanup();
sql(`insert into public.departments (id,name) values ('${DA}','XO Alpha'),('${DB}','XO Beta'),('${DL}','XO Large')`);
const mkUsers = (rows) => sql(`insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change)
  select '00000000-0000-0000-0000-000000000000', id::uuid, 'authenticated','authenticated', un||'@timesheet.local', crypt('${PW}',gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}','{}', now(), now(), '','','','' from (values ${rows.map((r) => `('${r[0]}','${r[1]}')`).join(',')}) v(id, un);
  insert into auth.identities (id,user_id,provider_id,identity_data,provider,last_sign_in_at,created_at,updated_at) select gen_random_uuid(), id, id::text, json_build_object('sub', id), 'email', now(), now(), now() from auth.users where id in (${rows.map((r) => `'${r[0]}'`).join(',')});
  insert into public.profiles (id,username,full_name,opr,level,department_id,role,job_title,contract_no) values ${rows.map((r) => `('${r[0]}','${r[1]}','${r[2]}','${r[3]}',${r[4]},'${r[5]}','${r[6]}',${r[7] ? `'${r[7]}'` : 'null'},${r[8] ? `'${r[8]}'` : 'null'})`).join(',')};`);
mkUsers([
  [uid(0), 'xoadm', 'XO Admin', 'EMC-900', 4, DA, 'admin', 'Supervisor', '010/2019'],
  [uid(1), 'xou1', 'XO Engineer One', 'EMC-901', 3, DA, 'user', 'Engineer', '033/2019'],
  [uid(2), 'xou2', 'XO Engineer Two', 'EMC-902', 2, DA, 'user', 'Engineer', null],
  [uid(3), 'xou3', 'XO Tech Three', 'EMC-903', 1, DA, 'user', 'Technician', '7/2021'],
  [uid(4), 'xou4', 'XO No Title Four', 'EMC-904', 1, DA, 'user', null, null],
  ['37000000-0000-0000-0000-000000000201', 'xobadm', 'XO Beta Admin', 'EMC-950', 4, DB, 'admin', 'Manager', null],
]);
const M = "date_trunc('month', current_date)::date";
sql(`insert into public.day_status (user_id, day, status) values ('${uid(1)}', ${M}+0, 'X'), ('${uid(1)}', ${M}+1, 'X'), ('${uid(1)}', ${M}+2, 'Y'), ('${uid(2)}', ${M}+1, 'Y'), ('${uid(3)}', ${M}+4, 'X'), ('${uid(0)}', ${M}+4, 'Y');
  insert into public.overtime (user_id, day, hours, note) values ('${uid(1)}', ${M}+0, 2, 'inventory'), ('${uid(1)}', ${M}+2, 6, 'night shift'), ('${uid(2)}', ${M}+1, 4, null), ('${uid(0)}', ${M}+4, 3, 'audit');
  insert into public.holidays (department_id, day) values ('${DA}', ${M}+1);`);

const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0;
const ok = (l, c, extra = '') => { if (!c) fails++; console.log((c ? 'PASS: ' : 'FAIL: ') + l + (c ? '' : ' ' + extra)); };
const month = sql("select to_char(current_date,'YYYY-MM')");
const nDays = Number(sql("select extract(day from (date_trunc('month',current_date)+interval '1 month - 1 day'))"));
const eventually = async (fn, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await fn()) return true; } catch { /* retry */ } await new Promise((r) => setTimeout(r, 300)); } return false; };
const dlg = (p) => p.locator('dialog[open]');
async function login(un, w = 1280) {
  const ctx = await b.newContext({ viewport: { width: w, height: 900 }, acceptDownloads: true });
  await ctx.addInitScript(() => { try { localStorage.setItem('ts.teamView', 'month'); } catch { /* ignore */ } });
  const p = await ctx.newPage(); p.errs = []; p.on('pageerror', (e) => p.errs.push(e.message));
  await p.goto(BASE + '/'); await p.fill('#username', un); await p.fill('#password', PW); await p.click('button[type=submit]'); await p.waitForSelector('.topbar');
  return p;
}
async function doExport(p, { format, monthValue } = {}) {
  await p.click('button:text-is("Export Excel")'); await p.waitForSelector('dialog[open]');
  if (format) await dlg(p).locator('#export-format').selectOption(format);
  if (monthValue) await dlg(p).locator('input[type=month]').fill(monthValue);
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 120000 }), dlg(p).locator('button.primary').click()]);
  const file = `${S}/xo-${format ?? 'official'}-${monthValue ?? month}.xlsx`; await dl.saveAs(file);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(file);
  return { name: dl.suggestedFilename(), wb };
}
const res = (c) => (c.value && typeof c.value === 'object' && 'formula' in c.value ? (c.value.result ?? 0) : c.value);

const p = await login('xoadm');
// ---- A. job title + contract number in the Users tab
await p.goto(BASE + '/#/users'); await p.waitForSelector('.person');
await p.click('button:text-is("Add user")'); await p.waitForSelector('dialog[open]');
ok('Add user dialog has Job title and Contract no. fields', (await dlg(p).getByLabel('Job title').count()) === 1 && (await dlg(p).getByLabel('Contract no.').count()) === 1);
await dlg(p).getByLabel('Username').fill('xonew'); await dlg(p).getByLabel('Full name').fill('XO Brand New'); await dlg(p).getByLabel('OPR').fill('EMC-999');
await dlg(p).getByLabel('Job title').fill('Certified Rigger'); await dlg(p).getByLabel('Contract no.').fill('202/2024');
await dlg(p).locator('button.primary').click();
await p.waitForSelector('dialog[open]', { state: 'detached', timeout: 60000 });
ok('the new person is created WITH job title and contract number (Edge Function)', await eventually(() => sql(`select job_title||'|'||contract_no from public.profiles where username='xonew'`) === 'Certified Rigger|202/2024'));
ok('the Users list shows the job title', await eventually(async () => (await p.locator('.person', { hasText: 'XO Brand New' }).textContent()).includes('Certified Rigger')));
await p.locator('.person', { hasText: 'XO Brand New' }).locator('button:text-is("Edit data")').click(); await p.waitForSelector('dialog[open]');
ok('Edit data shows the stored values', (await dlg(p).getByLabel('Job title').inputValue()) === 'Certified Rigger' && (await dlg(p).getByLabel('Contract no.').inputValue()) === '202/2024');
await dlg(p).getByLabel('Job title').fill('Senior Rigger'); await dlg(p).getByLabel('Contract no.').fill('');
await dlg(p).locator('button.primary').click(); await p.waitForSelector('dialog[open]', { state: 'detached' });
ok('editing saves the new job title and clearing the contract number empties it', await eventually(() => sql(`select job_title||'|'||coalesce(contract_no,'NULL') from public.profiles where username='xonew'`) === 'Senior Rigger|NULL'));

// ---- B. report settings
await p.goto(BASE + '/#/team'); await p.waitForSelector('.tgrid tbody tr');
await p.click('button:text-is("Export Excel")'); await p.waitForSelector('dialog[open]');
ok('export dialog: format defaults to the Official monthly report; Simple grid is the alternative', (await dlg(p).locator('#export-format').inputValue()) === 'official' && (await dlg(p).locator('#export-format option').count()) === 2);
await dlg(p).locator('button:text-is("Report settings")').click(); await p.waitForFunction(() => document.querySelectorAll('dialog[open]').length === 2);
const rs = p.locator('dialog[open]').last();
ok('Report settings: 12 fields, with the defaults shown as placeholders', (await rs.locator('input').count()) === 12 && (await rs.getByLabel('Department title (e.g. Turbo-Machinery Dept.)').getAttribute('placeholder')) === 'XO Alpha Dept.');
await rs.getByLabel('Department title (e.g. Turbo-Machinery Dept.)').fill('Turbo-Machinery Dept.'); await rs.getByLabel('Department code').fill('19'); await rs.getByLabel('Department name as printed').fill('TURBO (MAINT.)');
await rs.getByLabel('Location').fill('IDKU Site'); await rs.getByLabel('Sign-off, left').fill('Turbo-Machinery SH/DH'); await rs.getByLabel('Sign-off, right').fill('Turbo-Machinery AGM');
await rs.locator('button.primary').click();
ok('saved settings are stored on the department (only the filled fields)', await eventually(() => { const r = JSON.parse(sql(`select report::text from public.departments where id='${DA}'`)); return r.dept_code === '19' && r.location === 'IDKU Site' && r.dept_title === 'Turbo-Machinery Dept.' && !('banner_1' in r); }));
ok('the other department is unaffected', sql(`select report::text from public.departments where name='XO Beta'`) === '{}');
await p.locator('dialog[open]').last().waitFor({ state: 'visible' });
await p.keyboard.press('Escape'); await p.waitForTimeout(300);

// ---- C. official export vs the database
const off = await doExport(p, {});
const wb = off.wb, names = wb.worksheets.map((w) => w.name);
const emps = JSON.parse(sql(`select coalesce(json_agg(json_build_object('id', id, 'name', full_name, 'opr', opr, 'title', job_title, 'contract', contract_no, 'level', level) order by full_name),'[]') from public.profiles where department_id='${DA}' and active`));
ok(`download is named for the department and month`, off.name === `timesheet_XO_Alpha_${month}.xlsx`, off.name);
ok(`sheets: ${nDays} day sheets (1..${nDays}), ${emps.length} employee sheets, then Review`, names.length === nDays + emps.length + 1 && names.slice(0, nDays).every((n, i) => n === String(i + 1)) && names[names.length - 1] === 'Review', names.slice(0, 3).join(',') + '...' + names.slice(-3).join(','));
ok('employee sheets are named "<name> <OPR>" in alphabetical order', names.slice(nDays, nDays + emps.length).every((n, i) => n === `${emps[i].name} ${emps[i].opr}`.slice(0, 31) || n.endsWith(emps[i].opr)), names.slice(nDays, nDays + emps.length).join(' | '));
const d1 = wb.getWorksheet('1');
ok('settings are applied: title line and sign-offs on a day sheet', d1.getCell('A4').value === 'Turbo-Machinery Dept. Daily Attendance Sheet' && [...Array(10)].some((_, i) => d1.getCell(9 + emps.length + 2 + i, 1).value === 'Turbo-Machinery SH/DH'));
// every cell of every day sheet equals the database
const dbRows = sql(`select p.opr, extract(day from d.day)::int, coalesce(s.status,'E'), coalesce(o.hours::text,''), coalesce(o.note,'') from public.profiles p cross join generate_series(date_trunc('month',current_date)::date, (date_trunc('month',current_date)+interval '1 month - 1 day')::date, '1 day') d(day) left join public.day_status s on s.user_id=p.id and s.day=d.day left join public.overtime o on o.user_id=p.id and o.day=d.day where p.department_id='${DA}' and p.active`).split('\n').map((l) => l.split('|'));
let mism = 0; for (const [opr, day, status, hours, note] of dbRows) {
  const ws = wb.getWorksheet(String(Number(day))); let found = false;
  for (let r = 9; r < 9 + emps.length; r++) if (ws.getCell(r, 5).value === opr) { found = true; if (ws.getCell(r, 6).value !== status || String(ws.getCell(r, 10).value ?? '') !== hours || String(ws.getCell(r, 11).value ?? '') !== note) mism++; }
  if (!found) mism++;
}
ok(`all ${dbRows.length} day-sheet rows (status, overtime hours, note) equal the database`, mism === 0, `${mism} mismatches`);
const e1 = wb.worksheets[nDays + emps.findIndex((e) => e.opr === 'EMC-901')];
ok('employee sheet: name, title, level, location, contract number, department, code, payroll', e1.getCell('C6').value === 'XO Engineer One' && e1.getCell('C7').value === 'Engineer' && e1.getCell('C8').value === 'Level 3' && e1.getCell('C9').value === 'IDKU Site' && e1.getCell('P7').value === '033/2019' && e1.getCell('P8').value === 'TURBO (MAINT.)' && e1.getCell('P5').value === '19' && e1.getCell('P9').value === 'EMC-901');
ok('employee sheet: daily values come from formulas that read the day sheets (day 1 X / 2h / "inventory")', typeof e1.getCell('B13').value === 'object' && e1.getCell('B13').value.formula.includes("'1'!") && res(e1.getCell('B13')) === 'X' && res(e1.getCell('I13')) === 2 && res(e1.getCell('J13')) === 'inventory');
const rv = wb.getWorksheet('Review'); let rvOk = true, rvMsg = '';
for (let i = 0; i < emps.length; i++) {
  const t = JSON.parse(sql(`select json_build_object('x', count(*) filter (where status='X'), 'y', count(*) filter (where status='Y'), 'ot', coalesce((select sum(hours) from public.overtime where user_id='${emps[i].id}' and day >= date_trunc('month',current_date) and day < date_trunc('month',current_date) + interval '1 month'),0)) from public.day_status where user_id='${emps[i].id}' and day >= date_trunc('month',current_date) and day < date_trunc('month',current_date) + interval '1 month'`));
  const got = [res(rv.getCell(9 + i, 6)), res(rv.getCell(9 + i, 7)), res(rv.getCell(9 + i, 8)), res(rv.getCell(9 + i, 9))];
  if (JSON.stringify(got) !== JSON.stringify([t.x, t.y, t.x + t.y, t.ot])) { rvOk = false; rvMsg += `${emps[i].name}: ${got} vs ${[t.x, t.y, t.x + t.y, t.ot]}; `; }
}
ok('review sheet: X days, Y days, total and overtime for every employee equal the database', rvOk, rvMsg);
ok('review sheet: engineer days (SUMIF by title) = 3 + 1 = 4... computed from the data', res(rv.getCell(9 + emps.length + 1, 4)) === 4, String(res(rv.getCell(9 + emps.length + 1, 4))));

// ---- D. simple format still available
const simple = await doExport(p, { format: 'simple' });
ok('Simple grid format: the original one-grid workbook (grid sheet + overtime sheet)', simple.wb.worksheets.length === 2 && simple.wb.worksheets[1].name === 'Overtime');

// ---- E. another month
const other = await doExport(p, { monthValue: '2030-02' });
ok('another month (Feb 2030, 28 days): 28 day sheets, the employees, Review; file named for that month', other.wb.worksheets.length === 28 + emps.length + 1 && other.name === 'timesheet_XO_Alpha_2030-02.xlsx' && other.wb.worksheets[27].name === '28');

// ---- F. Arabic UI, English workbook
await p.click('text=العربية'); await p.waitForSelector('.tgrid tbody tr');
await p.click('button:has-text("تصدير Excel")'); await p.waitForSelector('dialog[open]');
ok('Arabic UI: the export dialog is in Arabic', (await dlg(p).textContent()).includes('إعدادات التقرير') && (await dlg(p).textContent()).includes('التقرير الشهري الرسمي'));
await p.screenshot({ path: S + '/xo-dialog-ar.png' });
const [dla] = await Promise.all([p.waitForEvent('download', { timeout: 120000 }), dlg(p).locator('button.primary').click()]);
await dla.saveAs(S + '/xo-ar.xlsx'); const wba = new ExcelJS.Workbook(); await wba.xlsx.readFile(S + '/xo-ar.xlsx');
ok('...the workbook itself stays the English company form', wba.getWorksheet('1').getCell('A4').value === 'Turbo-Machinery Dept. Daily Attendance Sheet' && wba.getWorksheet('Review').getCell('H8').value === 'Total Days');
ok('admin: no page errors ' + JSON.stringify(p.errs), p.errs.length === 0);
await p.context().close();

// ---- G. a 40-person department: size and speed
const rows = [[uid(50), 'xoladm', 'XO Large Admin', 'EMC-1000', 4, DL, 'admin', 'Supervisor', '1/2020']];
for (let i = 1; i <= 39; i++) rows.push([`37000000-0000-0000-0000-0000000003${String(i).padStart(2, '0')}`, `xol${i}`, `XO Person ${String(i).padStart(2, '0')} Abdelrahman Mahmoud`, `EMC-${1000 + i}`, 1 + (i % 5), DL, 'user', i % 3 ? 'Technician' : 'Engineer', `${i}/2021`]);
mkUsers(rows);
sql(`insert into public.day_status (user_id, day, status) select p.id, d::date, case when (abs(hashtext(p.id::text||d::text))%3)=0 then 'X' else 'Y' end from public.profiles p, generate_series(date_trunc('month',current_date), date_trunc('month',current_date) + interval '9 days', '1 day') d where p.department_id='${DL}' and (abs(hashtext(p.id::text||d::text))%2)=0`);
const big = await login('xoladm');
await big.goto(BASE + '/#/team'); await big.waitForSelector('.tgrid tbody tr');
const t0 = Date.now(); const bigOut = await doExport(big, {}); const secs = (Date.now() - t0) / 1000;
ok(`40 employees: ${nDays + 40 + 1} sheets generated and downloaded in ${secs.toFixed(1)} s (limit 90 s)`, bigOut.wb.worksheets.length === nDays + 40 + 1 && secs < 90, `${bigOut.wb.worksheets.length} sheets, ${secs}s`);
const names2 = bigOut.wb.worksheets.map((w) => w.name);
ok('...every sheet name valid (<=31 chars, unique, no forbidden characters) despite long names', names2.every((n) => n.length <= 31 && !/[\\/?*[\]:']/.test(n)) && new Set(names2.map((n) => n.toLowerCase())).size === names2.length);
ok('...day sheets list all 40 employees', bigOut.wb.getWorksheet('3').getCell(9 + 39, 5).value?.toString().startsWith('EMC-') && !bigOut.wb.getWorksheet('3').getCell(9 + 40, 5).value);
ok('big: no page errors ' + JSON.stringify(big.errs), big.errs.length === 0);
await big.context().close();

cleanup();
ok('cleanup removed every test row (real data untouched)', sql("select count(*) from auth.users where email ~ '^xo'") === '0' && sql("select count(*) from public.departments where name ~ '^XO '") === '0');
await b.close();
console.log(fails ? `=== ${fails} FAILURES ===` : '=== ALL OFFICIAL-EXPORT UI TESTS PASSED ===');
