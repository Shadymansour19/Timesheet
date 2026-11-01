-- Fix the JSON query aliases in save_my_calendar: PL/pgSQL variable r must not
-- share a name with the jsonb_array_elements table aliases.
create or replace function public.save_my_calendar(p_statuses jsonb, p_departures jsonb) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_win int;
  r jsonb;
  d date;
begin
  if public.app_role() is distinct from 'user' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if jsonb_typeof(p_statuses) is distinct from 'array' or jsonb_array_length(p_statuses) > 1000
     or jsonb_typeof(p_departures) is distinct from 'array' or jsonb_array_length(p_departures) > 1000 then
    raise exception 'calendar draft is too large' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_statuses) x
     where jsonb_typeof(x -> 'day') is distinct from 'string'
        or (x ->> 'day') !~ '^\d{4}-\d{2}-\d{2}$'
        or (x ->> 'status') is null or (x ->> 'status') not in ('X', 'Y', 'E')
  ) or exists (
    select 1 from jsonb_array_elements(p_departures) x
     where jsonb_typeof(x -> 'day') is distinct from 'string'
        or (x ->> 'day') !~ '^\d{4}-\d{2}-\d{2}$'
        or jsonb_typeof(x -> 'on') is distinct from 'boolean'
  ) then
    raise exception 'invalid calendar draft' using errcode = '22023';
  end if;
  select (value #>> '{}')::int into v_win from public.settings where key = 'user_edit_window_days';
  if (v_win is not null and exists (
    select 1 from jsonb_array_elements(p_statuses) x where (x ->> 'day')::date < current_date - v_win
  )) or (v_win is not null and exists (
    select 1 from jsonb_array_elements(p_departures) x where (x ->> 'day')::date < current_date - v_win
  )) then
    raise exception 'day is outside the edit window' using errcode = '42501';
  end if;

  for r in select value from jsonb_array_elements(p_statuses) loop
    d := (r ->> 'day')::date;
    if r ->> 'status' = 'E' then
      delete from public.day_status where user_id = auth.uid() and day = d;
    else
      insert into public.day_status (user_id, day, status, updated_by)
      values (auth.uid(), d, r ->> 'status', auth.uid())
      on conflict (user_id, day) do update
        set status = excluded.status, updated_by = excluded.updated_by, updated_at = now();
    end if;
  end loop;

  for r in select value from jsonb_array_elements(p_departures) loop
    d := (r ->> 'day')::date;
    if (r ->> 'on')::boolean then
      if not exists (select 1 from public.day_status where user_id = auth.uid() and day = d) then
        raise exception 'only a working day can carry the departure' using errcode = '22023';
      end if;
      insert into public.departure_moves (user_id, work_day, moved_by)
      values (auth.uid(), d, auth.uid())
      on conflict (user_id, work_day) do update set moved_by = excluded.moved_by, moved_at = now();
    else
      delete from public.departure_moves where user_id = auth.uid() and work_day = d;
    end if;
  end loop;
end $$;