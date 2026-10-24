-- profiles.level is free text now (e.g. 3, 3A, Senior): was an integer. Existing values keep their digits as text.
alter table public.profiles drop constraint if exists profiles_level_check;
alter table public.profiles alter column level type text using level::text;
alter table public.profiles add constraint profiles_level_len check (level is null or length(level) <= 50);

drop function public.update_profile(uuid, text, text, integer, text, text, text, text, text, text, boolean);
create function public.update_profile(
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
  update public.profiles
     set full_name = p_full_name, opr = p_opr, level = nullif(btrim(p_level), ''),
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
grant execute on function public.update_profile(uuid, text, text, text, text, text, text, text, text, text, boolean) to authenticated;
