// Browser E2E for the OVERTIME FORM buttons (Print / Excel / PDF): in the day window and on the Overtime tab, against the REAL Supabase project.
// Same-note employees share one "work required" cell, hours stay per person, the file is A4 landscape like the sample, the day window prints what it shows (saved or not).
// Temporary otf* users / "OTF Dept" department (ids 62000000-...), removed afterwards. Needs `npx vite preview --port 4173` (or BASE_URL), TS_DB_URL, Chromium,
// pdfinfo / pdftoppm (poppler). Usage: node tests/ui/overtime-form.mjs [screenshot-dir]
import { chromium } from 'playwright';
import { execSync, execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import ExcelJS from 'exceljs';
const S = process.argv[2] ?? tmpdir();
const BASE = process.env.BASE_URL ?? 'http://localhost:4173';
const db = (q) => execSync(`psql "$TS_DB_URL" -X -q -At -c "${q.replace(/"/g, '\\"')}"`, { encoding: 'utf8' }).trim();
const PW = 'Otf-Pass-12345', DA = '62000000-0000-0000-0000-00000000000a';
const ID = { adm: '62000000-0000-0000-0000-0000000000a1', u1: '62000000-0000-0000-0000-0000000000a2', u2: '62000000-0000-0000-0000-0000000000a3', u3: '62000000-0000-0000-0000-0000000000a4', u4: '62000000-0000-0000-0000-0000000000a5', sm: '62000000-0000-0000-0000-0000000000a6' };
const mk = (id, un, role, name, payroll, nameAr = null) => db(`
 insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change)
 values ('00000000-0000-0000-0000-000000000000','${id}','authenticated','authenticated','${un}@timesheet.local',crypt('${PW}',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',now(),now(),'','','','');
 insert into auth.identities (id,user_id,provider_id,identity_data,provider,last_sign_in_at,created_at,updated_at) values (gen_random_uuid(),'${id}','${id}','{"sub":"${id}"}','email',now(),now(),now());
 insert into public.profiles (id,username,full_name,full_name_ar,opr,level,department_id,role,payroll) values ('${id}','${un}','${name}',${nameAr ? `'${nameAr}'` : 'null'},'OPR-${un}',1,${role === 'super_manager' ? 'null' : `'${DA}'`},'${role}',${payroll ? `'${payroll}'` : 'null'});`);
const cleanup = () => db(`delete from auth.users where id::text like '62000000%'; delete from public.departments where id = '${DA}';
  delete from public.audit_log where (target_user is not null and target_user not in (select id from public.profiles)) or (department_id is not null and department_id not in (select id from public.departments));`);
cleanup();
db(`insert into public.departments (id,name,name_ar,sector,sector_ar) values ('${DA}','OTF Dept','قسم الاختبار','Maintenance','قطاع الاختبار')`);
mk(ID.adm, 'otfadm', 'admin', 'OTF Admin', 'OTF-900'); mk(ID.u1, 'otfu1', 'user', 'OTF User One', 'OTF-901', 'مستخدم واحد'); mk(ID.u2, 'otfu2', 'user', 'OTF User Two', 'OTF-902', 'مستخدم اثنان');
mk(ID.u3, 'otfu3', 'user', 'OTF User Three', 'OTF-903'); mk(ID.u4, 'otfu4', 'user', 'OTF User Four', null); mk(ID.sm, 'otfsm', 'super_manager', 'OTF Super Manager', null);
const M = "date_trunc('month', current_date)::date";
db(`insert into public.overtime (user_id, day, hours, note) values ('${ID.u1}', ${M}+3, 2, 'Pump seal change'), ('${ID.u2}', ${M}+3, 3, 'pump  SEAL change'), ('${ID.u3}', ${M}+3, 4, 'Other job'), ('${ID.u4}', ${M}+3, 1, null), ('${ID.u1}', ${M}+4, 5, 'Next day job')`);

const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
// the phone tour (tested in guide.mjs) must not cover the pages of the fixture users
{ const nc = b.newContext.bind(b); b.newContext = async (o) => { const c = await nc(o); await c.addInitScript(() => { const g = Storage.prototype.getItem; Storage.prototype.getItem = function (k) { return String(k).startsWith('ts.guideSeen.') ? '1' : g.call(this, k); }; }); return c; }; }
let fails = 0;
const ok = (l, c, extra = '') => { if (!c) fails++; console.log((c ? 'PASS: ' : 'FAIL: ') + l + (c ? '' : ' ' + extra)); };
const month = db("select to_char(current_date,'YYYY-MM')");
const dstr = (d) => `${month}-${String(d).padStart(2, '0')}`;
const eventually = async (fn, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await fn()) return true; } catch { /* retry */ } await new Promise((r) => setTimeout(r, 300)); } return false; };
const cell = (pg, d) => pg.locator('.ot-day').nth(d - 1);
async function login(un, { stubPrint = false, w = 1280 } = {}) {
  const ctx = await b.newContext({ viewport: { width: w, height: 900 }, acceptDownloads: true });
  if (stubPrint) await ctx.addInitScript(() => {          // headless Chromium cannot print: catch what would go to the printer
    const real = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow').get;     // html2canvas (the PDF) needs real frames; only the print frame (srcdoc) is replaced
    Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', { get() { if (!this.srcdoc) return real.call(this); return { focus() {}, print: () => { window.__printed = (window.__printed || 0) + 1; window.__printedDoc = this.srcdoc; } }; } });
  });
  const p = await ctx.newPage(); p.errs = []; p.on('pageerror', (e) => p.errs.push(e.message)); p.on('dialog', (d) => d.dismiss().catch(() => {}));
  await p.goto(BASE + '/'); await p.fill('#username', un); await p.fill('#password', PW); await p.click('button[type=submit]'); await p.waitForSelector('.topbar');
  return p;
}
const download = async (p, click) => { const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 60000 }), click()]); const f = `${S}/${dl.suggestedFilename()}`; await dl.saveAs(f); return { f, name: dl.suggestedFilename() }; };
const viaMenu = (pg, fmt) => async () => { await pg.click('#ot-export'); await pg.click('#ot-' + fmt); };      // the tab: the download icon opens a menu with Excel and PDF
const pdfInfo = (f) => execFileSync('pdfinfo', [f]).toString();
const dark = (png) => +execFileSync('python3', ['-I', '-c', `from PIL import Image; import numpy as np; a = np.asarray(Image.open('${png}').convert('L')); print(int((a < 100).sum()))`]).toString().trim();

