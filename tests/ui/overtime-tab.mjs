// Browser E2E for the admin Overtime tab (+ Cancel on change password) against the REAL Supabase project.
// Temporary ot* users / "OT *" departments (ids 60000000-...), removed afterwards. Needs `npx vite preview --port 4173`, TS_DB_URL, Chromium.
// Usage: node tests/ui/overtime-tab.mjs [screenshot-dir]
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
const S = process.argv[2] ?? tmpdir();
const db = (q) => execSync(`psql "$TS_DB_URL" -X -q -At -c "${q.replace(/"/g, '\\"')}"`, { encoding: 'utf8' }).trim();
const PW = 'Ot-Pass-12345', DA = '60000000-0000-0000-0000-00000000000a', DB = '60000000-0000-0000-0000-00000000000b';
const ID = { adm: '60000000-0000-0000-0000-0000000000a1', u1: '60000000-0000-0000-0000-0000000000a2', u2: '60000000-0000-0000-0000-0000000000a3', u3: '60000000-0000-0000-0000-0000000000a4', b: '60000000-0000-0000-0000-0000000000b1', sa: '60000000-0000-0000-0000-0000000000a0' };
const mk = (id, un, role, dept, name) => { const sa = role === 'super_admin'; return db(`
 insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change)
 values ('00000000-0000-0000-0000-000000000000','${id}','authenticated','authenticated','${un}@timesheet.local',crypt('${PW}',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',now(),now(),'','','','');
 insert into auth.identities (id,user_id,provider_id,identity_data,provider,last_sign_in_at,created_at,updated_at) values (gen_random_uuid(),'${id}','${id}','{"sub":"${id}"}','email',now(),now(),now());
 insert into public.profiles (id,username,full_name,opr,level,department_id,role) values ('${id}','${un}','${name}',${sa ? 'null' : `'OPR-${un}'`},1,${sa ? 'null' : `'${dept}'`},'${role}');`); };
const cleanup = () => db(`delete from auth.users where id::text like '60000000%'; delete from public.departments where id in ('${DA}','${DB}');
  delete from public.audit_log where (target_user is not null and target_user not in (select id from public.profiles)) or (department_id is not null and department_id not in (select id from public.departments));`);
cleanup();
db(`insert into public.departments (id,name) values ('${DA}','OT Dept A'),('${DB}','OT Dept B')`);
mk(ID.sa, 'otsa', 'super_admin', null, 'OT Super'); mk(ID.adm, 'otadm', 'admin', DA, 'OT Admin');
mk(ID.u1, 'otu1', 'user', DA, 'OT User One'); mk(ID.u2, 'otu2', 'user', DA, 'OT User Two'); mk(ID.u3, 'otu3', 'user', DA, 'OT User Three'); mk(ID.b, 'otb', 'user', DB, 'OT Other Dept');
const M = "date_trunc('month', current_date)::date";
db(`insert into public.overtime (user_id, day, hours, note) values ('${ID.u1}', ${M}+3, 2, null), ('${ID.u2}', ${M}+3, 5, 'fixture note'), ('${ID.u1}', ${M}+9, 1, null), ('${ID.b}', ${M}+3, 9, 'other dept')`);

const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0;
const ok = (l, c, extra = '') => { if (!c) fails++; console.log((c ? 'PASS: ' : 'FAIL: ') + l + (c ? '' : ' ' + extra)); };
const month = db("select to_char(current_date,'YYYY-MM')");
const dstr = (d) => `${month}-${String(d).padStart(2, '0')}`;
const ot = (uid, d) => db(`select coalesce((select hours||'|'||coalesce(note,'') from public.overtime where user_id='${uid}' and day='${dstr(d)}'),'none')`);
const newPage = async (un, w = 390) => { const c = await b.newContext({ viewport: { width: w, height: 800 } }); const pg = await c.newPage(); pg.errs = []; pg.on('pageerror', (e) => pg.errs.push(e.message)); await pg.goto('http://localhost:4173/'); await pg.fill('#username', un); await pg.fill('#password', PW); await pg.click('button[type=submit]'); await pg.waitForSelector('.topbar'); return pg; };
const cell = (pg, d) => pg.locator('.ot-day').nth(d - 1);
const rowOf = (name) => p.locator(`dialog[open] .otrow:has(strong:text-is("${name}"))`);
const dlgErr = async () => { await p.waitForFunction(() => document.querySelector('dialog[open] .error')?.textContent.length > 0); return p.locator('dialog[open] .error').textContent(); };

