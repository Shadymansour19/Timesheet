// Browser E2E for the department grid v2 (search, totals, headcount, today/holiday columns, week view + swipe,
// painting banner, Undo, bulk-fill preview, export month picker) against the REAL Supabase project.
// Temporary tg* users / "TG *" departments (ids 80000000-...), removed afterwards.
// Needs `npx vite preview --port 4173`, TS_DB_URL, Chromium. Usage: node tests/ui/team-grid.mjs [screenshot-dir]
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import ExcelJS from 'exceljs';
const S = process.argv[2] ?? tmpdir();
const db = (q) => execSync(`psql "$TS_DB_URL" -X -q -At -c "${q.replace(/"/g, '\\"')}"`, { encoding: 'utf8' }).trim();
const PW = 'Tg-Pass-12345', DA = '80000000-0000-0000-0000-00000000000a', DB = '80000000-0000-0000-0000-00000000000b';
const uid = (i) => `80000000-0000-0000-0000-0000000001${String(i).padStart(2, '0')}`;   // 0 = admin, 1..25 users
const OTHER = '80000000-0000-0000-0000-0000000002ff';
const cleanup = () => db(`delete from auth.users where id::text like '80000000%'; delete from public.departments where id in ('${DA}','${DB}');
  delete from public.audit_log where (target_user is not null and target_user not in (select id from public.profiles)) or (department_id is not null and department_id not in (select id from public.departments));`);
cleanup();
db(`insert into public.departments (id,name) values ('${DA}','TG Operations'),('${DB}','TG Other')`);
db(`insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change)
    select '00000000-0000-0000-0000-000000000000', id, 'authenticated','authenticated', un||'@timesheet.local', crypt('${PW}',gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}','{}', now(), now(), '','','','' from (
      select ('80000000-0000-0000-0000-0000000001'||lpad(i::text,2,'0'))::uuid id, case when i=0 then 'tgadm' else 'tgu'||lpad(i::text,2,'0') end un from generate_series(0,25) i
      union all select '${OTHER}'::uuid, 'tgother') q;
    insert into auth.identities (id,user_id,provider_id,identity_data,provider,last_sign_in_at,created_at,updated_at)
    select gen_random_uuid(), id, id::text, json_build_object('sub', id), 'email', now(), now(), now() from auth.users where id::text like '80000000%';
    insert into public.profiles (id,username,full_name,opr,level,department_id,role)
    select ('80000000-0000-0000-0000-0000000001'||lpad(i::text,2,'0'))::uuid, case when i=0 then 'tgadm' else 'tgu'||lpad(i::text,2,'0') end,
           case when i=0 then 'TG Admin' else 'TG User '||lpad(i::text,2,'0') end, 'OPR-TG'||lpad(i::text,2,'0'), 1, '${DA}', case when i=0 then 'admin' else 'user' end from generate_series(0,25) i;
    insert into public.profiles (id,username,full_name,opr,level,department_id,role) values ('${OTHER}','tgother','TG Other Dept Person','OPR-TGX',1,'${DB}','user');`);
// today: users 1-10 = X, 11-14 = Y; the other department has X today too (must never count)
db(`insert into public.day_status (user_id, day, status)
    select ('80000000-0000-0000-0000-0000000001'||lpad(i::text,2,'0'))::uuid, current_date, case when i<=10 then 'X' else 'Y' end from generate_series(1,14) i;
    insert into public.day_status (user_id, day, status) values ('${OTHER}', current_date, 'X'), ('${uid(1)}', current_date - 1, 'X'), ('${uid(1)}', current_date + 1, 'Y');
    insert into public.overtime (user_id, day, hours) values ('${uid(1)}', current_date, 3), ('${OTHER}', current_date, 9);
    insert into public.holidays (department_id, day) values ('${DA}', current_date + 2);`);

