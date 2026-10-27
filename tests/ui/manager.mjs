// Browser E2E for the department manager role: no Calendar tab, admin tabs, not in the team grid, role choice on Add user, bulk-add Role column.
// Fixtures: temporary ids 3c000000-... Needs `npx vite preview --port 4173`, TS_DB_URL, Chromium.
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
const sql = (q) => execSync(`psql "$TS_DB_URL" -X -q -At -c "${q.replace(/"/g, '\\"')}"`, { encoding: 'utf8' }).trim();
const PW = 'Mg-Pass-12345', DA = '3c000000-0000-0000-0000-00000000000a';
const uid = (i) => `3c000000-0000-0000-0000-0000000001${String(i).padStart(2, '0')}`;
const cleanup = () => sql(`delete from auth.users where id::text ~ '^3c000000-' or id in (select id from public.profiles where department_id::text ~ '^3c000000-');
  delete from public.departments where id::text ~ '^3c000000-';
  delete from public.audit_log where (target_user is not null and target_user not in (select id from public.profiles)) or (department_id is not null and department_id not in (select id from public.departments));`);
cleanup();
sql(`insert into public.departments (id,name) values ('${DA}','MG Alpha')`);
const people = [[0, 'mgadm', 'MG Admin', 'admin'], [1, 'mgmgr', 'MG Manager', 'manager'], [2, 'mgu1', 'MG Person', 'user']];
for (const [i, un, name, role] of people) sql(`
 insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change)
 values ('00000000-0000-0000-0000-000000000000','${uid(i)}','authenticated','authenticated','${un}@timesheet.local',crypt('${PW}',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',now(),now(),'','','','');
 insert into auth.identities (id,user_id,provider_id,identity_data,provider,last_sign_in_at,created_at,updated_at) values (gen_random_uuid(),'${uid(i)}','${uid(i)}','{"sub":"${uid(i)}"}','email',now(),now(),now());
 insert into public.profiles (id,username,full_name,opr,payroll,level,department_id,role) values ('${uid(i)}','${un}','${name}','MGO-${i}','MGP-${i}','2','${DA}','${role}');`);

