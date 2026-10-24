// Browser E2E for: live updates (several sessions at once), the Users tab (search / role filter / empty states) and the
// per-person timesheet editor, against the REAL Supabase project. Temporary lv* users / "LV *" departments (ids 90000000-...).
// Needs `npx vite preview --port 4173`, TS_DB_URL, Chromium. Usage: node tests/ui/live-users-person.mjs [screenshot-dir]
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
const S = process.argv[2] ?? tmpdir();
const sql = (q) => execSync(`psql "$TS_DB_URL" -X -q -At -c "${q.replace(/"/g, '\\"')}"`, { encoding: 'utf8' }).trim();
const PW = 'Lv-Pass-12345', DA = '90000000-0000-0000-0000-00000000000a', DB = '90000000-0000-0000-0000-00000000000b', DC = '90000000-0000-0000-0000-00000000000c';
const uid = (i) => `90000000-0000-0000-0000-0000000001${String(i).padStart(2, '0')}`;   // 0 admin1, 1-5 users, 6 admin2
const NAMES = { 0: 'ladm', 1: 'lu1', 2: 'lu2', 3: 'lu3', 4: 'lu4', 5: 'lu5', 6: 'ladm2' };
const B_ADM = '90000000-0000-0000-0000-000000000201', B_USER = '90000000-0000-0000-0000-000000000202', C_ADM = '90000000-0000-0000-0000-000000000301';
const cleanup = () => sql(`delete from auth.users where id::text ~ '^90000000-' or id in (select id from public.profiles where department_id::text ~ '^90000000-');   -- incl. people created through the UI during the test
  delete from public.departments where id::text ~ '^90000000-';
  delete from public.audit_log where (target_user is not null and target_user not in (select id from public.profiles)) or (department_id is not null and department_id not in (select id from public.departments));`);
cleanup();
sql(`insert into public.departments (id,name) values ('${DA}','LV Alpha'),('${DB}','LV Beta'),('${DC}','LV Gamma')`);
const people = [
  ...Object.entries(NAMES).map(([i, un]) => [uid(i), un, `LV ${un.toUpperCase()}`, `OPR-${un}`, DA, Number(i) === 0 || Number(i) === 6 ? 'admin' : 'user']),
  [B_ADM, 'lbadm', 'LV Beta Admin', 'OPR-LB1', DB, 'admin'], [B_USER, 'lbu', 'LV Beta User', 'OPR-LB2', DB, 'user'], [C_ADM, 'lnew', 'LV Gamma Admin', 'OPR-LG1', DC, 'admin'],
];
for (const [id, un, name, opr, dept, role] of people) sql(`
 insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change)
 values ('00000000-0000-0000-0000-000000000000','${id}','authenticated','authenticated','${un}@timesheet.local',crypt('${PW}',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',now(),now(),'','','','');
 insert into auth.identities (id,user_id,provider_id,identity_data,provider,last_sign_in_at,created_at,updated_at) values (gen_random_uuid(),'${id}','${id}','{"sub":"${id}"}','email',now(),now(),now());
 insert into public.profiles (id,username,full_name,opr,payroll,level,department_id,role) values ('${id}','${un}','${name}','${opr}','${opr}','2','${dept}','${role}');`);

const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0;
const ok = (l, c, extra = '') => { if (!c) fails++; console.log((c ? 'PASS: ' : 'FAIL: ') + l + (c ? '' : ' ' + extra)); };
const T = sql("select to_char(current_date,'YYYY-MM-DD')");
const eventually = async (fn, ms = 9000) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await fn()) return true; } catch { /* retry */ } await new Promise((r) => setTimeout(r, 250)); } return false; };
const st = (i, d = T) => sql(`select coalesce((select status from public.day_status where user_id='${uid(i)}' and day='${d}'),'E')`);

