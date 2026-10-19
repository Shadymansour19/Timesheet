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

## Setup (filled in as phases land)
1. Create a Supabase project; copy `.env.example` to `.env.local` and fill in URL + anon key.
2. Migrations in `supabase/migrations/` are auto-deployed by the GitHub integration on push.
3. Deploy the Edge Function manually: `supabase functions deploy admin-manage-users`.
4. Seed the first super_admin with `supabase/seed/first_super_admin.sql` (manual, not a migration).
5. `npm install && npm run dev`.
