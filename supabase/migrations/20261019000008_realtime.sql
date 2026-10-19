-- Live updates: the database announces "something changed in range X" on PRIVATE broadcast channels; clients
-- then refetch through the normal RLS-protected queries. Messages carry no timesheet data (only table + date range
-- + person ids), and who may listen is decided by RLS on realtime.messages:
--   user:<uid>        the person themself            (their own calendar / profile)
--   dept:<dept_id>    admins of that department      (grid, overtime, users, person timesheets)
--   deptpub:<dept_id> everyone in that department    (holidays change every calendar)
-- Clients cannot send (no INSERT policy). Statement-level triggers send ONE summary per statement, so a bulk fill
-- of thousands of cells costs a handful of messages. A realtime failure must never break a timesheet write.

create function public._rt_send(p_topic text, p_payload jsonb) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform realtime.send(p_payload, 'change', p_topic, true);
exception when others then
  null;
end $$;

-- p_rows: [{ "u": uuid, "d": date }, ...] for day_status / overtime
create function public._rt_fanout(p_table text, p_rows jsonb) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
begin
  for r in
    select x.u, min(x.d) as f, max(x.d) as t
      from jsonb_to_recordset(p_rows) as x(u uuid, d date) group by x.u
  loop
    perform public._rt_send('user:' || r.u, jsonb_build_object('t', p_table, 'from', r.f, 'to', r.t));
  end loop;
  for r in
    select p.department_id as dept, min(x.d) as f, max(x.d) as t,
           case when count(distinct x.u) <= 50 then jsonb_agg(distinct x.u) end as us
      from jsonb_to_recordset(p_rows) as x(u uuid, d date)
      join public.profiles p on p.id = x.u
     where p.department_id is not null
     group by p.department_id
  loop
    perform public._rt_send('dept:' || r.dept, jsonb_build_object('t', p_table, 'from', r.f, 'to', r.t, 'u', r.us));
  end loop;
end $$;

create function public.rt_user_rows() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare j jsonb;
begin
  if tg_op = 'DELETE' then
    select coalesce(jsonb_agg(jsonb_build_object('u', user_id, 'd', day)), '[]') into j from old_rows;
  else
    select coalesce(jsonb_agg(jsonb_build_object('u', user_id, 'd', day)), '[]') into j from new_rows;
  end if;
  perform public._rt_fanout(tg_table_name, j);
  return null;
end $$;

create function public.rt_holidays() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare r record;
begin
  if tg_op = 'DELETE' then
    for r in select department_id as d, min(day) as f, max(day) as t from old_rows group by department_id loop
      perform public._rt_send('deptpub:' || r.d, jsonb_build_object('t', 'holidays', 'from', r.f, 'to', r.t));
    end loop;
  else
    for r in select department_id as d, min(day) as f, max(day) as t from new_rows group by department_id loop
      perform public._rt_send('deptpub:' || r.d, jsonb_build_object('t', 'holidays', 'from', r.f, 'to', r.t));
    end loop;
  end if;
  return null;
end $$;

-- profile changes: admins of the affected department(s) refresh their lists; the person refreshes their own profile
-- (role change, deactivation).
create function public.rt_profiles() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  ids uuid[];
  depts uuid[];
begin
  if tg_op = 'DELETE' then
    select array_agg(distinct id), array_agg(distinct department_id) into ids, depts from old_rows;
  elsif tg_op = 'INSERT' then
    select array_agg(distinct id), array_agg(distinct department_id) into ids, depts from new_rows;
  else
    select array_agg(distinct id), array_agg(distinct d) into ids, depts from (
      select id, department_id as d from old_rows union select id, department_id from new_rows) q;
  end if;
  for r in select distinct d from unnest(coalesce(depts, '{}')) d where d is not null loop
    perform public._rt_send('dept:' || r.d, jsonb_build_object('t', 'profiles'));
  end loop;
  if coalesce(array_length(ids, 1), 0) <= 200 then
    for r in select distinct i from unnest(coalesce(ids, '{}')) i loop
      perform public._rt_send('user:' || r.i, jsonb_build_object('t', 'profile'));
    end loop;
  end if;
  return null;
end $$;

-- day_status
create trigger day_status_rt_ins after insert on public.day_status referencing new table as new_rows for each statement execute function public.rt_user_rows();
create trigger day_status_rt_upd after update on public.day_status referencing old table as old_rows new table as new_rows for each statement execute function public.rt_user_rows();
create trigger day_status_rt_del after delete on public.day_status referencing old table as old_rows for each statement execute function public.rt_user_rows();
-- overtime
create trigger overtime_rt_ins after insert on public.overtime referencing new table as new_rows for each statement execute function public.rt_user_rows();
create trigger overtime_rt_upd after update on public.overtime referencing old table as old_rows new table as new_rows for each statement execute function public.rt_user_rows();
create trigger overtime_rt_del after delete on public.overtime referencing old table as old_rows for each statement execute function public.rt_user_rows();
-- holidays
create trigger holidays_rt_ins after insert on public.holidays referencing new table as new_rows for each statement execute function public.rt_holidays();
create trigger holidays_rt_del after delete on public.holidays referencing old table as old_rows for each statement execute function public.rt_holidays();
-- profiles
create trigger profiles_rt_ins after insert on public.profiles referencing new table as new_rows for each statement execute function public.rt_profiles();
create trigger profiles_rt_upd after update on public.profiles referencing old table as old_rows new table as new_rows for each statement execute function public.rt_profiles();
create trigger profiles_rt_del after delete on public.profiles referencing old table as old_rows for each statement execute function public.rt_profiles();

-- Who may receive which topic. Writing to realtime.messages stays impossible for clients (no INSERT policy).
create policy rt_receive on realtime.messages for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (
      (select realtime.topic()) = 'user:' || (select auth.uid())::text
      or (select realtime.topic()) = 'deptpub:' || (select public.app_dept())::text
      or ((select realtime.topic()) = 'dept:' || (select public.app_dept())::text and (select public.app_role()) = 'admin')
    )
  );
