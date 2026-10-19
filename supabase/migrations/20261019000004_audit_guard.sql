-- Audit triggers (actor = auth.uid(), NULL for service-role/manual changes) and the
-- last-super_admin guard. Trigger functions are not granted to any client role.

create function public.audit_day_status() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare r public.day_status := coalesce(new, old);
begin
  if coalesce(old.status, 'E') is distinct from coalesce(new.status, 'E') then
    insert into public.audit_log (actor, table_name, department_id, target_user, day, field, old_value, new_value)
    values (auth.uid(), 'day_status', public.dept_of(r.user_id), r.user_id, r.day, 'status',
            coalesce(old.status, 'E'), coalesce(new.status, 'E'));
  end if;
  return null;
end $$;
create trigger day_status_audit after insert or update or delete on public.day_status
  for each row execute function public.audit_day_status();

create function public.audit_overtime() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare r public.overtime := coalesce(new, old);
begin
  if coalesce(old.hours, 0) is distinct from coalesce(new.hours, 0)
     or old.note is distinct from new.note then
    insert into public.audit_log (actor, table_name, department_id, target_user, day, field, old_value, new_value)
    values (auth.uid(), 'overtime', public.dept_of(r.user_id), r.user_id, r.day, 'hours',
            coalesce(old.hours, 0)::text, coalesce(new.hours, 0)::text);
  end if;
  return null;
end $$;
create trigger overtime_audit after insert or update or delete on public.overtime
  for each row execute function public.audit_overtime();

create function public.audit_holidays() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare r public.holidays := coalesce(new, old);
begin
  insert into public.audit_log (actor, table_name, department_id, day, field, old_value, new_value)
  values (auth.uid(), 'holidays', r.department_id, r.day, 'holiday',
          (tg_op = 'DELETE')::text, (tg_op <> 'DELETE')::text);
  return null;
end $$;
create trigger holidays_audit after insert or delete on public.holidays
  for each row execute function public.audit_holidays();

create function public.audit_profiles() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare k text;
begin
  if tg_op = 'INSERT' then
    insert into public.audit_log (actor, table_name, department_id, target_user, field, new_value)
    values (auth.uid(), 'profiles', new.department_id, new.id, 'created', new.username);
    return null;
  end if;
  foreach k in array array['username', 'full_name', 'opr', 'level', 'department_id', 'role', 'active'] loop
    if to_jsonb(old) ->> k is distinct from to_jsonb(new) ->> k then
      insert into public.audit_log (actor, table_name, department_id, target_user, field, old_value, new_value)
      values (auth.uid(), 'profiles', new.department_id, new.id, k, to_jsonb(old) ->> k, to_jsonb(new) ->> k);
    end if;
  end loop;
  return null;
end $$;
create trigger profiles_audit after insert or update on public.profiles
  for each row execute function public.audit_profiles();

create function public.audit_departments() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or old.name is distinct from new.name then
    insert into public.audit_log (actor, table_name, department_id, field, old_value, new_value)
    values (auth.uid(), 'departments', new.id, 'name', old.name, new.name);
  end if;
  return null;
end $$;
create trigger departments_audit after insert or update on public.departments
  for each row execute function public.audit_departments();

-- Never allow the last active super_admin to be demoted, deactivated or deleted
-- (by anyone, including the service role and auth.users cascade deletes).
create function public.guard_last_super_admin() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if old.role = 'super_admin' and old.active
     and (tg_op = 'DELETE' or new.role <> 'super_admin' or not new.active)
     and not exists (select 1 from public.profiles
                      where role = 'super_admin' and active and id <> old.id) then
    raise exception 'cannot demote, deactivate or delete the last super_admin';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger profiles_guard_last_super_admin before update or delete on public.profiles
  for each row execute function public.guard_last_super_admin();
