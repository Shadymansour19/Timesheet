-- Super manager: a read-only super admin. Sees every department's people, timesheets, overtime and holidays (and can export them),
-- changes nothing, manages nobody, and has no timesheet of its own. Like the super admin it belongs to no department.
-- app_role() answers 'super_manager' (the role itself), so every write RPC that asks for 'admin' / 'super_admin' refuses it.

alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('user', 'admin', 'manager', 'super_admin', 'super_manager'));
alter table public.profiles drop constraint profiles_check;
alter table public.profiles add constraint profiles_check check ((role in ('super_admin', 'super_manager')) = (department_id is null));

create function public.is_super_manager() returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.profiles where id = auth.uid() and active and role = 'super_manager') $$;
revoke all on function public.is_super_manager() from public, anon;
grant execute on function public.is_super_manager() to authenticated;

-- read access to every department (permissive policies are OR-ed with the existing ones)
create policy departments_select_sm on public.departments for select to authenticated using ((select public.is_super_manager()));
create policy profiles_select_sm on public.profiles for select to authenticated using ((select public.is_super_manager()));
create policy day_status_select_sm on public.day_status for select to authenticated using ((select public.is_super_manager()));
create policy overtime_select_sm on public.overtime for select to authenticated using ((select public.is_super_manager()));
create policy holidays_select_sm on public.holidays for select to authenticated using ((select public.is_super_manager()));
create policy departure_moves_select_sm on public.departure_moves for select to authenticated using ((select public.is_super_manager()));

-- live channels of any department
drop policy rt_receive on realtime.messages;
create policy rt_receive on realtime.messages for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (
      (select realtime.topic()) = 'user:' || (select auth.uid())::text
      or (select realtime.topic()) = 'deptpub:' || (select public.app_dept())::text
      or ((select realtime.topic()) = 'dept:' || (select public.app_dept())::text and (select public.app_role()) = 'admin')
      or ((select public.real_role()) = 'super_admin' and (select realtime.topic()) ~ '^(dept|deptpub):[0-9a-fA-F-]{36}$')
      or ((select public.is_super_manager()) and (select realtime.topic()) ~ '^(dept|deptpub):[0-9a-fA-F-]{36}$')
    )
  );

-- nobody without a timesheet can be the subject of timesheet rows
create or replace function public.no_timesheet_for_manager() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from public.profiles where id = new.user_id and role in ('manager', 'super_manager')) then
    raise exception 'this role has no timesheet' using errcode = '22023';
  end if;
  return new;
end $$;

-- set_user_role: only admins (managers) and super admins; a super manager must not pass the generic "not a plain user" test
create or replace function public.set_user_role(p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_role text := public.app_role();
  t record;
begin
  if p_role is null or p_role not in ('user', 'admin', 'manager') then
    raise exception 'role must be user, admin or manager' using errcode = '22023';
  end if;
  if v_role is null or v_role not in ('admin', 'super_admin') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select id, role, department_id into t from public.profiles
   where id = p_user and active and role in ('user', 'admin', 'manager');
  if not found then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_role = 'admin' then
    if t.department_id is distinct from public.app_dept() or t.id = auth.uid() then   -- no self change
      raise exception 'not authorized' using errcode = '42501';
    end if;
  end if;
  update public.profiles set role = p_role where id = p_user;
end $$;

-- the super admin may reset / delete super managers too
create or replace function public.assert_can_manage(p_target uuid, p_action text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_role text := public.app_role();
  t record;
begin
  select id, role, department_id into t from public.profiles where id = p_target and active;
  if v_role is null or not found or p_action not in ('reset', 'delete') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_role = 'admin' then
    if t.department_id is distinct from public.app_dept() or t.role in ('super_admin', 'super_manager')
       or (p_action = 'delete' and t.id = auth.uid()) then
      raise exception 'not authorized' using errcode = '42501';
    end if;
  elsif v_role = 'super_admin' then
    if t.role not in ('admin', 'manager', 'super_manager') then
      raise exception 'not authorized' using errcode = '42501';
    end if;
  else
    raise exception 'not authorized' using errcode = '42501';
  end if;
end $$;

-- super_admin additionally creates super managers (no department)
create or replace function public.assert_can_create(p_dept uuid, p_role text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_role text := public.app_role();
begin
  if p_role = 'super_manager' then
    if v_role is distinct from 'super_admin' or p_dept is not null then
      raise exception 'not authorized' using errcode = '42501';
    end if;
    return;
  end if;
  if not exists (select 1 from public.departments where id = p_dept) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not ((v_role = 'admin' and p_role in ('user', 'admin', 'manager') and p_dept = public.app_dept())
       or (v_role = 'super_admin' and p_role in ('admin', 'manager'))) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
end $$;

-- department report settings: admins (own department) and super admins only
CREATE OR REPLACE FUNCTION public.set_department_report(p_dept uuid, p_report jsonb, p_code text DEFAULT NULL::text, p_sector text DEFAULT NULL::text, p_field text DEFAULT NULL::text, p_approved_engineer text DEFAULT NULL::text, p_approved_tech text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_role text := public.app_role();
  k text;
  v jsonb;
begin
  if v_role is null or v_role not in ('admin', 'super_admin')
     or (v_role = 'admin' and p_dept is distinct from public.app_dept()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if jsonb_typeof(p_report) is distinct from 'object' then
    raise exception 'report settings must be an object' using errcode = '22023';
  end if;
  for k, v in select * from jsonb_each(p_report) loop
    if k not in ('dept_print_name', 'location') then
      raise exception 'unknown report setting: %', k using errcode = '22023';
    end if;
    if jsonb_typeof(v) is distinct from 'string' or length(v #>> '{}') > 200 then
      raise exception 'report setting % must be text of at most 200 characters', k using errcode = '22023';
    end if;
  end loop;
  if (p_approved_engineer is not null and p_approved_engineer <> '' and p_approved_engineer !~ '^[0-9]{1,9}$')
     or (p_approved_tech is not null and p_approved_tech <> '' and p_approved_tech !~ '^[0-9]{1,9}$') then
    raise exception 'approved totals must be whole numbers' using errcode = '22023';
  end if;
  update public.departments
     set report = p_report,
         code = case when p_code is null then code else nullif(btrim(p_code), '') end,
         sector = case when p_sector is null then sector else nullif(btrim(p_sector), '') end,
         field = case when p_field is null then field else nullif(btrim(p_field), '') end,
         approved_engineer = case when p_approved_engineer is null then approved_engineer else nullif(p_approved_engineer, '')::integer end,
         approved_tech = case when p_approved_tech is null then approved_tech else nullif(p_approved_tech, '')::integer end
   where id = p_dept;
  if not found then
    raise exception 'not authorized' using errcode = '42501';
  end if;
end $function$;
