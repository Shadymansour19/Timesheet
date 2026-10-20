-- Fields the official monthly report needs.
--   profiles.job_title / contract_no : printed on the employee sheet and the daily / review sheets
--   departments.report (jsonb)       : department-level print settings (code, printed name, location, header lines, sign-offs)
-- Edited only through SECURITY DEFINER RPCs (clients have no UPDATE privilege on either table).

alter table public.profiles
  add column job_title text check (job_title is null or length(job_title) <= 100),
  add column contract_no text check (contract_no is null or length(contract_no) <= 50);

alter table public.departments
  add column report jsonb not null default '{}'::jsonb check (jsonb_typeof(report) = 'object');

-- update_profile gains two optional arguments. NULL = leave unchanged, '' = clear. The 4-argument call keeps working.
drop function public.update_profile(uuid, text, text, integer);
create function public.update_profile(
  p_user uuid, p_full_name text, p_opr text, p_level integer,
  p_job_title text default null, p_contract_no text default null
) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if public.app_role() is distinct from 'admin' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.profiles
     set full_name = p_full_name, opr = p_opr, level = p_level,
         job_title = case when p_job_title is null then job_title else nullif(btrim(p_job_title), '') end,
         contract_no = case when p_contract_no is null then contract_no else nullif(btrim(p_contract_no), '') end
   where id = p_user and active and role in ('user', 'admin')
     and department_id = public.app_dept();
  if not found then
    raise exception 'not authorized' using errcode = '42501';
  end if;
end $$;
grant execute on function public.update_profile(uuid, text, text, integer, text, text) to authenticated;

-- Department print settings. admin: own department. super_admin: any. Whole object is replaced.
-- Allowed keys only, string values up to 200 characters.
create function public.set_department_report(p_dept uuid, p_report jsonb) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_role text := public.app_role();
  k text;
  v jsonb;
begin
  if v_role is null or v_role = 'user'
     or (v_role = 'admin' and p_dept is distinct from public.app_dept()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if jsonb_typeof(p_report) is distinct from 'object' then
    raise exception 'report settings must be an object' using errcode = '22023';
  end if;
  for k, v in select * from jsonb_each(p_report) loop
    if k not in ('dept_title', 'dept_code', 'dept_print_name', 'location', 'manpower', 'banner_1', 'banner_2', 'banner_3',
                 'company_left', 'company_right', 'signoff_left', 'signoff_right') then
      raise exception 'unknown report setting: %', k using errcode = '22023';
    end if;
    if jsonb_typeof(v) is distinct from 'string' or length(v #>> '{}') > 200 then
      raise exception 'report setting % must be text of at most 200 characters', k using errcode = '22023';
    end if;
  end loop;
  update public.departments set report = p_report where id = p_dept;
  if not found then
    raise exception 'not authorized' using errcode = '42501';
  end if;
end $$;
grant execute on function public.set_department_report(uuid, jsonb) to authenticated;

-- audit: log the two new profile fields and department report changes
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
  foreach k in array array['username', 'full_name', 'opr', 'level', 'department_id', 'role', 'active', 'job_title', 'contract_no'] loop
    if to_jsonb(old) ->> k is distinct from to_jsonb(new) ->> k then
      insert into public.audit_log (actor, table_name, department_id, target_user, field, old_value, new_value)
      values (auth.uid(), 'profiles', new.department_id, new.id, k, to_jsonb(old) ->> k, to_jsonb(new) ->> k);
    end if;
  end loop;
  return null;
end $$;

create or replace function public.audit_departments() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or old.name is distinct from new.name then
    insert into public.audit_log (actor, table_name, department_id, field, old_value, new_value)
    values (auth.uid(), 'departments', new.id, 'name', old.name, new.name);
  end if;
  if tg_op = 'UPDATE' and old.report is distinct from new.report then
    insert into public.audit_log (actor, table_name, department_id, field, old_value, new_value)
    values (auth.uid(), 'departments', new.id, 'report', old.report::text, new.report::text);
  end if;
  return null;
end $$;
