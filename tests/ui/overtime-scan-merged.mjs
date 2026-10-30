// Browser E2E for scanning an overtime form PRINTED BY THE APP (A4 landscape, people with the same note share ONE merged work cell, a long note wraps over two lines,
// a person without an Arabic name has the English name on the form). The form is made here with src/export/overtime-form.js and Chromium's PDF printer, then read by the
// real local OCR in the scan dialog. Temporary department / users 3c000000-..., removed afterwards. Needs `npx vite preview --port 4173`, TS_DB_URL, Chromium.
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { buildForms, formsHtml } from '../../src/export/overtime-form.js';
const S = process.argv[2] ?? tmpdir();
const sql = (q) => execSync(`psql "$TS_DB_URL" -X -q -At -c "${q.replace(/"/g, '\\"')}"`, { encoding: 'utf8' }).trim();
const PW = 'Ocm-Pass-12345', DA = '3c000000-0000-0000-0000-00000000000a';
const uid = (i) => `3c000000-0000-0000-0000-0000000001${String(i).padStart(2, '0')}`;
const cleanup = () => sql(`delete from auth.users where id::text ~ '^3c000000-'; delete from public.departments where id::text ~ '^3c000000-';
  delete from public.audit_log where (target_user is not null and target_user not in (select id from public.profiles)) or (department_id is not null and department_id not in (select id from public.departments));`);
cleanup();
sql(`insert into public.departments (id,name) values ('${DA}','OCM Alpha')`);
const people = [[0, 'ocmadm', 'OCM Admin', 'admin', null, null], [1, 'ocmu1', 'OCM Merge One', 'user', 'EMC-9101', 'ميم واحد'], [2, 'ocmu2', 'OCM Merge Two', 'user', 'EMC-9102', 'ميم اثنان'], [3, 'ocmu3', 'OCM Merge Three', 'user', 'EMC-9103', 'ميم ثلاثة'],
  [4, 'ocmu4', 'OCM Single Four', 'user', 'EMC-9104', 'ميم أربعة'], [5, 'ocmu5', 'OCM Single Five', 'user', 'EMC-9105', null]];
for (const [i, un, name, role, payroll] of people) sql(`
 insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change)
 values ('00000000-0000-0000-0000-000000000000','${uid(i)}','authenticated','authenticated','${un}@timesheet.local',crypt('${PW}',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',now(),now(),'','','','');
 insert into auth.identities (id,user_id,provider_id,identity_data,provider,last_sign_in_at,created_at,updated_at) values (gen_random_uuid(),'${uid(i)}','${uid(i)}','{"sub":"${uid(i)}"}','email',now(),now(),now());
 insert into public.profiles (id,username,full_name,opr,payroll,level,department_id,role) values ('${uid(i)}','${un}','${name}','OCM-${i}',${payroll ? `'${payroll}'` : 'null'},'2','${DA}','${role}');`);

const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0;
const ok = (l, c, extra = '') => { if (!c) fails++; console.log((c ? 'PASS: ' : 'FAIL: ') + l + (c ? '' : ' ' + extra)); };

// the form, as the app prints it
const png = (f) => { const x = readFileSync(new URL('../../public/templates/' + f, import.meta.url)); return { data: 'data:image/png;base64,' + x.toString('base64') }; };
const D = '2026-10-23', NOTE = 'Pump seal replacement', LONG = 'Inspection of cooling fan bearings and lube oil system';
const ppl = people.slice(1).map(([i, un, name, role, payroll, ar]) => ({ id: 'p' + i, full_name: name, full_name_ar: ar, payroll }));
const ot = new Map([['p1', [2, NOTE]], ['p2', [3, NOTE]], ['p3', [4, NOTE]], ['p4', [1, LONG]], ['p5', [5, 'Valve overhaul']]].map(([id, [hours, note]]) => [`${id}|${D}`, { hours, note }]));
const forms = buildForms({ dept: { name: 'OCM Alpha', name_ar: 'التوربينات', sector_ar: 'الصيانة' }, people: ppl, overtime: ot, days: [D] });
ok('the generated form is ONE page with a merged cell over 3 rows', forms.length === 1 && forms[0].rows[0].span === 3);
const pg = await (await b.newContext()).newPage();
await pg.setContent(formsHtml(forms, { logos: { left: png('logo-left.png'), right: png('logo-right.png') } }), { waitUntil: 'load' }); await pg.evaluate(() => document.fonts.ready);
const PDF = `${S}/ocm-form.pdf`; await pg.pdf({ path: PDF, preferCSSPageSize: true, printBackground: true });

