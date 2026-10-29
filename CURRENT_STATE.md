# Current state (2026-10-29)

One page for a new maintainer: what exists today. WHY things are as they are: [SPEC.md](SPEC.md) (dated decisions).
WHAT changed when: [CHANGELOG.md](CHANGELOG.md). HOW to work on it: [MAINTAINING.md](MAINTAINING.md). WHERE files are: [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md).

## What it is
A phone-first PWA (Vite, plain JavaScript, English / Arabic, light / dark) where people record their daily status (X work, Y operation,
E off) and overtime, and department admins export the official monthly report (Excel and PDF). Supabase: Postgres with row-level
security, Auth (username login), one Edge Function (`admin-manage-users`), Realtime for live updates. Hosted on Vercel (push to
GitHub deploys the front end; migrations and the Edge Function are applied by hand, see MAINTAINING).

## Roles and tabs
| Role | Tabs | Notes |
|---|---|---|
| user | My calendar | edits their own days inside the edit window |
| admin (department admin) | Department, Overtime, Users, My calendar | manages one department |
| manager (department manager) | Department, Overtime, Users | like an admin but NOT in the timesheet (no calendar, not in grids / reports) |
| super_manager | Department, Overtime | read-only, every department (department switcher), can export; no department of their own |
| super_admin | Departments, Department, Overtime, Users, Super users | manages departments and admins; can ACT AS the admin of any department; adds super admins / super managers |

## Main features
- Day grid (month / week), tap / drag / keyboard filling, undo, bulk fill, holidays, departure (D) badge, live updates.
- Overtime tab with day dialog; overtime from a scanned form (local OCR in the browser, editable preview, files / folders / drag and drop).
- Overtime form (print / Excel / PDF of a day or of the month, A4 landscape, Arabic, same-note people share one work cell): `src/export/overtime-form.js`; the Arabic names of people / department / sector come from the database (Edit data, Report settings).
- Users tab: cards or table, sort and Excel-style filters per column, bulk add from Excel; first-run checklist for a new department.
- Exports: official monthly report (Excel, PDF, print), per-person export, EMC overtime overview last.
- Guided tour ("How to use the app") for every role on phones and desktops: it runs through all the tabs of the role in one go (Next: <tab>), starts by itself for a new account on its landing screen, replayable from the account menu.
- Desktop notifications for admins (installed app, opt-in), "new version available" banner, offline banner, account switching.

## Data and rules in one paragraph
Writes go only through `security definer` RPCs that check the caller's role (`app_role()`, `app_dept()`, `real_role()`); a manager
counts as `admin` in `app_role()` but is refused by a trigger as the subject of timesheet rows; a super_manager has read policies only.
Payroll number is required for users and admins (not for managers / super users); OPR is optional. 28 migrations in
`supabase/migrations`; latest `20261029000028_arabic_names_sector.sql` (profiles.full_name_ar, departments.name_ar / sector_ar, sector without the word "Sector", dept_ar moves to name_ar,
update_profile / set_department_report take the Arabic fields; applied to the remote DB on 2026-10-29, Edge function `admin-manage-users` redeployed with `full_name_ar` in `create_user`).
The sector column holds the value only: exports append "Sector".

## Tests (all in README; the browser ones need `npx vite preview --port 4173`)
`npm run test:rls`, `test:e2e-users`, `test:i18n`, `test:export`, `test:export-official`, `test:export-pdf`, `test:ocr-parse`, `test:overtime-form`, and the
browser suites `test:ui*` (admin-flows, team, live, theme, keyboard, bottom-nav, export, notify, ocr, overtime-form, super-manager, update, onboarding, ...).
They run against the REAL project with their own prefixed fixtures: see "The database is the real one" in MAINTAINING.

## Known gaps / backlog
- Offline write queue (a failed save needs a manual retry).
- Week start (Sunday) and per-department holidays are assumptions waiting for the company.
- Official Excel form: an unprotected copy of the sample .xlsm is still needed to match fonts / widths exactly.
- No staging database (tests touch the live one), no scheduled backups / export, no CI.
- Session tokens of saved accounts live in the browser's local storage; no CSP / security headers yet.
- Realtime needs plan capacity for many concurrent connections.
