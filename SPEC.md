# SPEC

## 1. Requirements

### Roles
- **user**: records own daily status; sets own password only. Cannot change name, OPR, level, department or role. Views own overtime. Sees only own data.
- **admin** (department admin): for users in HIS department only: edit any day status (incl. own), add/edit overtime, mark/unmark department holidays, create/delete users, reset passwords, promote user→admin / demote admin→user, edit user data.
- **super_admin**: manages departments and department admins only (create departments, create/assign admins, promote/demote across departments). No timesheet editing. Cannot demote/delete the last super_admin.

### Data
- `departments` (real table)
- `profiles`: id (auth.users), username, full_name, opr (unique), level (int), department_id, role (user|admin|super_admin), active/deleted flag
- `day_status`: (user_id, date, status X|Y|E), unique per user-day. X = normal work, Y = operation, E = no work. Default E = **no row** (COALESCE in views/export, no backfill).
- `holidays`: (department_id, date), unique. Marked by the department's admin. Effective status shown/exported = status || 'H' when a holiday row exists and status is X or Y (XH, YH); E stays E. Derived in views/export, never written into `day_status`, so it applies to already-entered and future days alike, and unmarking a holiday restores X/Y.
- `overtime`: (user_id, date, hours smallint 0–24, integer only, note, entered_by). Written by same-department admin only; user read-only.
- `audit_log`: who/what/old→new/when, written by triggers.

### Security (critical)
- All enforcement in RLS + RPCs. Department scoping via SECURITY DEFINER helpers (`current_dept()`, `current_role()`).
- Profile edits only via SECURITY DEFINER RPCs (or column-level privileges). Password change only via `supabase.auth.updateUser`.
- Soft-delete via SECURITY DEFINER RPC.
- First super_admin seeded by manual SQL, not a migration.
- RLS verified via psql impersonation (user, admin dept A, admin dept B, super_admin); tests in `supabase/tests/`.
- Excel verified by inspecting actual file contents.

### Features
1. Username + password login; change own password.
2. User: month grid, tap cycles E→X→Y; overtime read-only.
3. Admin: department grid, quick set, bulk fill, overtime entry, user management dialog.
4. Super admin: departments & admins screen.
5. Export: per-department per-month Excel, template-driven mapping, default layout until official form arrives.
6. Realtime optional; offline tolerance nice-to-have.

### Export design proposal: client-side exceljs (recommended)
- Data is already RLS-scoped, so the client only fetches what the admin may see; no extra auth surface.
- No Edge Function cold start / deploy step; template swap = editing one JS mapping module + optional .xlsx template file.
- Cost: exceljs is ~1 MB, so lazy-load via dynamic `import()` only when Export is clicked.
- Revisit (move to Edge Function) only if the official template needs server-only features or the department is very large.
- Layout: `src/export/templates/<name>.js` declares sheet/cell mapping; `src/export/engine.js` applies it to a normalized `{employees, days, status, overtime, totals}` model.

## 2. Open questions
All answered 2026-10-19; see Decision log.

