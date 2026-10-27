# Changelog

Newest first. Grouped by day from the git history; the reasons are in [SPEC.md](SPEC.md).

## 2026-10-26
- New roles: department manager (admin without a timesheet), super manager (read-only, all departments); the super admin can add super admins / super managers (Super users tab, single and bulk).
- OPR optional; payroll required except for managers and super users.
- Bulk add: Role column; drag and drop of the Excel file (desktop); bulk add departments; bulk add admins / managers for several departments; one Bulk add button in Departments.
- Users table: sort and Excel-style cascading filters on the column headers; fixed column widths.
- Phone bottom bar: a five-tab bar (super admin) is a dark notched bar with the landing tab as a raised round button; bars with fewer tabs stay flat; Super users is the fifth tab for the super admin.
- Departments tab: search by department or person, counts in the closed rows.
- Faster printing: the report is printed as HTML with SVG pages (no PDF build, no PDF viewer), falling back to the PDF.
- Guided tour for every role on phones and desktops: it walks through all the tabs of the role one after the other (role-aware steps, dashed-days step); WhatsApp link; D badge no longer shows over the names on phones.
- "New version available" banner (the service worker waits for Refresh); first-run checklist for a new department; super users edit their own name / OPR.
- Overtime scan: the PDF reader is no longer precached (downloads when first needed).
- Internal: column filter, bulk-fill dialog and bulk import parsing moved out of the big view files.

## 2026-10-25
- Overtime forms from a scan (local OCR, preview, edit, save, multi-file and folder); admin desktop notifications; overtime overview is the last page of exports.
- Editable neighbouring days, round D departure badge, trips chip, language from the browser list; Excel title sizes.

## 2026-10-24
- Departure on the first rest day (movable); B2B closeout sheets / pages; people ordered by position then payroll; level as text; users cards / table toggle with double-click edit and right-click menu.

## 2026-10-22
- Drag-to-fill on the calendar and the department grid; grid column widths.

## 2026-10-21
- Super admin acts as the admin of any department; payroll field; bulk add from Excel; per-person Y permission; install bar for phones; print never downloads (PDF, Excel HTML, error); calendar clear month.

## 2026-10-20
- Official monthly report (Excel, PDF, print, report v2), job title / contract number / department data; grid keyboard use; phone bottom tab bar; click cycles status.

## 2026-10-19
- First version: schema and RLS, Edge Function, app shell, user calendar, admin grid, user management, super admin, Excel export, offline banner, live updates, theme, account switching, admin Overtime tab.
