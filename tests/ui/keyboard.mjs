// Browser E2E for keyboard use in the department grid (ARIA grid, roving tabindex, X/Y/E, Delete, Enter, H, Ctrl+Z,
// RTL, focus kept across redraws, accessibility labels) on the REAL Supabase project.
// Temporary kb* users / "KB *" departments (ids 36000000-...), removed afterwards.
// Needs `npx vite preview --port 4173` (or BASE_URL=...), TS_DB_URL, Chromium. Usage: node tests/ui/keyboard.mjs [screenshot-dir]
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
const S = process.argv[2] ?? tmpdir();
const BASE = process.env.BASE_URL ?? 'http://localhost:4173';
const sql = (q) => execSync(`psql "$TS_DB_URL" -X -q -At -c "${q.replace(/"/g, '\\"')}"`, { encoding: 'utf8' }).trim();
const PW = 'Kb-Pass-12345', DA = '36000000-0000-0000-0000-00000000000a', DB = '36000000-0000-0000-0000-00000000000b';
const uid = (i) => `36000000-0000-0000-0000-0000000001${String(i).padStart(2, '0')}`;   // 0 = admin, 1..6 users
const OTHER = '36000000-0000-0000-0000-0000000002ff';
const cleanup = () => sql(`delete from auth.users where id::text ~ '^36000000-' or id in (select id from public.profiles where department_id::text ~ '^36000000-');
  delete from public.departments where id::text ~ '^36000000-';
  delete from public.audit_log where (target_user is not null and target_user not in (select id from public.profiles)) or (department_id is not null and department_id not in (select id from public.departments));`);
cleanup();
sql(`insert into public.departments (id,name) values ('${DA}','KB Dept'),('${DB}','KB Other')`);
sql(`insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change)
     select '00000000-0000-0000-0000-000000000000', id, 'authenticated','authenticated', un||'@timesheet.local', crypt('${PW}',gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}','{}', now(), now(), '','','','' from (
       select ('36000000-0000-0000-0000-0000000001'||lpad(i::text,2,'0'))::uuid id, case when i=0 then 'kbadm' else 'kbu'||i end un from generate_series(0,6) i union all select '${OTHER}'::uuid, 'kbother') q;
     insert into auth.identities (id,user_id,provider_id,identity_data,provider,last_sign_in_at,created_at,updated_at)
     select gen_random_uuid(), id, id::text, json_build_object('sub', id), 'email', now(), now(), now() from auth.users where id::text like '36000000%';
     insert into public.profiles (id,username,full_name,opr,level,department_id,role)
     select ('36000000-0000-0000-0000-0000000001'||lpad(i::text,2,'0'))::uuid, case when i=0 then 'kbadm' else 'kbu'||i end, case when i=0 then 'KB Admin' else 'KB User '||i end,
            'OPR-KB'||i, 1, '${DA}', case when i=0 then 'admin' else 'user' end from generate_series(0,6) i;
     insert into public.profiles (id,username,full_name,opr,level,department_id,role) values ('${OTHER}','kbother','KB Other Person','OPR-KBX',1,'${DB}','user');`);

const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0;
const ok = (l, c, extra = '') => { if (!c) fails++; console.log((c ? 'PASS: ' : 'FAIL: ') + l + (c ? '' : ' ' + extra)); };
const T = sql("select to_char(current_date,'YYYY-MM-DD')");
const nDays = Number(sql("select extract(day from (date_trunc('month',current_date)+interval '1 month - 1 day'))"));
const eventually = async (fn, ms = 9000) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await fn()) return true; } catch { /* retry */ } await new Promise((r) => setTimeout(r, 200)); } return false; };
const st = (i, d = T) => sql(`select coalesce((select status from public.day_status where user_id='${uid(i)}' and day='${d}'),'E')`);
const dayN = (d) => Number(d.slice(8));

async function open(w, { month = true } = {}) {
  const ctx = await b.newContext({ viewport: { width: w, height: 800 } });
  if (month) await ctx.addInitScript(() => { try { localStorage.setItem('ts.teamView', 'month'); } catch { /* ignore */ } });
  const p = await ctx.newPage(); p.errs = []; p.on('pageerror', (e) => p.errs.push(e.message));
  await p.goto(BASE + '/'); await p.fill('#username', 'kbadm'); await p.fill('#password', PW); await p.click('button[type=submit]');
  await p.waitForSelector('.tgrid tbody tr'); await p.waitForTimeout(400);
  return p;
}
const cell = (p, i, d = T) => p.locator(`td.c[data-u="${uid(i)}"][data-d="${d}"]`);
const nameCell = (p, i) => p.locator(`tr[data-u="${uid(i)}"] th.nm`);
const active = (p) => p.evaluate(() => { const a = document.activeElement; const tr = a?.closest?.('tr'); return a && tr ? { u: tr.dataset.u, d: a.dataset?.d ?? null, name: a.matches('th.nm') } : null; });
const at = async (p, i, d) => { const a = await active(p); return a && a.u === uid(i) && (d === 'name' ? a.name : a.d === d); };
const key = (p, k) => p.keyboard.press(k);
const undoBtn = (p) => p.locator('.team-row.tools button:has-text("Undo")').first();
const plus = (d, n) => sql(`select to_char('${d}'::date + ${n},'YYYY-MM-DD')`);

