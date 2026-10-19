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
| `npm run test:rls` | 140 RLS/RPC checks by impersonating each role (runs in a rolled-back transaction) |
| `npm run test:e2e-users` | Deployed Edge Function: create/reset/delete, permissions, rollback |
| `npm run test:export` | Builds real .xlsx files, re-reads them and checks cell contents (+ fill-mode template) |
| `npm run test:i18n` | Every translation key exists in English and Arabic |
| `npm run test:ui-accounts` | Browser E2E of account switching: add/switch/remove/sign-out, revoked sessions, two tabs, no password in storage |
| `npm run test:ui-polish` | Browser checks: password show/hide, Arabic wording, month arrows in both languages |
| `npm run test:ui` | Browser E2E of admin + super_admin flows and Excel download (needs `npx vite preview --port 4173`, Playwright Chromium) |

## Export template
Default layout: `src/export/templates/default.js`. For the official form add a template with `mode: 'fill'` (see `templates/example-fill.js`), put the .xlsx in `public/templates/`, and set `activeTemplate` in `src/export/engine.js`.