const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0;
const ok = (l, c, extra = '') => { if (!c) fails++; console.log((c ? 'PASS: ' : 'FAIL: ') + l + (c ? '' : ' ' + extra)); };
const T = db("select to_char(current_date,'YYYY-MM-DD')");
const st = (i, d) => db(`select coalesce((select status from public.day_status where user_id='${uid(i)}' and day='${d}'),'E')`);
const snapshot = () => db(`select coalesce(string_agg(user_id||'|'||day||'|'||status, ',' order by user_id, day),'') from public.day_status where user_id::text like '80000000%'`);
async function open(w, extra = {}) {
  const ctx = await b.newContext({ viewport: { width: w, height: 800 }, acceptDownloads: true, ...extra });
  const p = await ctx.newPage(); p.errs = []; p.on('pageerror', (e) => p.errs.push(e.message));
  await p.goto('http://localhost:4173/'); await p.fill('#username', 'tgadm'); await p.fill('#password', PW); await p.click('button[type=submit]');
  await p.waitForSelector('.tgrid tbody tr'); await p.waitForTimeout(300);
  return p;
}
const cell = (p, i, d) => p.locator(`td.c[data-u="${uid(i)}"][data-d="${d}"]`);
const modeBtn = (p, label) => p.locator(`.team-row.tools .seg button:text-is("${label}")`);
const undoBtn = (p) => p.locator('.team-row.tools button:has(svg):has-text("Undo"), .team-row.tools button:has-text("Undo")').first();
const settle = (p) => p.waitForTimeout(900);
const days = (p) => p.locator('th.dh').evaluateAll((els) => els.map((e) => e.dataset.d));
const title = async (p) => (await p.locator('.cal-head h2').textContent()).trim();
const plus = (d, n) => db(`select to_char('${d}'::date + ${n},'YYYY-MM-DD')`);
const waitFirst = (pg, d) => pg.waitForFunction((d) => document.querySelector('th.dh')?.dataset.d === d && !document.querySelector('.gridwrap.loading'), d, { timeout: 8000 }).catch(() => {});
const swipe = (p, dx, dy = 0) => p.evaluate(({ dx, dy }) => {
  const w = document.querySelector('.gridwrap');
  const mk = (type, x, y) => new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [new Touch({ identifier: 1, target: w, clientX: x, clientY: y })], changedTouches: [new Touch({ identifier: 1, target: w, clientX: x, clientY: y })] });
  w.dispatchEvent(mk('touchstart', 200, 300)); w.dispatchEvent(mk('touchend', 200 + dx, 300 + dy));
}, { dx, dy });

