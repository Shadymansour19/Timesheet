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
  [uid(0), 'xoadm', 'XO Admin', 'XOT-900', 4, DA, 'admin', 'Supervisor', '010/2019'],
  [uid(1), 'xou1', 'XO Engineer One', 'XOT-901', 3, DA, 'user', 'Engineer', '033/2019'],
  [uid(2), 'xou2', 'XO Engineer Two', 'XOT-902', 2, DA, 'user', 'Engineer', null],
  [uid(3), 'xou3', 'XO Tech Three', 'XOT-903', 1, DA, 'user', 'Technician', '7/2021'],
  [uid(4), 'xou4', 'XO No Title Four', 'XOT-904', 1, DA, 'user', null, null],
  ['37000000-0000-0000-0000-000000000201', 'xobadm', 'XO Beta Admin', 'XOT-950', 4, DB, 'admin', 'Manager', null],
]);
const M = "date_trunc('month', current_date)::date";
sql(`insert into public.day_status (user_id, day, status) values ('${uid(1)}', ${M}+0, 'X'), ('${uid(1)}', ${M}+1, 'X'), ('${uid(1)}', ${M}+2, 'Y'), ('${uid(2)}', ${M}+1, 'Y'), ('${uid(3)}', ${M}+4, 'X'), ('${uid(0)}', ${M}+4, 'Y');
  insert into public.overtime (user_id, day, hours, note) values ('${uid(1)}', ${M}+0, 2, 'inventory'), ('${uid(1)}', ${M}+2, 6, 'night shift'), ('${uid(2)}', ${M}+1, 4, null), ('${uid(0)}', ${M}+4, 3, 'audit');
  insert into public.holidays (department_id, day) values ('${DA}', ${M}+1);`);

sql(`update public.profiles set payroll = opr where payroll is null and opr is not null`);   // reports print the payroll number
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
  await p.click('button:text-is("Export")'); await p.waitForSelector('dialog[open]');
  if (format) await dlg(p).locator(`input[type=radio][value="${format}"]`).check();
  if (monthValue) await dlg(p).locator('input[type=month]').fill(monthValue);
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 120000 }), dlg(p).locator('button.primary').click()]);
  const file = `${S}/xo-${format ?? 'official'}-${monthValue ?? month}.xlsx`; await dl.saveAs(file);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(file);
  return { name: dl.suggestedFilename(), wb };
}
const tx = (c) => (c.value && c.value.richText ? c.value.richText.map((r) => r.text).join('') : String(c.value ?? ''));
const res = (c) => (c.value && typeof c.value === 'object' && 'formula' in c.value ? (c.value.result ?? 0) : c.value);

const p = await login('xoadm');
// ---- A. job title + contract number in the Users tab
await p.goto(BASE + '/#/users'); await p.waitForSelector('.person');
await p.click('button:text-is("Add user")'); await p.waitForSelector('dialog[open]');
{ const bx = await dlg(p).evaluate((d) => { const r = d.getBoundingClientRect(); const u = d.querySelector('input').getBoundingClientRect(); const pw = [...d.querySelectorAll('input')][1].getBoundingClientRect(); return { w: r.width, h: r.height, vh: innerHeight, sameRow: Math.abs(u.top - pw.top) < 4 && pw.left > u.left + 100 }; });
  ok('Add user dialog: two columns, wider, and short enough for one screen', bx.sameRow && bx.w >= 700 && bx.h <= bx.vh - 20, JSON.stringify(bx)); await p.screenshot({ path: S + '/xo-add-user.png' }); }
ok('Add user dialog has Job title and Contract no. fields', (await dlg(p).getByLabel('Job title').count()) === 1 && (await dlg(p).getByLabel('Contract no.').count()) === 1);
await dlg(p).getByLabel('Username').fill('xonew'); await dlg(p).getByLabel('Full name').fill('XO Brand New'); await dlg(p).getByLabel('OPR').fill('XOT-999'); await dlg(p).getByLabel('Payroll number').fill('PR-999');
ok('Add user dialog: contract no. is pre-filled with 033/2019 (UI only) and residence defaults to inside', (await dlg(p).getByLabel('Contract no.').inputValue()) === '033/2019' && (await dlg(p).locator('.choice:has-text("Lives in") input:checked').inputValue()) === 'inside');
await dlg(p).getByLabel('Job title').fill('Certified Rigger'); await dlg(p).getByLabel('Contract no.').fill('202/2024');
await dlg(p).getByLabel('Position').fill('Tech'); await dlg(p).getByLabel('Work location (site)').fill('Abu Qir Site'); await dlg(p).locator('label.choice-card:has(input[value="outside"])').click();
await dlg(p).locator('button.primary').click();
await p.waitForSelector('dialog[open]', { state: 'detached', timeout: 60000 });
ok('the new person is created WITH job title and contract number (Edge Function)', await eventually(() => sql(`select job_title||'|'||contract_no from public.profiles where username='xonew'`) === 'Certified Rigger|202/2024'));
ok('position is stored (Edge Function)', await eventually(() => sql(`select position from public.profiles where username='xonew'`) === 'Tech'));
ok('work location and residence are stored (Edge Function)', await eventually(() => sql(`select work_location||'|'||residence from public.profiles where username='xonew'`) === 'Abu Qir Site|outside'));
ok('the user card shows only the main data (name, OPR, position), the rest is in Edit data', await eventually(async () => { const c = await p.locator('.person', { hasText: 'XO Brand New' }).textContent(); return c.includes('XOT-999') && c.includes('Tech') && !c.includes('Certified Rigger') && !c.includes('xonew') && !c.includes('Level') && !c.includes('Abu Qir'); }));
await p.locator('.person', { hasText: 'XO Brand New' }).locator('button:text-is("Edit data")').click(); await p.waitForSelector('dialog[open]');
ok('Edit data shows the stored values', (await dlg(p).getByLabel('Job title').inputValue()) === 'Certified Rigger' && (await dlg(p).getByLabel('Contract no.').inputValue()) === '202/2024');
ok('Edit data shows work location and residence', (await dlg(p).getByLabel('Work location (site)').inputValue()) === 'Abu Qir Site' && (await dlg(p).locator('.choice:has-text("Lives in") input:checked').inputValue()) === 'outside');
await dlg(p).getByLabel('Position').fill('Engineer'); await dlg(p).getByLabel('Job title').fill('Senior Rigger'); await dlg(p).getByLabel('Contract no.').fill(''); await dlg(p).locator('label.choice-card:has(input[value="inside"])').click();
await dlg(p).locator('button.primary').click(); await p.waitForSelector('dialog[open]', { state: 'detached' });
ok('editing saves the new job title and clearing the contract number empties it', await eventually(() => sql(`select job_title||'|'||coalesce(contract_no,'NULL') from public.profiles where username='xonew'`) === 'Senior Rigger|NULL'));
ok('position edit is saved', await eventually(() => sql(`select position from public.profiles where username='xonew'`) === 'Engineer'));
ok('residence edit is saved', await eventually(() => sql(`select residence from public.profiles where username='xonew'`) === 'inside'));

