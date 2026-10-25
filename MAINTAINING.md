# MAINTAINING – how to keep working on this app without an assistant

Plain JavaScript (Vite, no framework) in the browser, Supabase (Postgres + Auth + one Edge Function) behind it. Read
[SPEC.md](SPEC.md) for WHY things are the way they are (dated decision log, newest at the bottom) and
[PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md) for WHERE things are.

## 1. One-time setup on a machine
1. `npm install`
2. `.env.local` (untracked) with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (see `.env.example`). Both come from the Supabase dashboard (Project Settings → API).
3. For database work only: `.env.db` (untracked) with `TS_DB_URL='postgresql://…'` (the Supabase "connection string", Project Settings → Database). Load it with `set -a; . ./.env.db; set +a`. Never commit either file.
4. Tools used by the scripts: the Supabase CLI (`npx supabase …`), `psql`, LibreOffice (`soffice`, only for the Excel recalculation test), poppler (`pdftotext`, `pdfinfo`, `pdfimages`, for the PDF test), Playwright's Chromium (for the browser tests; set `CHROME=<path to chrome-headless-shell>`).

## 2. Everyday commands
| Do | Command |
|---|---|
| Run locally | `npm run dev` |
| Production build | `npm run build` (output in `dist/`, the host serves it; push to GitHub deploys) |
| Browser tests need a server | `npx vite preview --port 4173` (after `npm run build`) |
| Quick checks (no database, no browser) | `npm run test:i18n`, `npm run test:export`, `npm run test:export-official`, `npm run test:export-pdf` |
| Database rules | `npm run test:rls` (rolled-back transaction, safe) |
| Edge Function end to end | `npm run test:e2e-users` |
| Browser tests | `npm run test:ui`, `test:ui-team`, `test:ui-keyboard`, `test:ui-export`, … (list in README) |

**The database is the real one.** The browser tests create their own temporary people/departments (ids and names with a fixed prefix such as `XO`, `TG`, `KB`) and delete them afterwards; they must never touch real data. If a test is killed half-way, the next run cleans the leftovers first. Remote database calls take 1–2 s, so tests wait for results (`eventually` / `until`), never fixed sleeps.

## 3. Changing the database
1. Add a NEW file `supabase/migrations/<yyyymmddhhmmss>_<name>.sql` (never edit an applied one).
2. Apply: `set -a; . ./.env.db; set +a; npx supabase db push --db-url "$TS_DB_URL" --yes`.
3. All writes go through `security definer` functions that check the caller's role (see migrations 3, 9, 10, 12 for the pattern: `update_profile`, `set_department_report`). Row Level Security is on every table; clients cannot write tables directly.
4. Add a check to `supabase/tests/rls.sql` (pattern: `t.ok`, `t.eq`, `t.denied`) and run `npm run test:rls`.
5. Changing a function's arguments = `drop function` the old signature first (migration 12 shows how) and update `src/api/admin.js`.
6. The Edge Function (`supabase/functions/admin-manage-users/index.ts`, creates/deletes logins) is deployed separately: `npx supabase functions deploy admin-manage-users --use-api`.
7. The first super admin is created by hand with `supabase/seed/first_super_admin.sql` (template, never a migration).

## 4. Common changes – where to touch
| I want to… | Touch |
|---|---|
| Add a field to a person | migration (column, `update_profile` argument, audit trigger) → `PEOPLE_COLS` + `updateProfile` in `src/api/admin.js` → `personFields` in `src/views/users.js` (and its call sites: add user, edit user, `departments.js` add admin) → Edge Function `create_user` → i18n key in `en.js` AND `ar.js` → `src/export/model.js` if reports use it → tests |
| Add a field to a department | same pattern with `set_department_report` / `fetchDepartment`, the dialog `src/components/report-settings.js`, `reportSettings()` in `src/export/official.js` |
| Change a text | `src/i18n/en.js` and `ar.js` (`npm run test:i18n` fails if a key exists in one only) |
| Change who may do what | the RPC in a new migration + the RLS test. The UI hiding a button is cosmetic only |
| Change the week start (Sunday now) | `WEEK_START` in `src/lib/core.js` |
| Contract-number prefill (033/2019) | `DEFAULT_CONTRACT_NO` in `src/views/users.js` (UI only; there is no database default on purpose) |
| User edit window (how far back users may edit) | row `user_edit_window_days` in table `settings` (null = unlimited) |
| Payroll display prefix (EMC-) | `fmtOpr` in `src/lib/core.js` |
| Colours, spacing, grid widths | `src/styles/main.css` (grid cell and name-column widths: the `.tgrid.month` rules) |
| Grid clicks / keyboard | `src/views/team.js` (`cycle`, `onKey`, `toggleHoliday`) |
| A dropdown-like choice | `src/components/choice.js` (radio cards; never a native `<select>`) |

