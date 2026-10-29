-- Arabic names for the overtime form: the person (profiles.full_name_ar), the department (departments.name_ar) and the sector (departments.sector_ar).
-- The sector (English) now holds the sector value only ("Maintenance"): the exports append the word "Sector" themselves.
-- The Arabic department name that migration 27 kept in departments.report (dept_ar) moves to name_ar; the two optional signature titles (ot_sign_left,
-- ot_sign_right) stay in the report object. Without them the form builds "مدير عام <sector_ar>" and "مدير عام مساعد <name_ar>".
alter table public.profiles add column full_name_ar text check (full_name_ar is null or length(full_name_ar) <= 200);
alter table public.departments
  add column name_ar text check (name_ar is null or length(name_ar) <= 100),
  add column sector_ar text check (sector_ar is null or length(sector_ar) <= 100);
grant select (full_name_ar) on public.profiles to authenticated;
grant select (name_ar, sector_ar) on public.departments to authenticated;

-- one-off data fix: "Maintenance Sector" -> "Maintenance"
update public.departments set sector = nullif(btrim(regexp_replace(sector, '\s*sector\s*$', '', 'i')), '') where sector ~* 'sector\s*$';
-- the Arabic department name moves from the report object to its column
update public.departments set name_ar = nullif(btrim(report ->> 'dept_ar'), '') where name_ar is null and report ? 'dept_ar';
update public.departments set report = report - 'dept_ar' where report ? 'dept_ar';

-- admin edits a person: + the Arabic name (null = keep, '' = clear)
drop function public.update_profile(uuid, text, text, text, text, text, text, text, text, text, boolean);
create function public.update_profile(p_user uuid, p_full_name text, p_opr text, p_level text, p_job_title text default null::text, p_contract_no text default null::text, p_work_location text default null::text, p_residence text default null::text, p_position text default null::text, p_payroll text default null::text, p_y_allowed boolean default null::boolean, p_full_name_ar text default null::text)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  if public.app_role() is distinct from 'admin' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_residence is not null and p_residence not in ('', 'inside', 'outside') then
    raise exception 'residence must be inside or outside' using errcode = '22023';
  end if;
  if p_payroll is not null and btrim(p_payroll) = ''
     and exists (select 1 from public.profiles where id = p_user and role in ('user', 'admin')) then
    raise exception 'payroll is required' using errcode = '22023';
  end if;
  update public.profiles
     set full_name = p_full_name, opr = nullif(btrim(p_opr), ''), level = nullif(btrim(p_level), ''),
         job_title = case when p_job_title is null then job_title else nullif(btrim(p_job_title), '') end,
         contract_no = case when p_contract_no is null then contract_no else nullif(btrim(p_contract_no), '') end,
         work_location = case when p_work_location is null then work_location else nullif(btrim(p_work_location), '') end,
         residence = case when p_residence is null then residence else nullif(p_residence, '') end,
         "position" = case when p_position is null then "position" else nullif(btrim(p_position), '') end,
         payroll = case when p_payroll is null then payroll else nullif(btrim(p_payroll), '') end,
         y_allowed = coalesce(p_y_allowed, y_allowed),
         full_name_ar = case when p_full_name_ar is null then full_name_ar else nullif(btrim(p_full_name_ar), '') end
   where id = p_user and active and role in ('user', 'admin', 'manager')
     and department_id = public.app_dept();
  if not found then
    raise exception 'not authorized' using errcode = '42501';
  end if;
end $function$;
revoke all on function public.update_profile(uuid, text, text, text, text, text, text, text, text, text, boolean, text) from public, anon;
grant execute on function public.update_profile(uuid, text, text, text, text, text, text, text, text, text, boolean, text) to authenticated;

-- department print settings: + the Arabic department name and sector (null = keep, '' = clear); the report object takes dept_print_name, location and the two signature titles
drop function public.set_department_report(uuid, jsonb, text, text, text, text, text);
create function public.set_department_report(p_dept uuid, p_report jsonb, p_code text default null::text, p_sector text default null::text, p_field text default null::text, p_approved_engineer text default null::text, p_approved_tech text default null::text, p_name_ar text default null::text, p_sector_ar text default null::text)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
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
    if k not in ('dept_print_name', 'location', 'ot_sign_left', 'ot_sign_right') then
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
  if length(coalesce(p_name_ar, '')) > 100 or length(coalesce(p_sector_ar, '')) > 100 then
    raise exception 'Arabic names must be at most 100 characters' using errcode = '22023';
  end if;
  update public.departments
     set report = p_report,
         code = case when p_code is null then code else nullif(btrim(p_code), '') end,
         sector = case when p_sector is null then sector else nullif(btrim(p_sector), '') end,
         field = case when p_field is null then field else nullif(btrim(p_field), '') end,
         approved_engineer = case when p_approved_engineer is null then approved_engineer else nullif(p_approved_engineer, '')::integer end,
         approved_tech = case when p_approved_tech is null then approved_tech else nullif(p_approved_tech, '')::integer end,
         name_ar = case when p_name_ar is null then name_ar else nullif(btrim(p_name_ar), '') end,
         sector_ar = case when p_sector_ar is null then sector_ar else nullif(btrim(p_sector_ar), '') end
   where id = p_dept;
  if not found then
    raise exception 'not authorized' using errcode = '42501';
  end if;
end $function$;
revoke all on function public.set_department_report(uuid, jsonb, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.set_department_report(uuid, jsonb, text, text, text, text, text, text, text) to authenticated;

-- the audit log also records the new columns
create or replace function public.audit_profiles() returns trigger
 language plpgsql security definer set search_path to ''
as $function$
declare k text;
begin
  if tg_op = 'INSERT' then
    insert into public.audit_log (actor, table_name, department_id, target_user, field, new_value)
    values (auth.uid(), 'profiles', new.department_id, new.id, 'created', new.username);
    return null;
  end if;
  foreach k in array array['username', 'full_name', 'full_name_ar', 'opr', 'level', 'department_id', 'role', 'active', 'job_title', 'contract_no', 'work_location', 'residence', 'position', 'payroll', 'y_allowed'] loop
    if to_jsonb(old) ->> k is distinct from to_jsonb(new) ->> k then
      insert into public.audit_log (actor, table_name, department_id, target_user, field, old_value, new_value)
      values (auth.uid(), 'profiles', new.department_id, new.id, k, to_jsonb(old) ->> k, to_jsonb(new) ->> k);
    end if;
  end loop;
  return null;
end $function$;

create or replace function public.audit_departments() returns trigger
 language plpgsql security definer set search_path to ''
as $function$
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
    foreach k in array array['code', 'sector', 'field', 'approved_engineer', 'approved_tech', 'name_ar', 'sector_ar'] loop
      if to_jsonb(old) ->> k is distinct from to_jsonb(new) ->> k then
        insert into public.audit_log (actor, table_name, department_id, field, old_value, new_value)
        values (auth.uid(), 'departments', new.id, k, to_jsonb(old) ->> k, to_jsonb(new) ->> k);
      end if;
    end loop;
  end if;
  return null;
end $function$;