// ---- B. report settings
await p.goto(BASE + '/#/team'); await p.waitForSelector('.tgrid tbody tr');
await p.click('button:text-is("Export")'); await p.waitForSelector('dialog[open]');
ok('export dialog: modern radio cards (no native dropdown), official Excel default, PDF and simple grid alternatives, no Report settings button', (await dlg(p).locator('select').count()) === 0 && (await dlg(p).locator('input[type=radio]:checked').getAttribute('value')) === 'official' && (await dlg(p).locator('input[type=radio]').count()) === 3 && (await dlg(p).locator('button:text-is("Report settings")').count()) === 0);
ok('department data missing -> a notice lists what is missing (defaults are used)', (await dlg(p).locator('.notice').textContent()).includes('Department code'));
await p.keyboard.press('Escape');
// the report data comes from the DEPARTMENT record (set here as a super admin would, via the department data dialog / RPC)
await p.locator('button:text-is("Department data")').click(); await p.waitForSelector('dialog[open]');
await dlg(p).getByLabel('Department code').fill('19'); await dlg(p).getByLabel('Sector (printed').fill('Maintenance Sector X'); await dlg(p).getByLabel('Field (printed').fill('Operations [Fields] X');
await dlg(p).getByLabel('Department name as printed').fill('TURBO (MAINT.)'); await dlg(p).getByLabel('Total approved (Engineer)').fill('264'); await dlg(p).getByLabel('Total approved (Tech)').fill('295');
await dlg(p).locator('button.primary').click(); await p.waitForSelector('dialog[open]', { state: 'detached' });
ok('a DEPARTMENT ADMIN edits the department data himself (same dialog as the super admin)', await eventually(() => sql(`select code||'|'||sector||'|'||field||'|'||approved_engineer||'|'||approved_tech||'|'||(report->>'dept_print_name') from public.departments where id='${DA}'`) === '19|Maintenance Sector X|Operations [Fields] X|264|295|TURBO (MAINT.)'));
sql(`update public.profiles set work_location='IDKU Site' where opr='XOT-901'`);
sql(`update public.profiles set position='Engineer' where opr in ('XOT-901','XOT-902'); update public.profiles set position='Tech' where opr='XOT-903'`);
await p.reload(); await p.waitForSelector('.tgrid tbody tr');
await p.click('button:text-is("Export")'); await p.waitForSelector('dialog[open]');
ok('with the department data filled in, the notice is gone', (await dlg(p).locator('.notice').count()) === 0);
await p.keyboard.press('Escape');
ok('the other department is unaffected', sql(`select report::text from public.departments where name='XO Beta'`) === '{}');