const p = await newPage('otadm');
ok('admin tabs: Department | Overtime | Users | My calendar', (await p.locator('.nav a').allTextContents()).join('|') === 'Department|Overtime|Users|My calendar');
await p.click('.nav a:has(.lbl:text-is("Overtime"))'); await p.waitForSelector('.ot-day');
ok('month grid has one cell per day', (await p.locator('.ot-day').count()) === Number(db("select extract(day from (date_trunc('month',current_date)+interval '1 month - 1 day'))")));
ok('day 4 shows the department total 7h (2+5) from 2 people, not the other department', (await cell(p, 4).locator('.st').textContent()) === '7h' && (await cell(p, 4).locator('.ot').textContent()) === '2 people');
ok('day 10 shows 1h / 1 people; empty day shows a dash and no strip', (await cell(p, 10).locator('.st').textContent()) === '1h' && (await cell(p, 5).locator('.st').textContent()) === '–' && (await cell(p, 5).locator('.ot').count()) === 0);
ok('overtime days are tinted amber (distinct from empty days)', (await cell(p, 4).evaluate((e) => getComputedStyle(e).backgroundColor)) !== (await cell(p, 5).evaluate((e) => getComputedStyle(e).backgroundColor)));
ok('totals: 8h, 2 days, 2 people', (await p.locator('.totals').textContent()).replace(/\s+/g, ' ').includes('Total: 8h') && (await p.locator('.totals .chip').nth(1).textContent()) === '2 days' && (await p.locator('.totals .chip').nth(2).textContent()) === '2 people');
await p.screenshot({ path: S + '/ot-grid.png' });

// ---- open a day: everybody listed, prefilled
await cell(p, 4).click({ modifiers: ['Shift'] }); await p.waitForSelector('dialog[open]');
ok('dialog lists all 4 people of the department (admin + 3 users), nobody from another department', (await p.locator('dialog[open] .otrow').count()) === 4 && (await p.locator('dialog[open] .otrow strong:text-is("OT Other Dept")').count()) === 0);
ok('existing overtime is prefilled (u1=2, u2=5 + note)', (await rowOf('OT User One').locator('.ot-hours').inputValue()) === '2' && (await rowOf('OT User Two').locator('.ot-hours').inputValue()) === '5' && (await rowOf('OT User Two').locator('.ot-note').inputValue()) === 'fixture note');
ok('note field is hidden until a person has hours', (await rowOf('OT User Three').locator('.ot-note').isHidden()) && (await rowOf('OT User Two').locator('.ot-note').isVisible()));
ok('live total in the dialog = 7h · 2 people', (await p.locator('dialog[open] .ot-total').textContent()).includes('7h · 2 people'));
ok('search box is not auto-focused (keeps the phone keyboard closed)', !(await p.locator('dialog[open] .ot-search').evaluate((e) => e === document.activeElement)));
const sb = await p.locator('dialog[open] button.primary').boundingBox();
ok('Save/Cancel are visible without scrolling on a phone-sized screen', sb && sb.y + sb.height <= 800 && sb.y >= 0, JSON.stringify(sb));
await p.screenshot({ path: S + '/ot-dialog.png' });

