-- A super admin can add other super admins (and reset / delete them, never themselves; the last-super_admin guard still applies).
create or replace function public.assert_can_create(p_dept uuid, p_role text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_role text := public.app_role();
begin
  if p_role in ('super_manager', 'super_admin') then      -- no department
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
    if t.role not in ('admin', 'manager', 'super_manager', 'super_admin')
       or (t.role = 'super_admin' and t.id = auth.uid()) then
      raise exception 'not authorized' using errcode = '42501';
    end if;
  else
    raise exception 'not authorized' using errcode = '42501';
  end if;
end $$;