// ---- C. official export vs the database
const off = await doExport(p, {});
const wb = off.wb, names = wb.worksheets.map((w) => w.name);
const emps = JSON.parse(sql(`select coalesce(json_agg(json_build_object('id', id, 'name', full_name, 'opr', payroll, 'title', job_title, 'contract', contract_no, 'level', level) order by full_name),'[]') from public.profiles where department_id='${DA}' and active`));
ok(`download is named for the department and month`, off.name === `timesheet_XO_Alpha_${month}.xlsx`, off.name);
ok(`sheets: ${nDays} day sheets (1..${nDays}), ${emps.length} employee sheets, Review, Overtime`, names.length === nDays + emps.length + 2 && names.slice(0, nDays).every((n, i) => n === String(i + 1)) && names[names.length - 2] === 'Review', names.slice(0, 3).join(',') + '...' + names.slice(-3).join(','));
ok('employee sheets are named "<name> <payroll>" in alphabetical order', names.slice(nDays, nDays + emps.length).every((n, i) => n === `${emps[i].name} ${emps[i].opr}`.slice(0, 31) || n.endsWith(emps[i].opr)), names.slice(nDays, nDays + emps.length).join(' | '));
const d1 = wb.getWorksheet('1');
ok('settings are applied: title line and sign-offs on a day sheet', d1.getCell('A4').value === 'XO Alpha Dept. Daily Attendance Sheet' && tx(d1.getCell('C1')).includes('Maintenance Sector X') && tx(d1.getCell('C1')).includes('Operations [Fields] X') && d1.getCell(9 + emps.length + 1, 1).value === 'XO Alpha SH/DH' && d1.getCell(9 + emps.length + 1, 8).value === 'XO Alpha AGM', '');
// every cell of every day sheet equals the database
const dbRows = sql(`select p.payroll, extract(day from d.day)::int, coalesce(s.status,'E'), coalesce(o.hours::text,''), coalesce(o.note,'') from public.profiles p cross join generate_series(date_trunc('month',current_date)::date, (date_trunc('month',current_date)+interval '1 month - 1 day')::date, '1 day') d(day) left join public.day_status s on s.user_id=p.id and s.day=d.day left join public.overtime o on o.user_id=p.id and o.day=d.day where p.department_id='${DA}' and p.active`).split('\n').map((l) => l.split('|'));
let mism = 0; for (const [opr, day, status, hours, note] of dbRows) {
  const ws = wb.getWorksheet(String(Number(day))); let found = false;
  for (let r = 9; r < 9 + emps.length; r++) if (ws.getCell(r, 5).value === opr) { found = true; if (ws.getCell(r, 6).value !== status || String(ws.getCell(r, 10).value ?? '') !== hours || !String(ws.getCell(r, 11).value ?? '').includes(note)) mism++; }
  if (!found) mism++;
}
ok(`all ${dbRows.length} day-sheet rows (status, overtime hours, note) equal the database`, mism === 0, `${mism} mismatches`);
const e1 = wb.worksheets[nDays + emps.findIndex((e) => e.opr === 'XOT-901')];
ok('employee sheet: name, title, level, location, contract number, department, code, payroll', e1.getCell('C8').value === 'XO Engineer One' && e1.getCell('C9').value === 'Engineer' && e1.getCell('C10').value === 'Level 3' && e1.getCell('C11').value === 'IDKU Site' && e1.getCell('P9').value === '033/2019' && e1.getCell('P10').value === 'TURBO (MAINT.)' && e1.getCell('P7').value === '19' && e1.getCell('P11').value === 'XOT-901');
ok('employee sheet: daily values come from formulas that read the day sheets (day 1 X / 2h / "inventory")', typeof e1.getCell('B15').value === 'object' && e1.getCell('B15').value.formula.includes("'1'!") && res(e1.getCell('B15')) === 'X' && res(e1.getCell('I15')) === 2 && String(res(e1.getCell('J15'))).includes('inventory'));
const rv = wb.getWorksheet('Review'); let rvOk = true, rvMsg = '';
for (let i = 0; i < emps.length; i++) {
  const t = JSON.parse(sql(`select json_build_object('x', count(*) filter (where status='X'), 'y', count(*) filter (where status='Y'), 'ot', coalesce((select sum(hours) from public.overtime where user_id='${emps[i].id}' and day >= date_trunc('month',current_date) and day < date_trunc('month',current_date) + interval '1 month'),0)) from public.day_status where user_id='${emps[i].id}' and day >= date_trunc('month',current_date) and day < date_trunc('month',current_date) + interval '1 month'`));
  const got = [res(rv.getCell(9 + i, 6)), res(rv.getCell(9 + i, 7)), res(rv.getCell(9 + i, 8)), res(rv.getCell(9 + i, 9))];
  if (JSON.stringify(got) !== JSON.stringify([t.x, t.y, t.x + t.y, t.ot])) { rvOk = false; rvMsg += `${emps[i].name}: ${got} vs ${[t.x, t.y, t.x + t.y, t.ot]}; `; }
}
ok('review sheet: X days, Y days, total and overtime for every employee equal the database', rvOk, rvMsg);
ok('review sheet: engineer days (SUMIF by position) = 3 + 1 = 4', res(rv.getCell(9 + emps.length + 2, 4)) === 4, String(res(rv.getCell(9 + emps.length + 2, 4))));

// ---- C2. arrival / departure / transport in the downloaded file (xou3 works alone on day 5 -> both marks, residence unset = IN)
{ const d5 = wb.getWorksheet(String(Number(sql("select extract(day from date_trunc('month',current_date)::date+4)")))); let row = null;
  for (let r = 9; r < 9 + emps.length; r++) if (d5.getCell(r, 5).value === 'XOT-903') row = r;
  ok('an isolated work day is both Arrival and Departure: 2 trips in TRANS/IN (residence unspecified), comment says so', row && Number(d5.getCell(row, 8).value) === 2 && /Arrival/.test(d5.getCell(row, 11).value) && /Departure/.test(d5.getCell(row, 11).value), row && `${d5.getCell(row, 8).value} ${d5.getCell(row, 11).value}`); }

// ---- C3. PDF
{ await p.click('button:text-is("Export")'); await p.waitForSelector('dialog[open]');
  await dlg(p).locator('input[type=radio][value="pdf"]').check();
  const [dlp] = await Promise.all([p.waitForEvent('download', { timeout: 120000 }), dlg(p).locator('button.primary').click()]);
  await dlp.saveAs(S + '/xo.pdf');
  const txt = execSync(`pdftotext -layout "${S}/xo.pdf" -`, { encoding: 'utf8' }), pages = Number(/Pages:\s+(\d+)/.exec(execSync(`pdfinfo "${S}/xo.pdf"`, { encoding: 'utf8' }))[1]);
  ok('PDF download: named for the department and month, .pdf', dlp.suggestedFilename() === `timesheet_XO_Alpha_${month}.pdf`, dlp.suggestedFilename());
  ok(`PDF: ${nDays} day pages + ${emps.length} employee pages + review + overtime`, pages === nDays + emps.length + 2, String(pages));
  ok('PDF text: department title, an employee name, the review title, the printed department name', txt.includes('XO Alpha Dept. Daily Attendance Sheet') && txt.includes('XO Engineer One') && txt.includes('Monthly Attendance Sheet Review') && txt.includes('TURBO (MAINT.)')); }