// ================= phone =================
const p = await open(390, { hasTouch: true });
ok('phone defaults to WEEK view: 7 day columns', (await p.locator('th.dh').count()) === 7);
ok('week grid fits the phone: no sideways scrolling', await p.locator('.gridwrap').evaluate((e) => e.scrollWidth <= e.clientWidth + 1));
ok('subtitle: department name and 26 employees (other department excluded)', (await p.textContent('.dept-sub')).includes('TG Operations') && (await p.textContent('.dept-sub')).includes('26 employees') && (await p.locator('.tgrid tbody tr').count()) === 26);
ok("today's column is highlighted in the header", (await p.locator('th.dh.today').count()) === 1 && (await p.locator('th.dh.today').getAttribute('data-d')) === T);
ok('today column cells carry the marker too', (await p.locator('td.c.today').count()) === 26);
const wk = await days(p);
const holDay = db("select to_char(current_date + 2,'YYYY-MM-DD')");
if (wk.includes(holDay)) {
  ok('holiday header has the amber holiday style', await p.locator(`th.dh[data-d="${holDay}"]`).evaluate((e) => e.classList.contains('holiday') && getComputedStyle(e).backgroundColor === 'rgb(253, 230, 138)'));
  ok('holiday cells (E) are tinted, not plain', (await cell(p, 20, holDay).evaluate((e) => e.classList.contains('holiday'))) && (await cell(p, 20, holDay).evaluate((e) => getComputedStyle(e).backgroundColor)) !== (await cell(p, 20, T).evaluate((e) => getComputedStyle(e).backgroundColor)));
}
ok('no weekend shading: only holiday/today classes on headers', await p.locator('th.dh').evaluateAll((els) => els.every((e) => [...e.classList].every((c) => ['dh', 'holiday', 'today', 'pick'].includes(c)))));
const first = wk[0], last = wk[6];
const range = `d.user_id='${uid(1)}' and d.day between '${first}' and '${last}'`;
const isHol = `exists (select 1 from public.holidays h where h.department_id='${DA}' and h.day=d.day)`;
const n = (sql) => Number(db(sql));
const expected = [
  [n(`select count(*) from public.day_status d where ${range} and d.status='X' and not ${isHol}`), 'X'],
  [n(`select count(*) from public.day_status d where ${range} and d.status='Y' and not ${isHol}`), 'Y'],
  [n(`select count(*) from public.day_status d where ${range} and d.status='X' and ${isHol}`), 'XH'],
  [n(`select count(*) from public.day_status d where ${range} and d.status='Y' and ${isHol}`), 'YH'],
  [n(`select coalesce(sum(hours),0) from public.overtime d where ${range}`), 'h'],
].filter(([c]) => c > 0).map(([c, k]) => `${c}${k}`);
const shown = await p.locator(`tr[data-u="${uid(1)}"] .tp`).allTextContents();
ok(`per-person totals under the name equal the database for the shown week (${shown.join(' ')})`, JSON.stringify(shown) === JSON.stringify(expected), `${shown} vs ${expected}`);
const row1Totals = shown.join(' ');
ok('totals line shows X, Y and overtime hours for user 01', /\dX/.test(row1Totals) && row1Totals.includes('3h'), row1Totals);
const hx = (await p.locator(`tfoot td.hc[aria-label]`).evaluateAll((els, d) => els.map((e) => e.getAttribute('aria-label')), 0));
const idxToday = wk.indexOf(T);
ok('headcount row: today = X 10, Y 4 (whole department, other department not counted)', hx[idxToday] === 'X 10, Y 4', hx.join(' | '));
ok('headcount row label present', (await p.locator('tfoot th').textContent()).includes('Headcount'));
const fitsScreen = async (pg, h) => { const fb = await pg.locator('tfoot th').boundingBox(), wb = await pg.locator('.gridwrap').boundingBox(); return fb && wb && fb.y >= 0 && fb.y + fb.height <= h + 1 && wb.y + wb.height <= h + 1; };
ok('headcount row is visible on screen without scrolling the page (phone)', await fitsScreen(p, 800), JSON.stringify([await p.locator('tfoot th').boundingBox(), await p.locator('.gridwrap').boundingBox()]));
const pill = await p.locator(`tr[data-u="${uid(1)}"] .tp`).evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
ok('totals chips sit on one line (compact), not stacked', new Set(pill).size === 1, pill.join());
await p.screenshot({ path: S + '/tg-phone-week.png' });