const p = await login('otfadm', { stubPrint: true });
await p.click('.nav a:has(.lbl:text-is("Overtime"))'); await p.waitForSelector('.ot-day');
ok('Overtime tab: ONE line of three buttons: a print icon, a download icon and Scan (icon + word)', (await p.locator('.cal-tools > .ot-form-tools > button, .cal-tools > .ot-form-tools > .ot-export > button, .cal-tools > #scan-open').evaluateAll((els) => els.map((e) => (e.getAttribute('aria-label') || '') + '/' + e.textContent.trim()))).join('|') === 'Print/|Export/|Scan overtime forms/Scan');
{ const bx = await p.locator('.cal-tools').evaluate((el) => [...el.querySelectorAll('#ot-print, #ot-export, #scan-open')].map((e) => Math.round(e.getBoundingClientRect().top)));
  ok('...all on the same line', bx.length === 3 && Math.max(...bx) - Math.min(...bx) < 4, bx.join()); }
ok('the Excel / PDF menu is closed at first; the download icon opens it with Excel, PDF and the note that the PDF is a picture', await p.locator('#ot-xlsx').isHidden() && (await (async () => { await p.click('#ot-export'); return (await p.locator('.ot-export-menu button').allTextContents()).join('|') === 'Excel|PDF' && (await p.locator('.ot-export-menu .ot-form-hint').isVisible()) && (await p.locator('#ot-export').getAttribute('aria-expanded')) === 'true'; })()));
await p.keyboard.press('Escape'); ok('Escape closes the menu', await p.locator('#ot-xlsx').isHidden());
ok('the buttons are named by the group "Overtime form"', (await p.locator('.cal-tools .ot-form-tools').getAttribute('aria-label')) === 'Overtime form');