async function login(un, w = 390) {
  const ctx = await b.newContext({ viewport: { width: w, height: 800 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('ts.teamView', 'month'); } catch { /* ignore */ } });
  const p = await ctx.newPage(); p.errs = []; p.frames = { status: 0, other: 0, raw: [] }; p.rest = [];
  p.on('pageerror', (e) => p.errs.push(e.message));
  p.on('request', (r) => { if (r.url().includes('/rest/v1/')) p.rest.push(r.url()); });
  // Realtime v2 sends broadcasts as BINARY frames (topic + event "change" + JSON); count timesheet announcements on the wire.
  p.on('websocket', (ws) => ws.on('framereceived', (f) => { const s = typeof f.payload === 'string' ? f.payload : Buffer.from(f.payload).toString('utf8'); if (/"t":\s*"(day_status|overtime|holidays)"/.test(s)) { p.frames.status++; p.frames.raw.push(s); } else if (/"t":\s*"profiles?"/.test(s)) p.frames.other++; }));
  await p.goto('http://localhost:4173/'); await p.fill('#username', un); await p.fill('#password', PW); await p.click('button[type=submit]'); await p.waitForSelector('.topbar');
  return p;
}
// click the primary button of the open dialog; resolve when it closes, or throw with the dialog's own error text
const submit = async (p) => {
  await p.locator('dialog[open] button.primary').click();
  const r = await Promise.race([p.waitForSelector('dialog[open]', { state: 'detached', timeout: 60000 }).then(() => 'closed'),
    p.waitForFunction(() => document.querySelector('dialog[open] .error')?.textContent.length > 0, null, { timeout: 60000 }).then(async () => 'error: ' + await p.locator('dialog[open] .error').textContent())]).catch((e) => 'timeout');
  if (r !== 'closed') throw new Error('dialog did not close: ' + r);
};
const cellTeam = (p, i, d = T) => p.locator(`td.c[data-u="${uid(i)}"][data-d="${d}"]`);
const txt = async (loc) => (await loc.first().textContent())?.trim();
const gridReady = async (p) => { await p.waitForSelector('.tgrid tbody tr'); await p.waitForSelector('.live-dot.live', { timeout: 15000 }); };

// ============================================================ LIVE
const A = await login('ladm'); await gridReady(A);
const A2 = await login('ladm2'); await gridReady(A2);
const U = await login('lu1'); await U.waitForSelector('.day');
const Bp = await login('lbadm'); await gridReady(Bp);
ok('team grid shows a "Live" indicator once connected', (await txt(A.locator('.live-dot'))) === 'Live');

// 1) paint on A -> A2 sees it without reload
await cellTeam(A, 2).click();
ok('admin A paints lu2 = X', await eventually(() => st(2) === 'X'));
ok("admin A2's grid shows it LIVE (no reload)", await eventually(async () => (await txt(cellTeam(A2, 2))) === 'X'));
ok("headcount row on A2 updated too (X = 1)", await eventually(async () => (await A2.locator(`tfoot td.hc[aria-label]`).evaluateAll((els, T) => els.find((e, i) => true) && els.map((e) => e.getAttribute('aria-label')), T)).some((l) => l === 'X 1, Y 0')));

// 2) change made directly in the database (e.g. by another system) reaches an open user calendar
sql(`insert into public.day_status (user_id, day, status) values ('${uid(1)}', '${T}', 'X')`);
ok("user lu1's calendar shows X live after a database change", await eventually(async () => (await txt(U.locator('.day.today .st'))) === 'X'));

// 3) holiday toggled by A2 -> A header, lu1's calendar (XH)
await A2.locator(`th.dh[data-d="${T}"]`).click();
ok('A2 marked today as a holiday', await eventually(() => sql(`select count(*) from public.holidays where department_id='${DA}' and day='${T}'`) === '1'));
ok('admin A header turns amber (holiday) live', await eventually(async () => (await A.locator(`th.dh[data-d="${T}"]`).getAttribute('class')).includes('holiday')));
ok("user lu1's calendar shows XH live (holiday applied to their X)", await eventually(async () => (await txt(U.locator('.day.today .st'))) === 'XH'));
await A2.locator(`th.dh[data-d="${T}"]`).click();
ok('holiday removed -> lu1 back to X live', await eventually(async () => (await txt(U.locator('.day.today .st'))) === 'X'));