// search
await p.fill('.team-search', 'tgu07'); await p.waitForTimeout(400);
ok('search narrows rows to the match; counter shows 1/26', (await p.locator('.tgrid tbody tr').count()) === 1 && (await p.textContent('.team-count')) === '1/26');
const hxFiltered = await p.locator('tfoot td.hc[aria-label]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
ok('headcount still counts the whole department while filtering', hxFiltered[idxToday] === 'X 10, Y 4');
await p.fill('.team-search', 'zzzz'); await p.waitForTimeout(400);
ok('no match -> friendly message', (await p.locator('.tgrid tbody tr').count()) === 0 && (await p.locator('p:has-text("No employee matches")').isVisible()));
await p.fill('.team-search', 'opr-tg0'); await p.waitForTimeout(400);
ok('search also matches OPR (OPR-TG00..09 = 10 people)', (await p.locator('.tgrid tbody tr').count()) === 10);
await p.fill('.team-search', ''); await p.waitForTimeout(400);
ok('clearing restores all 26', (await p.locator('.tgrid tbody tr').count()) === 26 && (await p.textContent('.team-count')) === '');

// week navigation + swipe
const t0 = await title(p);
await swipe(p, -120); await waitFirst(p, plus(first, 7));
const w2 = await days(p);
ok('swipe LEFT = next week (+7 days)', w2[0] === plus(first, 7) && (await title(p)) !== t0, `${w2[0]}`);
await swipe(p, 120); await waitFirst(p, first);
ok('swipe RIGHT = back to the previous week', (await days(p))[0] === first);
await swipe(p, -120, 200); await p.waitForTimeout(700);
ok('a mostly-vertical gesture does NOT change the week', (await days(p))[0] === first);
await p.click('.cal-head button >> nth=1'); await waitFirst(p, plus(first, 7));
ok('the › button also advances a week', (await days(p))[0] === plus(first, 7));
await p.click('.cal-head button >> nth=2'); await waitFirst(p, first);
ok('Today returns to the current week', (await days(p))[0] === first && (await p.locator('th.dh.today').count()) === 1);

// painting banner + undo (exact state)
ok('banner is hidden in Edit mode', await p.locator('.banner').isHidden());
await modeBtn(p, 'X').click();
ok('painting banner appears: "Painting X"', (await p.locator('.banner').isVisible()) && (await p.locator('.banner').textContent()).includes('Painting X'));
const before = snapshot();
ok('Undo is disabled when there is nothing to undo', await undoBtn(p).isDisabled());
await cell(p, 20, T).click(); await cell(p, 21, T).click(); await cell(p, 22, T).click(); await settle(p);
ok('painted 3 cells -> X in the database', (await st(20, T)) === 'X' && (await st(21, T)) === 'X' && (await st(22, T)) === 'X');
ok('one paint stroke = ONE undo step: button says Undo (1)', (await undoBtn(p).textContent()).includes('(1)') && !(await undoBtn(p).isDisabled()));
await undoBtn(p).click(); await settle(p);
ok('Undo restores the exact previous state (3 cells back to E)', snapshot() === before && (await st(20, T)) === 'E');
ok('...and the grid shows E again', (await cell(p, 20, T).textContent()) === 'E');
ok('Undo disabled again', await undoBtn(p).isDisabled());
await modeBtn(p, 'E').click(); await cell(p, 1, T).click(); await settle(p);
ok('painting E over an X clears it', (await st(1, T)) === 'E');
await undoBtn(p).click(); await settle(p);
ok('Undo brings the X back, overtime untouched', (await st(1, T)) === 'X' && db(`select hours from public.overtime where user_id='${uid(1)}' and day='${T}'`) === '3');
await p.locator('.banner button').click();
ok('Done returns to Edit mode and hides the banner', await p.locator('.banner').isHidden());
// holiday toggle + undo
await modeBtn(p, 'Holiday').click();
ok('holiday banner shown', (await p.locator('.banner').textContent()).includes('Holiday mode'));
await p.locator(`th.dh[data-d="${T}"]`).click(); await settle(p);
ok('holiday marked for today', db(`select count(*) from public.holidays where department_id='${DA}' and day='${T}'`) === '1' && (await cell(p, 1, T).textContent()).startsWith('XH'));
await undoBtn(p).click(); await settle(p);
ok('Undo removes the holiday again (XH back to X)', db(`select count(*) from public.holidays where department_id='${DA}' and day='${T}'`) === '0' && (await cell(p, 1, T).textContent()).startsWith('X') && !(await cell(p, 1, T).textContent()).startsWith('XH'));
await modeBtn(p, 'Edit').click();
// edit dialog status change -> undo step
await cell(p, 23, T).click(); await p.waitForSelector('dialog[open]');
await p.locator('dialog[open] input[name=st][value=Y]').check(); await p.locator('dialog[open] button.primary').click(); await p.waitForSelector('dialog[open]', { state: 'detached' });
ok('edit dialog change is undoable', (await st(23, T)) === 'Y' && (await undoBtn(p).textContent()).includes('(1)'));
await undoBtn(p).click(); await settle(p);
ok('...and undone exactly', (await st(23, T)) === 'E');

// ---- bulk fill: live preview, apply, Undo from the toast, nothing-to-change
const todayCells = Number(db(`select count(*) from public.day_status where status='X' and day='${T}' and user_id::text like '80000000%' and user_id <> '${OTHER}'`));   // 10
await p.click('button:text-is("Bulk fill")'); await p.waitForSelector('dialog[open]');
await p.locator('dialog[open] input[type=date]').nth(0).fill(T); await p.locator('dialog[open] input[type=date]').nth(1).fill(db(`select to_char(current_date+3,'YYYY-MM-DD')`));
await p.locator('dialog[open] select').selectOption('X');
await p.waitForFunction(() => /cells will change/.test(document.querySelector('dialog[open] .bulk-preview')?.textContent ?? ''));
const expectChange = 26 * 4 - Number(db(`select count(*) from public.day_status where status='X' and day between '${T}' and (current_date+3) and user_id::text like '80000000%' and user_id <> '${OTHER}'`));
ok(`preview says exactly how many cells change (${expectChange} of 104)`, (await p.locator('dialog[open] .bulk-preview').textContent()).startsWith(`${expectChange} cells will change (104 selected)`), await p.locator('dialog[open] .bulk-preview').textContent());
await p.locator('dialog[open] label.check.strong input').uncheck();
await p.waitForFunction(() => /Select at least/.test(document.querySelector('dialog[open] .bulk-preview')?.textContent ?? ''), null, { timeout: 5000 });
ok('with nobody selected the preview asks for a selection', (await p.locator('dialog[open] .bulk-preview').textContent()).includes('Select at least one person'));
await p.locator('dialog[open] label.check.strong input').check();
await p.waitForFunction(() => /cells will change/.test(document.querySelector('dialog[open] .bulk-preview')?.textContent ?? ''));
const snapBefore = snapshot();
await p.locator('dialog[open] button.primary').click(); await p.waitForSelector('dialog[open]', { state: 'detached' });
await p.waitForSelector('.toast .toast-action');
ok('bulk fill wrote all 26 people x 4 days as X (incl. days beyond the visible week)', db(`select count(*) from public.day_status where status='X' and day between '${T}' and (current_date+3) and user_id::text like '80000000%' and user_id <> '${OTHER}'`) === '104');
ok('...a toast reports it and offers Undo', (await p.locator('.toast').first().textContent()).includes(`${expectChange} cells updated.`) && (await p.locator('.toast-action').textContent()) === 'Undo');
ok('other department untouched by bulk fill', db(`select status from public.day_status where user_id='${OTHER}' and day='${T}'`) === 'X' && db(`select count(*) from public.day_status where user_id='${OTHER}'`) === '1');
await p.locator('.toast-action').click(); await settle(p);
ok('Undo from the toast restores the EXACT previous cells (mixed X/Y/E all back)', snapshot() === snapBefore);
// applying a status that is already there
await p.click('button:text-is("Bulk fill")'); await p.waitForSelector('dialog[open]');
await p.locator('dialog[open] input[type=date]').nth(0).fill(T); await p.locator('dialog[open] input[type=date]').nth(1).fill(T);
await p.locator('dialog[open] select').selectOption('E');
await p.locator('dialog[open] label.check.strong input').uncheck();
await p.locator('dialog[open] label.check:has-text("TG User 20") input').check();
await p.waitForFunction(() => /^0 cells will change/.test(document.querySelector('dialog[open] .bulk-preview')?.textContent ?? ''), null, { timeout: 5000 });
ok('preview: 0 cells will change when they already have that status', (await p.locator('dialog[open] .bulk-preview').textContent()).startsWith('0 cells will change (1 selected)'));
await p.locator('dialog[open] button.primary').click(); await p.waitForSelector('dialog[open]', { state: 'detached' });
ok('applying with 0 changes says "Nothing to change" and writes nothing', (await p.locator('.toast').last().textContent()).includes('Nothing to change') && snapshot() === snapBefore);

// ---- view toggle: month
await p.locator('.team-row .seg:not(.tools .seg) button:text-is("Month"), .team-row > .seg button:text-is("Month")').first().click(); await p.waitForTimeout(900);
const nM = Number(db("select extract(day from (date_trunc('month',current_date)+interval '1 month - 1 day'))"));
ok(`Month view: one column per day (${nM}) and it scrolls sideways on a phone`, (await p.locator('th.dh').count()) === nM && await p.locator('.gridwrap').evaluate((e) => e.scrollWidth > e.clientWidth + 50));
const tb = await p.locator('th.dh.today').boundingBox(), wb = await p.locator('.gridwrap').boundingBox();
ok('Month view auto-scrolls so today is visible', tb && tb.x >= wb.x && tb.x + tb.width <= wb.x + wb.width + 1, JSON.stringify({ tb, wb }));
ok('the chosen view is remembered on this device', await p.evaluate(() => localStorage.getItem('ts.teamView')) === 'month');
await p.reload(); await p.waitForSelector('.tgrid tbody tr');
ok('after reload the grid opens in Month view', (await p.locator('th.dh').count()) === nM);
await p.locator('.team-row > .seg button:text-is("Week")').click(); await p.waitForTimeout(900);
ok('switching back to Week works', (await p.locator('th.dh').count()) === 7);

// ---- export asks for a month, independent of the view
const [dl] = await Promise.all([p.waitForEvent('download'), (async () => { await p.click('button:text-is("Export")'); await p.waitForSelector('dialog[open]'); await p.locator('dialog[open] button.primary').click(); })()]);
const cur = T.slice(0, 7);
ok('export (opened from Week view) defaults to the current month', dl.suggestedFilename() === `timesheet_TG_Operations_${cur}.xlsx`, dl.suggestedFilename());
await dl.saveAs(S + '/tg-export.xlsx');
const wb2 = new ExcelJS.Workbook(); await wb2.xlsx.readFile(S + '/tg-export.xlsx'); const ws = wb2.worksheets[0];
let r1 = -1; for (let r = 6; r < 40; r++) if (ws.getCell(r, 2).value === 'TG User 01') r1 = r;
ok('exported file has all 26 TG employees and none from the other department', (() => { let n = 0, other = 0; for (let r = 6; r < 40; r++) { const v = ws.getCell(r, 2).value; if (typeof v === 'string' && v.startsWith('TG User') || v === 'TG Admin') n++; if (v === 'TG Other Dept Person') other++; } return n === 26 && other === 0; })());
const wsToday = wb2.getWorksheet(String(Number(T.slice(8)))); let rT = -1; for (let r = 9; r < 40; r++) if (wsToday.getCell(r, 2).value === 'TG User 01') rT = r;
ok('exported day sheet for today: user 01 has status X', rT > 0 && wsToday.getCell(rT, 6).value === 'X');
const [dl2] = await Promise.all([p.waitForEvent('download'), (async () => { await p.click('button:text-is("Export")'); await p.waitForSelector('dialog[open]'); await p.locator('dialog[open] input[type=month]').fill('2030-02'); await p.locator('dialog[open] button.primary').click(); })()]);
ok('export for a chosen month (2030-02) names the file accordingly', dl2.suggestedFilename() === 'timesheet_TG_Operations_2030-02.xlsx', dl2.suggestedFilename());

// ---- Arabic
await p.click('text=العربية'); await p.waitForSelector('.tgrid');
ok('Arabic: view toggle, headcount label and search placeholder', (await p.locator('.team-row > .seg').first().textContent()).includes('أسبوع') && (await p.locator('tfoot th').textContent()).includes('العدد') && (await p.getAttribute('.team-search', 'placeholder')) === 'بحث عن موظف');
await modeBtn(p, 'X').click();
ok('Arabic painting banner', (await p.locator('.banner').textContent()).includes('تلوين X'));
await p.screenshot({ path: S + '/tg-phone-ar.png' });
ok('phone: no page errors ' + JSON.stringify(p.errs), p.errs.length === 0);

// ================= desktop =================
const d = await open(1280);
ok('desktop defaults to MONTH view and the month fits without sideways scrolling', (await d.locator('th.dh').count()) === nM && await d.locator('.gridwrap').evaluate((e) => e.scrollWidth <= e.clientWidth + 1), await d.locator('.gridwrap').evaluate((e) => `${e.scrollWidth}/${e.clientWidth}`));
ok('desktop shows the OPR beside the totals under each name', await d.locator('.opr').first().isVisible());
ok('toolbar is pinned (sticky) while the grid scrolls', (await d.locator('.team-top').evaluate((e) => getComputedStyle(e).position)) === 'sticky');
ok('headcount row is visible on screen without scrolling the page (desktop)', await fitsScreen(d, 800), JSON.stringify([await d.locator('tfoot th').boundingBox(), await d.locator('.gridwrap').boundingBox()]));
await d.screenshot({ path: S + '/tg-desktop.png' });
ok('desktop: no page errors ' + JSON.stringify(d.errs), d.errs.length === 0);

cleanup();
ok('cleanup removed every test row (real data untouched)', db("select count(*) from auth.users where email like 'tg%@timesheet.local'") === '0' && db("select count(*) from public.departments where name like 'TG %'") === '0');
await b.close();
console.log(fails ? `=== ${fails} FAILURES ===` : '=== ALL TEAM-GRID TESTS PASSED ===');