const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0;
const ok = (l, c, extra = '') => { if (!c) fails++; console.log((c ? 'PASS: ' : 'FAIL: ') + l + (c ? '' : ' ' + extra)); };
async function login(un) {
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } }); const p = await ctx.newPage(); p.errs = []; p.on('pageerror', (e) => p.errs.push(e.message));
  await p.goto('http://localhost:4173/'); await p.fill('#username', un); await p.fill('#password', PW); await p.click('button[type=submit]'); await p.waitForSelector('.topbar');
  return p;
}
{ const p = await login('mgmgr');
  await p.waitForSelector('.tgrid');
  ok('working screens: the Developed by line closes the page (and the account menu has its own)', (await p.locator('main .credit').count()) === 1 && !(await p.locator('.menu-credit').isVisible()));
  await p.click('.acct > summary');
  const nm = await p.locator('.menu-credit .dev-name').evaluate((e) => { const r = e.getClientRects(); return { lines: r.length, ws: getComputedStyle(e).whiteSpace }; });
  ok('the account menu keeps "Shady Mansour" on ONE line (no split in a narrow menu)', nm.lines === 1 && nm.ws === 'nowrap', JSON.stringify(nm));
  const narrow = await p.locator('.menu-credit').evaluate((e) => { e.firstElementChild.style.maxWidth = '120px'; const d = e.querySelector('.dev-name'); return { lines: d.getClientRects().length, wraps: e.firstElementChild.getBoundingClientRect().height > 30 }; });
  ok('even in a very narrow menu "Shady Mansour" stays on one line (the line breaks before the name instead)', narrow.lines === 1 && narrow.wraps, JSON.stringify(narrow));

  ok('the account menu ends with the Developed by line and its three icon links', (await p.locator('.menu-credit').isVisible()) && /Developed by Shady Mansour/.test(await p.locator('.menu-credit').innerText()) && (await p.locator('.menu-credit a.credit-link').count()) === 4 && (await p.locator('.menu-credit a[data-link=github]').getAttribute('href')) === 'https://github.com/shadymansour19');
  if (process.env.SHOTS) await p.screenshot({ path: process.env.SHOTS + '/menu.png' });
  await p.click('.acct > summary');
  const tabs = await p.locator('nav a, .topbar a').allTextContents();
  ok('manager lands on Team and has no Calendar tab', /#\/team/.test(p.url()) && !tabs.some((x) => /calendar/i.test(x)), `${p.url()} ${tabs}`);
  await p.goto('http://localhost:4173/#/calendar');
  ok('the calendar route is not available to a manager', !(await p.locator('.cal, .calendar').count()));
  await p.goto('http://localhost:4173/#/team'); await p.waitForSelector('.tgrid');
  const names = await p.locator('.tgrid tbody').innerText();
  ok('the team grid lists the person but not the manager', /MG Person/.test(names) && !/MG Manager/.test(names), names);
  await p.goto('http://localhost:4173/#/users'); await p.waitForSelector('.person, table');
  const body = await p.locator('main, body').first().innerText();
  ok('Users lists the manager with the manager badge', /MG Manager/.test(body) && /Department manager/.test(body));
  await p.goto('http://localhost:4173/#/account'); await p.waitForSelector('.credit');
  ok('Account page shows the Developed by line with GitHub / LinkedIn / email icon links', /Developed by Shady Mansour/.test(await p.locator('.credit').innerText()) && (await p.locator('.credit a[data-link=github]').getAttribute('href')) === 'https://github.com/shadymansour19' && (await p.locator('.credit a[data-link=github] svg').count()) === 1 && (await p.locator('.credit a[data-link=github]').innerText()).trim() === '' && (await p.locator('.credit a[data-link=linkedin]').getAttribute('href')) === 'https://www.linkedin.com/in/shadymansour19' && (await p.locator('.credit a[data-link=email]').getAttribute('href')) === 'mailto:shadymansour19@gmail.com' && /^https:\/\/wa\.me\/201069360912\?text=Good%20(morning|afternoon|evening)%20Shady.*Timesheet/.test(await p.locator('.credit a[data-link=whatsapp]').getAttribute('href')));
  ok('no page errors (manager)', p.errs.length === 0, p.errs.join('|'));
  await p.context().close(); }
{ const c = await b.newContext(); const q = await c.newPage(); await q.goto('http://localhost:4173/'); await q.waitForSelector('#username');
  ok('the sign-in page shows the Developed by line', /Developed by Shady Mansour/.test(await q.locator('.credit').innerText()));
  await q.evaluate(() => document.fonts.ready);
  const f = await q.locator('.dev-name').evaluate((e) => ({ fam: getComputedStyle(e).fontFamily, w: getComputedStyle(e).fontWeight, clip: getComputedStyle(e).webkitBackgroundClip || getComputedStyle(e).backgroundClip, loaded: document.fonts.check('400 20px "Kaushan Name"', e.textContent) }));
  ok('the developer name uses the Kaushan Script brush font (loaded) with a gradient fill', /Kaushan Name/.test(f.fam) && f.w === '400' && f.clip === 'text' && f.loaded, JSON.stringify(f));
  const sz = await q.evaluate(() => { const c = document.querySelector('.credit'), a = document.querySelector('.credit-link'), w = document.querySelector('.credit-link[data-link=whatsapp] svg'); return { font: parseFloat(getComputedStyle(c).fontSize), circle: Math.round(a.getBoundingClientRect().width), icon: Math.round(a.querySelector('svg').getBoundingClientRect().width), wa: Math.round(w.getBoundingClientRect().width) }; });
  ok('desktop: a bigger Developed by line (17px+) and bigger icons (48px circles, 27px icons, WhatsApp 31px)', sz.font >= 17 && sz.circle === 48 && sz.icon === 27 && sz.wa === 31, JSON.stringify(sz));

  // the greeting follows the local time (checked when the link is used)
  for (const [iso, word] of [['2026-10-27T05:00:00', 'morning'], ['2026-10-27T09:30:00', 'morning'], ['2026-10-27T12:00:00', 'afternoon'], ['2026-10-27T16:59:00', 'afternoon'], ['2026-10-27T17:00:00', 'evening'], ['2026-10-27T23:00:00', 'evening'], ['2026-10-27T02:00:00', 'evening']]) {
    await q.clock.setFixedTime(new Date(iso));
    const href = await q.evaluate(() => { const a = document.querySelector('.credit a[data-link=whatsapp]'); a.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); return a.href; });
    ok(`WhatsApp greeting at ${iso.slice(11, 16)} is "${word}"`, decodeURIComponent(href).includes(`Good ${word} Shady`), decodeURIComponent(href));
  }
  await c.close(); }
