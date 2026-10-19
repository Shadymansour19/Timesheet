-- Helpers are SECURITY DEFINER (owner bypasses RLS) so policies never recurse into profiles.

create function public.app_role() returns text
language sql stable security definer set search_path = ''
as $$ select role from public.profiles where id = auth.uid() and active $$;

create function public.app_dept() returns uuid
language sql stable security definer set search_path = ''
as $$ select department_id from public.profiles where id = auth.uid() and active $$;

create function public.dept_of(p_user uuid) returns uuid
language sql stable security definer set search_path = ''
as $$ select department_id from public.profiles where id = p_user $$;

alter table public.departments enable row level security;
alter table public.profiles    enable row level security;
alter table public.settings    enable row level security;
alter table public.day_status  enable row level security;
alter table public.holidays    enable row level security;
alter table public.overtime    enable row level security;
alter table public.audit_log   enable row level security;

create policy departments_select on public.departments for select to authenticated
  using ((select public.app_role()) = 'super_admin' or id = (select public.app_dept()));

create policy profiles_select on public.profiles for select to authenticated
  using (
    (id = auth.uid() and active)
    or (select public.app_role()) = 'super_admin'
    or ((select public.app_role()) = 'admin' and department_id = (select public.app_dept()))
  );

create policy settings_select on public.settings for select to authenticated using (true);

-- super_admin deliberately gets no timesheet access.
create policy day_status_select on public.day_status for select to authenticated
  using (
    (user_id = auth.uid() and (select public.app_role()) is not null)   -- app_role() is NULL once soft-deleted
    or ((select public.app_role()) = 'admin' and public.dept_of(user_id) = (select public.app_dept()))
  );

create policy overtime_select on public.overtime for select to authenticated
  using (
    (user_id = auth.uid() and (select public.app_role()) is not null)   -- app_role() is NULL once soft-deleted
    or ((select public.app_role()) = 'admin' and public.dept_of(user_id) = (select public.app_dept()))
  );

create policy holidays_select on public.holidays for select to authenticated
  using (department_id = (select public.app_dept()));

create policy audit_select on public.audit_log for select to authenticated
  using (
    ((select public.app_role()) = 'admin' and department_id = (select public.app_dept()))
    or ((select public.app_role()) = 'super_admin' and table_name in ('profiles', 'departments'))
  );

-- Read-only for clients. No INSERT/UPDATE/DELETE policies or grants exist anywhere.
revoke all on all tables in schema public from anon, authenticated;
grant select on public.departments, public.profiles, public.settings, public.day_status,
  public.holidays, public.overtime, public.audit_log to authenticated;
