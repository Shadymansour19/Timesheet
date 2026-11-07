-- A real super_admin must be able to load the full department switcher while acting as one department.
-- app_role() becomes 'admin' when x-acting-dept is present, so checking app_role() here
-- incorrectly limits the department list to the selected department.
drop policy departments_select on public.departments;
create policy departments_select on public.departments for select to authenticated
  using ((select public.real_role()) = 'super_admin' or id = (select public.app_dept()));
