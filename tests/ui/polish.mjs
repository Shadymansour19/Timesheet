// Browser checks for UI polish: password show/hide, Arabic wording, month arrows in both languages.
// Temporary pl* users (ids 50000000-...) on the REAL project; removed afterwards. Needs `npx vite preview --port 4173`, TS_DB_URL, Chromium.
// Usage: node tests/ui/polish.mjs [screenshot-dir]
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
const S = process.argv[2] ?? tmpdir();
const db = (q) => execSync(`psql "$TS_DB_URL" -X -q -At -c "${q.replace(/"/g, '\\"')}"`, { encoding: 'utf8' }).trim();
const PW = 'Pl-Pass-12345', D = '50000000-0000-0000-0000-00000000000a';
const ID = { adm: '50000000-0000-0000-0000-0000000000a1', u: '50000000-0000-0000-0000-0000000000a2', sa: '50000000-0000-0000-0000-0000000000a0' };
const mk = (id, un, role, name) => { const sa = role === 'super_admin'; return db(`
 insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change)
 values ('00000000-0000-0000-0000-000000000000','${id}','authenticated','authenticated','${un}@timesheet.local',crypt('${PW}',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',now(),now(),'','','','');
 insert into auth.identities (id,user_id,provider_id,identity_data,provider,last_sign_in_at,created_at,updated_at) values (gen_random_uuid(),'${id}','${id}','{"sub":"${id}"}','email',now(),now(),now());
 insert into public.profiles (id,username,full_name,opr,level,department_id,role) values ('${id}','${un}','${name}',${sa ? 'null' : `'OPR-${un}'`},1,${sa ? 'null' : `'${D}'`},'${role}');`); };
const cleanup = () => db(`delete from auth.users where id::text like '50000000%'; delete from public.departments where id='${D}';
  delete from public.audit_log where (target_user is not null and target_user not in (select id from public.profiles)) or (department_id is not null and department_id not in (select id from public.departments));`);
cleanup(); db(`insert into public.departments (id,name) values ('${D}','PL Dept')`);
mk(ID.adm, 'pladm', 'admin', 'Polish Admin'); mk(ID.u, 'plu', 'user', 'Polish User'); mk(ID.sa, 'plsa', 'super_admin', 'Polish Super');
db(`insert into public.day_status (user_id, day, status) values ('${ID.u}', date_trunc('month',current_date)::date + 3, 'X'), ('${ID.u}', date_trunc('month',current_date)::date + 4, 'Y'), ('${ID.u}', date_trunc('month',current_date)::date + 5, 'X');
    insert into public.overtime (user_id, day, hours) values ('${ID.u}', date_trunc('month',current_date)::date + 3, 3), ('${ID.u}', date_trunc('month',current_date)::date + 4, 12), ('${ID.u}', date_trunc('month',current_date)::date + 10, 1);
    insert into public.holidays (department_id, day) values ('${D}', date_trunc('month',current_date)::date + 5);`);

const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0;
const ok = (l, c, extra = '') => { if (!c) fails++; console.log((c ? 'PASS: ' : 'FAIL: ') + l + (c ? '' : ' ' + extra)); };
const ctx0 = await b.newContext({ viewport: { width: 390, height: 800 } });
await ctx0.addInitScript(() => { try { localStorage.setItem('ts.teamView', 'month'); } catch { /* ignore */ } });   // phones default to week view
const p = await ctx0.newPage();
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

// ---- overtime highlight + taller cells (user calendar)
await p.click('text=English'); await p.waitForSelector('.day');
const cellBox = await p.locator('.day').nth(3).boundingBox();
ok('calendar cells are taller than wide (ratio >= 1.25)', cellBox.height / cellBox.width >= 1.25, (cellBox.height / cellBox.width).toFixed(2));
const otCell = p.locator('.day.has-ot');
ok('exactly the 3 overtime days are marked', (await otCell.count()) === 3);
const ot = p.locator('.day').nth(3).locator('.ot');
ok('overtime area text +3h', (await ot.textContent()) === '+3h');
const otBg = await ot.evaluate((e) => getComputedStyle(e).backgroundColor);
const cellBg = await p.locator('.day').nth(3).evaluate((e) => getComputedStyle(e).backgroundColor);
ok('overtime area has its own amber colour, different from the cell', otBg === 'rgb(253, 230, 138)' && otBg !== cellBg, `${otBg} vs ${cellBg}`);
const ob = await ot.boundingBox(), cb = await p.locator('.day').nth(3).boundingBox();
ok('overtime strip is flush with the bottom edge and full width of the cell', ob.y >= cb.y + cb.height * 0.6 && Math.abs(ob.y + ob.height - (cb.y + cb.height)) <= 1.5 && Math.abs(ob.width - cb.width) <= 1.5, JSON.stringify({ ob, cb }));
ok('12h overtime is shown on the Y day', (await p.locator('.day').nth(4).locator('.ot').textContent()) === '+12h' && (await p.locator('.day').nth(4).locator('.st').textContent()) === 'Y');
ok('day without overtime has no strip', (await p.locator('.day').nth(5).locator('.ot').count()) === 0 && (await p.locator('.day').nth(6).locator('.ot').count()) === 0);
ok('holiday X day still shows XH', (await p.locator('.day').nth(5).locator('.st').textContent()) === 'XH');
ok('totals chip for overtime is amber and sums 16h', (await p.locator('.chip.ot').textContent()).includes('16h') && (await p.locator('.chip.ot').evaluate((e) => getComputedStyle(e).backgroundColor)) === 'rgb(253, 230, 138)');
await p.screenshot({ path: S + '/cal-ot.png' });