// ---- invalid input blocks saving; nothing is written
await rowOf('OT User Three').locator('.ot-hours').fill('25');
ok('25 marks the row invalid', await rowOf('OT User Three').evaluate((e) => e.classList.contains('invalid')));
await p.locator('dialog[open] button.primary').click();
ok('save is refused with a clear message', (await dlgErr()).includes('whole number'));
ok('...and nothing was written', (await ot(ID.u3, 4)) === 'none' && (await ot(ID.u1, 4)) === '2|');
await rowOf('OT User Three').locator('.ot-hours').fill('1.5');
await p.locator('dialog[open] button.primary').click();
ok('a fraction (1.5) is refused too', (await rowOf('OT User Three').evaluate((e) => e.classList.contains('invalid'))) && (await ot(ID.u3, 4)) === 'none');

// ---- filter
await rowOf('OT User Three').locator('.ot-hours').fill('');
await p.locator('dialog[open] .ot-search').fill('otu3');
ok('search narrows the list to the matching person (by username/OPR/name)', (await p.locator('dialog[open] .otrow:not([hidden])').count()) === 1);
await p.locator('dialog[open] .ot-search').press('Enter');
ok('Enter in the search box does not submit/close the dialog', (await p.locator('dialog[open]').count()) === 1);
await p.locator('dialog[open] .ot-search').fill('');
await p.locator('dialog[open] label.check input').check();
ok('"only with overtime" shows just the 2 people with hours', (await p.locator('dialog[open] .otrow:not([hidden])').count()) === 2);
await p.locator('dialog[open] label.check input').uncheck();

// ---- a no-op save just closes
await p.locator('dialog[open] button.primary').click(); await p.waitForSelector('dialog[open]', { state: 'detached' });
ok('saving without changes closes quietly and writes nothing', (await ot(ID.u1, 4)) === '2|' && (await ot(ID.u2, 4)) === '5|fixture note');

// ---- real edit: different hours and notes for several people, one removal
await cell(p, 4).click({ modifiers: ['Shift'] }); await p.waitForSelector('dialog[open]');
await rowOf('OT User One').locator('.ot-hours').fill('3'); await rowOf('OT User One').locator('.ot-note').fill('night shift');
await rowOf('OT User Three').locator('.ot-hours').fill('4');
ok('note box appears as soon as hours are entered', await rowOf('OT User Three').locator('.ot-note').isVisible());
await rowOf('OT User Three').locator('.ot-note').fill('audit');
await rowOf('OT Admin').locator('.ot-hours').fill('1'); await rowOf('OT Admin').locator('.ot-note').fill('on call');
await rowOf('OT User Two').locator('.ot-hours').fill('0');
ok('live total updates to 8h · 3 people', (await p.locator('dialog[open] .ot-total').textContent()).includes('8h · 3 people'));
await p.locator('dialog[open] button.primary').click(); await p.waitForSelector('dialog[open]', { state: 'detached' });
ok('u1: 3h + note', (await ot(ID.u1, 4)) === '3|night shift');
ok('u3: 4h + note (added)', (await ot(ID.u3, 4)) === '4|audit');
ok('admin himself: 1h + note', (await ot(ID.adm, 4)) === '1|on call');
ok('u2: set to 0 removes the row', (await ot(ID.u2, 4)) === 'none');
ok('other department untouched (9h, its note)', (await ot(ID.b, 4)) === '9|other dept');
ok('entered_by is the admin for every row and audit has him as actor', db(`select bool_and(entered_by='${ID.adm}') from public.overtime where day='${dstr(4)}' and user_id <> '${ID.b}'`) === 't' && db(`select count(*) from public.audit_log where actor='${ID.adm}' and table_name='overtime' and day='${dstr(4)}'`) === '4');
ok('grid cell updated at once: 8h from 3 people', (await cell(p, 4).locator('.st').textContent()) === '8h' && (await cell(p, 4).locator('.ot').textContent()) === '3 people');

// ---- note-only edit
await cell(p, 4).click({ modifiers: ['Shift'] }); await p.waitForSelector('dialog[open]');
await rowOf('OT User One').locator('.ot-note').fill('inventory');
await p.locator('dialog[open] button.primary').click(); await p.waitForSelector('dialog[open]', { state: 'detached' });
ok('changing only a note is saved (hours unchanged)', (await ot(ID.u1, 4)) === '3|inventory');