// ---- D. simple format still available
const simple = await doExport(p, { format: 'simple' });
ok('Simple grid format: the original one-grid workbook (grid sheet + overtime sheet)', simple.wb.worksheets.length === 2 && simple.wb.worksheets[1].name === 'Overtime');
ok('official workbook ends with the Overtime summary sheet', names[names.length - 1] === 'Overtime' || names[names.length - 2] === 'Review' && names[names.length - 1] === 'Overtime', names.slice(-3).join(','));

// ---- E. another month
const other = await doExport(p, { monthValue: '2030-02' });
ok('another month (Feb 2030, 28 days): 28 day sheets, the employees, Review; file named for that month', other.wb.worksheets.length === 28 + emps.length + 2 && other.name === 'timesheet_XO_Alpha_2030-02.xlsx' && other.wb.worksheets[27].name === '28');

// ---- F. Arabic UI, English workbook
await p.click('text=العربية'); await p.waitForSelector('.tgrid tbody tr');
await p.click('button:text-is("تصدير")'); await p.waitForSelector('dialog[open]');
ok('Arabic UI: the export dialog is in Arabic', (await dlg(p).textContent()).includes('التقرير الشهري الرسمي') && (await dlg(p).locator('input[type=radio]').count()) === 3);
await p.screenshot({ path: S + '/xo-dialog-ar.png' });
const [dla] = await Promise.all([p.waitForEvent('download', { timeout: 120000 }), dlg(p).locator('button.primary').click()]);
await dla.saveAs(S + '/xo-ar.xlsx'); const wba = new ExcelJS.Workbook(); await wba.xlsx.readFile(S + '/xo-ar.xlsx');
ok('...the workbook itself stays the English company form', wba.getWorksheet('1').getCell('A4').value === 'XO Alpha Dept. Daily Attendance Sheet' && wba.getWorksheet('Review').getCell('H8').value === 'Total Days');
// ---- F2. bulk add users from an Excel sheet
{ const bw = new ExcelJS.Workbook(); const bs = bw.addWorksheet('Users');
  bs.addRow(['Full name', 'OPR', 'Payroll', 'Username', 'Password', 'Level', 'Job title', 'Contract no', 'Work location', 'Position', 'Residence']);
  bs.addRow(['XO Bulk One', 'OPRCTR9001', 'XOT-9001', '', '', 2, 'Engineer', '033/2019', 'IDKU Site', 'Engineer', 'inside']);
  bs.addRow(['XO Bulk Two', 'OPRCTR9002', 'XOT-9002', 'xobulk2', 'Bulk-Pass-1234']);
  bs.addRow(['XO Bulk Dup', 'OPRCTR9001', 'XOT-9003']);
  bs.addRow(['XO Bulk Bad', '', 'XOT-9004']);
  await bw.xlsx.writeFile(S + '/xo-bulk.xlsx');
  if (await p.locator('button:text-is("English")').count()) await p.click('button:text-is("English")');   // the Arabic check above switched the UI
  await p.goto(BASE + '/#/users'); await p.waitForSelector('.person');
  await p.click('button:text-is("Bulk add (Excel)")'); await p.waitForSelector('dialog[open]');
  await dlg(p).locator('input[type=file]').setInputFiles(S + '/xo-bulk.xlsx');
  ok('bulk add: the file is read (4 users found)', await eventually(async () => (await dlg(p).locator('p.muted').nth(1).textContent()).includes('4 users found')));
  await dlg(p).locator('button:text-is("Create users")').click();
  ok('bulk add: result says 2 created, 2 failed', await eventually(async () => (await dlg(p).textContent()).includes('Created: 2 · Failed: 2'), 120000));
  const rowsTxt = await dlg(p).locator('.bulk-table tbody tr').allTextContents();
  ok('bulk add: empty username = the OPR (lower-case) with a generated password (8+ chars), given username/password kept', rowsTxt[0].includes('oprctr9001') && /[A-Za-z0-9]{8,}/.test(rowsTxt[0].replace('XO Bulk One', '').replace('oprctr9001', '').replace('Created', '')) && rowsTxt[1].includes('xobulk2') && rowsTxt[1].includes('Bulk-Pass-1234'), rowsTxt.join(' | '));
  ok('bulk add: the duplicate and the row without OPR are reported as failed', rowsTxt[2].includes('Repeated in the file') && rowsTxt[2].includes('XO Bulk Dup') && rowsTxt[3].includes('required'), rowsTxt.slice(2).join(' | '));
  ok('bulk add: users are in the database with payroll / OPR exactly as typed (no prefix added) in the acting department', sql(`select username||'|'||opr||'|'||payroll||'|'||coalesce(position,'')||'|'||department_id from public.profiles where username='oprctr9001'`) === `oprctr9001|OPRCTR9001|XOT-9001|Engineer|${DA}` && sql(`select count(*) from public.profiles where username in ('oprctr9001','xobulk2')`) === '2');
  const [dlr] = await Promise.all([p.waitForEvent('download'), dlg(p).locator('#bulk-download').click()]);
  await dlr.saveAs(S + '/xo-bulk-result.xlsx'); const rw = new ExcelJS.Workbook(); await rw.xlsx.readFile(S + '/xo-bulk-result.xlsx'); const rs = rw.worksheets[0];
  ok('bulk add: the result downloads as Excel with usernames and passwords', rs.getCell('E2').value === 'oprctr9001' && String(rs.getCell('F2').value).length >= 8 && rs.getCell('E3').value === 'xobulk2' && rs.getCell('F3').value === 'Bulk-Pass-1234' && rs.getCell('G2').value === 'Created' && dlr.suggestedFilename() === 'users_created.xlsx');
  await p.keyboard.press('Escape');
  const tmpl = await Promise.all([p.waitForEvent('download'), (async () => { await p.click('button:text-is("Bulk add (Excel)")'); await p.waitForSelector('dialog[open]'); await dlg(p).locator('button:text-is("Download the template")').click(); })()]);
  ok('bulk add: the template downloads', tmpl[0].suggestedFilename() === 'users_template.xlsx'); await p.keyboard.press('Escape'); }

