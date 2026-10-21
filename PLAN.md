# PLAN

Each phase ends with local commits (never pushed) and a hand-off of push + Supabase commands.

0. **Discovery** (DONE): docs, open questions answered, recorded in SPEC.md.
1. **Schema & security** (DONE): migrations (departments, profiles, day_status, holidays, overtime, audit_log, settings), helper functions, RLS, RPCs (profile edit, soft-delete, promote/demote, set status, set overtime), audit triggers, last-super_admin guard. Seed SQL for first super_admin (outside migrations). psql impersonation tests in `supabase/tests/`, run and results reported.
2. **Edge Function** (DONE) `admin-manage-users`: create user, reset password, delete user; caller-role and department checks server-side.
3. **App shell** (DONE): Vite scaffold, PWA manifest + service worker, Supabase client, username login, change password, routing by role.
4. **User calendar** (DONE): month grid, tap-cycle, overtime read-only, edit-window enforcement (UI + RPC).
5. **Admin screens** (DONE): department grid, quick set, bulk fill, overtime entry, user management dialog.
6. **Super admin screen** (DONE): departments and admins.
7. **Export** (DONE: default template): data model → template mapping engine → default layout; verify the generated xlsx contents programmatically.
8. **Polish** (DONE: offline banner; LIVE UPDATES via Realtime; offline write queue deferred): offline tolerance, optional realtime, a11y, mobile QA.
9. **Official report** (DONE 2026-10-20): official monthly report as Excel and PDF, print, department data; see SPEC.md decisions and MAINTAINING.md section 5.

## Backlog (agreed, NOT now - do later when asked)
- [x] **Desktop keyboard use** in the department grid: DONE (arrows, Home/End, PageUp/PageDown, X/Y/E, Delete, Enter/Space, H for holiday, Ctrl+Z; ARIA grid; Arabic-aware). Its own suite tests/ui/keyboard.mjs passed 5/5.
- [x] **Bottom tab bar with icons on phones**: DONE (fixed icon bar on phones, hidden for single-tab roles and while typing; top tabs on wide screens). Its own suite tests/ui/bottom-nav.mjs passed.
- [x] **Light / dark theme choice**: DONE (Light / Dark / System in the account menu, per device).
- [ ] Offline write queue (deferred earlier).
- [ ] Waiting on the company: the official Excel form (phase 9) and the weekend/week-start confirmation.
- [x] **Compact user calendar** (DONE 2026-10-20, with per-person export and full-width desktop layout; original note:) on the plain user's calendar page, use a compact layout - move the help text (legend, tap instructions, edit-window note) behind an "i" help button, like the department grid does.
- [x] **Confirm dialog before removing a saved account (the x in the account menu)**: DONE and TESTED - the checks in tests/ui/account-switch.mjs (own dialog, names the account, Cancel keeps it, red Remove button, no browser dialog) passed in the 2026-10-20 regression.
- [x] **Full regression on the keyboard + bottom-bar build** (2026-10-20): all suites passed except admin-flows / overtime-tab, whose failures were test problems (tab selectors after the icon bar; fixed waits that were too short) - fixed. The earlier account-switch failure did not reproduce (it passed). Re-run once more after the report work: see the next regression result in the project notes.
- [x] **Official monthly report export** (day sheets, one sheet per employee, review sheet): DONE from the user's screenshots; tests: tests/export-official.test.mjs (49 checks incl. LibreOffice recalculation) and tests/ui/export-official.mjs (28 checks incl. a 40-person department).
- [ ] **Official report - to refine with the user (needs input):** (1) an UNPROTECTED copy of the sample .xlsm (or just its day / employee / review sheets) so exact fonts, column widths, merged cells, formulas and macros-free layout can be matched; (2) the two logo images (placed automatically from public/templates/logo-left.png and logo-right.png); (3) holiday handling on the form (currently X/Y shown as-is, holiday flagged in the date line); (4) what "Total approved (Engineers / Tech)" should contain; (5) employee order on the sheets (currently alphabetical); (6) whether Accom., TRANS/IN, TRANS/EX and meals B/L/D should become recordable in the app.