const p = await open(1280);
ok('grid exposes role="grid" and keyboard-shortcut hints for assistive tech', (await p.locator('table.tgrid').getAttribute('role')) === 'grid' && (await p.locator('table.tgrid').getAttribute('aria-keyshortcuts')).includes('Control+Z'));
ok('exactly ONE cell is in the tab order (roving tabindex)', (await p.locator('tbody [tabindex="0"]').count()) === 1);
const first = await p.locator('tbody [tabindex="0"]').evaluate((e) => ({ u: e.closest('tr').dataset.u, d: e.dataset.d }));
ok("...and it is today's cell of the first row", first.u === uid(0) && first.d === T, JSON.stringify(first));
ok('...and it HAS keyboard focus right after the page loads (shortcuts work immediately)', await at(p, 0, T), JSON.stringify(await active(p)));
ok('cells have descriptive labels (name, weekday, date, status)', /KB Admin, \w+ \d+ \w+: E/.test(await cell(p, 0).getAttribute('aria-label')) || /KB Admin, .*: E/.test(await cell(p, 0).getAttribute('aria-label')), await cell(p, 0).getAttribute('aria-label'));
// Tab enters the grid on that single cell and leaves after it
await p.locator('button[aria-label="How this grid works"]').focus(); await key(p, 'Tab');
ok('Tab from the toolbar lands on the active cell', await at(p, 0, T), JSON.stringify(await active(p)));
await key(p, 'Tab');
ok('the next Tab leaves the grid (no tab stop on every cell)', !(await active(p))?.d);
await cell(p, 0).focus();

// ---- arrows / Home / End / PageDown
const startN = dayN(T);
await key(p, 'ArrowRight');
ok('ArrowRight = next day', startN < nDays ? await at(p, 0, plus(T, 1)) : await at(p, 0, T));
await key(p, 'ArrowLeft'); ok('ArrowLeft = back', await at(p, 0, T));
await key(p, 'ArrowDown'); ok('ArrowDown = next person, same day', await at(p, 1, T));
await key(p, 'ArrowUp'); ok('ArrowUp = back', await at(p, 0, T));
await key(p, 'ArrowUp'); ok('ArrowUp on the first row stays put', await at(p, 0, T));
await key(p, 'End'); ok('End = last day of the row', await at(p, 0, plus(T, nDays - startN)));
await key(p, 'ArrowRight'); ok('ArrowRight on the last day stays put', await at(p, 0, plus(T, nDays - startN)));
await key(p, 'Home'); ok('Home = the name cell (first in the row)', await at(p, 0, 'name'));
await key(p, 'ArrowLeft'); ok('ArrowLeft on the name cell stays put', await at(p, 0, 'name'));
await key(p, 'ArrowRight'); ok('ArrowRight from the name = first day', await at(p, 0, plus(T, 1 - startN)));
await key(p, 'Control+End'); ok('Ctrl+End = last day of the last row', await at(p, 6, plus(T, nDays - startN)));
await key(p, 'Control+Home'); ok('Ctrl+Home = first row, name cell', await at(p, 0, 'name'));
await key(p, 'PageDown'); ok('PageDown jumps 10 people (clamped to the last of 7)', await at(p, 6, 'name'));
await key(p, 'PageUp'); ok('PageUp jumps back (clamped to the first)', await at(p, 0, 'name'));
const ring = await (async () => { await cell(p, 0).focus(); await key(p, 'ArrowDown'); return cell(p, 1).evaluate((e) => { const c = getComputedStyle(e); return { w: c.outlineWidth, s: c.outlineStyle }; }); })();
ok('the focused cell shows a clear focus ring (3px outline)', ring.s === 'solid' && ring.w === '3px', JSON.stringify(ring));
await cell(p, 0).focus();

