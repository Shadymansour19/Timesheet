-- Set the status of many (person, day) cells in ONE statement / transaction: the engine behind bulk fill and Undo.
-- p_rows: [{ "user": uuid, "day": "YYYY-MM-DD", "status": "X"|"Y"|"E" }, ...]  (E removes the row).
-- Admin only; every person must be an ACTIVE member of the admin's own department, otherwise the whole call is
-- rejected (42501) and nothing is written. Bad shapes/values -> 22023. Audit triggers fire per changed row.
-- Duplicate (user, day) pairs: the last one wins. Returns the number of distinct cells applied.
create function public.set_day_status_rows(p_rows jsonb) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  n integer;
begin
  if public.app_role() is distinct from 'admin' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) > 20000 then
    raise exception 'rows must be an array of at most 20000 entries' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_rows) r
     where jsonb_typeof(r -> 'user') is distinct from 'string'
        or jsonb_typeof(r -> 'day') is distinct from 'string'
        or (r ->> 'day') !~ '^\d{4}-\d{2}-\d{2}$'
        or (r ->> 'status') is null or (r ->> 'status') not in ('X', 'Y', 'E')
  ) then
    raise exception 'each row needs user, day (YYYY-MM-DD) and status X, Y or E' using errcode = '22023';
  end if;
  -- authorisation: every person must be active and in the caller's department
  if exists (
    select 1 from (select distinct (r ->> 'user')::uuid as u from jsonb_array_elements(p_rows) r) x
     where not exists (select 1 from public.profiles p
                        where p.id = x.u and p.active and p.department_id = public.app_dept())
  ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  with rows as (
    select distinct on (u, d) u, d, s from (
      select (r.v ->> 'user')::uuid as u, (r.v ->> 'day')::date as d, r.v ->> 'status' as s, r.ord
        from jsonb_array_elements(p_rows) with ordinality as r(v, ord)
    ) q order by u, d, ord desc
  ),
  del as (
    delete from public.day_status ds using rows
     where rows.s = 'E' and ds.user_id = rows.u and ds.day = rows.d
    returning 1
  ),
  ups as (
    insert into public.day_status (user_id, day, status, updated_by)
    select u, d, s, auth.uid() from rows where s <> 'E'
    on conflict (user_id, day) do update
      set status = excluded.status, updated_by = excluded.updated_by, updated_at = now()
    returning 1
  )
  select count(*) into n from rows;
  return n;
end $$;

grant execute on function public.set_day_status_rows(jsonb) to authenticated;