// 4) admin edits lu1 (status + overtime) via the grid dialog -> the user's own calendar updates live
await cellTeam(A, 1).click({ modifiers: ['Shift'] }); await A.waitForSelector('dialog[open]');
await A.locator('dialog[open] input[name=st][value=Y]').check(); await A.locator('dialog[open] input[type=number]').fill('2'); await A.locator('dialog[open] button.primary').click(); await A.waitForSelector('dialog[open]', { state: 'detached' });
ok("lu1's calendar shows Y and the +2h overtime strip live", await eventually(async () => (await txt(U.locator('.day.today .st'))) === 'Y' && (await txt(U.locator('.day.today .ot'))) === '+2h'));

// 5) overtime tab live
await A2.goto('http://localhost:4173/#/overtime'); await A2.waitForSelector('.ot-day'); await A2.waitForSelector('.live-dot, .ot-day');
const todayIdx = Number(T.slice(8)) - 1;
ok('overtime tab shows today = 2h (from lu1)', (await txt(A2.locator('.ot-day').nth(todayIdx).locator('.st'))) === '2h');
await cellTeam(A, 3).click({ modifiers: ['Shift'] }); await A.waitForSelector('dialog[open]');
await A.locator('dialog[open] input[type=number]').fill('3'); await A.locator('dialog[open] button.primary').click(); await A.waitForSelector('dialog[open]', { state: 'detached' });
ok("overtime tab on A2 updates LIVE to 5h (2 + 3) when A adds overtime", await eventually(async () => (await txt(A2.locator('.ot-day').nth(todayIdx).locator('.st'))) === '5h'));

// 6) users tab live
await A2.goto('http://localhost:4173/#/users'); await A2.waitForSelector('.person');
const before = await A2.locator('.person').count();
await A.goto('http://localhost:4173/#/users'); await A.waitForSelector('.person');
await A.click('button:text-is("Add user")'); await A.waitForSelector('dialog[open]');
await A.locator('dialog[open]').getByLabel('Username').fill('lvnew'); await A.locator('dialog[open]').getByLabel('Full name').fill('LV Brand New'); await A.locator('dialog[open]').getByLabel('OPR').fill('OPR-LVN'); await A.locator('dialog[open]').getByLabel('Payroll number').fill('PR-OPR-LVN');
await submit(A);
ok("users tab on A2 shows the new person LIVE", await eventually(async () => (await A2.locator('.person').count()) === before + 1 && (await A2.locator('.person:has-text("LV Brand New")').count()) === 1));
await A.locator('.person', { hasText: 'LV Brand New' }).locator('button:text-is("Delete")').click(); await A.locator('dialog[open] button.danger').click();
ok("...and when A deletes them, they disappear from A2 LIVE", await eventually(async () => (await A2.locator('.person:has-text("LV Brand New")').count()) === 0));

// 7) isolation on the wire: the other department's admin received NO timesheet announcements
ok(`admin of ANOTHER department received 0 timesheet broadcasts (while A2 received ${A2.frames.status})`, Bp.frames.status === 0 && A2.frames.status >= 3, `B=${Bp.frames.status} A2=${A2.frames.status}`);
ok('...and made no timesheet refetch caused by them', Bp.rest.filter((u) => u.includes('day_status')).length <= 2, String(Bp.rest.filter((u) => u.includes('day_status')).length));
ok("a plain user received announcements (their own days / holidays) and NONE of them carries a person list or hours, status or notes", U.frames.status >= 3 && U.frames.raw.every((m) => !/"(status|hours|note|u)":/.test(m)), U.frames.raw.slice(0, 2).join(' | '));