// the plain user's help dialog in Arabic: short, simple sentences
{ const p = await login('mgu1'); await p.waitForSelector('.day'); await p.click('button:text-is("العربية")'); await p.waitForSelector('.day');
  await p.click('button[aria-label="مساعدة"]'); await p.waitForSelector('dialog[open]');
  const txt = await p.locator('dialog[open]').innerText();
  ok('Arabic help for users: simple wording', txt.includes('اضغط على اليوم لتغيير حالته بالترتيب E ثم X ثم Y وهكذا') && txt.includes('الدائرة الصغيرة') && !txt.includes('الكهرماني'), txt.slice(0, 120));
  if (process.env.SHOTS) await p.screenshot({ path: process.env.SHOTS + '/help-ar.png' });
  await p.context().close(); }
{ const p = await login('mgadm');
  await p.goto('http://localhost:4173/#/users'); await p.waitForSelector('.person');
  await p.click('text=Add user'); await p.waitForSelector('dialog[open]');
  const roles = await p.locator('dialog[open] input[type=radio]').evaluateAll((e) => e.map((x) => x.value).filter((v) => ['user', 'admin', 'manager'].includes(v)));
  ok('Add user offers user / admin / manager', roles.join() === 'user,admin,manager', roles.join());
  await p.keyboard.press('Escape');
  // promote the person to manager through the card action
  await p.locator('.person:has-text("MG Person") >> text=Make manager').click();
  await p.click('dialog[open] button.primary'); await p.waitForTimeout(1500);
  ok('"Make manager" changes the role', sql(`select role from public.profiles where id='${uid(2)}'`) === 'manager');
  // table view: sort / filter on the column headers
  await p.click('.view-seg button[data-view="table"]'); await p.waitForSelector('.utable tbody tr.urow');
  const names = async () => (await p.locator('.utable tbody tr.urow th').allTextContents()).map((x) => x.trim()).filter((x) => x.startsWith('MG '));
  await p.locator('.utable th[data-k="full_name"] .th-sort').click();
  const asc = await names();
  ok('table: a click on a column title sorts ascending', asc.join() === [...asc].sort().join() && (await p.locator('.utable th[data-k="full_name"]').getAttribute('aria-sort')) === 'ascending', asc.join());
  await p.locator('.utable th[data-k="full_name"] .th-sort').click();
  const desc = await names();
  ok('table: a second click sorts descending', desc.join() === [...asc].reverse().join() && (await p.locator('.utable th[data-k="full_name"]').getAttribute('aria-sort')) === 'descending', desc.join());
  await p.locator('.utable th[data-k="full_name"] .th-sort').click();
  ok('table: a third click returns to the default order', (await p.locator('.utable th[data-k="full_name"]').getAttribute('aria-sort')) === 'none');
  // Excel-style column filter: every value with a check box, search, Select all
  await p.click('.th-filter[data-k="full_name"]'); await p.waitForSelector('.flt-pop');
  const opts = await p.locator('.flt-pop .flt-list .flt-opt').allTextContents();
  ok('filter: the popup lists every value of the column', ['MG Admin', 'MG Manager', 'MG Person'].every((x) => opts.map((o) => o.trim()).includes(x)), opts.join('|'));
  await p.fill('.flt-pop input[type=search]', 'person'); await p.waitForTimeout(150);
  ok('filter: the search narrows the list of values', (await p.locator('.flt-pop .flt-list .flt-opt').count()) === 1);
  await p.locator('.flt-pop .flt-all input').uncheck(); await p.locator('.flt-pop .flt-all input').check();
  const only = async () => (await p.locator('.utable tbody tr.urow th').allTextContents()).map((x) => x.trim()).filter((x) => /^MG /.test(x));
  await p.waitForFunction(() => [...document.querySelectorAll('.utable tbody tr.urow th')].filter((x) => /^MG /.test(x.textContent)).length === 1);
  ok('filter: Select all / none acts on the values the search shows', (await only()).join() === 'MG Person', (await only()).join());
  await p.fill('.flt-pop input[type=search]', ''); await p.waitForTimeout(150);
  await p.locator('.flt-pop .flt-all input').check();
  await p.waitForFunction(() => [...document.querySelectorAll('.utable tbody tr.urow th')].filter((x) => /^MG /.test(x.textContent)).length === 3);
  await p.locator('.flt-pop .flt-opt:has-text("MG Admin") input').uncheck();
  await p.waitForFunction(() => [...document.querySelectorAll('.utable tbody tr.urow th')].filter((x) => /^MG /.test(x.textContent)).length === 2);
  ok('filter: unchecking a value hides its rows and the funnel is marked', (await only()).join().includes('MG Admin') === false && (await p.locator('.th-filter.on[data-k="full_name"]').count()) === 1);
  const widths = () => p.locator('.utable thead th').evaluateAll((e) => e.map((x) => Math.round(x.getBoundingClientRect().width)));
  const w0 = await widths();
  await p.click('.flt-pop button:text-is("Clear filter")');
  await p.waitForFunction(() => [...document.querySelectorAll('.utable tbody tr.urow th')].filter((x) => /^MG /.test(x.textContent)).length === 3);
  ok('table: the column widths stay the same when filters change', JSON.stringify(await widths()) === JSON.stringify(w0), JSON.stringify(w0) + JSON.stringify(await widths()));
  for (const chip of ['Admins', 'Users', 'Managers', 'All']) { await p.locator('.team-row .seg:not(.view-seg) button', { hasText: new RegExp('^' + chip) }).first().click().catch(() => {}); await p.waitForTimeout(150); ok(`table: the column widths stay the same with the role chip ${chip}`, JSON.stringify(await widths()) === JSON.stringify(w0), JSON.stringify(await widths())); }
  ok('filter: Clear filter shows everything again', (await p.locator('.th-filter.on').count()) === 0);
  await p.click('.th-filter[data-k="role"]'); await p.waitForSelector('.flt-pop');
  await p.locator('.flt-pop .flt-all input').uncheck(); await p.locator('.flt-pop .flt-opt:has-text("Department manager") input').check();
  ok('filter: the Role column filters by the checked roles', await p.waitForFunction(() => { const r = [...document.querySelectorAll('.utable tbody tr.urow th')].map((x) => x.textContent.trim()).filter((x) => /^MG /.test(x)); return r.length === 2 && !r.includes('MG Admin'); }).then(() => true, () => false));
  // the values offered by another column leave out what the active filters already excluded
  await p.keyboard.press('Escape');
  await p.click('.th-filter[data-k="full_name"]'); await p.waitForSelector('.flt-pop');
  const left = (await p.locator('.flt-pop .flt-list .flt-opt').allTextContents()).map((x) => x.trim());
  ok('filter: a column offers only the values left by the other filters (Role = manager -> no MG Admin)', !left.includes('MG Admin') && left.includes('MG Manager'), left.join('|'));
  await p.keyboard.press('Escape');
  ok('filter: Escape closes the popup', (await p.locator('.flt-pop').count()) === 0);
  await p.context().close(); }
