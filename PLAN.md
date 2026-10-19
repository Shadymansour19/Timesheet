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
8. **Polish** (DONE: offline banner; offline write queue + realtime deferred): offline tolerance, optional realtime, a11y, mobile QA.
9. **Template swap** (WAITING for the official form): when the official form arrives, add a new template mapping.
