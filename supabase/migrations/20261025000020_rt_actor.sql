-- The department channel announcement now also says WHO made the change ("a" = auth.uid(), null for service / manual changes), so an
-- admin's desktop notification can tell "somebody filled his own timesheet" from "an admin edited it" (and from the admin's own edits).
-- Still no timesheet data in the message: table, date range, person ids, actor id.
create or replace function public._rt_fanout(p_table text, p_rows jsonb) returns void
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
    perform public._rt_send('dept:' || r.dept, jsonb_build_object('t', p_table, 'from', r.f, 'to', r.t, 'u', r.us, 'a', auth.uid()));
  end loop;
end $$;
