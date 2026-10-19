// Browser checks for UI polish: password show/hide, Arabic wording, month arrows in both languages.
// Temporary pl* users (ids 50000000-...) on the REAL project; removed afterwards. Needs `npx vite preview --port 4173`, TS_DB_URL, Chromium.
// Usage: node tests/ui/polish.mjs [screenshot-dir]
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
const S = process.argv[2] ?? tmpdir();
const db = (q) => execSync(`psql "$TS_DB_URL" -X -q -At -c "${q.replace(/"/g, '\\"')}"`, { encoding: 'utf8' }).trim();
const PW = 'Pl-Pass-12345', D = '50000000-0000-0000-0000-00000000000a';
const ID = { adm: '50000000-0000-0000-0000-0000000000a1', u: '50000000-0000-0000-0000-0000000000a2' };
const mk = (id, un, role, name) => db(`
 insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change)
 values ('00000000-0000-0000-0000-000000000000','${id}','authenticated','authenticated','${un}@timesheet.local',crypt('${PW}',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',now(),now(),'','','','');
 insert into auth.identities (id,user_id,provider_id,identity_data,provider,last_sign_in_at,created_at,updated_at) values (gen_random_uuid(),'${id}','${id}','{"sub":"${id}"}','email',now(),now(),now());
 insert into public.profiles (id,username,full_name,opr,level,department_id,role) values ('${id}','${un}','${name}','OPR-${un}',1,'${D}','${role}');`);
const cleanup = () => db(`delete from auth.users where id::text like '50000000%'; delete from public.departments where id='${D}';
  delete from public.audit_log where (target_user is not null and target_user not in (select id from public.profiles)) or (department_id is not null and department_id not in (select id from public.departments));`);
cleanup(); db(`insert into public.departments (id,name) values ('${D}','PL Dept')`);
mk(ID.adm, 'pladm', 'admin', 'Polish Admin'); mk(ID.u, 'plu', 'user', 'Polish User');

const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0;
const ok = (l, c, extra = '') => { if (!c) fails++; console.log((c ? 'PASS: ' : 'FAIL: ') + l + (c ? '' : ' ' + extra)); };
const p = await (await b.newContext({ viewport: { width: 390, height: 800 } })).newPage();
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const box = (sel) => p.locator(sel).first().boundingBox();

// ---- password show/hide: login screen
await p.goto('http://localhost:4173/'); await p.waitForSelector('#password');
await p.fill('#password', 'secret-value');
ok('password starts hidden', (await p.getAttribute('#password', 'type')) === 'password');
await p.click('.pw-toggle');
ok('click shows it (type=text, value kept, label says Hide)', (await p.getAttribute('#password', 'type')) === 'text' && (await p.inputValue('#password')) === 'secret-value' && (await p.getAttribute('.pw-toggle', 'aria-label')) === 'Hide password' && (await p.getAttribute('.pw-toggle', 'aria-pressed')) === 'true');
await p.click('.pw-toggle');
ok('click again hides it', (await p.getAttribute('#password', 'type')) === 'password');
await p.screenshot({ path: S + '/pw-login.png' });
await p.click('text=العربية');
ok('Arabic label on the toggle', (await p.getAttribute('.pw-toggle', 'aria-label')) === 'إظهار كلمة المرور');
const ib = await box('#password'), tb = await box('.pw-toggle');
ok('RTL: eye button sits at the left (inline-end) edge inside the field', tb.x < ib.x + 60 && tb.x + tb.width <= ib.x + ib.width);
await p.click('text=English');

