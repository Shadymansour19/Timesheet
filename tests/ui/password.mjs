// Browser E2E: changing your own password signs the account out of the OTHER devices (two browser contexts = two devices).
// Fixtures: temporary ids 41000000-.... Needs `npx vite preview --port 4173`, TS_DB_URL, VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (from .env.local), Chromium.
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const sql = (q) => execSync(`psql "$TS_DB_URL" -X -q -At -c "${q.replace(/"/g, '\\"')}"`, { encoding: 'utf8' }).trim();
const env = readFileSync(new URL('../../.env.local', import.meta.url), 'utf8');
const URL_ = env.match(/^VITE_SUPABASE_URL=(.*)$/m)[1].trim(), KEY = env.match(/^VITE_SUPABASE_ANON_KEY=(.*)$/m)[1].trim();
const PW = 'Pw-Pass-12345', NEW = 'Pw-Pass-67890', DA = '41000000-0000-0000-0000-00000000000a', U = '41000000-0000-0000-0000-0000000001a1';
const cleanup = () => sql(`delete from auth.users where id::text ~ '^41000000-' or id in (select id from public.profiles where department_id::text ~ '^41000000-');
  delete from public.departments where id::text ~ '^41000000-';
  delete from public.audit_log where (target_user is not null and target_user not in (select id from public.profiles)) or (department_id is not null and department_id not in (select id from public.departments));`);
cleanup();
sql(`insert into public.departments (id,name) values ('${DA}','PW Alpha')`);
sql(`
 insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change)
 values ('00000000-0000-0000-0000-000000000000','${U}','authenticated','authenticated','pwuser@timesheet.local',crypt('${PW}',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',now(),now(),'','','','');
 insert into auth.identities (id,user_id,provider_id,identity_data,provider,last_sign_in_at,created_at,updated_at) values (gen_random_uuid(),'${U}','${U}','{"sub":"${U}"}','email',now(),now(),now());
 insert into public.profiles (id,username,full_name,opr,payroll,level,department_id,role) values ('${U}','pwuser','PW User','PWO-1','PWP-1','2','${DA}','user');`);

const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let fails = 0;
const ok = (l, c, extra = '') => { if (!c) fails++; console.log((c ? 'PASS: ' : 'FAIL: ') + l + (c ? '' : ' ' + extra)); };
async function device() {
  const ctx = await b.newContext({ viewport: { width: 1100, height: 800 } }); const p = await ctx.newPage(); p.errs = []; p.on('pageerror', (e) => p.errs.push(e.message));
  await p.goto('http://localhost:4173/'); await p.fill('#username', 'pwuser'); await p.fill('#password', PW); await p.click('button[type=submit]'); await p.waitForSelector('.topbar');
  return p;
}
// the refresh token this device holds (what keeps it signed in)
const refreshToken = (p) => p.evaluate(() => { const k = Object.keys(localStorage).find((x) => /^sb-.*-auth-token$/.test(x)); return k ? JSON.parse(localStorage.getItem(k)).refresh_token : null; });
const renew = async (rt) => (await fetch(`${URL_}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: rt }) })).status;

const A = await device(), B = await device(), C = await device();
const rtA = await refreshToken(A), rtB = await refreshToken(B);
ok('three devices are signed in with their own sessions', !!rtA && !!rtB && rtA !== rtB);
// device A changes the password on the Account page
await A.goto('http://localhost:4173/#/account'); await A.waitForSelector('#cur');
await A.fill('#cur', PW); await A.fill('#nw', NEW); await A.fill('#cf', NEW); await A.click('form button[type=submit]');
await A.waitForSelector('p.success', { timeout: 30000 });
ok('device A is told that the other devices were signed out', /other devices were signed out/.test(await A.locator('p.success').innerText()));
await A.waitForTimeout(1500);
const rtA2 = await refreshToken(A);
ok('device B can no longer renew its login (its session was revoked)', (await renew(rtB)) !== 200);
ok('device A stays signed in (its current session still renews)', (await renew(rtA2)) === 200);
await B.reload(); await B.waitForSelector('#username', { timeout: 30000 });
ok('device B, when reloaded, is back at the sign-in page at once (not an hour later)', (await B.locator('#username').count()) === 1);
// device C was left open: when the person comes back to it, it signs out by itself
await C.evaluate(() => window.dispatchEvent(new Event('focus'))); await C.waitForSelector('#username', { timeout: 30000 });
ok('device C, left open, signs out as soon as the person returns to it', (await C.locator('#username').count()) === 1);
// and the new password signs in
await B.fill('#username', 'pwuser'); await B.fill('#password', NEW); await B.click('button[type=submit]'); await B.waitForSelector('.topbar', { timeout: 30000 });
ok('the NEW password signs in on device B', (await B.locator('.topbar').count()) === 1);
ok('no page errors', A.errs.length === 0 && B.errs.length === 0 && C.errs.length === 0, A.errs.concat(B.errs, C.errs).join('|'));
cleanup();
await b.close();
console.log(fails ? `=== ${fails} FAILURES ===` : '=== ALL PASSWORD TESTS PASSED ===');
