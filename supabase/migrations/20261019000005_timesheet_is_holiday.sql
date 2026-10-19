-- get_timesheet also reports whether the day is a department holiday (needed to show XH/YH
-- immediately when an E day on a holiday is changed). Return type changes, so drop + recreate.
drop function public.get_timesheet(uuid, date, date);

create function public.get_timesheet(p_dept uuid, p_from date, p_to date)
returns table (user_id uuid, day date, status text, effective_status text, overtime_hours integer, is_holiday boolean)
language sql stable
as $$
  select p.id, d::date,
         coalesce(s.status, 'E'),
         case when coalesce(s.status, 'E') <> 'E' and h.day is not null
              then s.status || 'H' else coalesce(s.status, 'E') end,
         coalesce(o.hours, 0)::int,
         h.day is not null
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

grant execute on function public.get_timesheet(uuid, date, date) to authenticated;