// a phone: tapping a column filter must keep the popup open when the on-screen keyboard changes the window HEIGHT (it used to close at once)
{ const ctx = await b.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true }); const p = await ctx.newPage();
  await p.goto('http://localhost:4173/'); await p.fill('#username', 'mgadm'); await p.fill('#password', PW); await p.click('button[type=submit]'); await p.waitForSelector('.topbar');
  await p.goto('http://localhost:4173/#/users'); await p.waitForSelector('.person'); await p.tap('.view-seg button[data-view="table"]'); await p.waitForSelector('.utable tbody tr.urow');
  await p.tap('.th-filter[data-k="role"]'); await p.waitForSelector('.flt-pop');
  ok('phone: the credit line and its icons keep their compact size (14px text, 36px circles)', await p.evaluate(() => { const c = document.querySelector('main .credit'), a = c.querySelector('.credit-link'); return parseFloat(getComputedStyle(c).fontSize) < 14 && Math.round(a.getBoundingClientRect().width) === 36; }));
  ok('phone: the filter popup opens without focusing its search box (no keyboard by itself)', await p.evaluate(() => document.activeElement?.type !== 'search' || !document.querySelector('.flt-pop').contains(document.activeElement)));
  await p.setViewportSize({ width: 390, height: 380 });                                // what the on-screen keyboard does
  await p.waitForTimeout(500);
  ok('phone: the keyboard (height change) does not close the popup, and it stays on screen', (await p.locator('.flt-pop').count()) === 1 && await p.locator('.flt-pop').evaluate((e) => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight + 1; }));
  await p.tap('.flt-pop .flt-list .flt-opt:has-text("Department manager") input'); await p.waitForTimeout(300);
  ok('phone: a value can be ticked and the filter applies', (await p.locator('.th-filter.on[data-k="role"]').count()) === 1);
  await p.setViewportSize({ width: 700, height: 380 }); await p.waitForTimeout(300);
  ok('phone: turning the screen (a width change) closes the popup', (await p.locator('.flt-pop').count()) === 0);
  await ctx.close(); }
cleanup();
await b.close();
console.log(fails ? `=== ${fails} FAILURES ===` : '=== ALL MANAGER TESTS PASSED ===');