// 8) refresh button
await A.goto('http://localhost:4173/#/team'); await gridReady(A);
const n0 = A.rest.filter((u) => u.includes('day_status')).length;
await A.click('button[aria-label="Refresh"]'); await A.waitForTimeout(1200);
ok('Refresh button refetches from the server', A.rest.filter((u) => u.includes('day_status')).length > n0);

// 9) role / activation change reaches the person's open session
const P5 = await login('lu5'); await P5.waitForSelector('.day');
ok('lu5 starts as a plain user (one tab)', (await P5.locator('.nav a').allTextContents()).join('|') === 'My calendar');
sql(`update public.profiles set role='admin' where id='${uid(5)}'`);
ok('promoted by someone else -> lu5 gets the admin tabs LIVE and lands on the department grid', await eventually(async () => (await P5.locator('.nav a').allTextContents()).join('|') === 'Department|Overtime|Users|My calendar' && P5.url().endsWith('#/team')));
sql(`update public.profiles set role='user' where id='${uid(5)}'`);
ok('demoted -> back to the plain user view LIVE', await eventually(async () => (await P5.locator('.nav a').allTextContents()).join('|') === 'My calendar'));
sql(`update public.profiles set active=false, deleted_at=now() where id='${uid(5)}'`);
ok('deactivated -> the open session is sent to the login screen LIVE with an explanation', await eventually(async () => (await P5.locator('#username').count()) === 1 && (await P5.textContent('.error')).includes('not active')));

// 10) reconnect: a change made while a session was offline shows up after it comes back
await A2.goto('http://localhost:4173/#/team'); await gridReady(A2);
await A2.context().setOffline(true); await A2.waitForTimeout(1500);
sql(`insert into public.day_status (user_id, day, status) values ('${uid(4)}', '${T}', 'Y')`);
await A2.context().setOffline(false);
ok('after reconnecting, the grid catches up on what it missed (resync)', await eventually(async () => (await txt(cellTeam(A2, 4))) === 'Y', 80000));

// ============================================================ USERS TAB
await A.goto('http://localhost:4173/#/users'); await A.waitForSelector('.person');
const total = await A.locator('.person').count();
ok(`users list shows the department (${total} active people)`, total === 6);
ok('role filter chips carry counts (All 6 / Users 4 / Admins 2)', (await A.locator('.team-row > .seg:not(.view-seg)').textContent()).replace(/\s+/g, ' ').includes('All 6') && (await A.locator('.team-row > .seg:not(.view-seg)').textContent()).includes('Users 4') && (await A.locator('.team-row > .seg:not(.view-seg)').textContent()).includes('Admins 2'));
await A.fill('.team-search', 'lu2'); await A.waitForTimeout(400);
ok('search by username narrows to 1 and shows the counter 1/6', (await A.locator('.person').count()) === 1 && (await A.textContent('.team-count')) === '1/6');
await A.fill('.team-search', 'OPR-lu'); await A.waitForTimeout(400);
ok('search by OPR matches the users (OPR-lu1..4 = 4 active)', (await A.locator('.person').count()) === 4, String(await A.locator('.person').count()));
await A.fill('.team-search', 'brown fox'); await A.waitForTimeout(400);
ok('no match -> friendly message with a Clear filters button', (await A.locator('.empty').isVisible()) && (await A.locator('.empty').textContent()).includes('No one matches'));
await A.click('.empty button:text-is("Clear filters")'); await A.waitForTimeout(300);
ok('Clear filters restores everyone', (await A.locator('.person').count()) === 6 && (await A.inputValue('.team-search')) === '');
await A.click('.team-row > .seg button:has-text("Admins")');
ok('role filter "Admins" shows only the 2 admins', (await A.locator('.person').count()) === 2 && (await A.locator('.person .badge.admin').count()) === 2);
await A.click('.team-row > .seg button:has-text("Users")');
ok('role filter "Users" shows only plain users', (await A.locator('.person').count()) === 4 && (await A.locator('.person .badge.admin').count()) === 0);
await A.screenshot({ path: S + '/lv-users.png' });
// empty state: department with only its admin
const G = await login('lnew'); await G.goto('http://localhost:4173/#/users'); await G.waitForSelector('.person');
ok('a department with no employees shows a helpful empty state', (await G.locator('.empty').isVisible()) && (await G.locator('.empty').textContent()).includes('No employees yet'));
await G.click('.empty button:text-is("Add user")'); await G.waitForSelector('dialog[open]');
await G.locator('dialog[open]').getByLabel('Username').fill('lvg1'); await G.locator('dialog[open]').getByLabel('Full name').fill('LV Gamma One'); await G.locator('dialog[open]').getByLabel('OPR').fill('OPR-LG9'); await G.locator('dialog[open]').getByLabel('Payroll number').fill('PR-OPR-LG9');
await submit(G);
ok('...adding the first employee from it works and the empty state disappears', await eventually(async () => (await G.locator('.person:has-text("LV Gamma One")').count()) === 1 && (await G.locator('.empty').isHidden())));
await G.screenshot({ path: S + '/lv-empty.png' });

