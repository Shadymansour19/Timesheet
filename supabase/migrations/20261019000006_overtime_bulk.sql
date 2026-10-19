-- Set overtime for many people on ONE day in a single transaction (all rows succeed or none do).
-- p_rows: [{ "user": uuid, "hours": 0..24 (integer), "note": text|null }, ...]. hours = 0 removes the row.
-- Each row goes through set_overtime(), so the same checks apply (admin only, same department, active person)
-- and the audit triggers fire. Any failing row rolls back the whole call. Returns the number of rows applied.
create function public.set_overtime_bulk(p_day date, p_rows jsonb) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  r jsonb;
  n integer := 0;
begin
  if public.app_role() is distinct from 'admin' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) > 1000 then
    raise exception 'rows must be an array of at most 1000 entries' using errcode = '22023';
  end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(r -> 'hours') is distinct from 'number' or (r ->> 'hours') !~ '^[0-9]{1,2}$' then
      raise exception 'hours must be a whole number from 0 to 24' using errcode = '22023';
    end if;
    if length(coalesce(r ->> 'note', '')) > 200 then
      raise exception 'note is too long (max 200 characters)' using errcode = '22023';
    end if;
    perform public.set_overtime((r ->> 'user')::uuid, p_day, (r ->> 'hours')::integer, nullif(btrim(r ->> 'note'), ''));
    n := n + 1;
  end loop;
  return n;
end $$;

grant execute on function public.set_overtime_bulk(date, jsonb) to authenticated;
