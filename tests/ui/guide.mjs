// Browser E2E for the how-to guide (guided tour): every role, phone and desktop. Starts by itself for a new account on its landing screen; the account menu starts the
// tour of the screen you are on. Automation never gets the automatic start unless localStorage ts.forceGuide = 1 (set here).
// Fixtures: temporary ids 3f000000-.... Needs `npx vite preview --port 4173`, TS_DB_URL, Chromium.
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
const sql = (q) => execSync(`psql "$TS_DB_URL" -X -q -At -c "${q.replace(/"/g, '\\"')}"`, { encoding: 'utf8' }).trim();
const PW = 'Gd-Pass-12345', DA = '3f000000-0000-0000-0000-00000000000a';
const uid = (i) => `3f000000-0000-0000-0000-0000000001${String(i).padStart(2, '0')}`;
const cleanup = () => sql(`delete from auth.users where id::text ~ '^3f000000-' or id in (select id from public.profiles where department_id::text ~ '^3f000000-');
  delete from public.departments where id::text ~ '^3f000000-';
  delete from public.audit_log where (target_user is not null and target_user not in (select id from public.profiles)) or (department_id is not null and department_id not in (select id from public.departments));`);
cleanup();
sql(`insert into public.departments (id,name) values ('${DA}','GD Alpha')`);
const people = [[0, 'gdnew', 'GD New User', 'user', '0 days'], [1, 'gdold', 'GD Old User', 'user', '90 days'], [2, 'gdadm', 'GD Admin', 'admin', '0 days'], [3, 'gdmgr', 'GD Manager', 'manager', '0 days'], [4, 'gdsm', 'GD Super Manager', 'super_manager', '0 days'], [5, 'gdsa', 'GD Super Admin', 'super_admin', '0 days']];
for (const [i, un, name, role, age] of people) sql(`
 insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change)
 values ('00000000-0000-0000-0000-000000000000','${uid(i)}','authenticated','authenticated','${un}@timesheet.local',crypt('${PW}',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',now(),now(),'','','','');
 insert into auth.identities (id,user_id,provider_id,identity_data,provider,last_sign_in_at,created_at,updated_at) values (gen_random_uuid(),'${uid(i)}','${uid(i)}','{"sub":"${uid(i)}"}','email',now(),now(),now());
 insert into public.profiles (id,username,full_name,opr,payroll,level,department_id,role,created_at) values ('${uid(i)}','${un}','${name}',${role.startsWith('super') ? 'null' : `'GDO-${i}'`},${role.startsWith('super') ? 'null' : `'GDP-${i}'`},'2',${role.startsWith('super') ? 'null' : `'${DA}'`},'${role}', now() - interval '${age}');`);

