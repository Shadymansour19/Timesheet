# SPEC

## 1. Requirements

### Roles
- **user**: records own daily status; sets own password only. Cannot change name, OPR, level, department or role. Views own overtime. Sees only own data.
- **admin** (department admin): for users in HIS department only: edit any day status (incl. own), add/edit overtime, create/delete users, reset passwords, promote user→admin / demote admin→user, edit user data.
- **super_admin**: manages departments and department admins only (create departments, create/assign admins, promote/demote across departments). No timesheet editing. Cannot demote/delete the last super_admin.

### Data
- `departments` (real table)
- `profiles`: id (auth.users), username, full_name, opr (unique), level (int), department_id, role (user|admin|super_admin), active/deleted flag
- `day_status`: (user_id, date, status X|Y|E), unique per user-day. X = normal work, Y = operation, E = no work. Default E = **no row** (COALESCE in views/export, no backfill).
- `overtime`: (user_id, date, hours numeric(4,2) 0–24, note, entered_by). Written by same-department admin only; user read-only.
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
| 2026-10-19 | Users cannot record future days; past days freely editable, no month lock/approval | User answer. Edit window kept as a settings value (`user_edit_window_days`, default NULL = unlimited) so it can be tightened later without a migration |
| 2026-10-19 | Weekly off-days/holidays are NOT automatic; stay user-entered (default E) | User answer; no holiday table |
| 2026-10-19 | `level` is display + export column only; no rate logic | User answer |
| 2026-10-19 | UI is English + Arabic with RTL from the start | User answer. Use i18n module, CSS logical properties (inline-start/end), `dir` toggled on `<html>`, language persisted per device; Excel export headers localisable per template |
| 2026-10-19 | One department per user (`profiles.department_id`) | User answer |
| 2026-10-19 | Overtime in hours, 0–24, UI step 0.25 | User answer |
| 2026-10-19 | Username-only login via synthetic internal email (`<username>@timesheet.local`), no real email, no email recovery; admins reset passwords | User answer. Usernames lowercase, unique |
