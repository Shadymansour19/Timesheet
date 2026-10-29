-- Overtime form (Arabic): the department report may also hold the department name in Arabic and the two sign-off titles of the form
-- (dept_ar, ot_sign_left, ot_sign_right). Same function as before (migration 23) with a longer whitelist of keys.
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
    if k not in ('dept_print_name', 'location', 'dept_ar', 'ot_sign_left', 'ot_sign_right') then
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

grant execute on function public.set_department_report(uuid, jsonb, text, text, text, text, text) to authenticated;