// ---- setting statuses with the keyboard
await key(p, 'x'); ok('x -> X written to the database by the admin', await eventually(() => sql(`select status||'|'||(updated_by='${uid(0)}') from public.day_status where user_id='${uid(0)}' and day='${T}'`) === 'X|true'));
ok('...the cell shows X, keeps keyboard focus, and its label updates', (await cell(p, 0).textContent()).startsWith('X') && await at(p, 0, T) && (await cell(p, 0).getAttribute('aria-label')).endsWith(': X'));
ok('a screen-reader announcement is made ("KB Admin ...: X")', await eventually(async () => (await p.locator('.sr-only[role=status]').textContent()).includes('KB Admin') && (await p.locator('.sr-only[role=status]').textContent()).endsWith(': X')));
await key(p, 'Y'); ok('capital Y -> Y', await eventually(() => st(0) === 'Y'));
await key(p, 'Delete'); ok('Delete -> back to E (row removed)', await eventually(() => st(0) === 'E' && sql(`select count(*) from public.day_status where user_id='${uid(0)}' and day='${T}'`) === '0'));
await key(p, 'x'); await key(p, 'Backspace'); ok('Backspace also clears to E', await eventually(() => st(0) === 'E'));
await key(p, 'x'); await key(p, 'y');   // no waiting: ordered writes must not overtake each other
ok('two quick key presses (X then Y): the database ends at Y, exactly like the screen', await eventually(() => st(0) === 'Y') && (await cell(p, 0).textContent()).startsWith('Y'));
await key(p, 'e'); await eventually(() => st(0) === 'E');
// undo is per key press
const undoN = async () => Number(((await undoBtn(p).textContent()).match(/\((\d+)\)/) ?? [0, 0])[1]);
const u0 = await undoN();
await key(p, 'x'); await key(p, 'ArrowDown'); await key(p, 'y'); await p.waitForTimeout(900);
ok('each key press is its own Undo step (the Undo counter grows by 2 for two key presses)', (await undoN()) === u0 + 2 && st(0) === 'X' && st(1) === 'Y', `${u0} -> ${await undoN()}`);
await key(p, 'Control+z'); ok('Ctrl+Z undoes only the LAST change', await eventually(() => st(1) === 'E' && st(0) === 'X'));
await key(p, 'ArrowUp'); await key(p, 'Control+z'); ok('Ctrl+Z again undoes the one before', await eventually(() => st(0) === 'E'));
ok('keys on a name cell never change a status (x ignored)', await (async () => { await nameCell(p, 2).focus(); await key(p, 'x'); await p.waitForTimeout(600); return st(2) === 'E'; })());

// ---- Enter / Space / H
await cell(p, 1).focus(); await key(p, 'Shift+Enter'); await p.waitForSelector('dialog[open]');
ok('Shift+Enter opens the day editor for that person and date', (await p.textContent('dialog[open] .muted')).includes('KB User 1'));
await p.locator('dialog[open] input[name=st][value=Y]').check(); await p.locator('dialog[open] button.primary').click(); await p.waitForSelector('dialog[open]', { state: 'detached' });
ok('after saving, focus returns to the same cell (keyboard flow is not interrupted)', await eventually(() => at(p, 1, T)) && st(1) === 'Y');
await key(p, 'Escape');
await cell(p, 2).focus(); await key(p, 'Enter');
ok('Enter cycles the cell E -> X', await eventually(() => st(2) === 'X'));
await key(p, ' ');
ok('Space cycles X -> Y', await eventually(() => st(2) === 'Y'));
await key(p, 'Enter');
ok('Enter cycles Y -> E', await eventually(() => st(2) === 'E'));
await cell(p, 3).focus(); await key(p, 'h');
ok('H marks the day as a holiday for the department', await eventually(() => sql(`select count(*) from public.holidays where department_id='${DA}' and day='${T}'`) === '1') && (await p.locator(`th.dh[data-d="${T}"]`).getAttribute('class')).includes('holiday'));
await key(p, 'Control+z'); ok('Ctrl+Z removes the holiday again', await eventually(() => sql(`select count(*) from public.holidays where department_id='${DA}' and day='${T}'`) === '0'));
await p.locator(`th.dh[data-d="${T}"]`).click();
ok('clicking a day number marks the holiday', await eventually(() => sql(`select count(*) from public.holidays where department_id='${DA}' and day='${T}'`) === '1'));
await p.locator(`th.dh[data-d="${T}"]`).click();
ok('clicking it again unmarks it', await eventually(() => sql(`select count(*) from public.holidays where department_id='${DA}' and day='${T}'`) === '0'));
// name cell + Enter = person page
await nameCell(p, 4).focus(); await key(p, 'Enter'); await p.waitForSelector('.person-head');
ok('Enter on a name opens that person\'s timesheet', p.url().includes('#/person/' + uid(4)));
await p.goBack(); await p.waitForSelector('.tgrid tbody tr');

