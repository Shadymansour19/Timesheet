-- Department manager: a department admin who is NOT part of the timesheet.
-- app_role() answers 'admin' for a manager (like an acting super_admin), so every admin policy / RPC applies unchanged;
-- real_role() still says 'manager'. A manager can never be the subject of timesheet data (trigger below).

alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('user', 'admin', 'manager', 'super_admin'));

create or replace function public.app_role() returns text
language sql stable security definer set search_path = ''
as $$
  select case when role = 'super_admin' and public.acting_dept() is not null then 'admin'
              when role = 'manager' then 'admin'
              else role end
    from public.profiles where id = auth.uid() and active
$$;

create function public.no_timesheet_for_manager() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from public.profiles where id = new.user_id and role = 'manager') then
    raise exception 'a department manager has no timesheet' using errcode = '22023';
  end if;
  return new;
end $$;
revoke all on function public.no_timesheet_for_manager() from public, anon, authenticated;

create trigger day_status_no_manager before insert or update on public.day_status for each row execute function public.no_timesheet_for_manager();
create trigger overtime_no_manager before insert or update on public.overtime for each row execute function public.no_timesheet_for_manager();
create trigger departure_moves_no_manager before insert or update on public.departure_moves for each row execute function public.no_timesheet_for_manager();

-- user <-> admin <-> manager. admin (or manager): own department, never self. super_admin: any department.
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
  if v_role is null or v_role = 'user' then
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
    if t.department_id is distinct from public.app_dept() or t.role = 'super_admin'
       or (p_action = 'delete' and t.id = auth.uid()) then
      raise exception 'not authorized' using errcode = '42501';
    end if;
  elsif v_role = 'super_admin' then
    if t.role not in ('admin', 'manager') then
      raise exception 'not authorized' using errcode = '42501';
    end if;
  else
    raise exception 'not authorized' using errcode = '42501';
  end if;
end $$;

-- admin / manager create users, admins and managers in their own department; super_admin creates admins and managers in any.
create or replace function public.assert_can_create(p_dept uuid, p_role text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_role text := public.app_role();
begin
  if not exists (select 1 from public.departments where id = p_dept) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not ((v_role = 'admin' and p_role in ('user', 'admin', 'manager') and p_dept = public.app_dept())
       or (v_role = 'super_admin' and p_role in ('admin', 'manager'))) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
end $$;