// ---- empty day, add from scratch; persists after reload
await cell(p, 20).click({ modifiers: ['Shift'] }); await p.waitForSelector('dialog[open]');
ok('empty day: all rows blank, no note boxes', (await p.locator('dialog[open] .ot-note:visible').count()) === 0 && (await p.locator('dialog[open] .ot-hours').first().inputValue()) === '');
await rowOf('OT User Two').locator('.ot-hours').fill('24'); await p.locator('dialog[open] button.primary').click(); await p.waitForSelector('dialog[open]', { state: 'detached' });
ok('24h (the maximum) is accepted', (await ot(ID.u2, 20)) === '24|');
await p.reload(); await p.waitForSelector('.ot-day');
ok('after reload: day 4 = 8h, day 20 = 24h', (await cell(p, 4).locator('.st').textContent()) === '8h' && (await cell(p, 20).locator('.st').textContent()) === '24h');

// ---- Cancel on the change-password page
await p.click('.acct > summary'); await p.click('.menu a.menu-item'); await p.waitForSelector('#cur');
await p.fill('#cur', 'typed-something'); await p.click('form button:text-is("Cancel")'); await p.waitForSelector('.ot-day, .tgrid');
ok('Cancel on change password returns to the admin home without saving', p.url().endsWith('#/team') && (await p.locator('#cur').count()) === 0);
await p.click('.acct > summary'); await p.click('.menu a.menu-item'); await p.waitForSelector('#cur');
ok('the form is empty again after coming back', (await p.inputValue('#cur')) === '');

// ---- Arabic
await p.goto('http://localhost:4173/#/overtime'); await p.waitForSelector('.ot-day');
await p.click('text=العربية'); await p.waitForSelector('.ot-day');
ok('Arabic tab label "الإضافي"', (await p.locator('.nav a').nth(1).textContent()).trim() === 'الإضافي');
await cell(p, 4).click({ modifiers: ['Shift'] }); await p.waitForSelector('dialog[open]');
ok('Arabic dialog: placeholder + totals text', (await p.locator('dialog[open] .ot-search').getAttribute('placeholder')) === 'بحث بالاسم أو الرمز' && (await p.locator('dialog[open] .ot-total').textContent()).includes('الإجمالي'));
const sb2 = await p.locator('dialog[open] button.primary').boundingBox();
ok('Arabic dialog (all rows prefilled with notes): Save still visible without scrolling', sb2 && sb2.y + sb2.height <= 800, JSON.stringify(sb2));
await p.screenshot({ path: S + '/ot-dialog-ar.png' });
await p.locator('dialog[open] button:text-is("إلغاء")').click();
ok('admin: no page errors ' + JSON.stringify(p.errs), p.errs.length === 0);

// ---- other roles
const u = await newPage('otu1'); await u.waitForSelector('.day');
ok('a plain user has no Overtime tab', (await u.locator('.nav a').allTextContents()).join('|') === 'My calendar');
ok('...and sees the overtime the admin entered, read-only (+3h strip, no edit dialog)', (await u.locator('.day').nth(3).locator('.ot').textContent()) === '+3h');
await u.evaluate(() => { location.hash = '#/overtime'; }); await u.waitForTimeout(500);
ok('...typing #/overtime shows no overtime screen', (await u.locator('.ot-view').count()) === 0);
const s = await newPage('otsa'); await s.waitForSelector('.depts');
ok('super_admin has no Overtime tab either', (await s.locator('.nav a').allTextContents()).join('|') === 'Departments');
await s.evaluate(() => { location.hash = '#/overtime'; }); await s.waitForTimeout(500);
ok('...and cannot open it by URL', (await s.locator('.ot-view').count()) === 0);

cleanup();
ok('cleanup removed every test row (real data untouched)', db("select count(*) from auth.users where email like 'ot%@timesheet.local'") === '0' && db("select count(*) from public.departments where name like 'OT %'") === '0');
await b.close();
console.log(fails ? `=== ${fails} FAILURES ===` : '=== ALL OVERTIME-TAB TESTS PASSED ===');
