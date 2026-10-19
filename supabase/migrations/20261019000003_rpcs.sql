-- All writes. Every function is SECURITY DEFINER with an empty search_path and re-checks
-- the caller itself. Authorization failures use SQLSTATE 42501, bad input 22023.

create function public.set_day_status(p_user uuid, p_day date, p_status text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_role text := public.app_role();
  v_win int;
begin
  if p_status is null or p_status not in ('X', 'Y', 'E') then
    raise exception 'invalid status' using errcode = '22023';
  end if;
  if v_role = 'user' then
    if p_user is distinct from auth.uid() then
      raise exception 'not authorized' using errcode = '42501';
    end if;
    select (value #>> '{}')::int into v_win from public.settings where key = 'user_edit_window_days';
    if v_win is not null and p_day < current_date - v_win then
      raise exception 'day is outside the edit window' using errcode = '42501';
    end if;
  elsif v_role = 'admin' then
    if public.dept_of(p_user) is distinct from public.app_dept() then
      raise exception 'not authorized' using errcode = '42501';
    end if;
  else
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_user and active) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if p_status = 'E' then
    delete from public.day_status where user_id = p_user and day = p_day;
  else
    insert into public.day_status (user_id, day, status, updated_by)
    values (p_user, p_day, p_status, auth.uid())
    on conflict (user_id, day) do update
      set status = excluded.status, updated_by = excluded.updated_by, updated_at = now();
  end if;
end $$;

create function public.set_day_status_bulk(p_users uuid[], p_days date[], p_status text) returns void
language plpgsql security definer set search_path = ''
as $$
declare u uuid; d date;
begin
  if public.app_role() is distinct from 'admin' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if cardinality(p_users) > 500 or cardinality(p_days) > 366 then
    raise exception 'too many users or days' using errcode = '22023';
  end if;
  foreach u in array p_users loop
    foreach d in array p_days loop
      perform public.set_day_status(u, d, p_status);
    end loop;
  end loop;
end $$;

create function public.set_overtime(p_user uuid, p_day date, p_hours integer, p_note text default null) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if public.app_role() is distinct from 'admin'
     or public.dept_of(p_user) is distinct from public.app_dept()
     or not exists (select 1 from public.profiles where id = p_user and active) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_hours is null or p_hours < 0 or p_hours > 24 then
    raise exception 'hours must be an integer between 0 and 24' using errcode = '22023';
  end if;
  if p_hours = 0 then
    delete from public.overtime where user_id = p_user and day = p_day;
  else
    insert into public.overtime (user_id, day, hours, note, entered_by)
    values (p_user, p_day, p_hours, p_note, auth.uid())
    on conflict (user_id, day) do update
      set hours = excluded.hours, note = excluded.note,
          entered_by = excluded.entered_by, updated_at = now();
  end if;
end $$;

create function public.set_holiday(p_day date, p_on boolean) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if public.app_role() is distinct from 'admin' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_on then
    insert into public.holidays (department_id, day, created_by)
    values (public.app_dept(), p_day, auth.uid())
    on conflict do nothing;
  else
    delete from public.holidays where department_id = public.app_dept() and day = p_day;
  end if;
end $$;

create function public.update_profile(p_user uuid, p_full_name text, p_opr text, p_level integer) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if public.app_role() is distinct from 'admin' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.profiles
     set full_name = p_full_name, opr = p_opr, level = p_level
   where id = p_user and active and role in ('user', 'admin')
     and department_id = public.app_dept();
  if not found then
    raise exception 'not authorized' using errcode = '42501';
  end if;
end $$;

-- user <-> admin only. admin: own department. super_admin: any department.
create function public.set_user_role(p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_role text := public.app_role();
  t record;
begin
  if p_role is null or p_role not in ('user', 'admin') then
    raise exception 'role must be user or admin' using errcode = '22023';
  end if;
  if v_role is null or v_role = 'user' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select id, role, department_id into t from public.profiles
   where id = p_user and active and role in ('user', 'admin');
  if not found then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_role = 'admin' then
    if t.department_id is distinct from public.app_dept()
       or (t.id = auth.uid() and p_role = 'user') then   -- no self-demotion
      raise exception 'not authorized' using errcode = '42501';
    end if;
  end if;
  update public.profiles set role = p_role where id = p_user;
end $$;

-- Raises unless the caller may manage (p_action 'reset' | 'delete') the target.
-- admin: users/admins of own department (not self for delete). super_admin: admins only.
-- The Edge Function calls this with the caller's JWT before using the service role.
create function public.assert_can_manage(p_target uuid, p_action text) returns void
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
    if t.role <> 'admin' then
      raise exception 'not authorized' using errcode = '42501';
    end if;
  else
    raise exception 'not authorized' using errcode = '42501';
  end if;
end $$;

-- admin creates plain users in own department; super_admin creates admins in any department.
create function public.assert_can_create(p_dept uuid, p_role text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_role text := public.app_role();
begin
  if not exists (select 1 from public.departments where id = p_dept) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not ((v_role = 'admin' and p_role = 'user' and p_dept = public.app_dept())
       or (v_role = 'super_admin' and p_role = 'admin')) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
end $$;

-- Soft delete. Must be an RPC: a plain client UPDATE would be re-checked against the SELECT
-- policy on the new row and silently blocked. The Edge Function then bans the auth user.
create function public.soft_delete_user(p_user uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.assert_can_manage(p_user, 'delete');
  update public.profiles set active = false, deleted_at = now() where id = p_user;
end $$;

create function public.create_department(p_name text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
  if public.app_role() is distinct from 'super_admin' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  insert into public.departments (name) values (btrim(p_name)) returning id into v_id;
  return v_id;
end $$;

create function public.rename_department(p_id uuid, p_name text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if public.app_role() is distinct from 'super_admin' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.departments set name = btrim(p_name) where id = p_id;
end $$;

-- Grid / export source. SECURITY INVOKER: RLS decides which people and rows are visible.
-- effective_status: X/Y become XH/YH on a department holiday; E stays E.
create function public.get_timesheet(p_dept uuid, p_from date, p_to date)
returns table (user_id uuid, day date, status text, effective_status text, overtime_hours integer)
language sql stable
as $$
  select p.id, d::date,
         coalesce(s.status, 'E'),
         case when coalesce(s.status, 'E') <> 'E' and h.day is not null
              then s.status || 'H' else coalesce(s.status, 'E') end,
         coalesce(o.hours, 0)::int
    from public.profiles p
   cross join generate_series(p_from, p_to, interval '1 day') d
    left join public.day_status s on s.user_id = p.id and s.day = d::date
    left join public.holidays h on h.department_id = p.department_id and h.day = d::date
    left join public.overtime o on o.user_id = p.id and o.day = d::date
   where p.active and p.role <> 'super_admin'
     and (p_dept is null or p.department_id = p_dept)
     and public.app_role() is distinct from 'super_admin'
     and p_to - p_from <= 62
$$;

-- Only authenticated may call these (default function privileges were revoked in 0001).
grant execute on function
  public.app_role(), public.app_dept(), public.dept_of(uuid),
  public.set_day_status(uuid, date, text), public.set_day_status_bulk(uuid[], date[], text),
  public.set_overtime(uuid, date, integer, text), public.set_holiday(date, boolean),
  public.update_profile(uuid, text, text, integer), public.set_user_role(uuid, text),
  public.assert_can_manage(uuid, text), public.assert_can_create(uuid, text),
  public.soft_delete_user(uuid), public.create_department(text),
  public.rename_department(uuid, text), public.get_timesheet(uuid, date, date)
to authenticated;
