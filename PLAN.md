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
9. **Template swap** (WAITING for the official form): when the official form arrives, add a new template mapping.

## Backlog (agreed, NOT now - do later when asked)
- [x] **Desktop keyboard use** in the department grid: DONE (arrows, Home/End, PageUp/PageDown, X/Y/E, Delete, Enter/Space, H for holiday, Ctrl+Z; ARIA grid; Arabic-aware). Its own suite tests/ui/keyboard.mjs passed 5/5.
- [x] **Bottom tab bar with icons on phones**: DONE (fixed icon bar on phones, hidden for single-tab roles and while typing; top tabs on wide screens). Its own suite tests/ui/bottom-nav.mjs passed.
- [x] **Light / dark theme choice**: DONE (Light / Dark / System in the account menu, per device).
- [ ] Offline write queue (deferred earlier).
- [ ] Waiting on the company: the official Excel form (phase 9) and the weekend/week-start confirmation.
- [ ] **Compact user calendar** (NOT started, later): on the plain user's calendar page, use a compact layout - move the help text (legend, tap instructions, edit-window note) behind an "i" help button, like the department grid does.
- [ ] **TO TEST LATER - confirm dialog before removing a saved account (the x in the account menu)**: built with our own dialog (not the browser's) but NOT pushed and NOT yet tested; kept on the local git branch `wip-confirm-remove` (worktree in the session scratchpad; patch also saved). Its test (tests/ui/account-switch.mjs) did not get to run its new checks because the suite failed earlier (next item).
- [ ] **FIRST THING NEXT: full regression on the pushed keyboard + bottom-bar build.** Not run on the combined code yet. In the pre-push combined build tests/ui/account-switch.mjs failed once at "switch works after a reload" (the address stayed #/team after switching from an admin to a plain user). Cause unknown: could be a flake or one of the two new features. Investigate and fix first; also re-check the other suites that run at phone width (the fixed bar can cover buttons).

