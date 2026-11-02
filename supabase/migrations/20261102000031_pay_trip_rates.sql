-- The old pay-rate functions included p_trip_rate. Remove those signatures before
-- creating the new contract; writes remain available only through these RPCs.
drop function if exists public.create_pay_rate(text, uuid, text, double precision, double precision, double precision, double precision);
drop function if exists public.update_pay_rate(text, uuid, text, double precision, double precision, double precision, double precision);

create or replace function public.create_pay_rate(
  p_level text,
  p_department uuid,
  p_position text,
  p_x_rate double precision,
  p_y_rate double precision,
  p_overtime_rate double precision
)
returns public.pay_rates
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := public.app_role();
  v_level text := btrim(p_level);
  v_position text := btrim(p_position);
  v_rate public.pay_rates;
begin
  if v_role is null or v_role not in ('admin', 'super_admin')
     or (v_role = 'admin' and p_department is distinct from public.app_dept()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_level = '' or length(v_level) > 50 then
    raise exception 'invalid level' using errcode = '22023';
  end if;
  if v_position = '' or length(v_position) > 100 then
    raise exception 'invalid position' using errcode = '22023';
  end if;
  if p_x_rate is null or p_y_rate is null or p_overtime_rate is null
     or p_x_rate < 0 or p_y_rate < 0 or p_overtime_rate < 0
     or p_x_rate in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision)
     or p_y_rate in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision)
     or p_overtime_rate in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision) then
    raise exception 'invalid pay rate' using errcode = '22023';
  end if;
  insert into public.pay_rates (level, department_id, "position", x_pay_rate, y_pay_rate, overtime_hour_rate)
  values (v_level, p_department, v_position, p_x_rate, p_y_rate, p_overtime_rate)
  returning * into v_rate;
  return v_rate;
exception
  when unique_violation then
    raise exception 'pay rate already exists for this level and position' using errcode = '22023';
end;
$$;

create or replace function public.update_pay_rate(
  p_level text,
  p_department uuid,
  p_position text,
  p_x_rate double precision,
  p_y_rate double precision,
  p_overtime_rate double precision
)
returns public.pay_rates
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := public.app_role();
  v_level text := btrim(p_level);
  v_position text := btrim(p_position);
  v_rate public.pay_rates;
begin
  if v_role is null or v_role not in ('admin', 'super_admin')
     or (v_role = 'admin' and p_department is distinct from public.app_dept()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_level = '' or length(v_level) > 50 or v_position = '' or length(v_position) > 100 then
    raise exception 'invalid pay-rate key' using errcode = '22023';
  end if;
  if p_x_rate is null or p_y_rate is null or p_overtime_rate is null
     or p_x_rate < 0 or p_y_rate < 0 or p_overtime_rate < 0 then
    raise exception 'invalid pay rate' using errcode = '22023';
  end if;
  update public.pay_rates
  set x_pay_rate = p_x_rate, y_pay_rate = p_y_rate, overtime_hour_rate = p_overtime_rate
  where level = v_level and department_id = p_department and "position" = v_position
  returning * into v_rate;
  if not found then
    raise exception 'pay rate not found' using errcode = '22023';
  end if;
  return v_rate;
end;
$$;

create or replace function public.delete_pay_rate(
  p_level text,
  p_department uuid,
  p_position text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := public.app_role();
begin
  if v_role is null or v_role not in ('admin', 'super_admin')
     or (v_role = 'admin' and p_department is distinct from public.app_dept()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  delete from public.pay_rates
  where level = btrim(p_level) and department_id = p_department and "position" = btrim(p_position);
  if not found then
    raise exception 'pay rate not found' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.create_trip_pay_rate(
  p_residence text,
  p_rate double precision
)
returns public.trip_pay_rates
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := public.app_role();
  v_residence text := lower(btrim(p_residence));
  v_rate public.trip_pay_rates;
begin
  if v_role is null or v_role not in ('admin', 'super_admin') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_residence not in ('inside', 'outside') then
    raise exception 'invalid residence' using errcode = '22023';
  end if;
  if p_rate is null or p_rate < 0 then
    raise exception 'invalid trip rate' using errcode = '22023';
  end if;
  insert into public.trip_pay_rates (residence, rate) values (v_residence, p_rate) returning * into v_rate;
  return v_rate;
exception
  when unique_violation then
    raise exception 'trip rate already exists for this residence' using errcode = '22023';
end;
$$;

create or replace function public.update_trip_pay_rate(
  p_residence text,
  p_rate double precision
)
returns public.trip_pay_rates
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := public.app_role();
  v_residence text := lower(btrim(p_residence));
  v_rate public.trip_pay_rates;
begin
  if v_role is null or v_role not in ('admin', 'super_admin') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_residence not in ('inside', 'outside') or p_rate is null or p_rate < 0 then
    raise exception 'invalid trip rate' using errcode = '22023';
  end if;
  update public.trip_pay_rates set rate = p_rate where residence = v_residence returning * into v_rate;
  if not found then
    raise exception 'trip rate not found' using errcode = '22023';
  end if;
  return v_rate;
end;
$$;

create or replace function public.delete_trip_pay_rate(p_residence text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := public.app_role();
  v_residence text := lower(btrim(p_residence));
begin
  if v_role is null or v_role not in ('admin', 'super_admin') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  delete from public.trip_pay_rates where residence = v_residence;
  if not found then
    raise exception 'trip rate not found' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.create_pay_rate(text, uuid, text, double precision, double precision, double precision) from public, anon;
revoke all on function public.update_pay_rate(text, uuid, text, double precision, double precision, double precision) from public, anon;
revoke all on function public.delete_pay_rate(text, uuid, text) from public, anon;
revoke all on function public.create_trip_pay_rate(text, double precision) from public, anon;
revoke all on function public.update_trip_pay_rate(text, double precision) from public, anon;
revoke all on function public.delete_trip_pay_rate(text) from public, anon;
grant execute on function public.create_pay_rate(text, uuid, text, double precision, double precision, double precision) to authenticated;
grant execute on function public.update_pay_rate(text, uuid, text, double precision, double precision, double precision) to authenticated;
grant execute on function public.delete_pay_rate(text, uuid, text) to authenticated;
grant execute on function public.create_trip_pay_rate(text, double precision) to authenticated;
grant execute on function public.update_trip_pay_rate(text, double precision) to authenticated;
grant execute on function public.delete_trip_pay_rate(text) to authenticated;
