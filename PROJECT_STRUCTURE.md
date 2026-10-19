# PROJECT_STRUCTURE

```
timesheet/
├── README.md / SPEC.md / PLAN.md / PROJECT_STRUCTURE.md
├── CLAUDE.md                 # local, untracked, never in .gitignore
├── package.json, vite.config.js, index.html
├── .env.example              # no real values
├── public/                   # icons, manifest, service worker assets
├── src/
│   ├── main.js, router.js, supabase.js, dom.js
│   ├── auth/                 # login, change password, session
│   ├── api/                  # timesheet.js (paged reads), admin.js (RPCs + Edge Function), errors.js
│   ├── lib/core.js           # pure date + holiday helpers (shared with export/tests)
│   ├── views/                # user-calendar, admin-grid, superadmin, login
│   ├── components/           # grid, dialogs, toasts
│   ├── export/
│   │   ├── model.js          # data -> template-independent model
│   │   ├── engine.js         # applies a template (generate or fill mode)
│   │   └── templates/        # default.js, (official form later)
│   ├── i18n/                 # strings (en; ar if required)
│   └── styles/
├── supabase/
│   ├── migrations/           # *.sql, auto-deployed on push
│   ├── functions/admin-manage-users/
│   ├── seed/                 # first_super_admin.sql (manual, template only)
│   └── tests/                # psql RLS impersonation tests
└── tests/                    # check-i18n, export.test.mjs, ui/admin-flows.mjs (browser E2E)
```