// ---- the whole month as Excel
const x = await download(p, viaMenu(p, 'xlsx'));
ok('month Excel: file name has the department and the month', x.name === `overtime_OTF_Dept_${month}.xlsx`, x.name);
const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(x.f);
ok('month Excel: one sheet per day with overtime (4th and 5th)', wb.worksheets.length === 2 && wb.worksheets[0].name.startsWith('04-') && wb.worksheets[1].name.startsWith('05-'), wb.worksheets.map((w) => w.name).join());
const ws = wb.worksheets[0];
ok('month Excel: A4 landscape, one page per sheet, columns in the visual order of the form', ws.pageSetup.orientation === 'landscape' && ws.pageSetup.paperSize === 9 && ws.pageSetup.fitToHeight === 1 && !ws.views[0].rightToLeft);
ok('month Excel: the general-management line is "<Arabic sector> / <Arabic department>"', String(ws.getCell('A4').value).endsWith('قطاع الاختبار / قسم الاختبار'), String(ws.getCell('A4').value));
const names = [8, 9, 10, 11].map((r) => ws.getCell(r, 5).value);
ok('month Excel: the four people of the day, hours per person, payroll numbers', names.join() === 'مستخدم واحد,مستخدم اثنان,OTF User Three,OTF User Four' && [8, 9, 10, 11].map((r) => ws.getCell(r, 1).value).join() === '2,3,4,1' && ws.getCell('D8').value === 'OTF-901' && (ws.getCell('D11').value ?? '') === '', names.join());
ok('month Excel: the two people with the same note (other case, double blank) share ONE cell; the others are not merged', ws.model.merges.includes('B8:C9') && !ws.model.merges.some((m) => /^B1[01]:C1[2-9]/.test(m)) && ws.getCell('B8').value === 'Pump seal change' && ws.getCell('B10').value === 'Other job', ws.model.merges.join());
const signRow = ws.rowCount;
ok('month Excel: sign-off titles are built from the sector (left: GM) and the department (right: assistant GM)', ws.getCell(`B${signRow}`).value === 'مدير عام قطاع الاختبار' && ws.getCell(`E${signRow}`).value === 'مدير عام مساعد قسم الاختبار', String(ws.getCell(`E${signRow}`).value));
ok('month Excel: the DB date is the sheet date', String(ws.getCell('A5').value).includes(`${dstr(4).slice(8)}/${month.slice(5)}/${month.slice(0, 4)}`), String(ws.getCell('A5').value));

// ---- the whole month as PDF
const fontReq = p.waitForRequest(/noto-naskh-arabic-(regular|bold)\.woff2/, { timeout: 60000 }).then(() => true, () => false);
const pd = await download(p, viaMenu(p, 'pdf'));
const info = pdfInfo(pd.f);
ok('month PDF: file name', pd.name === `overtime_OTF_Dept_${month}.pdf`, pd.name);
ok('month PDF: 2 pages (one per day), A4 landscape', /Pages:\s+2/.test(info) && /Page size:\s+841\.\d+ x 595\.\d+ pts/.test(info), info.match(/Pages.*|Page size.*/g)?.join(' / '));
execFileSync('pdftoppm', ['-r', '60', '-png', pd.f, `${S}/otf-month`]);
ok('month PDF: the pages are not blank (text, lines and logos are drawn)', dark(`${S}/otf-month-1.png`) > 1500 && dark(`${S}/otf-month-2.png`) > 1500, `${dark(`${S}/otf-month-1.png`)} ${dark(`${S}/otf-month-2.png`)}`);
ok('month PDF: the embedded Arabic font (Noto Naskh Arabic) is fetched, so the look does not depend on the machine\'s fonts', await fontReq);
ok('month PDF: the off-screen pages are removed again', (await p.locator('div[style*="-10000px"]').count()) === 0);

