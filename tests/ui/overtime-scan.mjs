// Browser E2E for the overtime form scan (local OCR) preview, on the real sample scan (two pages, rotated, Arabic + English).
// The sample is a real document: it is NOT in the repository. Path: env OCR_SAMPLE (default ~/Downloads/scan_opr1021_2026-10-25-14-38-11.pdf);
// the test is skipped when it is missing. Fixtures: temporary ids 3b000000-... Needs `npx vite preview --port 4173`, TS_DB_URL, Chromium.
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
const SAMPLE = process.env.OCR_SAMPLE ?? `${homedir()}/Downloads/scan_opr1021_2026-10-25-14-38-11.pdf`;
if (!existsSync(SAMPLE)) { console.log('SKIP: sample scan not found: ' + SAMPLE); process.exit(0); }
const sql = (q) => execSync(`psql "$TS_DB_URL" -X -q -At -c "${q.replace(/"/g, '\\"')}"`, { encoding: 'utf8' }).trim();
const PW = 'Oc-Pass-12345', DA = '3b000000-0000-0000-0000-00000000000a', DB = '3b000000-0000-0000-0000-00000000000b';
const uid = (i) => `3b000000-0000-0000-0000-0000000001${String(i).padStart(2, '0')}`;
const cleanup = () => sql(`delete from auth.users where id::text ~ '^3b000000-' or id in (select id from public.profiles where department_id::text ~ '^3b000000-');
  delete from public.departments where id::text ~ '^3b000000-';
  delete from public.audit_log where (target_user is not null and target_user not in (select id from public.profiles)) or (department_id is not null and department_id not in (select id from public.departments));`);
cleanup();
sql(`insert into public.departments (id,name) values ('${DA}','OC Alpha'),('${DB}','OC Beta')`);
// payrolls are unique: the real EMC-062 exists, so the fixture person has EMC-0062 (the scan reader ignores leading zeros)
const people = [[0, 'ocadm', 'OC Admin', 'admin', DA, null], [1, 'ocu1', 'OC Person One', 'user', DA, 'EMC-0062'], [2, 'ocu2', 'OC Person Two', 'user', DA, 'EMC-0063'], [3, 'ocadm2', 'OC Admin Beta', 'admin', DB, null], [4, 'ocu4', 'OC Beta Person', 'user', DB, 'EMC-0064']];
for (const [i, un, name, role, dept, payroll] of people) sql(`
 insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change)
 values ('00000000-0000-0000-0000-000000000000','${uid(i)}','authenticated','authenticated','${un}@timesheet.local',crypt('${PW}',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',now(),now(),'','','','');
 insert into auth.identities (id,user_id,provider_id,identity_data,provider,last_sign_in_at,created_at,updated_at) values (gen_random_uuid(),'${uid(i)}','${uid(i)}','{"sub":"${uid(i)}"}','email',now(),now(),now());
 insert into public.profiles (id,username,full_name,opr,payroll,level,department_id,role) values ('${uid(i)}','${un}','${name}','OCO-${i}',${payroll ? `'${payroll}'` : 'null'},'2','${dept}','${role}');`);

const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0;
const ok = (l, c, extra = '') => { if (!c) fails++; console.log((c ? 'PASS: ' : 'FAIL: ') + l + (c ? '' : ' ' + extra)); };
async function scan(un) {
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } }); const p = await ctx.newPage(); p.errs = []; p.on('pageerror', (e) => p.errs.push(e.message));
  const requests = []; p.on('request', (r) => requests.push(r.url()));
  await p.goto('http://localhost:4173/'); await p.fill('#username', un); await p.fill('#password', PW); await p.click('button[type=submit]'); await p.waitForSelector('.topbar');
  await p.goto('http://localhost:4173/#/overtime'); await p.waitForSelector('#scan-open');
  await p.click('#scan-open'); await p.waitForSelector('dialog[open]');
  const t0 = Date.now();
  await p.locator('dialog[open] #scan-files').setInputFiles(SAMPLE);
  await p.waitForFunction(() => /rows found|could not be read/.test(document.querySelector('dialog[open] [aria-live]')?.textContent ?? ''), null, { timeout: 240000 });
  return { p, secs: (Date.now() - t0) / 1000, requests };
}