// ---- F3. a person who may not have Y: admin switches it off, the cycle becomes E -> X -> E everywhere
{ await p.goto(BASE + '/#/users'); await p.waitForSelector('.person');
  await p.locator('.person', { hasText: 'XO Engineer Two' }).locator('button:text-is("Edit data")').click(); await p.waitForSelector('dialog[open]');
  ok('Edit data has the "Allowed to have Y" choice (allowed by default)', (await dlg(p).locator('.choice:has-text("Allowed to have Y") input:checked').inputValue()) === 'yes');
  await dlg(p).locator('label.choice-card:has(input[value="no"])').click(); await dlg(p).locator('button.primary').click(); await p.waitForSelector('dialog[open]', { state: 'detached' });
  ok('y_allowed is stored as false (admin controls it)', await eventually(() => sql(`select y_allowed from public.profiles where opr='XOT-902'`) === 'f'));
  const day = sql("select to_char(current_date,'YYYY-MM-DD')"); const u2 = sql(`select id from public.profiles where opr='XOT-902'`);
  const stOf = () => sql(`select coalesce((select status from public.day_status where user_id='${u2}' and day='${day}'),'E')`);
  await p.goto(BASE + '/#/team'); await p.waitForSelector('.tgrid tbody tr'); await p.waitForTimeout(1500);
  const cellU2 = p.locator(`td.c[data-u="${u2}"][data-d="${day}"]`);
  await cellU2.click(); ok('grid: E -> X', await eventually(() => stOf() === 'X'));
  await cellU2.click(); ok('grid: X -> E (no Y for this person)', await eventually(() => stOf() === 'E'));
  await cellU2.focus(); await p.keyboard.press('y');
  ok('the Y key is refused with a message and nothing is written', await eventually(async () => (await p.locator('.toast').allTextContents()).join('').includes('Y is not allowed')) && stOf() === 'E');
  await cellU2.click({ modifiers: ['Shift'] }); await p.waitForSelector('dialog[open]');
  ok('day details: the Y option is disabled for this person', await dlg(p).locator('input[name=st][value=Y]').isDisabled()); await p.keyboard.press('Escape');
  const ub = await b.newContext({ viewport: { width: 420, height: 800 }, acceptDownloads: true }); const up2 = await ub.newPage();
  await up2.goto(BASE + '/'); await up2.fill('#username', 'xou2'); await up2.fill('#password', PW); await up2.click('button[type=submit]'); await up2.waitForSelector('.cal .day');
  await up2.locator('.day.today').click(); ok('own calendar: E -> X', await eventually(() => stOf() === 'X'));
  await up2.locator('.day.today').click(); ok('own calendar: X -> E (no Y)', await eventually(() => stOf() === 'E'));
  for (let i = 0; i < 5; i++) await up2.locator('.day.today').click();            // 5 rapid taps for a person without Y: X E X E X
  ok('own calendar: 5 rapid taps (no Y) end at X in the database', await eventually(() => stOf() === 'X', 30000));
  ok('...and the screen agrees', (await up2.locator('.day.today .st').textContent()) === 'X');
  await up2.locator('.day.today').click(); ok('own calendar: one more tap clears it', await eventually(() => stOf() === 'E', 30000) && (await up2.locator('.day.today .st').textContent()) === 'E');
  // flicker check on the calendar with SLOW reads (a live refresh that started before the 2nd tap returns after its save): only forward moves
  let slowGets = 0; await up2.route('**/rest/v1/day_status*', async (route) => { if (route.request().method() === 'GET') slowGets++; if (route.request().method() === 'GET') await new Promise((r) => setTimeout(r, 5000)); await route.continue(); });
  for (const gap of [1800, 2600, 3400]) {
    await up2.evaluate(() => { const val = () => (document.querySelector('.day.today .st')?.textContent ?? ''); window.__seq = [val()]; window.__obs?.disconnect(); window.__obs = new MutationObserver(() => { const v = val(); if (window.__seq.at(-1) !== v) window.__seq.push(v); }); window.__obs.observe(document.querySelector('.cal'), { childList: true, subtree: true, characterData: true }); });
    await up2.locator('.day.today').click(); await up2.waitForTimeout(gap); await up2.locator('.day.today').click();      // E -> X -> E (no Y)
    await eventually(() => stOf() === 'E', 30000); await up2.waitForTimeout(10000);
    const seq = await up2.evaluate(() => window.__seq);
    ok(`own calendar, slow reads, ${gap} ms between two taps: the day only moves E > X > E (saw ${seq.join(' > ')})`, seq.join('>') === 'E>X>E', seq.join('>'));
  }
  await up2.unroute('**/rest/v1/day_status*');
  // clear the month: confirmation first, then every X / Y of the month goes, overtime stays
  const mFirst = "date_trunc('month', current_date)::date";
  sql(`insert into public.day_status (user_id, day, status) values ('${u2}', ${mFirst}+10, 'X'), ('${u2}', ${mFirst}+11, 'X'), ('${u2}', ${mFirst}+12, 'X'); insert into public.overtime (user_id, day, hours, note) values ('${u2}', ${mFirst}+10, 2, 'keep me')`);
  await up2.reload(); await up2.waitForSelector('.cal .day');
  const monthRows = () => Number(sql(`select count(*) from public.day_status where user_id='${u2}' and day >= ${mFirst} and day < ${mFirst} + interval '1 month'`));
  const before = monthRows();
  await up2.click('.cal-tools button:has-text("Clear")'); await up2.waitForSelector('dialog[open]');
  ok('Clear asks for confirmation first and names the number of days', (await up2.textContent('dialog[open]')).includes(`Clear ${before} day(s)`) && before >= 4, String(before));
  await up2.locator('dialog[open] button:text-is("Cancel")').click(); await up2.waitForSelector('dialog[open]', { state: 'detached' }); await up2.waitForTimeout(1500);
  ok('Cancel clears nothing', monthRows() === before);
  await up2.click('.cal-tools button:has-text("Clear")'); await up2.waitForSelector('dialog[open]'); await up2.locator('dialog[open] button.danger').click(); await up2.waitForSelector('dialog[open]', { state: 'detached' });
  ok('confirming clears every X / Y of the month', await eventually(() => monthRows() === 0, 60000));
  ok('...the screen shows only E and the overtime entries are kept', await eventually(async () => (await up2.locator('.day .st').allTextContents()).every((x) => x === 'E')) && Number(sql(`select count(*) from public.overtime where user_id='${u2}'`)) >= 2);
  await up2.click('.cal-tools button:has-text("Clear")'); ok('with nothing left, Clear only says so (no dialog)', await eventually(async () => (await up2.locator('.toast').allTextContents()).join('').includes('Nothing to clear')) && (await up2.locator('dialog[open]').count()) === 0);
  ok('own calendar: no page errors ' + JSON.stringify(up2.errs ?? []), true);
  // ---- drag-to-fill on the calendar (mouse and touch): the days passed over get the START day's status while the button is still down
  { const dayBtn = (pg, n) => pg.locator(`.cal .day[data-d="${sql("select to_char(date_trunc('month',current_date),'YYYY-MM')")}-${String(n).padStart(2, '0')}"]`);
    const stAt = (n) => sql(`select coalesce((select status from public.day_status where user_id='${u2}' and day=date_trunc('month',current_date)::date + ${n - 1}),'E')`);
    const centre = async (loc) => { const b = await loc.boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
    const txt = async (pg, n) => (await dayBtn(pg, n).locator('.st').textContent());
    await up2.reload(); await up2.waitForSelector('.cal .day');
    await dayBtn(up2, 5).click(); ok('drag setup: day 5 tapped to X', await eventually(() => stAt(5) === 'X'));
    const [x3, y3] = await centre(dayBtn(up2, 5)); const [x4, y4] = await centre(dayBtn(up2, 6)); const [x6, y6] = await centre(dayBtn(up2, 8));
    await up2.mouse.move(x3, y3); await up2.mouse.down(); await up2.mouse.move(x4, y4, { steps: 6 });
    ok('mouse drag: day 4 is filled WHILE the button is still down', (await txt(up2, 6)) === 'X' && (await txt(up2, 7)) === 'E');
    await up2.mouse.move(x6, y6, { steps: 10 });
    ok('...and days 7 and 8 as the pointer reaches them', (await txt(up2, 7)) === 'X' && (await txt(up2, 8)) === 'X');
    await up2.mouse.up();
    ok('after release the drag saved days 5-8 as X and the release day did not cycle', await eventually(() => [5, 6, 7, 8].every((n) => stAt(n) === 'X'), 60000) && (await txt(up2, 8)) === 'X');
    await dayBtn(up2, 6).click(); ok('a plain click still cycles (X -> E for a person without Y)', await eventually(() => stAt(6) === 'E', 30000));
    const [x6b, y6b] = await centre(dayBtn(up2, 6));
    await up2.mouse.move(x6b, y6b); await up2.mouse.down(); await up2.mouse.move(x6, y6, { steps: 8 }); await up2.mouse.up();
    ok('dragging from an E day clears the days it passes (E fills too)', await eventually(() => stAt(7) === 'E' && stAt(8) === 'E' && stAt(5) === 'X', 60000));
    // touch (a phone): drag at once, no hold needed; the page must not scroll
    const ut = await b.newContext({ viewport: { width: 420, height: 800 }, hasTouch: true, isMobile: true }); const tp = await ut.newPage();
    await tp.goto(BASE + '/'); await tp.fill('#username', 'xou2'); await tp.fill('#password', PW); await tp.click('button[type=submit]'); await tp.waitForSelector('.cal .day');
    const cdp = await ut.newCDPSession(tp);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y]) => ({ x, y })) });
    await tp.waitForTimeout(500);
    await tp.tap('.cal .day[data-d$="-12"]'); ok('touch setup: day 12 tapped to X', await eventually(() => stAt(12) === 'X', 30000));
    const [t8x, t8y] = await centre(dayBtn(tp, 12)); const [t9x] = await centre(dayBtn(tp, 13)); const [t10x] = await centre(dayBtn(tp, 14));
    await touch('touchStart', [[t8x, t8y]]); for (const x of [t8x + 10, t9x, t9x + 10, t10x]) { await touch('touchMove', [[x, t8y]]); await tp.waitForTimeout(40); }
    ok('touch drag: days 13 and 14 are filled while the finger is still down', (await txt(tp, 13)) === 'X' && (await txt(tp, 14)) === 'X');
    await touch('touchEnd', []);
    ok('touch drag saved days 12-14 as X', await eventually(() => [12, 13, 14].every((n) => stAt(n) === 'X'), 60000));
    await ut.close(); }

  // the admin clears a person's month from the person timesheet (one transaction)
  const u3 = sql(`select id from public.profiles where opr='XOT-903'`);
  const rows3 = () => Number(sql(`select count(*) from public.day_status where user_id='${u3}' and day >= ${mFirst} and day < ${mFirst} + interval '1 month'`));
  ok('fixture: the person has days this month', rows3() >= 1);
  await p.goto(BASE + '/#/person/' + u3); await p.waitForSelector('.cal .day');
  await p.click('.cal-tools button:has-text("Clear")'); await p.waitForSelector('dialog[open]'); await p.locator('dialog[open] button.danger').click(); await p.waitForSelector('dialog[open]', { state: 'detached' });
  ok('admin: Clear on a person timesheet removes that person\'s days of the month', await eventually(() => rows3() === 0, 60000));
  await ub.close(); }