// ============================================================ PERSON TIMESHEET
await A.fill('.team-search', ''); await A.waitForTimeout(300); await A.click('.team-row > .seg button:has-text("All")');
await A.locator('.person', { hasText: 'LV LU2' }).locator('a:text-is("Timesheet")').click(); await A.waitForSelector('.person-head'); await A.waitForSelector('.day');
ok('Timesheet opens that person page with name, OPR, level and a month calendar', A.url().includes('#/person/' + uid(2)) && (await A.textContent('.person-head')).includes('LV LU2') && (await A.textContent('.person-head')).includes('OPR-lu2') && (await A.locator('.day').count()) > 27);
ok('a Back link is shown', (await A.locator('.back-link').count()) === 1);
const dayBtn = (p, d) => p.locator('.day').nth(d - 1);
const target = Number(T.slice(8)) <= 20 ? Number(T.slice(8)) + 3 : Number(T.slice(8)) - 3;   // a day other than today
const D2 = `${T.slice(0, 8)}${String(target).padStart(2, '0')}`;
await dayBtn(A, target).click(); await A.waitForTimeout(900);
ok("tap cycles the person's status: E -> X (written by the admin)", sql(`select status||'|'||(updated_by='${uid(0)}') from public.day_status where user_id='${uid(2)}' and day='${D2}'`) === 'X|true');
await dayBtn(A, target).click(); await A.waitForTimeout(900);
ok('second tap -> Y', (await st(2, D2)) === 'Y');
await dayBtn(A, target).click(); await A.waitForTimeout(900);
ok('third tap -> E (row removed)', (await st(2, D2)) === 'E' && sql(`select count(*) from public.day_status where user_id='${uid(2)}' and day='${D2}'`) === '0');
await A.click('.cal-mode button:has-text("details")');
await dayBtn(A, target).click(); await A.waitForSelector('dialog[open]');
ok('Details mode opens the day editor for that person and date', (await A.textContent('dialog[open] .muted')).includes('LV LU2'));
await A.locator('dialog[open] input[name=st][value=X]').check(); await A.locator('dialog[open] input[type=number]').fill('3'); await A.locator('dialog[open] input[type=text]').fill('ops cover'); await A.locator('dialog[open] button.primary').click(); await A.waitForSelector('dialog[open]', { state: 'detached' });
ok('status X + overtime 3h + note saved for that person', (await st(2, D2)) === 'X' && sql(`select hours||'|'||note||'|'||(entered_by='${uid(0)}') from public.overtime where user_id='${uid(2)}' and day='${D2}'`) === '3|ops cover|true');
ok('the calendar shows X with the amber +3h strip, and totals', (await txt(dayBtn(A, target).locator('.st'))) === 'X' && (await txt(dayBtn(A, target).locator('.ot'))) === '+3h' && (await A.textContent('.totals')).includes('Overtime: 3h'));
// admin is not bound by the user edit window
sql(`update public.settings set value='3'::jsonb where key='user_edit_window_days'`);
const oldDay = sql("select to_char(date_trunc('month', current_date)::date, 'YYYY-MM-DD')");
await A.reload(); await A.waitForSelector('.day');
await A.click('.cal-mode button:has-text("status")');
ok('even with a 3-day user edit window the admin can edit the 1st of the month (button enabled)', !(await dayBtn(A, 1).isDisabled()) || Number(T.slice(8)) <= 4);
sql(`update public.settings set value='null'::jsonb where key='user_edit_window_days'`);
// live inside the person view: lu2 edits their own calendar
const U2 = await login('lu2'); await U2.waitForSelector('.day');
await U2.locator('.day').nth(Number(T.slice(8)) - 1).click();
ok("the admin's person page shows the person's own edit LIVE", await eventually(async () => (await txt(dayBtn(A, Number(T.slice(8))).locator('.st'))) !== 'E'));
// access control of the route
await A.goto('http://localhost:4173/#/person/' + B_USER); await A.waitForSelector('.person-view');
ok("another department's person id shows 'not found' (nothing leaked)", await eventually(async () => (await A.textContent('.person-view')).includes('not found')) && (await A.locator('.person-head').count()) === 0);
await U2.evaluate((id) => { location.hash = '#/person/' + id; }, uid(1)); await U2.waitForTimeout(700);
ok('a plain user typing the person URL gets no timesheet editor', (await U2.locator('.person-head').count()) === 0 && (await U2.locator('.cal-mode').count()) === 0);
// from the grid: tap a name
await A.goto('http://localhost:4173/#/team'); await gridReady(A);
await A.locator('tbody th.nm', { hasText: 'LV LU3' }).click(); await A.waitForSelector('.person-head');
ok('tapping an employee name in the grid (Edit mode) opens their timesheet', A.url().includes('#/person/' + uid(3)) && (await A.textContent('.person-head')).includes('LV LU3'));
await A.click('.back-link'); await A.waitForSelector('.tgrid');
ok('Back returns to the grid', A.url().endsWith('#/team'));
// Arabic
await A.goto('http://localhost:4173/#/person/' + uid(2)); await A.waitForSelector('.person-head'); await A.click('text=العربية'); await A.waitForSelector('.cal-mode');
ok('Arabic: person page mode labels and hint', (await A.locator('.cal-mode').textContent()).includes('النقر') && (await (async () => { await A.click('.cal-tools button[aria-label="مساعدة"]'); await A.waitForSelector('dialog[open]'); const tx = await A.textContent('dialog[open]'); await A.keyboard.press('Escape'); return tx; })()).includes('اضغط على يوم'));
await A.screenshot({ path: S + '/lv-person-ar.png' });
await A.click('text=English'); await A.waitForSelector('.cal-mode'); await A.screenshot({ path: S + '/lv-person.png' });

for (const [n, pg] of Object.entries({ A, A2, U, Bp, P5, G, U2 })) ok(`no page errors in session ${n} ${JSON.stringify(pg.errs)}`, pg.errs.length === 0);
cleanup();
ok('cleanup removed every test row (real data untouched)', sql("select count(*) from auth.users where email ~ '^(lu|lb|ladm|lnew|lvg|lvnew)'") === '0' && sql("select count(*) from public.departments where name like 'LV %'") === '0');
await b.close();
console.log(fails ? `=== ${fails} FAILURES ===` : '=== ALL LIVE/USERS/PERSON TESTS PASSED ===');