// ---- typing in the search box must never change the grid
const snap = () => sql(`select coalesce(string_agg(user_id||'|'||status, ',' order by user_id),'') || '#' || (select count(*) from public.holidays where department_id='${DA}') from public.day_status where user_id::text like '36000000%' and day='${T}'`);
const snapBefore = snap();
await p.fill('.team-search', ''); await p.locator('.team-search').focus(); await p.keyboard.type('xyeh');
await p.waitForTimeout(700);
ok('typing x/y/e/h in the search box does not touch any status or holiday', (await p.inputValue('.team-search')) === 'xyeh' && snap() === snapBefore, `${snapBefore} -> ${snap()}`);
await p.fill('.team-search', ''); await p.waitForTimeout(400);

// ---- focus survives a live redraw caused by someone else
await cell(p, 5).focus(); await key(p, 'ArrowRight');
const before = await active(p);
sql(`insert into public.day_status (user_id, day, status) values ('${uid(6)}', '${T}', 'Y') on conflict (user_id, day) do update set status = 'Y'`);
ok('a change made elsewhere shows up live...', await eventually(async () => (await cell(p, 6).textContent()).startsWith('Y'), 12000));
const after = await active(p);
ok('...and keyboard focus is still on the same cell (the redraw did not drop it)', after && before && after.u === before.u && after.d === before.d, JSON.stringify({ before, after }));
await p.keyboard.press('x'); ok('...so typing continues to work after the redraw', await eventually(async () => { const a = await active(p); return a && (await st(5, a.d)) === 'X'; }));

// ---- info dialog documents the shortcuts
await p.click('button[aria-label="How this grid works"]'); await p.waitForSelector('dialog[open]');
ok('the info dialog lists the keyboard shortcuts', (await p.textContent('dialog[open]')).includes('Keyboard') && (await p.textContent('dialog[open]')).includes('Ctrl+Z') && (await p.textContent('dialog[open]')).includes('PageDown'));
await p.screenshot({ path: S + '/kb-info.png' }); await p.locator('dialog[open] button:text-is("Close")').click();
await cell(p, 1).focus(); await key(p, 'ArrowRight'); await p.screenshot({ path: S + '/kb-focus.png' });

// ---- Arabic / right-to-left: arrows follow what you SEE
await p.click('text=العربية'); await p.waitForSelector('.tgrid tbody tr');
await cell(p, 0).focus();
const order = await p.locator('tr[data-u="' + uid(0) + '"] td.c').evaluateAll((els) => els.slice(0, 2).map((e) => Math.round(e.getBoundingClientRect().left)));
ok('Arabic: the first day is to the RIGHT of the second (days run right-to-left)', order[0] > order[1], JSON.stringify(order));
await key(p, 'ArrowLeft'); ok('Arabic: ArrowLeft moves to the NEXT day (visually left)', nDays > startN ? await at(p, 0, plus(T, 1)) : await at(p, 0, T));
await key(p, 'ArrowRight'); ok('Arabic: ArrowRight moves back to the previous day', await at(p, 0, T));
await key(p, 'x'); ok('Arabic: X still sets the status', await eventually(() => st(0) === 'X'));
await p.click('text=English'); await p.waitForSelector('.tgrid tbody tr');
ok('desktop: no page errors ' + JSON.stringify(p.errs), p.errs.length === 0);
await p.context().close();

// ---- week view on a phone-sized screen
const m = await open(390, { month: false });
ok('phone defaults to Week view (7 columns)', (await m.locator('th.dh').count()) === 7);
await cell(m, 0).focus(); await key(m, 'End');
const wk = await m.locator('th.dh').evaluateAll((els) => els.map((e) => e.dataset.d));
ok('Week view: End = last day of the week', await at(m, 0, wk[6]));
await key(m, 'ArrowLeft'); await key(m, 'ArrowLeft'); await key(m, 'x');
ok('Week view: arrows + X work on a phone-sized screen', await eventually(async () => (await st(0, wk[4])) === 'X'));
ok('phone: no page errors ' + JSON.stringify(m.errs), m.errs.length === 0);
await m.context().close();

cleanup();
ok('cleanup removed every test row (real data untouched)', sql("select count(*) from auth.users where email like 'kb%@timesheet.local'") === '0' && sql("select count(*) from public.departments where name like 'KB %'") === '0');
await b.close();
console.log(fails ? `=== ${fails} FAILURES ===` : '=== ALL KEYBOARD TESTS PASSED ===');