const { p, secs, requests } = await scan('ocadm');
const cards = await p.locator('.scan-page').count();
ok(`the two pages of the sample are read (2 page cards, ${secs.toFixed(0)} s)`, cards === 2, String(cards));
const info = await p.locator('.scan-page').evaluateAll((els) => els.map((e) => ({
  date: e.querySelector('input[type=date]').value, rows: [...e.querySelectorAll('tbody tr')].map((tr) => ({ payroll: tr.dataset.p, name: tr.children[2].textContent, hours: tr.querySelector('input[type=number]').value, note: tr.querySelector('.scan-note input').value, warn: tr.querySelector('.scan-warn').textContent, checked: tr.querySelector('input[type=checkbox]').checked, raw: tr.dataset.raw })),
  skipped: e.querySelector('.scan-skipped')?.textContent ?? '', thumb: [e.querySelector('img').naturalWidth, e.querySelector('img').naturalHeight] })));
console.log(JSON.stringify(info));
ok('page 1: date 23-Oct-2026 found', info[0]?.date === '2026-10-23');
ok('page 2: date 24-Oct-2026 found', info[1]?.date === '2026-10-24');
ok('each page: ONE row found from "EMC-062" (leading zeros ignored), shown with the ENGLISH name of the department person, hours 3, note "BC Cooler fan repair"', info.every((c) => c.rows.length === 1 && c.rows[0].payroll === 'EMC-0062' && c.rows[0].name === 'OC Person One' && c.rows[0].hours === '3' && /^BC Cooler fan repair$/i.test(c.rows[0].note)), JSON.stringify(info.map((c) => c.rows)));
ok('rows are ticked and carry no warnings', info.every((c) => c.rows[0].checked && c.rows[0].warn === ''));
ok('the page thumbnails are shown UPRIGHT (landscape: the scan was rotated)', info.every((c) => c.thumb[0] > c.thumb[1]), JSON.stringify(info.map((c) => c.thumb)));
const text = await p.locator('dialog[open]').textContent();
ok('no Arabic text is shown anywhere in the preview', !/[؀-ۿ]/.test(text.replace(/[؀-ۿ]/g, (m) => m).match(/[؀-ۿ]+/g)?.filter((w) => !/مسح|النماذج|الإضافي|معاينة/.test(w)).join('') ?? ''));
ok('nothing was uploaded: no request carried the file or left the app origin for OCR', requests.every((u) => u.startsWith('http://localhost:4173') || /supabase\.co/.test(u)), requests.filter((u) => !u.startsWith('http://localhost:4173') && !/supabase\.co/.test(u)).join(' '));
await p.screenshot({ path: process.env.OCR_SHOT ?? '/tmp/ocr-preview.png' });
ok('the Save button is active once pages are read', !(await p.locator('dialog[open] .dlg-actions button.primary').isDisabled()));
await p.locator('.scan-page').first().locator('input[type=number]').fill('5'); await p.locator('.scan-page').first().locator('.scan-note input').fill('edited note');
ok('rows are editable (hours / note)', (await p.locator('.scan-page').first().locator('input[type=number]').inputValue()) === '5');
ok('no page errors ' + JSON.stringify(p.errs), p.errs.length === 0);
await p.context().close();

// ---- saving: existing entries are flagged and replaced, unticked rows are left out, one atomic save per date
const ovt = (day) => sql(`select coalesce((select hours||'|'||coalesce(note,'') from public.overtime where user_id='${uid(1)}' and day='${day}'),'none')`);
sql(`insert into public.overtime (user_id, day, hours, note, entered_by) values ('${uid(1)}', '2026-10-23', 5, 'old entry', '${uid(0)}')`);
{ const { p } = await scan('ocadm');
  ok('a row whose day already has overtime shows "replaces 5 h" (page 1 only)', (await p.locator('.scan-page').nth(0).locator('.warn-chip.exist:not([hidden])').count()) === 1 && (await p.locator('.scan-page').nth(0).locator('.warn-chip.exist').textContent()).includes('replaces 5 h') && (await p.locator('.scan-page').nth(1).locator('.warn-chip.exist:not([hidden])').count()) === 0);
  await p.locator('.scan-page').nth(1).locator('input[type=checkbox]').uncheck();
  await p.locator('dialog[open] .dlg-actions button.primary').click(); await p.waitForSelector('dialog[open]', { state: 'detached', timeout: 60000 });
  const toastText = (await p.locator('.toast').allTextContents()).join('');          // read at once: a toast lives 3.5 s
  ok('Save: page 1 replaced the old entry (3 h, "BC Cooler fan repair"); the unticked page 2 was NOT saved', ovt('2026-10-23') === '3|BC Cooler fan repair' && ovt('2026-10-24') === 'none', `${ovt('2026-10-23')} / ${ovt('2026-10-24')}`);
  ok('the dialog closed and a confirmation was shown', toastText.includes('1 overtime entries saved'), toastText);
  await p.context().close(); }