const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0;
const ok = (l, c, extra = '') => { if (!c) fails++; console.log((c ? 'PASS: ' : 'FAIL: ') + l + (c ? '' : ' ' + extra)); };
async function open(un, { phone = true } = {}) {
  const ctx = await b.newContext(phone ? { viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true } : { viewport: { width: 1300, height: 900 } });
  await ctx.addInitScript((dept) => { localStorage.setItem('ts.forceGuide', '1'); localStorage.setItem('ts.actingDept', dept); }, DA);       // automation: the automatic start is allowed here
  const p = await ctx.newPage(); p.errs = []; p.on('pageerror', (e) => p.errs.push(e.message));
  await p.goto('http://localhost:4173/'); await p.fill('#username', un); await p.fill('#password', PW); await p.click('button[type=submit]'); await p.waitForSelector('.topbar');
  return p;
}
const TARGETS = ['.cal > .cal-head', '.grid .day.today', '.grid', '.grid .day.ctx', '.totals', '.cal-tools .icon-only', '.acct'];
const inView = (p) => p.locator('.tour-card').evaluate((e) => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1; });
// walks a whole tour: every step has a card on screen and (after the welcome) a spotlight ring of real size; the last step finishes it
async function walk(p, label) {
  const n = await p.locator('.tour-dot').count(), bad = [];
  for (let i = 0; i < n; i++) {
    await p.waitForTimeout(450);
    const m = await p.evaluate(() => { const rings = [...document.querySelectorAll('.tour-ring')].filter((r) => getComputedStyle(r).opacity === '1').map((r) => { const b = r.getBoundingClientRect(); return b.width * b.height; });
      const c = document.querySelector('.tour-card').getBoundingClientRect(); return { rings: rings.length, area: Math.round(rings.reduce((a, v) => a + v, 0)), card: c.left >= 0 && c.top >= 0 && c.right <= innerWidth + 1 && c.bottom <= innerHeight + 1, title: document.querySelector('.tour-title').innerText }; });
    if (!m.card || !m.title || (i > 0 && (m.rings < 1 || m.area < 100))) bad.push({ i, ...m });
    if (process.env.SHOTS && (i === 3 || i === 5)) await p.screenshot({ path: `${process.env.SHOTS}/tour-${label.replace(/\W+/g, '_')}-${i}.png` });
    await p.click('#tour-next');
  }
  await p.waitForSelector('.tour', { state: 'detached' });
  ok(`${label}: ${n} steps, each with its card on screen and a spotlight`, n > 3 && bad.length === 0, JSON.stringify(bad));
  return n;
}
const menuGuide = async (p) => { await p.click('.acct > summary'); await p.click('#guide-open'); await p.waitForSelector('.tour'); };
{ const p = await open('gdnew');
  // the app re-renders (a profile refresh, a route change) while the first tour is still waiting for the calendar: no second tour may start behind it
  await p.evaluate(() => { window.dispatchEvent(new HashChangeEvent('hashchange')); setTimeout(() => window.dispatchEvent(new HashChangeEvent('hashchange')), 120); });
  await p.waitForSelector('.day'); await p.waitForSelector('.tour'); await p.waitForTimeout(1500);
  ok('re-rendering while the tour is starting does not stack a second tour (one overlay, one card)', (await p.locator('.tour').count()) === 1 && (await p.locator('.tour-card').count()) === 1, `${await p.locator('.tour').count()} / ${await p.locator('.tour-card').count()}`);
  ok('phone, new user: the tour starts by itself with a welcome card', /Welcome/.test(await p.locator('.tour-title').innerText()) && (await p.locator('.tour-dot').count()) === 8);
  const bf = await p.locator('.tour-dim').first().evaluate((e) => getComputedStyle(e).backdropFilter + '|' + getComputedStyle(e).backgroundColor);
  ok('the page behind is blurred and dimmed (backdrop blur on the panels)', bf.includes('blur'), bf);
  if (process.env.SHOTS) await p.screenshot({ path: process.env.SHOTS + '/tour-0.png' });
  await p.tap('#tour-next');
  ok('after Next the welcome text is gone from the page', !(await p.locator('body').innerText()).includes('Take a quick tour'));
  for (let i = 0; i < TARGETS.length; i++) {
    await p.waitForTimeout(500);                                  // the spotlight glides to the next area
    const m = await p.evaluate((sel) => { const t = document.querySelector(sel).getBoundingClientRect(), r = document.querySelector('.tour-ring').getBoundingClientRect(); return { covers: r.left <= t.left + 1 && r.top <= t.top + 1 && r.right >= t.right - 1 && r.bottom >= t.bottom - 1, small: r.width < innerWidth * 1.2 }; }, TARGETS[i]);
    ok(`step ${i + 1}: the spotlight ring surrounds ${TARGETS[i]}`, m.covers && m.small, JSON.stringify(m));
    ok(`step ${i + 1}: the explanation card is fully on screen and shows a title`, (await inView(p)) && (await p.locator('.tour-title').innerText()).length > 2);
    if (process.env.SHOTS && i === 1) await p.screenshot({ path: process.env.SHOTS + '/tour-2.png' });
    if (process.env.SHOTS && i === 3) await p.screenshot({ path: process.env.SHOTS + '/tour-dash.png' });
    if (TARGETS[i] === '.grid .day.ctx') {                          // BOTH dashed days are highlighted: two rings, the second around the last dashed day
      const two = await p.evaluate(() => { const ctx = [...document.querySelectorAll('.grid .day.ctx')], rings = [...document.querySelectorAll('.tour-ring')].filter((r) => getComputedStyle(r).opacity === '1');
        const around = (r, el) => { const a = r.getBoundingClientRect(), b = el.getBoundingClientRect(); return a.left <= b.left + 1 && a.top <= b.top + 1 && a.right >= b.right - 1 && a.bottom >= b.bottom - 1; };
        return { n: ctx.length, rings: rings.length, first: around(rings[0], ctx[0]), last: around(rings[1], ctx[ctx.length - 1]) }; });
      ok('dashed-days step: both dashed days get their own spotlight ring', two.n === 2 && two.rings === 2 && two.first && two.last, JSON.stringify(two));
    }
    if (i < TARGETS.length - 1) await p.tap('#tour-next');
  }
  ok('the last step says Done', (await p.locator('#tour-next').innerText()) === 'Done');
  await p.tap('#tour-next'); await p.waitForSelector('.tour', { state: 'detached' });
  ok('finishing the tour removes it', (await p.locator('.tour').count()) === 0);
  await p.reload(); await p.waitForSelector('.day'); await p.waitForTimeout(1500);
  ok('...and it does not start again after a reload', (await p.locator('.tour').count()) === 0);
  await p.tap('.acct > summary');
  ok('the menu has "How to use the app" on a phone', (await p.locator('#guide-open').isVisible()));
  await p.tap('#guide-open'); await p.waitForSelector('.tour');
  ok('the menu entry starts the tour again', (await p.locator('.tour-dot').count()) === 8);
  await p.keyboard.press('Escape'); await p.waitForSelector('.tour', { state: 'detached' });
  ok('Esc skips the tour', (await p.locator('.tour').count()) === 0);
  ok('no page errors', p.errs.length === 0, p.errs.join('|'));
  await p.context().close(); }