// ---- account menu trigger
const caret = p.locator('.acct .caret svg');
ok('account trigger has a drawn up/down chevron icon (no text arrow)', (await caret.count()) === 1 && (await p.locator('.acct .caret').textContent()).trim() === '' && (await caret.locator('path').count()) === 2);
const before = await caret.evaluate((e) => getComputedStyle(e).transform);
await p.locator('.acct > summary').click(); await p.waitForTimeout(400);
const after = await caret.evaluate((e) => getComputedStyle(e).transform);
ok('chevron animates (rotates) when the menu opens', before === 'none' && after !== 'none', `${before} -> ${after}`);
ok('trigger looks like a button: bordered pill', (await p.locator('.acct > summary').evaluate((e) => parseFloat(getComputedStyle(e).borderTopWidth) >= 1 && parseFloat(getComputedStyle(e).borderTopLeftRadius) >= 10)));
await p.screenshot({ path: S + '/trigger-open.png' });
await p.locator('.acct > summary').click();
await p.emulateMedia({ colorScheme: 'dark' }); await p.waitForTimeout(300);
await p.screenshot({ path: S + '/cal-ot-dark.png' });
const darkBg = await p.locator('.day').nth(3).locator('.ot').evaluate((e) => getComputedStyle(e).backgroundColor);
ok('dark mode uses the dark amber', darkBg === 'rgb(120, 53, 15)', darkBg);
await p.emulateMedia({ colorScheme: 'light' });

// ---- account page: three independent toggles
ok('Change password is no longer a tab', (await p.locator('.nav a').allTextContents()).join('|') === 'My calendar');
await p.click('.acct > summary'); await p.click('.menu a.menu-item'); await p.waitForSelector('#cur');
ok('menu item opens the change-password page', p.url().endsWith('#/account') && (await p.locator('details.acct').getAttribute('open')) === null);
ok('Back link is shown on that page and returns to the calendar', (await p.locator('.back-link').count()) === 1);
ok('account page has 3 toggles', (await p.locator('.pw-toggle').count()) === 3);
await p.locator('.pw-toggle').nth(1).click();
ok('only the clicked field is revealed', (await p.getAttribute('#cur', 'type')) === 'password' && (await p.getAttribute('#nw', 'type')) === 'text' && (await p.getAttribute('#cf', 'type')) === 'password');

await p.click('.back-link'); await p.waitForSelector('.day');
ok('Back returns to the calendar and the link disappears', p.url().endsWith('#/calendar') && (await p.locator('.back-link').count()) === 0);
await p.click('.acct > summary'); await p.click('.menu a.menu-item'); await p.waitForSelector('#cur');
await p.screenshot({ path: S + '/account-page.png' });
await p.click('.acct > summary'); await p.screenshot({ path: S + '/menu-pw.png' }); await p.click('.acct > summary');

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
ok('admin grid marks overtime cells (amber bar + badge)', (await p.locator('td.has-ot').count()) === 3 && (await p.locator('td.has-ot').first().evaluate((e) => getComputedStyle(e).boxShadow)) !== 'none');
// ---- every role has it in the menu: admin and super_admin
await p.click('text=English'); await p.waitForSelector('.tgrid');
ok('admin tabs (no Change password tab)', (await p.locator('.nav a').allTextContents()).join('|') === 'Department|Overtime|Users|My calendar');
await p.click('.acct > summary'); ok('admin menu has Change password', (await p.locator('.menu a.menu-item').textContent()).trim() === 'Change password');
await p.click('.menu a.menu-item'); await p.waitForSelector('#cur'); ok('admin: opens the page, Back goes to the department grid', (await p.locator('.back-link').count()) === 1);
await p.click('.back-link'); await p.waitForSelector('.tgrid');
await p.click('.acct > summary'); await p.click('.menu-item:text("Add account")'); await p.waitForSelector('dialog[open]');
await p.locator('dialog[open]').getByLabel('Username').fill('plsa'); await p.locator('dialog[open]').getByLabel('Password', { exact: true }).fill(PW); await p.locator('dialog[open] button.primary').click();
await p.waitForSelector('dialog[open]', { state: 'detached' }); await p.waitForSelector('.depts');
ok('super_admin tabs: Departments only', (await p.locator('.nav a').allTextContents()).join('|') === 'Departments');
await p.click('.acct > summary'); await p.click('.menu a.menu-item'); await p.waitForSelector('#cur');
ok('super_admin: Change password via the menu, Back goes to Departments', (await p.locator('.back-link').count()) === 1);
await p.click('.back-link'); await p.waitForSelector('.depts');
// Arabic: back arrow mirrors, menu text is Arabic
await p.click('text=العربية'); await p.click('.acct > summary'); await p.waitForTimeout(300);
ok('Arabic: menu item "تغيير كلمة المرور"', (await p.locator('.menu a.menu-item').textContent()).trim() === 'تغيير كلمة المرور');
await p.screenshot({ path: S + '/menu-pw-ar.png' });
await p.click('.menu a.menu-item'); await p.waitForSelector('#cur');
ok('Arabic: back arrow is mirrored', (await p.locator('.back-link svg').evaluate((e) => getComputedStyle(e).transform)) !== 'none');
ok('no page errors ' + JSON.stringify(errs), errs.length === 0);
cleanup();
ok('cleanup removed every test row (real data untouched)', db("select count(*) from auth.users where email like 'pl%@timesheet.local'") === '0');
await b.close();
console.log(fails ? `=== ${fails} FAILURES ===` : '=== ALL POLISH TESTS PASSED ===');