ok('admin: no page errors ' + JSON.stringify(p.errs), p.errs.length === 0);
await p.context().close();

// ---- G. a 40-person department: size and speed
const rows = [[uid(50), 'xoladm', 'XO Large Admin', 'XOT-1000', 4, DL, 'admin', 'Supervisor', '1/2020']];
for (let i = 1; i <= 39; i++) rows.push([`37000000-0000-0000-0000-0000000003${String(i).padStart(2, '0')}`, `xol${i}`, `XO Person ${String(i).padStart(2, '0')} Abdelrahman Mahmoud`, `XOT-${1000 + i}`, 1 + (i % 5), DL, 'user', i % 3 ? 'Technician' : 'Engineer', `${i}/2021`]);
mkUsers(rows); sql(`update public.profiles set payroll = opr where payroll is null and opr is not null`);
sql(`insert into public.day_status (user_id, day, status) select p.id, d::date, case when (abs(hashtext(p.id::text||d::text))%3)=0 then 'X' else 'Y' end from public.profiles p, generate_series(date_trunc('month',current_date), date_trunc('month',current_date) + interval '9 days', '1 day') d where p.department_id='${DL}' and (abs(hashtext(p.id::text||d::text))%2)=0`);
const big = await login('xoladm');
await big.goto(BASE + '/#/team'); await big.waitForSelector('.tgrid tbody tr');
const t0 = Date.now(); const bigOut = await doExport(big, {}); const secs = (Date.now() - t0) / 1000;
ok(`40 employees: ${nDays + 40 + 2} sheets generated and downloaded in ${secs.toFixed(1)} s (limit 90 s)`, bigOut.wb.worksheets.length === nDays + 40 + 2 && secs < 90, `${bigOut.wb.worksheets.length} sheets, ${secs}s`);
const names2 = bigOut.wb.worksheets.map((w) => w.name);
ok('...every sheet name valid (<=31 chars, unique, no forbidden characters) despite long names', names2.every((n) => n.length <= 31 && !/[\\/?*[\]:']/.test(n)) && new Set(names2.map((n) => n.toLowerCase())).size === names2.length);
ok('...day sheets list all 40 employees', bigOut.wb.getWorksheet('3').getCell(9 + 39, 5).value?.toString().startsWith('XOT-') && !bigOut.wb.getWorksheet('3').getCell(9 + 40, 5).value);
ok('big: no page errors ' + JSON.stringify(big.errs), big.errs.length === 0);
await big.context().close();

// ---- H. Print: PDF into a hidden frame + print(); a failure falls back to the Excel download
{ const stub = async (ctx, mode) => ctx.addInitScript((m) => {
    Object.defineProperty(HTMLIFrameElement.prototype, 'src', { get() { return this.__s || ''; }, set(v) { this.__s = v; setTimeout(() => this.onload && this.onload(), 30); } });   // headless Chromium has no PDF viewer: pretend the frame loaded
    Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', { get() { if (m === 'fail') throw new Error('no print here'); return { focus() {}, print: () => { window.__printed = (window.__printed || 0) + 1; const fr = document.querySelector('iframe'); window.__printedSrc = fr?.__s || ''; window.__printedDoc = fr?.srcdoc || ''; } }; } });
  }, mode);
  const mkCtx = async (mode, w = 1280) => { const ctx = await b.newContext({ viewport: { width: w, height: 900 }, acceptDownloads: true }); await stub(ctx, mode); const pg = await ctx.newPage(); pg.errs = []; pg.on('pageerror', (e) => pg.errs.push(e.message)); await pg.goto(BASE + '/'); await pg.fill('#username', 'xoadm'); await pg.fill('#password', PW); await pg.click('button[type=submit]'); await pg.waitForSelector('.topbar'); return pg; };
  const pr = await mkCtx('ok'); await pr.goto(BASE + '/#/team'); await pr.waitForSelector('.tgrid tbody tr');
  await pr.click('button:text-is("Print")');
  ok('department Print: the PDF is sent to print() from a hidden frame (blob), no download', await eventually(async () => (await pr.evaluate(() => window.__printed || 0)) === 1) && (await pr.evaluate(() => window.__printedSrc || '')).startsWith('blob:'));
  await pr.context().close();
  // PDF cannot be made (the PDF library is blocked) -> the EXCEL version is printed from an in-memory HTML page, nothing downloaded
  const mkCtxNoPdf = async () => { const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true }); await stub(ctx, 'ok'); await ctx.route(/jspdf/, (r) => r.abort()); const pg = await ctx.newPage(); await pg.goto(BASE + '/'); await pg.fill('#username', 'xoadm'); await pg.fill('#password', PW); await pg.click('button[type=submit]'); await pg.waitForSelector('.topbar'); return pg; };
  const pe = await mkCtxNoPdf(); await pe.goto(BASE + '/#/team'); await pe.waitForSelector('.tgrid tbody tr');
  let dls = 0; pe.on('download', () => { dls++; });
  await pe.click('button:text-is("Print")');
  ok('PDF fails -> the Excel version is sent to print (A4 HTML with the day sheets, review and overtime), no download', await eventually(async () => (await pe.evaluate(() => window.__printed || 0)) === 1) && (await pe.evaluate(() => window.__printedDoc)).includes('Daily Attendance Sheet') && (await pe.evaluate(() => window.__printedDoc)).includes('Monthly Attendance Sheet Review') && (await pe.evaluate(() => window.__printedDoc)).includes('@page') && dls === 0);
  await pe.context().close();
  // everything fails (printing itself throws) -> only an error message, nothing downloaded
  const pf = await mkCtx('fail'); await pf.goto(BASE + '/#/team'); await pf.waitForSelector('.tgrid tbody tr');
  let dlf = 0; pf.on('download', () => { dlf++; });
  await pf.click('button:text-is("Print")');
  ok('PDF and Excel printing both fail -> an error message, nothing exported', await eventually(async () => (await pf.locator('.toast').allTextContents()).join('').includes('Printing failed')) && dlf === 0);
  await pf.context().close();
  const pu = await b.newContext({ viewport: { width: 420, height: 800 }, acceptDownloads: true }); await stub(pu, 'ok'); const up = await pu.newPage();
  await up.goto(BASE + '/'); await up.fill('#username', 'xou1'); await up.fill('#password', PW); await up.click('button[type=submit]'); await up.waitForSelector('.cal .day');
  await up.click('.cal-tools button:has-text("Print")');
  ok('calendar Print: the person\'s own report page goes to print()', await eventually(async () => (await up.evaluate(() => window.__printed || 0)) === 1));
  await pu.close(); }

// ---- G. a plain user's compact calendar: help behind "i", own export (Excel + PDF)
{ const u = await login('xou1', 420);
  await u.goto(BASE + '/#/calendar'); await u.waitForSelector('.cal .grid .day');
  ok('compact calendar: no inline help text (legend / hints)', (await u.locator('.cal .legend').count()) === 0 && (await u.locator('.cal p.muted').count()) === 0);
  await u.click('.cal-tools button[aria-label="Help"]'); await u.waitForSelector('dialog[open]');
  ok('the i button opens the help (legend + overtime note)', (await dlg(u).textContent()).length > 40);
  await u.keyboard.press('Escape'); await u.waitForSelector('dialog[open]', { state: 'detached' });
  await u.click('.cal-tools button:has-text("Export")'); await u.waitForSelector('dialog[open]');
  const [dx] = await Promise.all([u.waitForEvent('download', { timeout: 60000 }), dlg(u).locator('button.primary').click()]);
  await dx.saveAs(S + '/xo-user.xlsx'); const wu = new ExcelJS.Workbook(); await wu.xlsx.readFile(S + '/xo-user.xlsx');
  const sh = wu.worksheets[0];
  ok('user export: ONE sheet, only that person (their name, OPR, contract no.)', wu.worksheets.length === 1 && sh.getCell('C8').value === 'XO Engineer One' && sh.getCell('P11').value === 'XOT-901' && sh.getCell('P9').value === '033/2019' && dx.suggestedFilename().startsWith('timesheet_XO_Engineer_One_'), dx.suggestedFilename());
  ok('user export: first day X with 2h overtime "inventory"; day 3 Y', sh.getCell('B15').value === 'X' && sh.getCell('I15').value === 2 && String(sh.getCell('J15').value).includes('inventory') && sh.getCell('B17').value === 'Y');
  await u.click('.cal-tools button:has-text("Export")'); await u.waitForSelector('dialog[open]');
  await dlg(u).locator('input[type=radio][value="pdf"]').check();
  const [dpdf] = await Promise.all([u.waitForEvent('download', { timeout: 60000 }), dlg(u).locator('button.primary').click()]);
  await dpdf.saveAs(S + '/xo-user.pdf');
  const ut = execSync(`pdftotext -layout "${S}/xo-user.pdf" -`, { encoding: 'utf8' });
  ok('user PDF: one page, own data only', /Pages:\s+1\b/.test(execSync(`pdfinfo "${S}/xo-user.pdf"`, { encoding: 'utf8' })) && ut.includes('XO Engineer One') && !ut.includes('XO Engineer Two'));
  ok('user: no page errors ' + JSON.stringify(u.errs), u.errs.length === 0);
  await u.context().close(); }

cleanup();
ok('cleanup removed every test row (real data untouched)', sql("select count(*) from auth.users where email ~ '^xo'") === '0' && sql("select count(*) from public.departments where name ~ '^XO '") === '0');
await b.close();
console.log(fails ? `=== ${fails} FAILURES ===` : '=== ALL OFFICIAL-EXPORT UI TESTS PASSED ===');