// the Arabic tour: the letter legend must not display flipped ("Y. E" next to each other)
{ const ctx = await b.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true }); await ctx.addInitScript(() => { localStorage.setItem('lang', 'ar'); localStorage.setItem('ts.forceGuide', '1'); });
  const p = await ctx.newPage(); await p.goto('http://localhost:4173/'); await p.fill('#username', 'gdnew'); await p.fill('#password', PW); await p.click('button[type=submit]');
  await p.waitForSelector('.tour'); await p.tap('#tour-next'); await p.tap('#tour-next'); await p.waitForTimeout(600);
  const txt = await p.locator('.tour-text').innerText();
  ok('Arabic tour, step "tap a day": the sentences end in Arabic words (no "Y. E" run of Latin text)', txt.includes('ثم Y وهكذا. E يعني راحة') && !/[A-Za-z]\.\s+[A-Za-z]/.test(txt), txt);
  if (process.env.SHOTS) await p.screenshot({ path: process.env.SHOTS + '/tour-ar.png' });
  await p.keyboard.press('Escape'); await p.waitForSelector('.tour', { state: 'detached' });
  ok('Arabic: the credit reads "تطوير شادي منصور" with the name in the modern font', (await p.locator('main .credit').innerText()).includes('تطوير شادي منصور') && (await p.locator('main .credit .dev-name').evaluate((e) => document.fonts.check('800 20px "Cairo Name"', e.textContent))));
  // the Latin text of the totals chips (X: 5 ...) must sit in the vertical middle of the pill in Arabic as well
  const off = await p.evaluate(() => [...document.querySelectorAll('.totals .chip.s-x, .totals .chip.s-y, .totals .chip.s-xh, .totals .chip.s-yh')].map((c) => {
    const probe = document.createElement('span'); probe.style.cssText = 'display:inline-block;width:0;height:0'; c.append(probe);
    const base = probe.getBoundingClientRect().bottom, box = c.getBoundingClientRect(); probe.remove();
    const cs = getComputedStyle(c), ctx2 = document.createElement('canvas').getContext('2d'); ctx2.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const cap = ctx2.measureText('X').actualBoundingBoxAscent;
    return Math.round(((base - cap / 2) - (box.top + box.height / 2)) * 10) / 10;
  }));
  ok('Arabic: the X / Y / XH / YH totals are vertically centred in their pills (within 1px)', off.length === 4 && off.every((v) => Math.abs(v) <= 1), JSON.stringify(off));
  if (process.env.SHOTS) await p.locator('.totals').screenshot({ path: process.env.SHOTS + '/totals-ar.png' });
  await ctx.close(); }
{ const p = await open('gdold'); await p.waitForSelector('.day');
  await p.waitForTimeout(1500);
  ok('phone, an older account: no tour by itself', (await p.locator('.tour').count()) === 0);
  await p.tap('.acct > summary');
  ok('...but the menu entry is there', (await p.locator('#guide-open').isVisible()));
  await p.context().close(); }
{ const p = await open('gdnew', { phone: false }); await p.waitForSelector('.day'); await p.waitForSelector('.tour');
  ok('desktop: the tour starts by itself too (same 8 steps)', (await p.locator('.tour-dot').count()) === 8);
  await walk(p, 'desktop, user calendar');
  await p.click('.acct > summary');
  ok('desktop: the menu has "How to use the app"', await p.locator('#guide-open').isVisible());
  ok('no page errors', p.errs.length === 0, p.errs.join('|'));
  await p.context().close(); }
