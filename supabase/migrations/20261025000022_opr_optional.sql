-- OPR is optional for everyone. The payroll number is what identifies a person on the timesheet: it is required for users and
-- admins (enforced by create_user and update_profile, not by a table constraint) and optional for managers and super admins.
alter table public.profiles drop constraint profiles_check1;

-- update_profile: managers can be edited too; a payroll that is explicitly blank is refused for users and admins
create or replace function public.update_profile(
  p_user uuid, p_full_name text, p_opr text, p_level text,
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
         y_allowed = coalesce(p_y_allowed, y_allowed)
   where id = p_user and active and role in ('user', 'admin', 'manager')
     and department_id = public.app_dept();
  if not found then
    raise exception 'not authorized' using errcode = '42501';
  end if;
end $$;
