# PROJECT_STRUCTURE

How to work on it: see [MAINTAINING.md](MAINTAINING.md). Why things are as they are: [SPEC.md](SPEC.md).

```
timesheet/
├── README.md / SPEC.md / PLAN.md / PROJECT_STRUCTURE.md / MAINTAINING.md / CURRENT_STATE.md / CHANGELOG.md
├── CLAUDE.md                 # local, untracked, never in .gitignore (assistant notes only)
├── package.json, vite.config.js, index.html
├── .env.example              # no real values (.env.local and .env.db are untracked)
├── public/                   # icons, manifest, service worker assets, templates/ (logo-left.png, logo-right.png)
├── src/
│   ├── main.js, router.js, supabase.js, dom.js, live.js (Realtime), theme.js, update.js (new-version banner), notify.js, install.js, acting.js
│   ├── auth/session.js       # login, saved accounts, session
│   ├── api/                  # timesheet.js (paged reads, padded month), admin.js (RPCs + Edge Function), errors.js
│   ├── lib/                  # core.js (pure date / holiday helpers, WEEK_START, comparePeople), dragfill.js, bulk-parse.js (Excel files of the bulk add dialogs)
│   ├── views/                # calendar (user + person), team (department grid), overtime, users, departments, super-users, bulk-users, bulk-departments, person, account, login
│   ├── components/           # choice, dialog, form, day-editor, report-settings, bulk-fill, column-filter, onboarding, dropzone, overtime-scan, month-head, shell, toast, icons
│   ├── export/
│   │   ├── model.js          # data -> model: arrival / departure / transport rules, totals
│   │   ├── official.js       # official monthly report as Excel (day, employee, review, overtime sheets; formulas)
│   │   ├── pdf.js            # the same report as PDF (jsPDF)
│   │   ├── engine.js         # downloads, single-person export, print (PDF in a hidden frame, Excel fallback), simple grid, overtime form print / export
│   │   ├── overtime-form.js  # the overtime form (a day per A4 portrait page, Arabic): grouping of same notes, HTML (print, PDF) and Excel
│   │   └── templates/        # official.js (constants of the form), default.js (simple grid), example-fill.js
│   ├── ocr/                  # engine.js (pdf.js + Tesseract.js, local), parse.js (words -> overtime rows)
│   ├── i18n/                 # en.js, ar.js (kept in sync by tests/check-i18n.mjs)
│   └── styles/main.css
├── supabase/
│   ├── migrations/           # numbered *.sql (27 so far); applied with `supabase db push`
│   ├── functions/admin-manage-users/   # Edge Function: create / reset / delete logins
│   ├── seed/                 # first_super_admin.sql (manual, template only)
│   └── tests/                # rls.sql (impersonation tests), run.sh, e2e_admin_users.sh
└── tests/
    ├── check-i18n.mjs, export.test.mjs, export-official.test.mjs, export-pdf.test.mjs
    └── ui/                   # Playwright browser tests (need vite preview on 4173)
```