## 3. Decision log
| Date | Decision | Reason |
|---|---|---|
| 2026-10-19 | Export generated client-side with exceljs, lazy-loaded, template-driven mapping | See §1 proposal |
| 2026-10-19 | Default status E = absence of row | Per brief; avoids backfill |
| 2026-10-19 | Users cannot record future days; past days freely editable, no month lock/approval | SUPERSEDED same day by next entry |
| 2026-10-19 | Users CAN record future days as well as past days; no month lock/approval | User correction. Edit window kept as a settings value (`user_edit_window_days`, default NULL = unlimited, applies to past days only) so it can be tightened later without a migration |
| 2026-10-19 | No automatic weekly off-days. Admin marks holidays; X/Y become XH/YH, E stays E, for already-entered and future entries | User answer. Implemented as a `holidays` table + derived effective status (see §1 Data), not by rewriting rows. ASSUMPTION: holidays are per department (admin scope is his department); tell me if they should be global |
| 2026-10-19 | Overtime is integer hours 0–24, no fractions (supersedes the 0.25 step) | User correction; column `smallint` with CHECK 0..24, UI step 1 |
| 2026-10-19 | `level` is display + export column only; no rate logic | User answer |
| 2026-10-19 | UI is English + Arabic with RTL from the start | User answer. Use i18n module, CSS logical properties (inline-start/end), `dir` toggled on `<html>`, language persisted per device; Excel export headers localisable per template |
| 2026-10-19 | One department per user (`profiles.department_id`) | User answer |
| 2026-10-19 | Username-only login via synthetic internal email (`<username>@timesheet.local`), no real email, no email recovery; admins reset passwords | User answer. Usernames lowercase, unique |
| 2026-10-19 | Clients get SELECT only; every write is a SECURITY DEFINER RPC that re-checks role/department (`set_day_status[_bulk]`, `set_overtime`, `set_holiday`, `update_profile`, `set_user_role`, `soft_delete_user`, department RPCs) | Brief: enforce in DB, soft-delete must be an RPC |
| 2026-10-19 | Column named `day` (not `date`) in day_status/overtime/holidays | Avoid SQL keyword |
| 2026-10-19 | Setting status back to E deletes the row; overtime 0 deletes the row | Keeps "no row = E / no overtime" invariant |
| 2026-10-19 | Admin cannot demote himself; only super_admin can. No guard against a department having zero admins | Prevent accidental lock-out; super_admin can reassign |
| 2026-10-19 | Admin creates role=user only; super_admin creates role=admin only. Nobody can create/grant super_admin via the app (manual SQL only) | Per brief roles |
| 2026-10-19 | super_admin may promote/demote/reset/delete admins but cannot edit user data or touch plain users' passwords | Brief: super_admin only manages departments and admins |
| 2026-10-19 | Soft-deleted users keep data, lose all access (RLS keyed on active); usernames are NOT reusable after deletion; OPR can be reused (unique among active only) | Preserves audit/history; auth user is banned by the Edge Function |
| 2026-10-19 | Edge Function authorises by calling `assert_can_create` / `assert_can_manage` / `soft_delete_user` with the CALLER's JWT, then uses the service role for auth.users work | Single source of authorisation truth in the DB |
| 2026-10-19 | Tests run migrations + `supabase/tests/rls.sql` in one transaction on the real project and ROLLBACK (`supabase/tests/run.sh`) | Real Supabase auth/roles, nothing left behind |
| 2026-10-19 | Fixed by tests: soft-deleted users could still read their own profile/rows; own-row policies now require active | Found by RLS test |
| 2026-10-19 | Edge Function `admin-manage-users` (actions create_user / reset_password / delete_user) authorises through RPCs run with the caller's JWT, then uses the service role; failed profile insert rolls back the auth user; delete = soft_delete RPC + auth ban (~100y) | Keeps authorisation rules in one place (DB) |
| 2026-10-19 | Public sign-up disabled in Supabase Auth (verified: /auth/v1/signup returns signup_disabled) | Anyone with the publishable key could otherwise self-register |
| 2026-10-19 | Frontend: Vite + vanilla JS, hash router with per-role route tables, `h()` DOM helper (no innerHTML), vite-plugin-pwa (app shell cached, API never cached), i18n en/ar with `dir` toggled on `<html>` and CSS logical properties | Per brief; XSS-safe by construction |
| 2026-10-19 | Change password re-authenticates with the current password before `auth.updateUser` | updateUser alone does not verify the old password; protects an unlocked phone |
| 2026-10-19 | `get_timesheet` also returns `is_holiday` (migration 5) | UI must show XH immediately when an E day on a holiday is set to X |
| 2026-10-19 | Calendar: week starts Sunday (constant `WEEK_START` in views/calendar.js), Latin digits in both languages, per-day serialised optimistic writes with rollback on error, days older than `user_edit_window_days` disabled in UI (server still enforces) | Easy to change later; assumed Sunday, confirm with company |
| 2026-10-19 | Frontend reads sparse rows from `day_status`/`overtime`/`holidays` with paging (`fetchAll`, 1000/page) instead of `get_timesheet` | PostgREST caps responses at 1000 rows; a 35+ person department x 31 days would be silently truncated. `get_timesheet` stays in the DB for SQL-side reporting |
| 2026-10-19 | `effective()` (X/Y -> XH/YH on holiday) lives in `src/lib/core.js`, shared by UI, export and Node tests | One implementation of the holiday rule |
| 2026-10-19 | Department grid: tap mode selector (Edit dialog / paint X / paint Y / paint E / Holiday = tap day number), bulk fill dialog (people x date range x status, max 500 x 366), totals X/Y/XH/YH/OT per person | Fast on phones; matches brief (quick set, bulk fill, overtime, holidays) |
| 2026-10-19 | Admin manages users via dialogs: add (temp password generator), edit data, reset password, promote/demote, delete. No self-delete/self-demote/self-reset buttons | Matches server rules |
| 2026-10-19 | Super admin screen lists departments with members; create/rename department, add admin, promote/demote across departments, reset/delete admins only | Matches server rules |
| 2026-10-19 | Export is client-side exceljs, lazy-loaded (~930 kB chunk). `default` template = generate mode: title block, # / Employee / OPR / Level, day columns coloured by X/Y/XH/YH/E with holiday columns amber, totals X/Y/XH/YH/OT as COUNTIF formulas, second sheet with per-day overtime, RTL sheet when UI is Arabic. Totals of 0 are written as plain 0 | ExcelJS drops a cached 0 result, leaving blanks in non-recalculating viewers. Verified by re-reading real files and rendering with LibreOffice |
| 2026-10-19 | Official form later: add a template file with `mode: 'fill'` (source .xlsx in public/templates/, cell/column mapping, see templates/example-fill.js) and set `activeTemplate` in export/engine.js. Fill mode keeps the form's own formatting and clones row styling for extra employees | Swap without touching UI or model |
| 2026-10-19 | Export includes active employees of the department only (people deleted mid-month are not listed) | Simplicity; revisit if the company needs historical rows |
| 2026-10-19 | Offline: installable app shell is cached by the service worker; an offline banner appears; writes fail with a clear message (no offline write queue). Realtime not implemented (optional in brief) | Nice-to-have items kept out of scope for now; both can be added later without schema changes |
| 2026-10-19 | Account switching: the browser keeps a list of accounts signed in on this device (`localStorage` key `ts.accounts`: id, username, name, role, session tokens; never passwords). The Supabase client holds one session, so switching swaps it with `setSession`. Menu in the top bar: switch, add account (wrong password keeps the current session), remove from device, sign out, sign out of all | Requested UX. Tokens live in the same storage the Supabase client already uses, so exposure is unchanged in kind; staff on shared phones should use "Sign out of all accounts" |
| 2026-10-19 | Sign-out now uses `scope: 'local'` (revokes only this device's session). Before, the default was global, which also signed the user out on all their other devices | Needed for switching; also fixes unintended global logout |
| 2026-10-19 | A saved account whose session was revoked/expired/banned is removed on the first failed switch with a message; the previous session is restored. Another tab follows a switch (page reloads) so the UI never shows a stale identity | Verified by browser tests, including killing a session server-side |
| 2026-10-19 | Password fields get a show/hide eye button (login, change password, add account); generated temporary passwords stay visible text on purpose so admins can read them out | Requested UX; a11y: aria-pressed + localized label |
| 2026-10-19 | Arabic wording: "جدولي" for My calendar, "وردية" for Y (shift) in the legend and in the Excel legend | Requested; modern wording |
| 2026-10-19 | Month navigation is laid out left-to-right in every language (previous left, next right) using drawn SVG chevrons; text arrows were rendered mirrored by the Arabic font | Requested "revert" for Arabic; verified by zooming screenshots and geometry tests |
| 2026-10-19 | Calendar cells are taller (1:1.32); a day with overtime gets an amber strip flush with the bottom of the cell showing `+Nh` (still text, so colour is not the only cue), amber overtime chip in the totals, amber also in dark mode. Department grid marks overtime cells with an amber bar and badge | Requested: overtime must stand out |
| 2026-10-19 | Account menu trigger is a bordered pill with a drawn up/down chevron badge (switcher icon) that fills with the brand colour and rotates when open; menu fades in (disabled for prefers-reduced-motion) | Requested "real modern" dropdown affordance |
| 2026-10-19 | "Change password" moved from a tab into the account menu (all roles), next to Add account / Sign out; the page keeps the `#/account` route and shows a Back link to the role's home. Menu items now have icons (plus, key, logout; arrows mirror in RTL) | Requested |