## 5. The official report (Excel and PDF)
Data flow: database rows → `fetchPaddedMonthData` (month ± 1 day) → `buildModel` in `src/export/model.js` → either `official.js` (Excel, ExcelJS) or `pdf.js` (jsPDF). `engine.js` wires downloads and printing.

- **Rules live in `model.js`**: Arrival / Departure / TRANS-IN / TRANS-EX. `DEPARTURE_RULE = 'work-day'` marks the last work day before a rest day; `'rest-day'` marks the first rest day (what the sample sheets did). An isolated work day gets both marks (2 trips). Unspecified residence counts as inside.
- **Constants of the form** (captions, "EMC MANPOWER", banner line, sign-off texts, logo path) are in `src/export/templates/official.js`. The logos are `public/templates/logo-left.png` / `logo-right.png`.
- **Excel layout** (`official.js`): the objects `D` (day sheet), `E` (employee sheet), `V` (review sheet) hold row/column positions; column widths are the arrays near the top of each sheet function. Employee sheets READ the day sheets with `INDEX/MATCH` on the payroll cell; the review and overtime sheets read the employee sheets. Review totals use a hidden column (13) holding each person's position.
- **PDF layout** (`pdf.js`): day, review and overtime pages use point sizes; the employee page is drawn on the printed form's own 920 × 1300 grid (`K = page width / 920`), so coordinates there are in that grid's pixels.
- **After any layout change** run `npm run test:export-official` (it re-reads every cell and has LibreOffice recalculate every formula) and `npm run test:export-pdf`, then LOOK at the output: `soffice --headless --convert-to pdf <file.xlsx>` and `pdftoppm -r 80 -png <file.pdf> page` produce images you can open.
- Sheet names: day sheets `1..N`, employee sheets `<name> <payroll>` shortened to Excel's 31 characters, then `Review`, `Overtime`.
- PDF text is Latin only (standard PDF fonts); other characters print as "?". To support Arabic names embed a font in `pdf.js` (not done).

## 6. Things to know before you are surprised
- Hosting needs the two `VITE_…` variables at build time; the Edge Function reads the service key from Supabase itself (never in the repo).
- Live updates use Supabase Realtime broadcast channels; the plan must allow enough concurrent connections.
- The Edge Function can be slow (10+ s) on Supabase's side now and then; that is not the app.
- Open decisions are marked "TO CONFIRM" / "OPEN" in `SPEC.md` (departure rule, position-based totals only counting "engineer" / "tech", week start, holidays per department).
- PDF printing relies on the browser printing a PDF shown in a hidden frame; if that does not work on a device the app downloads the Excel file instead. Paper size comes from the PDF (A4).
- Do not edit `dist/` or `node_modules/`.

## 7. If something breaks
1. `git log --oneline` and `git diff` – commits are small and one-line.
2. Run the quick checks (section 2), then `npm run test:rls`, then the browser tests of the area you touched.
3. A migration that went wrong: write a new migration that fixes it (do not edit the old one).
4. Anything in the app that talks to the database fails for a plain user but works for an admin → it is almost always a missing grant or role check in the function (migration), not the UI.

## 8. Overtime forms from a scan (local OCR)
Overtime tab -> "Scan overtime forms": PDFs / photos (several files or a whole folder) are read ON THE DEVICE and shown as an editable preview; "Save overtime" writes one atomic bulk save per date (`set_overtime_bulk`).
- Code: `src/ocr/engine.js` (pdf.js draws the pages, Tesseract.js reads them, English model in `public/ocr/lang`), `src/ocr/parse.js` (pure: words -> rows), `src/components/overtime-scan.js` (preview + save). The big engine files are NOT precached (`vite.config.js`); they are cached on first use.
- Rows are found from the payroll code `EMC-<number>` anywhere on the page; the person and the English name come from the admin's department (the payroll key ignores leading zeros); a payroll that is not in the department is skipped; Arabic text is never used or shown. The work text of the row is the note, the hours are the small number on the same side of the code as that text.
- Lessons (tests/ui/overtime-scan.mjs on the real sample): rotation is found by 4 quick passes; read at ~150 dpi (a second try at ~200 dpi); do NOT threshold the page (small text was lost); the lone hours digit is read separately from its own strip with the table's vertical lines erased.
- Tests: `npm run test:ocr-parse` (pure) and `npm run test:ui-ocr` (needs the sample PDF at `OCR_SAMPLE`, default `~/Downloads/scan_opr1021_2026-10-25-14-38-11.pdf`; it is a real document and is not in the repository).