// ---- the whole month: print
await p.click('#ot-print');
ok('month Print: sent to print() once, as HTML (no download)', await eventually(async () => (await p.evaluate(() => window.__printed || 0)) === 1));
const doc = await p.evaluate(() => window.__printedDoc);
ok('month Print: A4 landscape, right-to-left, 2 forms, the merged cell once', /size: A4 landscape/.test(doc) && /dir="rtl"/.test(doc) && (doc.match(/class="pg"/g) || []).length === 2 && (doc.match(/Pump seal change/g) || []).length === 1 && /rowspan="2"/.test(doc) && doc.includes('OTF Naskh') && doc.includes('/fonts/noto-naskh-arabic-bold.woff2')&& doc.includes('قطاع الاختبار / قسم الاختبار') && doc.includes('مستخدم واحد') && !doc.includes('OTF User One'));
ok('month Print: no page errors', p.errs.length === 0, p.errs.join('|'));

// ---- one day: the window has the same three buttons; it prints what it shows
await cell(p, 4).click({ modifiers: ['Shift'] }); await p.waitForSelector('dialog[open]');
await p.screenshot({ path: `${S}/otf-day-dialog.png` });
ok('day window: Print, Excel and PDF are there', (await p.locator('dialog[open] .ot-form-tools button').allTextContents()).join('|') === 'Print|Excel|PDF');
const d1 = await download(p, () => p.click('#otd-xlsx'));
ok('day Excel: file name has the day; one sheet with the 4 people', d1.name === `overtime_OTF_Dept_${dstr(4)}.xlsx`);
const w1 = new ExcelJS.Workbook(); await w1.xlsx.readFile(d1.f);
ok('day Excel: one sheet, the 4 people', w1.worksheets.length === 1 && [8, 9, 10, 11].map((r) => w1.worksheets[0].getCell(r, 5).value).join() === 'مستخدم واحد,مستخدم اثنان,OTF User Three,OTF User Four');
// not saved yet: Three gets the SAME note as One and Two -> the form shows 3 merged rows, the database stays as it was
const row = (n) => p.locator(`dialog[open] .otrow:has(strong:text-is("${n}"))`);
await row('OTF User Three').locator('.ot-note').fill('Pump seal change');
const d2 = await download(p, () => p.click('#otd-xlsx'));
const w2 = new ExcelJS.Workbook(); await w2.xlsx.readFile(d2.f);
ok('day Excel: shows what is in the window (unsaved): three people share the note', w2.worksheets[0].model.merges.includes('B8:C10'), w2.worksheets[0].model.merges.join());
ok('...and nothing was saved by exporting', db(`select note from public.overtime where user_id='${ID.u3}' and day='${dstr(4)}'`) === 'Other job');
await p.click('#otd-print');
ok('day Print: the printed HTML has ONE form (that day) with the 3-row merged cell', await eventually(async () => (await p.evaluate(() => window.__printed || 0)) === 2) && ((await p.evaluate(() => window.__printedDoc)).match(/class="pg"/g) || []).length === 1 && /rowspan="3"/.test(await p.evaluate(() => window.__printedDoc)));
const dp = await download(p, () => p.click('#otd-pdf'));
ok('day PDF: one A4 landscape page', /Pages:\s+1/.test(pdfInfo(dp.f)) && /Page size:\s+841\.\d+ x 595\.\d+ pts/.test(pdfInfo(dp.f)));
execFileSync('pdftoppm', ['-r', '80', '-png', dp.f, `${S}/otf-day`]);
// an invalid row stops the export with the usual message, nothing is downloaded
await row('OTF User Four').locator('.ot-hours').fill('99');
let got = 0; p.on('download', () => { got++; });
await p.click('#otd-xlsx');
ok('day: a row with invalid hours blocks the export with a message', await eventually(async () => (await p.locator('.toast').allTextContents()).join('').includes('whole number')) && got === 0);
await p.keyboard.press('Escape');

// ---- a month without overtime: a message, no file
await p.locator('.cal-head button').first().click(); await p.waitForSelector('.ot-day');
await p.waitForFunction(() => !document.querySelector('.cal-head')?.textContent.includes('Loading'));
await p.locator('.toast').first().waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
let got2 = 0; p.on('download', () => { got2++; });
await viaMenu(p, 'xlsx')();
ok('a month without overtime: "No overtime to put on the form", no file', await eventually(async () => (await p.locator('.toast').allTextContents()).join('').includes('No overtime to put on the form')) && got2 === 0);
await p.screenshot({ path: `${S}/otf-tab.png` });
await p.context().close();

