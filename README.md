# Timesheet

Mobile-first PWA for recording daily work status (X / Y / E) and overtime, with per-department monthly Excel export.

- **Backend:** Supabase (Postgres + RLS + Auth), one Edge Function `admin-manage-users`
- **Frontend:** Vite, vanilla JS, installable PWA
- **Export:** exceljs, template-driven mapping layer (see SPEC.md)

## Roles
| Role | Can do |
|---|---|
| user | Record own daily status, view own overtime, change own password |
| admin | Everything for users in own department: statuses, overtime, user management, export |
| super_admin | Manage departments and department admins only |

## Docs
- [SPEC.md](SPEC.md) – requirements and dated decision log
- [PLAN.md](PLAN.md) – phases
- [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md) – repo layout

## Setup
1. Create a Supabase project. Auth: disable public sign-ups; email confirmation is not needed.
2. Copy `.env.example` to `.env.local` and fill in the project URL and publishable (anon) key.
3. Apply migrations: push to GitHub (integration) or `npx supabase db push --db-url "$TS_DB_URL"`.
4. Deploy the Edge Function (manual): `npx supabase functions deploy admin-manage-users`.
5. Create the first super_admin: add the auth user `<username>@timesheet.local` in the dashboard (auto-confirm), then run `supabase/seed/first_super_admin.sql` with your values.
6. `npm install && npm run dev` (build: `npm run build`).

## Tests
Put the DB connection string in an untracked `.env.db` (`TS_DB_URL='postgresql://...'`) and `set -a; . ./.env.db; set +a`.

| Command | What it checks |
|---|---|
| `npm run test:rls` | 225 RLS/RPC checks by impersonating each role (runs in a rolled-back transaction) |
| `npm run test:e2e-users` | Deployed Edge Function: create/reset/delete, permissions, rollback |
| `npm run test:export` | Builds real .xlsx files, re-reads them and checks cell contents (+ fill-mode template) |
| `npm run test:export-official` | The official monthly report workbook: sheet names/order, day/employee/review cells, formulas, and LibreOffice recalculating every formula from scratch |
| `npm run test:ui-export` | Browser E2E: job title / contract number, Report settings, export dialog (format, month), downloaded workbook vs the database, a 40-person department |
| `npm run test:i18n` | Every translation key exists in English and Arabic |
| `npm run test:ui-accounts` | Browser E2E of account switching: add/switch/remove/sign-out, revoked sessions, two tabs, no password in storage |
| `npm run test:ui-team` | Department grid v2: week/month, swipe, search, totals, headcount, today/holiday columns, painting banner, Undo (exact state), bulk-fill preview, export month |
| `npm run test:ui-live` | Several sessions at once: live updates (grid, calendar, overtime, users), isolation on the wire between departments, role/deactivation live, reconnect resync, Users tab search/filter/empty states, per-person timesheet editor |
| `npm run test:ui-overtime` | Browser E2E of the admin Overtime tab: totals, day dialog, edits/notes/removal, validation, filters, other departments untouched, roles, Arabic |
| `npm run test:ui-keyboard` | Grid keyboard use: roving tabindex, arrows/Home/End/PageUp, X/Y/E/Delete, Enter, H, Ctrl+Z, focus kept across live redraws, Arabic arrows, week view, accessibility labels |
| `npm run test:ui-bottom-nav` | Phone bottom tab bar: layout, spacing above grid/toasts, keyboard hiding, single-tab roles, Arabic mirroring, desktop unchanged |
| `npm run test:ui-theme` | Light/Dark/System: device vs manual choice, no flash before the app loads, persistence, Arabic labels, all roles, navigation unchanged |
| `npm run test:ui-polish` | Browser checks: password show/hide, Arabic wording, month arrows in both languages |
| `npm run test:ui` | Browser E2E of admin + super_admin flows and Excel download (needs `npx vite preview --port 4173`, Playwright Chromium) |

## Live updates
The database announces changes on private Realtime broadcast channels (migration 8); the app refetches through the normal RLS queries. Realtime must be enabled on the Supabase project (it is by default). Details and security reasoning are in SPEC.md.

## Export
The export dialog offers the **official monthly report** (default: one sheet per day, one per employee, a review sheet; department print settings under "Report settings") and a **simple grid**. Optional logos: `public/templates/logo-left.png`, `logo-right.png`.

## Export template (simple grid)
Default layout: `src/export/templates/default.js`. For the official form add a template with `mode: 'fill'` (see `templates/example-fill.js`), put the .xlsx in `public/templates/`, and set `activeTemplate` in `src/export/engine.js`.