// a department admin (phone): the Department screen has its own tour, then his own calendar, then Overtime and Users through the menu
{ const p = await open('gdadm'); await p.waitForSelector('.tgrid'); await p.waitForSelector('.tour');
  ok('phone, admin: the Department screen tour starts by itself (8 steps)', (await p.locator('.tour-dot').count()) === 8 && /Department grid/.test(await p.locator('.tour-title').innerText()));
  await walk(p, 'phone, admin, Department screen');
  await p.click('.nav a:has(.lbl:text-is("My calendar"))'); await p.waitForSelector('.tour');
  ok('phone, admin: opening his own calendar (new account) starts the calendar tour (8 steps)', (await p.locator('.tour-dot').count()) === 8 && /Welcome/.test(await p.locator('.tour-title').innerText()));
  await p.keyboard.press('Escape'); await p.waitForSelector('.tour', { state: 'detached' });
  await p.click('.nav a:has(.lbl:text-is("Overtime"))'); await p.waitForSelector('.ot-day'); await p.waitForTimeout(800);
  ok('phone, admin: no automatic tour on Overtime', (await p.locator('.tour').count()) === 0);
  await menuGuide(p);
  ok('phone, admin: the menu starts the Overtime tour (6 steps, with the Scan step)', (await p.locator('.tour-dot').count()) === 6 && /Overtime/.test(await p.locator('.tour-title').innerText()));
  await walk(p, 'phone, admin, Overtime');
  await p.click('.nav a:has(.lbl:text-is("Users"))'); await p.waitForSelector('.person');
  await menuGuide(p);
  ok('phone, admin: the menu starts the Users tour (5 steps)', (await p.locator('.tour-dot').count()) === 5);
  await walk(p, 'phone, admin, Users');
  ok('no page errors', p.errs.length === 0, p.errs.join('|'));
  await p.context().close(); }
// a department manager (desktop)
{ const p = await open('gdmgr', { phone: false }); await p.waitForSelector('.tgrid'); await p.waitForSelector('.tour');
  ok('desktop, manager: the Department tour starts by itself (8 steps, no department switcher)', (await p.locator('.tour-dot').count()) === 8);
  await walk(p, 'desktop, manager, Department screen');
  ok('no page errors', p.errs.length === 0, p.errs.join('|'));
  await p.context().close(); }
// a super manager (desktop): read-only wording, with the department switcher step
{ const p = await open('gdsm', { phone: false }); await p.waitForSelector('.tgrid'); await p.waitForSelector('.tour');
  ok('desktop, super manager: the Department tour has the department step (9 steps) and says view only', (await p.locator('.tour-dot').count()) === 9 && (await p.locator('.tour-text').innerText()).includes('You can look and export'));
  await walk(p, 'desktop, super manager, Department screen');
  await p.click('.nav a:has(.lbl:text-is("Overtime"))'); await p.waitForSelector('.ot-day'); await menuGuide(p);
  ok('desktop, super manager: the Overtime tour has no Scan step (6 steps)', (await p.locator('.tour-dot').count()) === 6);
  await walk(p, 'desktop, super manager, Overtime');
  ok('no page errors', p.errs.length === 0, p.errs.join('|'));
  await p.context().close(); }
// a super admin (desktop): Departments, Super users, and the Department screen acting for a department
{ const p = await open('gdsa', { phone: false }); await p.waitForSelector('details.dept'); await p.waitForSelector('.tour');
  ok('desktop, super admin: the Departments tour starts by itself (6 steps)', (await p.locator('.tour-dot').count()) === 6 && /Departments/.test(await p.locator('.tour-title').innerText()));
  await walk(p, 'desktop, super admin, Departments');
  await p.click('.nav a:has(.lbl:text-is("Super users"))'); await p.waitForSelector('#add-super'); await menuGuide(p);
  ok('desktop, super admin: the Super users tour (4 steps)', (await p.locator('.tour-dot').count()) === 4);
  await walk(p, 'desktop, super admin, Super users');
  await p.click('.nav a:has(.lbl:text-is("Department"))'); await p.waitForSelector('.tgrid td.c'); await menuGuide(p);
  ok('desktop, super admin: the Department tour has the department step (9 steps)', (await p.locator('.tour-dot').count()) === 9);
  await walk(p, 'desktop, super admin, Department screen');
  ok('no page errors', p.errs.length === 0, p.errs.join('|'));
  await p.context().close(); }
cleanup();
await b.close();
console.log(fails ? `=== ${fails} FAILURES ===` : '=== ALL GUIDE TESTS PASSED ===');