// ---- the arabic UI and a phone
{ const ph = await login('otfadm', { w: 390 }); await ph.click('.nav a:has(.lbl:text-is("Overtime"))'); await ph.waitForSelector('.ot-day');
  const box = await ph.locator('.cal-tools').boundingBox();
  ok('phone: the toolbar stays inside the screen (wraps)', box && box.x >= 0 && box.x + box.width <= 391, JSON.stringify(box));
  await ph.goto(BASE + '/#/team'); await ph.waitForSelector('.tgrid tbody tr .nm-name');
  ok('English UI: the department grid shows the English names', (await ph.locator('.tgrid .nm-name').allTextContents()).includes('OTF User One'));
  await ph.goto(BASE + '/#/overtime'); await ph.waitForSelector('.ot-day');
  await ph.click('.topbar .lang-btn'); await ph.waitForSelector('html[lang=ar]');
  await ph.goto(BASE + '/#/team'); await ph.waitForSelector('.tgrid tbody tr .nm-name');
  { const nmA = await ph.locator('.tgrid .nm-name').allTextContents();
    ok('Arabic UI: the department grid shows the Arabic name of each employee (the English one when there is none)', nmA.includes('مستخدم واحد') && nmA.includes('مستخدم اثنان') && nmA.includes('OTF User Three') && !nmA.includes('OTF User One'), nmA.join(' | ')); }
  await ph.goto(BASE + '/#/overtime'); await ph.waitForSelector('.ot-day');
  ok('Arabic UI: the group is named "نموذج الإضافي" and the buttons are Print / Excel / PDF in Arabic', (await ph.locator('.cal-tools .ot-form-tools').getAttribute('aria-label')) === 'نموذج الإضافي' && (await ph.locator('#ot-print').getAttribute('aria-label')) === 'طباعة' && (await ph.locator('#scan-open').textContent()).includes('مسح'));
  await ph.screenshot({ path: `${S}/otf-phone-ar.png` }); await ph.context().close(); }

// ---- the read-only super manager can print and export too
{ const sm = await login('otfsm'); await sm.goto(BASE + '/#/overtime'); await sm.waitForSelector('.ot-view');
  await sm.click('.dept-switch'); await sm.waitForSelector('dialog[open]');
  await sm.locator('dialog[open] label:has-text("OTF Dept")').click(); await sm.locator('dialog[open] button.primary').click();
  await sm.waitForFunction(() => document.querySelector('.dept-switch')?.textContent.includes('OTF Dept'), null, { timeout: 20000 });
  await sm.waitForSelector('.ot-day', { timeout: 20000 });
  ok('super manager (view only): the form buttons are there, the scan button is not', (await sm.locator('#ot-xlsx').count()) === 1 && (await sm.locator('#scan-open').count()) === 0);
  const sx = await download(sm, viaMenu(sm, 'xlsx')); const sw1 = new ExcelJS.Workbook(); await sw1.xlsx.readFile(sx.f);
  ok('super manager: the month Excel has the department\'s forms', sw1.worksheets.length === 2);
  await sm.context().close(); }

