# PROJECT_STRUCTURE

```
timesheet/
├── README.md / SPEC.md / PLAN.md / PROJECT_STRUCTURE.md
├── CLAUDE.md                 # local, untracked, never in .gitignore
├── package.json, vite.config.js, index.html
├── .env.example              # no real values
├── public/                   # icons, manifest, service worker assets
├── src/
│   ├── main.js, router.js, supabase.js
│   ├── auth/                 # login, change password, session
│   ├── api/                  # thin wrappers over RPCs / queries
│   ├── views/                # user-calendar, admin-grid, superadmin, login
│   ├── components/           # grid, dialogs, toasts
│   ├── export/
│   │   ├── engine.js         # applies a template mapping to the model
│   │   └── templates/        # default.js, (official form later)
│   ├── i18n/                 # strings (en; ar if required)
│   └── styles/
├── supabase/
│   ├── migrations/           # *.sql, auto-deployed on push
│   ├── functions/admin-manage-users/
│   ├── seed/                 # first_super_admin.sql (manual, template only)
│   └── tests/                # psql RLS impersonation tests
└── tests/                    # export verification scripts
```
