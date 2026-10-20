-- More report data.
--   people:      work_location (site, overrides the department default), residence ('inside' | 'outside' the work-location city;
--                decides whether Arrival/Departure trips are counted as TRANS/IN (inside) or TRANS/EX (outside))
--   departments: code, sector, field (printed on the official report banner and forms)
-- Contract number: existing people get 033/2019 once (data update below). It is NOT a column default.

alter table public.profiles
  add column work_location text check (work_location is null or length(work_location) <= 100),
  add column residence text check (residence is null or residence in ('inside', 'outside'));

alter table public.departments
  add column code text check (code is null or length(code) <= 20),
  add column sector text check (sector is null or length(sector) <= 100),
  add column field text check (field is null or length(field) <= 100);

-- the department code used to live in the report settings object
update public.departments set code = report ->> 'dept_code' where code is null and (report ->> 'dept_code') is not null;

update public.profiles set contract_no = '033/2019' where contract_no is null;

-- update_profile: two more optional arguments (NULL = keep, '' = clear; residence must be inside/outside or '' to clear)
drop function public.update_profile(uuid, text, text, integer, text, text);
create function public.update_profile(
  p_user uuid, p_full_name text, p_opr text, p_level integer,
  p_job_title text default null, p_contract_no text default null,
  p_work_location text default null, p_residence text default null
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
         residence = case when p_residence is null then residence else nullif(p_residence, '') end
   where id = p_user and active and role in ('user', 'admin')
     and department_id = public.app_dept();
  if not found then
    raise exception 'not authorized' using errcode = '42501';
  end if;
end $$;
grant execute on function public.update_profile(uuid, text, text, integer, text, text, text, text) to authenticated;

-- set_department_report: the object now only holds the printed department name and the default site location;
-- code / sector / field are real columns (NULL = keep, '' = clear). admin: own department, super_admin: any.
drop function public.set_department_report(uuid, jsonb);
create function public.set_department_report(
  p_dept uuid, p_report jsonb,
  p_code text default null, p_sector text default null, p_field text default null
) returns void
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
    if k not in ('dept_print_name', 'location') then
      raise exception 'unknown report setting: %', k using errcode = '22023';
    end if;
    if jsonb_typeof(v) is distinct from 'string' or length(v #>> '{}') > 200 then
      raise exception 'report setting % must be text of at most 200 characters', k using errcode = '22023';
    end if;
  end loop;
  update public.departments
     set report = p_report,
         code = case when p_code is null then code else nullif(btrim(p_code), '') end,
         sector = case when p_sector is null then sector else nullif(btrim(p_sector), '') end,
         field = case when p_field is null then field else nullif(btrim(p_field), '') end
   where id = p_dept;
  if not found then
    raise exception 'not authorized' using errcode = '42501';
  end if;
end $$;
grant execute on function public.set_department_report(uuid, jsonb, text, text, text) to authenticated;

-- audit the new columns
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
  foreach k in array array['username', 'full_name', 'opr', 'level', 'department_id', 'role', 'active', 'job_title', 'contract_no', 'work_location', 'residence'] loop
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
declare k text;
begin
  if tg_op = 'INSERT' or old.name is distinct from new.name then
    insert into public.audit_log (actor, table_name, department_id, field, old_value, new_value)
    values (auth.uid(), 'departments', new.id, 'name', old.name, new.name);
  end if;
  if tg_op = 'UPDATE' then
    if old.report is distinct from new.report then
      insert into public.audit_log (actor, table_name, department_id, field, old_value, new_value)
      values (auth.uid(), 'departments', new.id, 'report', old.report::text, new.report::text);
    end if;
    foreach k in array array['code', 'sector', 'field'] loop
      if to_jsonb(old) ->> k is distinct from to_jsonb(new) ->> k then
        insert into public.audit_log (actor, table_name, department_id, field, old_value, new_value)
        values (auth.uid(), 'departments', new.id, k, to_jsonb(old) ->> k, to_jsonb(new) ->> k);
      end if;
    end loop;
  end if;
  return null;
end $$;