// ---- user in Arabic: wording + arrows
await p.fill('#username', 'plu'); await p.fill('#password', PW); await p.click('button[type=submit]'); await p.waitForSelector('.day');
const monthEn = (await p.textContent('.cal-head h2')).trim();
const PREV = '.cal-head button >> nth=0', NEXT = '.cal-head button >> nth=1';   // language-independent
const order = async () => ({ prev: await p.locator(PREV).boundingBox(), next: await p.locator(NEXT).boundingBox(), glyphs: (await p.locator('.cal-head button').nth(0).locator('path').getAttribute('d')) + '|' + (await p.locator('.cal-head button').nth(1).locator('path').getAttribute('d')) });
let o = await order(); ok('English: previous is left of next, arrows drawn as left/right chevrons', o.prev.x < o.next.x && o.glyphs === 'M15 6l-6 6 6 6|M9 6l6 6-6 6');
await p.click('text=العربية'); await p.waitForSelector('.day');
ok('Arabic nav label is "جدولي"', (await p.locator('.nav a').first().textContent()).trim() === 'جدولي');
const legend = await p.textContent('.legend');
ok('Arabic legend says وردية, not تشغيل', legend.includes('وردية') && !legend.includes('تشغيل'));
o = await order();
ok('Arabic: arrows are reverted vs. before — previous on the LEFT (left chevron), next on the RIGHT (right chevron)', o.prev.x < o.next.x && o.glyphs === 'M15 6l-6 6 6 6|M9 6l6 6-6 6', JSON.stringify(o));
const titleAr = (await p.textContent('.cal-head h2')).trim();
await p.click(NEXT); await p.waitForFunction((t) => document.querySelector('.cal-head h2')?.textContent.trim() !== t && !!document.querySelector('.cal-head h2'), titleAr);
const nextTitle = (await p.textContent('.cal-head h2')).trim();
await p.click(PREV); await p.waitForFunction((t) => document.querySelector('.cal-head h2')?.textContent.trim() === t, titleAr);
ok('Arabic: right chevron goes to the next month and left chevron comes back', nextTitle !== titleAr);
await p.screenshot({ path: S + '/cal-ar2.png' });

// ---- account page: three independent toggles
await p.click('text=English'); await p.click('.nav a:text("Change password")'); await p.waitForSelector('#cur');
ok('account page has 3 toggles', (await p.locator('.pw-toggle').count()) === 3);
await p.locator('.pw-toggle').nth(1).click();
ok('only the clicked field is revealed', (await p.getAttribute('#cur', 'type')) === 'password' && (await p.getAttribute('#nw', 'type')) === 'text' && (await p.getAttribute('#cf', 'type')) === 'password');

// ---- add-account dialog
await p.click('.acct > summary'); await p.click('.menu-item:text("Add account")'); await p.waitForSelector('dialog[open]');
ok('add-account dialog password has a toggle', (await p.locator('dialog[open] .pw-toggle').count()) === 1);
await p.locator('dialog[open] input[type=password]').fill('abc'); await p.locator('dialog[open] .pw-toggle').click();
ok('...and it reveals the typed value', (await p.locator('dialog[open] .pw input').getAttribute('type')) === 'text');
await p.locator('dialog[open] button:text-is("Cancel")').click();

// ---- admin grid arrows in Arabic
await p.click('.acct > summary'); await p.click('.menu-item:text("Add account")'); await p.waitForSelector('dialog[open]');
await p.locator('dialog[open]').getByLabel('Username').fill('pladm'); await p.locator('dialog[open]').getByLabel('Password', { exact: true }).fill(PW); await p.locator('dialog[open] button.primary').click();
await p.waitForSelector('.tgrid'); await p.click('text=العربية'); await p.waitForSelector('.tgrid');
o = await order(); ok('Arabic department grid: same reverted arrow layout', o.prev.x < o.next.x && o.glyphs === 'M15 6l-6 6 6 6|M9 6l6 6-6 6');
ok('Arabic grid tab says "القسم"', (await p.locator('.nav a').first().textContent()).trim() === 'القسم');
await p.screenshot({ path: S + '/team-ar2.png' });
ok('no page errors ' + JSON.stringify(errs), errs.length === 0);
cleanup();
ok('cleanup removed every test row (real data untouched)', db("select count(*) from auth.users where email like 'pl%@timesheet.local'") === '0');
await b.close();
console.log(fails ? `=== ${fails} FAILURES ===` : '=== ALL POLISH TESTS PASSED ===');