const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } }); const p = await ctx.newPage(); p.errs = []; p.on('pageerror', (e) => p.errs.push(e.message));
await p.goto('http://localhost:4173/'); await p.fill('#username', 'ocmadm'); await p.fill('#password', PW); await p.click('button[type=submit]'); await p.waitForSelector('.topbar');
await p.goto('http://localhost:4173/#/overtime'); await p.waitForSelector('#scan-open'); await p.click('#scan-open'); await p.waitForSelector('dialog[open]');
const t0 = Date.now();
await p.locator('dialog[open] #scan-files').setInputFiles(PDF);
await p.waitForFunction(() => /rows found|could not be read/.test(document.querySelector('dialog[open] [aria-live]')?.textContent ?? ''), null, { timeout: 240000 });
const rows = await p.locator('.scan-page tbody tr').evaluateAll((els) => els.map((tr) => ({ payroll: tr.dataset.p, g: tr.dataset.g ?? '', merged: tr.classList.contains('merged'), name: tr.children[2].textContent, hours: tr.querySelector('input[type=number]').value, note: tr.querySelector('.scan-note input').value, warn: tr.querySelector('.scan-warn').textContent })));
console.log(`(${((Date.now() - t0) / 1000).toFixed(0)} s)`, JSON.stringify(rows));
await p.screenshot({ path: `${S}/ocm-preview.png` });
ok('the 5 people of the form are found from their payroll codes, with the English names of the department', rows.length === 5 && rows.map((r) => r.payroll).join() === 'EMC-9101,EMC-9102,EMC-9103,EMC-9104,EMC-9105' && rows[0].name === 'OCM Merge One', rows.map((r) => r.payroll).join());
ok('hours are per person: 2, 3, 4, 1, 5', rows.map((r) => r.hours).join() === '2,3,4,1,5');
ok('the three people of the MERGED cell all get its note', rows.slice(0, 3).every((r) => /Pump/.test(r.note) && /seal/.test(r.note) && /replacement/.test(r.note)) && new Set(rows.slice(0, 3).map((r) => r.note)).size === 1, rows.slice(0, 3).map((r) => r.note).join(' | '));
ok('they are shown as one group (same group number, "shared note" mark); the two others are not', rows.slice(0, 3).every((r) => r.merged && r.g === rows[0].g) && !rows[3].merged && !rows[4].merged && /shared note/.test(rows[0].warn), rows.map((r) => r.g + '/' + r.merged).join());
ok('a note that wraps over two lines is read completely', /Inspection/.test(rows[3].note) && /lube/.test(rows[3].note) && /bearings/.test(rows[3].note), rows[3].note);
ok('the English NAME of a person without an Arabic name is not taken as the note', /Valve/.test(rows[4].note) && !/OCM|Single|Five/i.test(rows[4].note), rows[4].note);
ok('no "no work text" warning on any row', rows.every((r) => !/no work text/.test(r.warn)), rows.map((r) => r.warn).join(' | '));
await p.locator('.scan-page tbody tr').nth(0).locator('.scan-note input').fill('changed together');
ok('editing the note of one person of the merged cell changes it for the others, not for the single rows', (await p.locator('.scan-page tbody tr').nth(1).locator('.scan-note input').inputValue()) === 'changed together' && (await p.locator('.scan-page tbody tr').nth(2).locator('.scan-note input').inputValue()) === 'changed together' && (await p.locator('.scan-page tbody tr').nth(3).locator('.scan-note input').inputValue()) !== 'changed together');
await p.locator('dialog[open] .dlg-actions button.primary').click(); await p.waitForSelector('dialog[open]', { state: 'detached', timeout: 60000 });
const sv = sql(`select string_agg(p.payroll||':'||o.hours||':'||coalesce(o.note,''), ' / ' order by p.payroll) from public.overtime o join public.profiles p on p.id=o.user_id where o.day='${D}' and p.department_id='${DA}'`);
ok('Save writes the same note for the three people, with their own hours', /EMC-9101:2:changed together \/ EMC-9102:3:changed together \/ EMC-9103:4:changed together/.test(sv), sv);
ok('no page errors ' + JSON.stringify(p.errs), p.errs.length === 0);
cleanup(); await b.close();
console.log(fails ? `=== ${fails} FAILURES ===` : '=== ALL MERGED-SCAN TESTS PASSED ===');
process.exit(fails ? 1 : 0);
