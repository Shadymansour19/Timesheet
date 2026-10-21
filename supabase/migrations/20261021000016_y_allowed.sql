-- profiles.y_allowed: may this person have the status "Y" (day/night shift, 1.2X)? Controlled by the department admin.
-- Default true = everybody keeps what they had. Enforced by a trigger on day_status, so EVERY writer (user, admin, bulk, undo,
-- super admin acting as admin) is covered: a person who is not allowed can only be E or X.
alter table public.profiles add column y_allowed boolean not null default true;

create function public.day_status_y_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.status = 'Y' and not coalesce((select y_allowed from public.profiles where id = new.user_id), true) then
    raise exception 'Y is not allowed for this person' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger day_status_y_guard before insert or update on public.day_status
  for each row execute function public.day_status_y_guard();

drop function public.update_profile(uuid, text, text, integer, text, text, text, text, text, text);
create function public.update_profile(
  p_user uuid, p_full_name text, p_opr text, p_level integer,
  p_job_title text default null, p_contract_no text default null,
  p_work_location text default null, p_residence text default null,
  p_position text default null, p_payroll text default null,
  p_y_allowed boolean default null
) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if public.app_role() is distinct from 'admin' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_residence is not null and p_residence not in ('', 'inside', 'outside') then
    raise exception 'residence must be inside or outside' using errcode = '22023';
  end if;
  update public.profiles
     set full_name = p_full_name, opr = p_opr, level = p_level,
         job_title = case when p_job_title is null then job_title else nullif(btrim(p_job_title), '') end,
         contract_no = case when p_contract_no is null then contract_no else nullif(btrim(p_contract_no), '') end,
         work_location = case when p_work_location is null then work_location else nullif(btrim(p_work_location), '') end,
         residence = case when p_residence is null then residence else nullif(p_residence, '') end,
         "position" = case when p_position is null then "position" else nullif(btrim(p_position), '') end,
         payroll = case when p_payroll is null then payroll else nullif(btrim(p_payroll), '') end,
         y_allowed = coalesce(p_y_allowed, y_allowed)
   where id = p_user and active and role in ('user', 'admin')
     and department_id = public.app_dept();
  if not found then
    raise exception 'not authorized' using errcode = '42501';
  end if;
end $$;
grant execute on function public.update_profile(uuid, text, text, integer, text, text, text, text, text, text, boolean) to authenticated;

create or replace function public.audit_profiles() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare k text;
begin
  if tg_op = 'INSERT' then
    insert into public.audit_log (actor, table_name, department_id, target_user, field, new_value)
    values (auth.uid(), 'profiles', new.department_id, new.id, 'created', new.username);
    return null;
  end if;
  foreach k in array array['username', 'full_name', 'opr', 'level', 'department_id', 'role', 'active', 'job_title', 'contract_no', 'work_location', 'residence', 'position', 'payroll', 'y_allowed'] loop
    if to_jsonb(old) ->> k is distinct from to_jsonb(new) ->> k then
      insert into public.audit_log (actor, table_name, department_id, target_user, field, old_value, new_value)
      values (auth.uid(), 'profiles', new.department_id, new.id, k, to_jsonb(old) ->> k, to_jsonb(new) ->> k);
    end if;
  end loop;
  return null;
end $$;