// ---- the Arabic names are edited in the app: a person (Edit data) and the department / sector (Report settings)
{ const ed = await login('otfadm'); const dlgOf = () => ed.locator('dialog[open]');
  await ed.click('.nav a:has(.lbl:text-is("Users"))'); await ed.waitForSelector('.person');
  await ed.locator('.person', { hasText: 'OTF User Three' }).first().locator('button:text-is("Edit data")').click(); await ed.waitForSelector('dialog[open]');
  ok('Edit data has the field "Full name in Arabic"', (await dlgOf().getByLabel('Full name in Arabic').count()) === 1 && (await dlgOf().getByLabel('Full name in Arabic').getAttribute('dir')) === 'rtl');
  await dlgOf().getByLabel('Full name in Arabic').fill('مستخدم ثلاثة'); await dlgOf().locator('button.primary').click(); await ed.waitForSelector('dialog[open]', { state: 'detached' });
  ok('...saved in the database, the English name untouched', await eventually(() => db(`select full_name_ar||'|'||full_name from public.profiles where id='${ID.u3}'`) === 'مستخدم ثلاثة|OTF User Three'));
  await ed.click('.nav a:has(.lbl:text-is("Department"))'); await ed.waitForSelector('button:text-is("Department data")');
  await ed.locator('button:text-is("Department data")').click(); await ed.waitForSelector('dialog[open]');
  ok('Report settings: the sector box shows the value only, the Arabic department and sector boxes hold the saved values', (await dlgOf().getByLabel('Sector (printed').inputValue()) === 'Maintenance' && (await dlgOf().getByLabel('Department name in Arabic').inputValue()) === 'قسم الاختبار' && (await dlgOf().getByLabel('Sector in Arabic').inputValue()) === 'قطاع الاختبار');
  const bx = async (l) => dlgOf().getByLabel(l).first().boundingBox(), [bs, ba, bd] = [await bx('Sector (printed'), await bx('Sector in Arabic'), await dlgOf().boundingBox()];
  ok('Report settings is wide and in two columns on a desktop: the Arabic sector sits beside the English one', bd.width >= 760 && Math.abs(bs.y - ba.y) < 4 && Math.abs(bs.x - ba.x) > 200, JSON.stringify([bd.width, bs, ba]));
  ok('the signature titles are optional and show their defaults in grey: "مدير عام مساعد <department>" (right) and "مدير عام <sector>" (left)', (await dlgOf().getByLabel('Signature title on the right').inputValue()) === '' && (await dlgOf().getByLabel('Signature title on the right').getAttribute('placeholder')) === 'مدير عام مساعد قسم الاختبار' && (await dlgOf().getByLabel('Signature title on the left').getAttribute('placeholder')) === 'مدير عام قطاع الاختبار');
  await dlgOf().getByLabel('Department name in Arabic').fill('التوربينات'); await dlgOf().getByLabel('Sector in Arabic').fill('الصيانة');
  ok('the grey defaults follow what is typed', (await dlgOf().getByLabel('Signature title on the right').getAttribute('placeholder')) === 'مدير عام مساعد التوربينات' && (await dlgOf().getByLabel('Signature title on the left').getAttribute('placeholder')) === 'مدير عام الصيانة');
  await dlgOf().getByLabel('Signature title on the left').fill('توقيع مخصص'); await dlgOf().locator('button.primary').click(); await ed.waitForSelector('dialog[open]', { state: 'detached' });
  ok('...saved in the database (name_ar, sector_ar); the English sector is unchanged', await eventually(() => db(`select name_ar||'|'||sector_ar||'|'||sector from public.departments where id='${DA}'`) === 'التوربينات|الصيانة|Maintenance' && db(`select report->>'ot_sign_left' from public.departments where id='${DA}'`) === 'توقيع مخصص'));
  await ed.click('.nav a:has(.lbl:text-is("Overtime"))'); await ed.waitForSelector('.ot-day');
  const x3 = await download(ed, viaMenu(ed, 'xlsx')); const w3 = new ExcelJS.Workbook(); await w3.xlsx.readFile(x3.f); const s3 = w3.worksheets[0];
  const sr = s3.rowCount;
  ok('the next form uses them: "الصيانة / التوربينات", the given left title, the DEFAULT right title "مدير عام مساعد التوربينات", the new Arabic name', String(s3.getCell('A4').value).endsWith('الصيانة / التوربينات') && s3.getCell(`B${sr}`).value === 'توقيع مخصص' && s3.getCell(`E${sr}`).value === 'مدير عام مساعد التوربينات' && s3.getCell('E10').value === 'مستخدم ثلاثة', String(s3.getCell('A4').value));
  await ed.context().close(); }

cleanup();
await b.close();
console.log(fails ? `=== ${fails} FAILURES ===` : '=== ALL OVERTIME FORM UI TESTS PASSED ===');
process.exit(fails ? 1 : 0);