// the same forms twice (two files) -> the same person / day twice: blocked, nothing saved
{ execSync(`cp "${SAMPLE}" /tmp/oc-copy.pdf`);
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } }); const p = await ctx.newPage();
  await p.goto('http://localhost:4173/'); await p.fill('#username', 'ocadm'); await p.fill('#password', PW); await p.click('button[type=submit]'); await p.waitForSelector('.topbar');
  await p.goto('http://localhost:4173/#/overtime'); await p.waitForSelector('#scan-open'); await p.click('#scan-open'); await p.waitForSelector('dialog[open]');
  await p.locator('dialog[open] #scan-files').setInputFiles([SAMPLE, '/tmp/oc-copy.pdf']);
  await p.waitForFunction(() => /rows found/.test(document.querySelector('dialog[open] [aria-live]')?.textContent ?? ''), null, { timeout: 240000 });
  ok('two files: 4 page cards', (await p.locator('.scan-page').count()) === 4);
  await p.locator('dialog[open] .dlg-actions button.primary').click(); await p.waitForFunction(() => /twice/.test(document.querySelector('dialog[open] .error')?.textContent ?? ''), null, { timeout: 30000 });
  ok('the same person on the same day twice is reported and blocks the save; nothing was written', ovt('2026-10-24') === 'none');
  await ctx.close(); }
// a whole folder
{ const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } }); const p = await ctx.newPage();
  await p.goto('http://localhost:4173/'); await p.fill('#username', 'ocadm'); await p.fill('#password', PW); await p.click('button[type=submit]'); await p.waitForSelector('.topbar');
  await p.goto('http://localhost:4173/#/overtime'); await p.waitForSelector('#scan-open'); await p.click('#scan-open'); await p.waitForSelector('dialog[open]');
  ok('the folder picker is there (select a folder)', (await p.locator('dialog[open] #scan-folder').getAttribute('webkitdirectory')) !== null);
  execSync('rm -rf /tmp/oc-folder && mkdir -p /tmp/oc-folder/sub'); execSync(`cp "${SAMPLE}" /tmp/oc-folder/a.pdf && cp /tmp/oc-copy.pdf /tmp/oc-folder/sub/b.pdf && echo x > /tmp/oc-folder/notes.txt`);
  await p.locator('dialog[open] #scan-folder').setInputFiles('/tmp/oc-folder');
  await p.waitForFunction(() => /rows found/.test(document.querySelector('dialog[open] [aria-live]')?.textContent ?? ''), null, { timeout: 240000 });
  ok('folder: every PDF inside (also in sub-folders) is read, other files ignored (2 PDFs, 4 pages)', (await p.locator('.scan-page').count()) === 4);
  await p.locator('.scan-page').nth(0).locator('button:has-text("Remove page")').click(); await p.locator('.scan-page').nth(0).locator('button:has-text("Remove page")').click();
  ok('"Remove page" drops a page card', (await p.locator('.scan-page').count()) === 2);
  await p.locator('.scan-page').nth(0).locator('input[type=number]').fill('2'); await p.locator('.scan-page').nth(0).locator('.scan-note input').fill('edited in preview');
  await p.locator('dialog[open] .dlg-actions button.primary').click(); await p.waitForSelector('dialog[open]', { state: 'detached', timeout: 60000 });
  const sv = sql(`select string_agg(to_char(day,'MM-DD')||':'||hours||':'||coalesce(note,''), ' / ' order by day) from public.overtime where user_id='${uid(1)}'`);
  ok('edits made in the preview are what is saved (2 h, "edited in preview")', /10-2[34]:2:edited in preview/.test(sv), sv);
  await ctx.close(); }

// an admin of another department: the same payroll is not in his department -> skipped, nothing shown
const other = await scan('ocadm2');
const o = await other.p.locator('.scan-page').evaluateAll((els) => els.map((e) => ({ rows: e.querySelectorAll('tbody tr').length, skipped: e.querySelector('.scan-skipped')?.textContent ?? '' })));
ok('another department: no row is created for a payroll that is not in it; the code is listed as skipped', o.length === 2 && o.every((c) => c.rows === 0 && /EMC-0?62/.test(c.skipped)), JSON.stringify(o));
await other.p.context().close();

cleanup();
await b.close();
console.log(fails ? `=== ${fails} FAILURES ===` : '=== ALL OVERTIME-SCAN TESTS PASSED ===');
process.exit(fails ? 1 : 0);
