-- RLS / RPC tests. Run via supabase/tests/run.sh (wraps everything in a transaction and rolls back).
-- Each check raises on failure; successes print NOTICE 'PASS: ...'.

create schema t;
grant usage on schema t to anon, authenticated;

create function t.login(p_uid uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create function t.anon() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
end $$;

create function t.su() returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims', '', true); end $$;

-- statement must fail with the given SQLSTATE
create function t.denied(p_label text, p_sql text, p_state text default '42501') returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate = p_state then
      raise notice 'PASS: % (denied: %)', p_label, p_state; return;
    end if;
    raise exception 'FAIL: % -- expected %, got % (%)', p_label, p_state, sqlstate, sqlerrm;
  end;
  raise exception 'FAIL: % -- statement succeeded but should have been denied', p_label;
end $$;

create function t.ok(p_label text, p_sql text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise notice 'PASS: %', p_label;
exception when others then
  raise exception 'FAIL: % -- unexpected error % (%)', p_label, sqlstate, sqlerrm;
end $$;

create function t.count(p_label text, p_sql text, p_expected bigint) returns void
language plpgsql as $$
declare n bigint;
begin
  execute 'select count(*) from (' || p_sql || ') q' into n;
  if n is distinct from p_expected then
    raise exception 'FAIL: % -- expected % rows, got %', p_label, p_expected, n;
  end if;
  raise notice 'PASS: % (% rows)', p_label, n;
end $$;

create function t.eq(p_label text, p_sql text, p_expected text) returns void
language plpgsql as $$
declare v text;
begin
  execute p_sql into v;
  if v is distinct from p_expected then
    raise exception 'FAIL: % -- expected %, got %', p_label, p_expected, v;
  end if;
  raise notice 'PASS: % (= %)', p_label, v;
end $$;

grant execute on all functions in schema t to anon, authenticated;

-- ---------------------------------------------------------------- fixtures (as owner)
insert into public.departments (id, name) values
  ('10000000-0000-0000-0000-00000000000a', 'Dept A'),
  ('10000000-0000-0000-0000-00000000000b', 'Dept B');

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000a0', 'sa@timesheet.local',  'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000a1', 'adma@timesheet.local', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000a2', 'ua1@timesheet.local',  'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000a3', 'ua2@timesheet.local',  'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000b1', 'admb@timesheet.local', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000b2', 'ub1@timesheet.local',  'authenticated', 'authenticated');

insert into public.profiles (id, username, full_name, opr, level, department_id, role) values
  ('00000000-0000-0000-0000-0000000000a0', 'sadm', 'Super',   null,   null, null, 'super_admin'),
  ('00000000-0000-0000-0000-0000000000a1', 'adma', 'Admin A', 'OPR-A1', 1, '10000000-0000-0000-0000-00000000000a', 'admin'),
  ('00000000-0000-0000-0000-0000000000a2', 'ua1',  'User A1', 'OPR-A2', 2, '10000000-0000-0000-0000-00000000000a', 'user'),
  ('00000000-0000-0000-0000-0000000000a3', 'ua2',  'User A2', 'OPR-A3', 2, '10000000-0000-0000-0000-00000000000a', 'user'),
  ('00000000-0000-0000-0000-0000000000b1', 'admb', 'Admin B', 'OPR-B1', 1, '10000000-0000-0000-0000-00000000000b', 'admin'),
  ('00000000-0000-0000-0000-0000000000b2', 'ub1',  'User B1', 'OPR-B2', 2, '10000000-0000-0000-0000-00000000000b', 'user');

insert into public.day_status (user_id, day, status) values
  ('00000000-0000-0000-0000-0000000000a3', current_date, 'X'),
  ('00000000-0000-0000-0000-0000000000b2', current_date, 'Y');
insert into public.overtime (user_id, day, hours) values
  ('00000000-0000-0000-0000-0000000000a2', current_date, 2),
  ('00000000-0000-0000-0000-0000000000b2', current_date, 3);

-- ---------------------------------------------------------------- anon
select t.anon();
select t.denied('anon cannot read profiles', 'select * from public.profiles');
select t.denied('anon cannot call set_overtime_bulk', $$select public.set_overtime_bulk(current_date, '[]'::jsonb)$$);
select t.denied('anon cannot call set_department_report', $$select public.set_department_report('10000000-0000-0000-0000-00000000000a', '{}'::jsonb)$$);
select t.denied('anon cannot call set_day_status_rows', $$select public.set_day_status_rows('[]'::jsonb)$$);
select t.denied('anon cannot call set_day_status',
  $$select public.set_day_status('00000000-0000-0000-0000-0000000000a2', current_date, 'X')$$);

-- ---------------------------------------------------------------- user (dept A: ua1)
select t.login('00000000-0000-0000-0000-0000000000a2');
select t.count('user sees only own profile', 'select 1 from public.profiles', 1);
select t.count('user sees only own dept', 'select 1 from public.departments', 1);
select t.count('user cannot see other users'' status (ua2 row hidden)', 'select 1 from public.day_status', 0);
select t.count('user sees own overtime only', 'select 1 from public.overtime', 1);
select t.count('user sees no audit log', 'select 1 from public.audit_log', 0);
select t.ok('user sets own status X today',
  $$select public.set_day_status('00000000-0000-0000-0000-0000000000a2', current_date, 'X')$$);
select t.ok('user can record a FUTURE day',
  $$select public.set_day_status('00000000-0000-0000-0000-0000000000a2', current_date + 10, 'Y')$$);
select t.eq('own status stored', $$select status from public.day_status where day = current_date$$, 'X');
select t.denied('user cannot set same-dept colleague',
  $$select public.set_day_status('00000000-0000-0000-0000-0000000000a3', current_date, 'E')$$);
select t.denied('user cannot set other-dept user',
  $$select public.set_day_status('00000000-0000-0000-0000-0000000000b2', current_date, 'E')$$);
select t.denied('user cannot bulk fill', $$select public.set_day_status_bulk(array['00000000-0000-0000-0000-0000000000a2']::uuid[], array[current_date], 'X')$$);
select t.denied('user direct INSERT day_status',
  $$insert into public.day_status (user_id, day, status) values ('00000000-0000-0000-0000-0000000000a2', current_date + 1, 'X')$$);
select t.denied('user direct UPDATE day_status', $$update public.day_status set status = 'E'$$);
select t.denied('user direct UPDATE profiles.role', $$update public.profiles set role = 'admin'$$);
select t.denied('user direct UPDATE profiles.full_name', $$update public.profiles set full_name = 'x'$$);
select t.denied('user direct UPDATE profiles.department_id',
  $$update public.profiles set department_id = '10000000-0000-0000-0000-00000000000b'$$);
select t.denied('user direct soft-delete UPDATE', $$update public.profiles set active = false$$);
select t.denied('user direct DELETE profiles', $$delete from public.profiles$$);
select t.denied('user direct INSERT overtime',
  $$insert into public.overtime (user_id, day, hours) values ('00000000-0000-0000-0000-0000000000a2', current_date + 1, 5)$$);
select t.denied('user set_overtime on self',
  $$select public.set_overtime('00000000-0000-0000-0000-0000000000a2', current_date, 9)$$);
select t.denied('user bulk overtime', $$select public.set_overtime_bulk(current_date, '[{"user":"00000000-0000-0000-0000-0000000000a2","hours":9}]'::jsonb)$$);
select t.denied('user set_day_status_rows', $$select public.set_day_status_rows('[{"user":"00000000-0000-0000-0000-0000000000a2","day":"2030-01-01","status":"X"}]'::jsonb)$$);
select t.denied('user set_department_report', $$select public.set_department_report('10000000-0000-0000-0000-00000000000a', '{"location":"1"}'::jsonb)$$);
select t.denied('user update_profile with job title', $$select public.update_profile('00000000-0000-0000-0000-0000000000a2', 'x', 'OPR-A2', '1', 'Boss', null)$$);
select t.denied('user set_holiday', $$select public.set_holiday(current_date, true)$$);
select t.denied('user direct INSERT holidays',
  $$insert into public.holidays (department_id, day) values ('10000000-0000-0000-0000-00000000000a', current_date)$$);
select t.denied('user update_profile on self', $$select public.update_profile('00000000-0000-0000-0000-0000000000a2', 'Hacker', 'OPR-A2', '99')$$);
select t.denied('user self-promote', $$select public.set_user_role('00000000-0000-0000-0000-0000000000a2', 'admin')$$);
select t.denied('user soft_delete_user', $$select public.soft_delete_user('00000000-0000-0000-0000-0000000000a3')$$);
select t.denied('user create_department', $$select public.create_department('Evil')$$);
select t.denied('user assert_can_create', $$select public.assert_can_create('10000000-0000-0000-0000-00000000000a', 'user')$$);
select t.denied('user direct INSERT audit_log', $$insert into public.audit_log (table_name) values ('x')$$);

-- edit window (setting changed by the owner, then user tries past days)
select t.su();
update public.settings set value = '3'::jsonb where key = 'user_edit_window_days';
select t.login('00000000-0000-0000-0000-0000000000a2');
select t.denied('user outside 3-day edit window',
  $$select public.set_day_status('00000000-0000-0000-0000-0000000000a2', current_date - 5, 'X')$$);
select t.ok('user inside 3-day edit window',
  $$select public.set_day_status('00000000-0000-0000-0000-0000000000a2', current_date - 2, 'X')$$);
select t.ok('user future day still fine with window set',
  $$select public.set_day_status('00000000-0000-0000-0000-0000000000a2', current_date + 5, 'X')$$);
select t.su();
update public.settings set value = 'null'::jsonb where key = 'user_edit_window_days';

-- ---------------------------------------------------------------- admin A
select t.login('00000000-0000-0000-0000-0000000000a1');
select t.count('adminA sees dept A profiles only', 'select 1 from public.profiles', 3);
select t.count('adminA sees no dept B profile',
  $$select 1 from public.profiles where department_id = '10000000-0000-0000-0000-00000000000b'$$, 0);
select t.count('adminA cannot see ub1 day_status', $$select 1 from public.day_status where user_id = '00000000-0000-0000-0000-0000000000b2'$$, 0);
select t.count('adminA cannot see ub1 overtime', $$select 1 from public.overtime where user_id = '00000000-0000-0000-0000-0000000000b2'$$, 0);
select t.count('adminA sees ua2 day_status', $$select 1 from public.day_status where user_id = '00000000-0000-0000-0000-0000000000a3'$$, 1);
select t.count('adminA sees only dept A', 'select 1 from public.departments', 1);
select t.ok('adminA sets ua1 status', $$select public.set_day_status('00000000-0000-0000-0000-0000000000a2', current_date + 1, 'X')$$);
select t.ok('adminA sets OWN status', $$select public.set_day_status('00000000-0000-0000-0000-0000000000a1', current_date, 'Y')$$);
select t.denied('adminA cannot set dept B user', $$select public.set_day_status('00000000-0000-0000-0000-0000000000b2', current_date, 'X')$$);
select t.denied('adminA cannot set dept B admin', $$select public.set_day_status('00000000-0000-0000-0000-0000000000b1', current_date, 'X')$$);
select t.ok('adminA bulk fill dept A',
  $$select public.set_day_status_bulk(array['00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000a3']::uuid[], array[current_date+20, current_date+21], 'X')$$);
select t.count('bulk fill wrote 4 rows', $$select 1 from public.day_status where day >= current_date + 20$$, 4);
select t.denied('adminA bulk including dept B user is rejected',
  $$select public.set_day_status_bulk(array['00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000b2']::uuid[], array[current_date+30], 'Y')$$);
select t.count('rejected bulk left nothing behind', $$select 1 from public.day_status where day = current_date + 30$$, 0);
select t.denied('adminA invalid status', $$select public.set_day_status('00000000-0000-0000-0000-0000000000a2', current_date, 'Z')$$, '22023');
select t.ok('adminA overtime 5h for ua1', $$select public.set_overtime('00000000-0000-0000-0000-0000000000a2', current_date, 5, 'late')$$);
select t.eq('overtime stored', $$select hours::text from public.overtime where user_id = '00000000-0000-0000-0000-0000000000a2' and day = current_date$$, '5');
select t.denied('overtime 25h rejected', $$select public.set_overtime('00000000-0000-0000-0000-0000000000a2', current_date, 25)$$, '22023');
select t.denied('overtime -1h rejected', $$select public.set_overtime('00000000-0000-0000-0000-0000000000a2', current_date, -1)$$, '22023');
select t.denied('overtime fractional rejected (integer param)', $$select public.set_overtime('00000000-0000-0000-0000-0000000000a2', current_date, 1.5)$$, '42883');
select t.denied('adminA overtime for dept B user', $$select public.set_overtime('00000000-0000-0000-0000-0000000000b2', current_date, 1)$$);
select t.denied('adminA direct INSERT overtime',
  $$insert into public.overtime (user_id, day, hours) values ('00000000-0000-0000-0000-0000000000a2', current_date+3, 1)$$);
-- holidays: X -> XH, Y -> YH, E stays E, applies to existing and later entries
select t.ok('adminA marks holiday on day with X (ua1 today=X)', $$select public.set_holiday(current_date, true)$$);
select t.ok('adminA marks holiday on future day', $$select public.set_holiday(current_date + 40, true)$$);
select t.eq('ua1 today effective = XH',
  $$select effective_status from public.get_timesheet(null, current_date, current_date) where user_id = '00000000-0000-0000-0000-0000000000a2'$$, 'XH');
select t.eq('adminA own Y today -> YH',
  $$select effective_status from public.get_timesheet(null, current_date, current_date) where user_id = '00000000-0000-0000-0000-0000000000a1'$$, 'YH');
select t.eq('raw status untouched (still X)',
  $$select status from public.day_status where user_id = '00000000-0000-0000-0000-0000000000a2' and day = current_date$$, 'X');
select t.eq('E on holiday stays E (ua2 has no row on +40)',
  $$select effective_status from public.get_timesheet(null, current_date + 40, current_date + 40) where user_id = '00000000-0000-0000-0000-0000000000a3'$$, 'E');
select t.ok('status entered AFTER holiday marked', $$select public.set_day_status('00000000-0000-0000-0000-0000000000a3', current_date + 40, 'Y')$$);
select t.eq('...becomes YH',
  $$select effective_status from public.get_timesheet(null, current_date + 40, current_date + 40) where user_id = '00000000-0000-0000-0000-0000000000a3'$$, 'YH');
select t.count('get_timesheet returns only dept A (3 people)',
  $$select 1 from public.get_timesheet(null, current_date, current_date)$$, 3);
select t.count('get_timesheet for dept B returns nothing to adminA',
  $$select 1 from public.get_timesheet('10000000-0000-0000-0000-00000000000b', current_date, current_date)$$, 0);
select t.ok('adminA removes holiday', $$select public.set_holiday(current_date + 40, false)$$);
select t.eq('...status reverts to Y',
  $$select effective_status from public.get_timesheet(null, current_date + 40, current_date + 40) where user_id = '00000000-0000-0000-0000-0000000000a3'$$, 'Y');
-- exact-cell status writes (bulk fill / Undo engine)
select t.ok('adminA set_day_status_rows: X, Y and E in one call',
  $$select public.set_day_status_rows(('[{"user":"00000000-0000-0000-0000-0000000000a2","day":"' || (current_date + 50) || '","status":"X"},{"user":"00000000-0000-0000-0000-0000000000a3","day":"' || (current_date + 50) || '","status":"Y"},{"user":"00000000-0000-0000-0000-0000000000a1","day":"' || (current_date + 51) || '","status":"X"}]')::jsonb)$$);
select t.eq('...three rows stored with updated_by adminA',
  $$select count(*)::text || ':' || bool_and(updated_by = '00000000-0000-0000-0000-0000000000a1')::text from public.day_status where day in (current_date + 50, current_date + 51)$$, '3:true');
select t.ok('E in a row removes the cell (undo path) and duplicates: last one wins',
  $$select public.set_day_status_rows(('[{"user":"00000000-0000-0000-0000-0000000000a2","day":"' || (current_date + 50) || '","status":"E"},{"user":"00000000-0000-0000-0000-0000000000a3","day":"' || (current_date + 50) || '","status":"X"},{"user":"00000000-0000-0000-0000-0000000000a3","day":"' || (current_date + 50) || '","status":"Y"}]')::jsonb)$$);
select t.eq('...ua1 cleared, ua2 stays Y',
  $$select (select count(*) from public.day_status where user_id = '00000000-0000-0000-0000-0000000000a2' and day = current_date + 50)::text || ':' || (select status from public.day_status where user_id = '00000000-0000-0000-0000-0000000000a3' and day = current_date + 50)$$, '0:Y');
select t.denied('rows with a dept B person are rejected as a whole (nothing written)',
  $$select public.set_day_status_rows(('[{"user":"00000000-0000-0000-0000-0000000000a2","day":"' || (current_date + 60) || '","status":"X"},{"user":"00000000-0000-0000-0000-0000000000b2","day":"' || (current_date + 60) || '","status":"X"}]')::jsonb)$$);
select t.count('...no rows exist for that day', $$select 1 from public.day_status where day = current_date + 60$$, 0);
select t.denied('rows with an invalid status are rejected (atomic)', $$select public.set_day_status_rows(('[{"user":"00000000-0000-0000-0000-0000000000a2","day":"' || (current_date + 60) || '","status":"X"},{"user":"00000000-0000-0000-0000-0000000000a3","day":"' || (current_date + 60) || '","status":"Z"}]')::jsonb)$$, '22023');
select t.denied('rows with a malformed date are rejected', $$select public.set_day_status_rows('[{"user":"00000000-0000-0000-0000-0000000000a2","day":"10/10/2030","status":"X"}]'::jsonb)$$, '22023');
select t.denied('rows must be an array', $$select public.set_day_status_rows('{"user":"00000000-0000-0000-0000-0000000000a2"}'::jsonb)$$, '22023');
select t.denied('more than 20000 rows is rejected', $$select public.set_day_status_rows((select jsonb_agg(jsonb_build_object('user','00000000-0000-0000-0000-0000000000a2','day','2030-01-01','status','X')) from generate_series(1, 20001)))$$, '22023');
select t.denied('rows cannot target the super_admin', $$select public.set_day_status_rows('[{"user":"00000000-0000-0000-0000-0000000000a0","day":"2030-01-01","status":"X"}]'::jsonb)$$);
select t.count('...still nothing for day +60', $$select 1 from public.day_status where day = current_date + 60$$, 0);
select t.ok('the admin may include himself', $$select public.set_day_status_rows(('[{"user":"00000000-0000-0000-0000-0000000000a1","day":"' || (current_date + 52) || '","status":"Y"}]')::jsonb)$$);
select t.ok('empty array is a no-op', $$select public.set_day_status_rows('[]'::jsonb)$$);
select t.eq('audit logs rows-API changes with adminA as actor',
  $$select (count(*) >= 5)::text from public.audit_log where table_name = 'day_status' and actor = '00000000-0000-0000-0000-0000000000a1' and day in (current_date + 50, current_date + 51, current_date + 52)$$, 'true');

-- bulk overtime for a whole day (atomic, same rules as set_overtime)
select t.ok('adminA bulk overtime for two people with different hours and notes',
  $$select public.set_overtime_bulk(current_date + 7, '[{"user":"00000000-0000-0000-0000-0000000000a2","hours":4,"note":"inventory"},{"user":"00000000-0000-0000-0000-0000000000a3","hours":6,"note":"night shift"}]'::jsonb)$$);
select t.eq('bulk stored both rows with notes and entered_by',
  $$select string_agg(hours || ':' || note || ':' || (entered_by = '00000000-0000-0000-0000-0000000000a1')::text, ',' order by hours) from public.overtime where day = current_date + 7$$, '4:inventory:true,6:night shift:true');
select t.ok('bulk can edit (update) and remove (0) in the same call',
  $$select public.set_overtime_bulk(current_date + 7, '[{"user":"00000000-0000-0000-0000-0000000000a2","hours":8,"note":"edited"},{"user":"00000000-0000-0000-0000-0000000000a3","hours":0}]'::jsonb)$$);
select t.eq('...ua1 updated to 8, ua2 row removed',
  $$select count(*) || ':' || max(hours) from public.overtime where day = current_date + 7$$, '1:8');
select t.denied('bulk with a dept B user fails as a whole (atomic): nothing is written for the valid row either',
  $$select public.set_overtime_bulk(current_date + 8, '[{"user":"00000000-0000-0000-0000-0000000000a2","hours":3},{"user":"00000000-0000-0000-0000-0000000000b2","hours":3}]'::jsonb)$$);
select t.count('...no rows exist for that day', $$select 1 from public.overtime where day = current_date + 8$$, 0);
select t.denied('bulk with one invalid hour (25) rejects everything', $$select public.set_overtime_bulk(current_date + 8, '[{"user":"00000000-0000-0000-0000-0000000000a2","hours":3},{"user":"00000000-0000-0000-0000-0000000000a3","hours":25}]'::jsonb)$$, '22023');
select t.denied('bulk rejects a fractional hour (1.5)', $$select public.set_overtime_bulk(current_date + 8, '[{"user":"00000000-0000-0000-0000-0000000000a2","hours":1.5}]'::jsonb)$$, '22023');
select t.denied('bulk rejects hours given as a string', $$select public.set_overtime_bulk(current_date + 8, '[{"user":"00000000-0000-0000-0000-0000000000a2","hours":"5"}]'::jsonb)$$, '22023');
select t.denied('bulk rejects a negative hour', $$select public.set_overtime_bulk(current_date + 8, '[{"user":"00000000-0000-0000-0000-0000000000a2","hours":-1}]'::jsonb)$$, '22023');
select t.denied('bulk rejects a non-array payload', $$select public.set_overtime_bulk(current_date + 8, '{"user":"x"}'::jsonb)$$, '22023');
select t.denied('bulk rejects a 201-character note', format($f$select public.set_overtime_bulk(current_date + 8, '[{"user":"00000000-0000-0000-0000-0000000000a2","hours":1,"note":"%s"}]'::jsonb)$f$, repeat('x', 201)), '22023');
select t.count('...still nothing written for that day', $$select 1 from public.overtime where day = current_date + 8$$, 0);
select t.denied('bulk cannot target the super_admin', $$select public.set_overtime_bulk(current_date + 8, '[{"user":"00000000-0000-0000-0000-0000000000a0","hours":1}]'::jsonb)$$);
select t.ok('bulk may include the admin himself', $$select public.set_overtime_bulk(current_date + 8, '[{"user":"00000000-0000-0000-0000-0000000000a1","hours":2}]'::jsonb)$$);
select t.eq('audit logged the bulk change with adminA as actor',
  $$select count(*)::text from public.audit_log where table_name = 'overtime' and actor = '00000000-0000-0000-0000-0000000000a1' and day = current_date + 7$$, '4');

-- ============================================================ realtime announcements (private broadcast channels)
select t.su();
-- the fixture writes above already produced messages; start from a known point
delete from realtime.messages where topic like 'user:%' or topic like 'dept:%' or topic like 'deptpub:%';
select t.login('00000000-0000-0000-0000-0000000000a1');
select t.ok('adminA writes (status, overtime, holiday) trigger announcements',
  $$select public.set_day_status('00000000-0000-0000-0000-0000000000a2', current_date + 70, 'X'), public.set_overtime('00000000-0000-0000-0000-0000000000a2', current_date + 70, 2, 'rt'), public.set_holiday(current_date + 71, true)$$);
select t.su();
select t.eq('as owner: an announcement exists for the person (user:ua1), the admin channel (dept A) and the department (deptpub A)',
  $$select (exists (select 1 from realtime.messages where topic = 'user:00000000-0000-0000-0000-0000000000a2' and payload->>'t' = 'day_status')
        and exists (select 1 from realtime.messages where topic = 'dept:10000000-0000-0000-0000-00000000000a' and payload->>'t' = 'overtime')
        and exists (select 1 from realtime.messages where topic = 'deptpub:10000000-0000-0000-0000-00000000000a' and payload->>'t' = 'holidays'))::text$$, 'true');
select t.eq('announcements carry only table + range + person ids, never a status/hours/note',
  $$select (not exists (select 1 from realtime.messages where topic like 'dept:%' and (payload ? 'status' or payload ? 'hours' or payload ? 'note')))::text$$, 'true');
select t.eq('dept channel payload lists the affected person ids',
  $$select (payload->'u' ? '00000000-0000-0000-0000-0000000000a2')::text from realtime.messages where topic = 'dept:10000000-0000-0000-0000-00000000000a' and payload->>'t' = 'day_status' limit 1$$, 'true');
-- one summary per statement, not per row
select t.login('00000000-0000-0000-0000-0000000000a1');
select t.ok('a 3-row rows call is announced once per department', $$select public.set_day_status_rows(('[{"user":"00000000-0000-0000-0000-0000000000a2","day":"' || (current_date + 80) || '","status":"X"},{"user":"00000000-0000-0000-0000-0000000000a3","day":"' || (current_date + 81) || '","status":"X"},{"user":"00000000-0000-0000-0000-0000000000a1","day":"' || (current_date + 82) || '","status":"Y"}]')::jsonb)$$);
select t.su();
select t.eq('...exactly 1 admin-channel message for 3 rows / 3 people (range +80..+82)',
  $$select count(*)::text || ':' || max(jsonb_array_length(payload->'u')) from realtime.messages where topic = 'dept:10000000-0000-0000-0000-00000000000a' and payload->>'t' = 'day_status' and payload->>'from' = (current_date + 80)::text$$, '1:3');
-- ---- who can receive what (impersonate + join the topic, like the Realtime server does)
select t.login('00000000-0000-0000-0000-0000000000a2');
select set_config('realtime.topic', 'user:00000000-0000-0000-0000-0000000000a2', true);
select t.count('user ua1 joined user:ua1 receives their announcements', $$select 1 from realtime.messages where topic = 'user:00000000-0000-0000-0000-0000000000a2'$$, 3);
select set_config('realtime.topic', 'user:00000000-0000-0000-0000-0000000000a3', true);
select t.count('user ua1 cannot join another person''s channel', $$select 1 from realtime.messages where topic = 'user:00000000-0000-0000-0000-0000000000a3'$$, 0);
select set_config('realtime.topic', 'dept:10000000-0000-0000-0000-00000000000a', true);
select t.count('plain user cannot join the admin channel of their own department', $$select 1 from realtime.messages where topic = 'dept:10000000-0000-0000-0000-00000000000a'$$, 0);
select set_config('realtime.topic', 'deptpub:10000000-0000-0000-0000-00000000000a', true);
select t.count('plain user receives their department holiday announcements', $$select 1 from realtime.messages where topic = 'deptpub:10000000-0000-0000-0000-00000000000a'$$, 1);
select t.denied('clients cannot publish into realtime.messages', $$insert into realtime.messages (topic, extension, payload, private) values ('dept:10000000-0000-0000-0000-00000000000a', 'broadcast', '{}', true)$$);
select t.login('00000000-0000-0000-0000-0000000000b2');
select set_config('realtime.topic', 'deptpub:10000000-0000-0000-0000-00000000000a', true);
select t.count('a user of department B cannot join department A public channel', $$select 1 from realtime.messages where topic = 'deptpub:10000000-0000-0000-0000-00000000000a'$$, 0);
select set_config('realtime.topic', 'user:00000000-0000-0000-0000-0000000000a2', true);
select t.count('...nor a person channel of department A', $$select 1 from realtime.messages where topic = 'user:00000000-0000-0000-0000-0000000000a2'$$, 0);
select t.login('00000000-0000-0000-0000-0000000000a1');
select set_config('realtime.topic', 'dept:10000000-0000-0000-0000-00000000000a', true);
select t.count('adminA joined dept:A receives the admin announcements', $$select 1 from realtime.messages where topic = 'dept:10000000-0000-0000-0000-00000000000a'$$, 3);
select set_config('realtime.topic', 'dept:10000000-0000-0000-0000-00000000000b', true);
select t.count('adminA cannot join department B admin channel', $$select 1 from realtime.messages where topic = 'dept:10000000-0000-0000-0000-00000000000b'$$, 0);
select set_config('realtime.topic', 'user:00000000-0000-0000-0000-0000000000a2', true);
select t.count('adminA cannot join a person channel (those are private to the person)', $$select 1 from realtime.messages where topic = 'user:00000000-0000-0000-0000-0000000000a2'$$, 0);
select t.login('00000000-0000-0000-0000-0000000000b1');
select set_config('realtime.topic', 'dept:10000000-0000-0000-0000-00000000000a', true);
select t.count('adminB cannot join department A admin channel', $$select 1 from realtime.messages where topic = 'dept:10000000-0000-0000-0000-00000000000a'$$, 0);
select set_config('realtime.topic', 'deptpub:10000000-0000-0000-0000-00000000000a', true);
select t.count('adminB cannot join department A public channel', $$select 1 from realtime.messages where topic = 'deptpub:10000000-0000-0000-0000-00000000000a'$$, 0);
select t.login('00000000-0000-0000-0000-0000000000a0');
select set_config('realtime.topic', 'dept:10000000-0000-0000-0000-00000000000a', true);
select t.eq('super_admin may listen to department channels (changed 2026-10-21: it can act as admin of any department)', $$select (count(*) > 0)::text from realtime.messages where topic = 'dept:10000000-0000-0000-0000-00000000000a'$$, 'true');
select set_config('realtime.topic', 'deptpub:10000000-0000-0000-0000-00000000000a', true);
select t.eq('...and the public one', $$select (count(*) > 0)::text from realtime.messages where topic = 'deptpub:10000000-0000-0000-0000-00000000000a'$$, 'true');
select t.anon();
select t.count('anon sees no realtime messages at all (no policy for anon)', $$select 1 from realtime.messages$$, 0);
select t.su();
-- profile changes are announced
delete from realtime.messages where topic like 'dept:%' or topic like 'user:%';
update public.profiles set full_name = 'User A1 renamed' where id = '00000000-0000-0000-0000-0000000000a2';
select t.eq('a profile change is announced to the department admins and to the person',
  $$select (exists (select 1 from realtime.messages where topic = 'dept:10000000-0000-0000-0000-00000000000a' and payload->>'t' = 'profiles') and exists (select 1 from realtime.messages where topic = 'user:00000000-0000-0000-0000-0000000000a2' and payload->>'t' = 'profile'))::text$$, 'true');
select t.eq('...and not to the other department', $$select (not exists (select 1 from realtime.messages where topic = 'dept:10000000-0000-0000-0000-00000000000b'))::text$$, 'true');
select t.login('00000000-0000-0000-0000-0000000000a1');   -- the sections below continue as adminA


-- profile edits
select t.ok('adminA edits ua1 data', $$select public.update_profile('00000000-0000-0000-0000-0000000000a2', 'User A1 Renamed', 'OPR-A2', '7')$$);
select t.eq('edit persisted', $$select level::text from public.profiles where username = 'ua1'$$, '7');
select t.denied('adminA edits dept B user', $$select public.update_profile('00000000-0000-0000-0000-0000000000b2', 'x', 'OPR-B2', '1')$$);
select t.denied('adminA edits super_admin', $$select public.update_profile('00000000-0000-0000-0000-0000000000a0', 'x', 'x', '1')$$);
select t.denied('duplicate OPR rejected', $$select public.update_profile('00000000-0000-0000-0000-0000000000a2', 'x', 'OPR-B2', '1')$$, '23505');
-- report fields: job title / contract number on people, print settings on departments
select t.ok('adminA sets job title and contract number (6-argument update_profile)', $$select public.update_profile('00000000-0000-0000-0000-0000000000a2', 'User A1', 'OPR-A2', '7', 'Engineer', '033/2019')$$);
select t.eq('...stored', $$select job_title || '|' || contract_no from public.profiles where id = '00000000-0000-0000-0000-0000000000a2'$$, 'Engineer|033/2019');
select t.ok('the old 4-argument call still works and leaves them unchanged', $$select public.update_profile('00000000-0000-0000-0000-0000000000a2', 'User A1', 'OPR-A2', '7')$$);
select t.eq('...job title / contract number kept', $$select job_title || '|' || contract_no from public.profiles where id = '00000000-0000-0000-0000-0000000000a2'$$, 'Engineer|033/2019');
select t.ok('empty text clears a field', $$select public.update_profile('00000000-0000-0000-0000-0000000000a2', 'User A1', 'OPR-A2', '7', '', null)$$);
select t.eq('...job title cleared, contract number kept', $$select coalesce(job_title, 'NULL') || '|' || contract_no from public.profiles where id = '00000000-0000-0000-0000-0000000000a2'$$, 'NULL|033/2019');
select t.denied('job title longer than 100 characters is rejected', format($f$select public.update_profile('00000000-0000-0000-0000-0000000000a2', 'User A1', 'OPR-A2', '7', '%s', null)$f$, repeat('x', 101)), '23514');
select t.denied('adminA cannot set job title of a dept B person', $$select public.update_profile('00000000-0000-0000-0000-0000000000b2', 'x', 'OPR-B2', '1', 'Engineer', null)$$);
select t.ok('adminA sets work location and residence (8-argument update_profile)', $$select public.update_profile('00000000-0000-0000-0000-0000000000a2', 'User A1', 'OPR-A2', '7', null, null, 'IDKU Site', 'outside')$$);
select t.eq('...stored (job title / contract untouched)', $$select work_location || '|' || residence from public.profiles where id = '00000000-0000-0000-0000-0000000000a2'$$, 'IDKU Site|outside');
select t.denied('residence must be inside or outside', $$select public.update_profile('00000000-0000-0000-0000-0000000000a2', 'User A1', 'OPR-A2', '7', null, null, null, 'abroad')$$, '22023');
select t.ok('residence can be cleared with empty text', $$select public.update_profile('00000000-0000-0000-0000-0000000000a2', 'User A1', 'OPR-A2', '7', null, null, '', '')$$);
select t.eq('...both cleared', $$select coalesce(work_location, 'NULL') || '|' || coalesce(residence, 'NULL') from public.profiles where id = '00000000-0000-0000-0000-0000000000a2'$$, 'NULL|NULL');
select t.ok('...and can be set again', $$select public.update_profile('00000000-0000-0000-0000-0000000000a2', 'User A1', 'OPR-A2', '7', null, null, 'IDKU Site', 'inside')$$);
select t.denied('direct UPDATE of residence is impossible for clients', $$update public.profiles set residence = 'inside'$$);
select t.ok('adminA saves the print settings of his OWN department (printed name + site in the object, code/sector/field as columns)', $$select public.set_department_report('10000000-0000-0000-0000-00000000000a', '{"dept_print_name":"TURBO (MAINT.)","location":"IDKU Site"}'::jsonb, '19', 'Maintenance Sector', 'Operations [Fields]')$$);
select t.eq('...stored', $$select (report ->> 'location') || '|' || code || '|' || sector || '|' || field from public.departments where id = '10000000-0000-0000-0000-00000000000a'$$, 'IDKU Site|19|Maintenance Sector|Operations [Fields]');
select t.ok('NULL keeps the columns, only the object is replaced', $$select public.set_department_report('10000000-0000-0000-0000-00000000000a', '{"location":"Abu Qir"}'::jsonb)$$);
select t.eq('...code/sector/field unchanged, location replaced, printed name gone', $$select (report ->> 'location') || '|' || code || '|' || sector || '|' || coalesce(report ->> 'dept_print_name', 'none') from public.departments where id = '10000000-0000-0000-0000-00000000000a'$$, 'Abu Qir|19|Maintenance Sector|none');
select t.ok('empty text clears a column', $$select public.set_department_report('10000000-0000-0000-0000-00000000000a', '{}'::jsonb, null, '', null)$$);
select t.eq('...sector cleared, code and field kept', $$select coalesce(sector, 'NULL') || '|' || code || '|' || field from public.departments where id = '10000000-0000-0000-0000-00000000000a'$$, 'NULL|19|Operations [Fields]');
select t.ok('adminA sets a position (9-argument update_profile)', $$select public.update_profile('00000000-0000-0000-0000-0000000000a2', 'User A1', 'OPR-A2', '7', null, null, null, null, 'Engineer')$$);
select t.eq('...stored, other fields untouched', $$select "position" || '|' || coalesce(work_location, 'NULL') from public.profiles where id = '00000000-0000-0000-0000-0000000000a2'$$, 'Engineer|IDKU Site');
select t.ok('position can be any free text and be cleared with empty text', $$select public.update_profile('00000000-0000-0000-0000-0000000000a2', 'User A1', 'OPR-A2', '7', null, null, null, null, 'Rigger Foreman')$$);
select t.denied('position longer than 100 characters is rejected', format($f$select public.update_profile('00000000-0000-0000-0000-0000000000a2', 'User A1', 'OPR-A2', '7', null, null, null, null, '%s')$f$, repeat('x', 101)), '23514');
select t.denied('adminA cannot set the position of a dept B person', $$select public.update_profile('00000000-0000-0000-0000-0000000000b2', 'x', 'x', '1', null, null, null, null, 'Engineer')$$);
select t.ok('adminA sets a payroll number (10-argument update_profile)', $$select public.update_profile('00000000-0000-0000-0000-0000000000a2', 'User A1', 'OPR-A2', '7', null, null, null, null, null, 'PR-777')$$);
select t.eq('...stored (OPR untouched)', $$select payroll || '|' || opr from public.profiles where id = '00000000-0000-0000-0000-0000000000a2'$$, 'PR-777|OPR-A2');
select t.denied('payroll must be unique', $$select public.update_profile('00000000-0000-0000-0000-0000000000a1', 'Admin A', 'OPR-A1', '1', null, null, null, null, null, 'PR-777')$$, '23505');
select t.denied('adminA cannot set the payroll of a dept B person', $$select public.update_profile('00000000-0000-0000-0000-0000000000b2', 'x', 'x', '1', null, null, null, null, null, 'PR-1')$$);
select t.ok('adminA forbids Y for a person (11-argument update_profile)', $$select public.update_profile('00000000-0000-0000-0000-0000000000a2', 'User A1', 'OPR-A2', '7', null, null, null, null, null, null, false)$$);
select t.eq('...stored', $$select y_allowed::text from public.profiles where id = '00000000-0000-0000-0000-0000000000a2'$$, 'false');
select t.denied('Y is rejected by the admin for that person (set_day_status)', $$select public.set_day_status('00000000-0000-0000-0000-0000000000a2', current_date + 50, 'Y')$$, '22023');
select t.denied('...and by the bulk rows RPC, nothing written', $$select public.set_day_status_rows('[{"user":"00000000-0000-0000-0000-0000000000a2","day":"2030-02-01","status":"Y"}]'::jsonb)$$, '22023');
select t.ok('X is still fine for that person', $$select public.set_day_status('00000000-0000-0000-0000-0000000000a2', current_date + 50, 'X')$$);
select t.denied('a plain user cannot allow Y for himself', $$update public.profiles set y_allowed = true$$);
select t.ok('adminA allows Y again (NULL keeps it otherwise)', $$select public.update_profile('00000000-0000-0000-0000-0000000000a2', 'User A1', 'OPR-A2', '7', null, null, null, null, null, null, true)$$);
select t.ok('...and Y works', $$select public.set_day_status('00000000-0000-0000-0000-0000000000a2', current_date + 50, 'Y')$$);
select t.ok('4-argument update_profile leaves the permission unchanged', $$select public.update_profile('00000000-0000-0000-0000-0000000000a2', 'User A1', 'OPR-A2', '7')$$);
select t.eq('...still allowed', $$select y_allowed::text from public.profiles where id = '00000000-0000-0000-0000-0000000000a2'$$, 'true');
select t.ok('adminA sets a working day for ua1 (for the departure tests)', $$select public.set_day_status('00000000-0000-0000-0000-0000000000a2', current_date + 60, 'X')$$);
select t.ok('adminA moves the departure of ua1 onto that working day', $$select public.set_departure_move('00000000-0000-0000-0000-0000000000a2', current_date + 60, true)$$);
select t.eq('...stored', $$select count(*)::text from public.departure_moves where user_id = '00000000-0000-0000-0000-0000000000a2' and work_day = current_date + 60$$, '1');
select t.denied('a departure can only sit on a working day', $$select public.set_departure_move('00000000-0000-0000-0000-0000000000a2', current_date + 61, true)$$, '22023');
select t.denied('adminA cannot move the departure of a dept B person', $$select public.set_departure_move('00000000-0000-0000-0000-0000000000b2', current_date + 60, true)$$);
select t.denied('no direct writes to departure_moves', $$insert into public.departure_moves (user_id, work_day) values ('00000000-0000-0000-0000-0000000000a2', current_date + 62)$$);
select t.login('00000000-0000-0000-0000-0000000000a2');
select t.count('a user sees only his own departure moves', $$select 1 from public.departure_moves$$, 1);
select t.ok('the user puts it back on the rest day (removes the move)', $$select public.set_departure_move('00000000-0000-0000-0000-0000000000a2', current_date + 60, false)$$);
select t.ok('...and moves it again himself', $$select public.set_departure_move('00000000-0000-0000-0000-0000000000a2', current_date + 60, true)$$);
select t.denied('a user cannot move the departure of another person', $$select public.set_departure_move('00000000-0000-0000-0000-0000000000a1', current_date + 60, true)$$);
select t.login('00000000-0000-0000-0000-0000000000a1');
select t.ok('adminA sets the approved totals of his department', $$select public.set_department_report('10000000-0000-0000-0000-00000000000a', '{}'::jsonb, null, null, null, '264', '295')$$);
select t.eq('...stored as whole numbers', $$select approved_engineer || '|' || approved_tech from public.departments where id = '10000000-0000-0000-0000-00000000000a'$$, '264|295');
select t.denied('approved totals must be whole numbers', $$select public.set_department_report('10000000-0000-0000-0000-00000000000a', '{}'::jsonb, null, null, null, '12.5', null)$$, '22023');
select t.ok('empty text clears an approved total, NULL keeps the other', $$select public.set_department_report('10000000-0000-0000-0000-00000000000a', '{}'::jsonb, null, null, null, '', null)$$);
select t.eq('...engineer cleared, tech kept', $$select coalesce(approved_engineer::text, 'NULL') || '|' || approved_tech from public.departments where id = '10000000-0000-0000-0000-00000000000a'$$, 'NULL|295');
select t.denied('code longer than 20 characters is rejected', format($f$select public.set_department_report('10000000-0000-0000-0000-00000000000a', '{}'::jsonb, '%s')$f$, repeat('9', 21)), '23514');
select t.denied('adminA cannot set the print settings of department B', $$select public.set_department_report('10000000-0000-0000-0000-00000000000b', '{"location":"99"}'::jsonb)$$);
select t.denied('an unknown setting key is rejected', $$select public.set_department_report('10000000-0000-0000-0000-00000000000a', '{"evil":"x"}'::jsonb)$$, '22023');
select t.denied('a non-text value is rejected', $$select public.set_department_report('10000000-0000-0000-0000-00000000000a', '{"location":19}'::jsonb)$$, '22023');
select t.denied('a value over 200 characters is rejected', format($f$select public.set_department_report('10000000-0000-0000-0000-00000000000a', '{"location":"%s"}'::jsonb)$f$, repeat('x', 201)), '22023');
select t.denied('settings must be an object', $$select public.set_department_report('10000000-0000-0000-0000-00000000000a', '["x"]'::jsonb)$$, '22023');
select t.denied('direct UPDATE of departments.report is impossible', $$update public.departments set report = '{}'::jsonb$$);
select t.eq('the report change was audited with adminA as actor (object + code/sector/field)', $$select (count(*) filter (where field = 'report') >= 1 and count(*) filter (where field in ('code', 'sector', 'field')) >= 2)::text from public.audit_log where table_name = 'departments' and actor = '00000000-0000-0000-0000-0000000000a1' and department_id = '10000000-0000-0000-0000-00000000000a'$$, 'true');
select t.denied('adminA direct UPDATE profiles', $$update public.profiles set level = 1$$);
select t.ok('adminA promotes ua2 to admin', $$select public.set_user_role('00000000-0000-0000-0000-0000000000a3', 'admin')$$);
select t.ok('adminA demotes ua2 back', $$select public.set_user_role('00000000-0000-0000-0000-0000000000a3', 'user')$$);
select t.denied('adminA promotes dept B user', $$select public.set_user_role('00000000-0000-0000-0000-0000000000b2', 'admin')$$);
select t.denied('adminA self-demotion blocked', $$select public.set_user_role('00000000-0000-0000-0000-0000000000a1', 'user')$$);
select t.denied('adminA cannot touch super_admin role', $$select public.set_user_role('00000000-0000-0000-0000-0000000000a0', 'user')$$);
select t.denied('adminA cannot grant super_admin', $$select public.set_user_role('00000000-0000-0000-0000-0000000000a2', 'super_admin')$$, '22023');
select t.denied('adminA create_department', $$select public.create_department('Evil')$$);
select t.ok('adminA may create user in own dept', $$select public.assert_can_create('10000000-0000-0000-0000-00000000000a', 'user')$$);
select t.denied('adminA may not create user in dept B', $$select public.assert_can_create('10000000-0000-0000-0000-00000000000b', 'user')$$);
select t.ok('adminA may create admin in own dept', $$select public.assert_can_create('10000000-0000-0000-0000-00000000000a', 'admin')$$);
select t.ok('adminA may create manager in own dept', $$select public.assert_can_create('10000000-0000-0000-0000-00000000000a', 'manager')$$);
select t.denied('adminA may not create super_admin', $$select public.assert_can_create('10000000-0000-0000-0000-00000000000a', 'super_admin')$$);
-- department manager: admin powers, no timesheet
select t.ok('adminA makes ua2 a manager', $$select public.set_user_role('00000000-0000-0000-0000-0000000000a3', 'manager')$$);
select t.denied('adminA cannot give a manager a day status', $$select public.set_day_status('00000000-0000-0000-0000-0000000000a3', current_date, 'X')$$, '22023');
select t.login('00000000-0000-0000-0000-0000000000a3');
select t.eq('manager acts as admin (app_role)', $$select public.app_role()$$, 'admin');
select t.ok('manager sets a user day status in own dept', $$select public.set_day_status('00000000-0000-0000-0000-0000000000a2', current_date, 'X')$$);
select t.denied('manager has no timesheet of their own', $$select public.set_day_status('00000000-0000-0000-0000-0000000000a3', current_date, 'X')$$, '22023');
select t.denied('manager cannot touch dept B', $$select public.set_user_role('00000000-0000-0000-0000-0000000000b2', 'admin')$$);
select t.denied('manager cannot change own role', $$select public.set_user_role('00000000-0000-0000-0000-0000000000a3', 'user')$$);
select t.login('00000000-0000-0000-0000-0000000000a1');
select t.ok('a manager can be edited and needs no payroll', $$select public.update_profile('00000000-0000-0000-0000-0000000000a3', 'User A2', 'OPR-A3', '1', null, null, null, null, null, '')$$);
select t.denied('a blank payroll is refused for a user', $$select public.update_profile('00000000-0000-0000-0000-0000000000a2', 'User A1', 'OPR-A2', '7', null, null, null, null, null, '')$$, '22023');
select t.ok('OPR can be cleared (optional)', $$select public.update_profile('00000000-0000-0000-0000-0000000000a2', 'User A1', '', '7')$$);
select t.ok('adminA makes the manager a user again', $$select public.set_user_role('00000000-0000-0000-0000-0000000000a3', 'user')$$);
select t.ok('adminA may reset ua2 password', $$select public.assert_can_manage('00000000-0000-0000-0000-0000000000a3', 'reset')$$);
select t.denied('adminA may not reset dept B', $$select public.assert_can_manage('00000000-0000-0000-0000-0000000000b2', 'reset')$$);
select t.denied('adminA may not delete self', $$select public.soft_delete_user('00000000-0000-0000-0000-0000000000a1')$$);
select t.denied('adminA may not delete dept B user', $$select public.soft_delete_user('00000000-0000-0000-0000-0000000000b2')$$);
select t.count('adminA audit: only dept A rows',
  $$select 1 from public.audit_log where department_id is distinct from '10000000-0000-0000-0000-00000000000a'$$, 0);
select t.eq('audit recorded status change old->new',
  $$select old_value || '->' || new_value from public.audit_log where table_name = 'day_status' and target_user = '00000000-0000-0000-0000-0000000000a3' and day = current_date + 40 and new_value = 'Y' and old_value = 'E' limit 1$$, 'E->Y');
select t.eq('audit recorded overtime 2->5',
  $$select old_value || '->' || new_value from public.audit_log where table_name = 'overtime' and target_user = '00000000-0000-0000-0000-0000000000a2' and new_value = '5' limit 1$$, '2->5');
select t.ok('audit has actor', $$select 1 / count(*) from public.audit_log where actor = '00000000-0000-0000-0000-0000000000a1'$$);
select t.ok('adminA soft-deletes ua2 via RPC', $$select public.soft_delete_user('00000000-0000-0000-0000-0000000000a3')$$);
select t.eq('ua2 is now inactive', $$select active::text from public.profiles where username = 'ua2'$$, 'false');
select t.denied('adminA cannot set status of deleted user', $$select public.set_day_status('00000000-0000-0000-0000-0000000000a3', current_date, 'X')$$);

-- deleted user is locked out
select t.login('00000000-0000-0000-0000-0000000000a3');
select t.count('deleted user sees no profile', 'select 1 from public.profiles', 0);
select t.denied('deleted user cannot record', $$select public.set_day_status('00000000-0000-0000-0000-0000000000a3', current_date, 'X')$$);

-- ---------------------------------------------------------------- admin B (cross-department)
select t.login('00000000-0000-0000-0000-0000000000b1');
select t.count('adminB sees dept B profiles only', 'select 1 from public.profiles', 2);
select t.count('adminB sees no dept A status', $$select 1 from public.day_status where user_id in ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000a3')$$, 0);
select t.count('adminB sees no dept A overtime', $$select 1 from public.overtime where user_id = '00000000-0000-0000-0000-0000000000a2'$$, 0);
select t.count('adminB sees no dept A holidays', 'select 1 from public.holidays', 0);
select t.count('adminB sees no dept A audit', $$select 1 from public.audit_log where department_id = '10000000-0000-0000-0000-00000000000a'$$, 0);
select t.denied('adminB set status in dept A', $$select public.set_day_status('00000000-0000-0000-0000-0000000000a2', current_date, 'X')$$);
select t.denied('adminB bulk overtime in dept A', $$select public.set_overtime_bulk(current_date, '[{"user":"00000000-0000-0000-0000-0000000000a2","hours":9}]'::jsonb)$$);
select t.denied('adminB set_day_status_rows for dept A', $$select public.set_day_status_rows('[{"user":"00000000-0000-0000-0000-0000000000a2","day":"2030-01-01","status":"X"}]'::jsonb)$$);
select t.denied('adminB set_department_report for dept A', $$select public.set_department_report('10000000-0000-0000-0000-00000000000a', '{"location":"1"}'::jsonb)$$);
select t.denied('adminB overtime in dept A', $$select public.set_overtime('00000000-0000-0000-0000-0000000000a2', current_date, 2)$$);
select t.denied('adminB edit dept A user', $$select public.update_profile('00000000-0000-0000-0000-0000000000a2', 'x', 'OPR-A2', '1')$$);
select t.denied('adminB promote dept A user', $$select public.set_user_role('00000000-0000-0000-0000-0000000000a2', 'admin')$$);
select t.denied('adminB delete dept A user', $$select public.soft_delete_user('00000000-0000-0000-0000-0000000000a2')$$);
select t.ok('adminB marks own-dept holiday', $$select public.set_holiday(current_date, true)$$);
select t.eq('adminB holiday did not affect dept A (ua1 still XH only from dept A holiday)',
  $$select count(*)::text from public.holidays where department_id = '10000000-0000-0000-0000-00000000000b'$$, '1');
select t.login('00000000-0000-0000-0000-0000000000a2');
select t.count('dept A user does not see dept B holiday', $$select 1 from public.holidays where department_id = '10000000-0000-0000-0000-00000000000b'$$, 0);

-- ---------------------------------------------------------------- super_admin
select t.login('00000000-0000-0000-0000-0000000000a0');
select t.count('super_admin sees all fixture profiles (other real rows may exist)', $$select 1 from public.profiles where username in ('sadm','adma','ua1','ua2','admb','ub1')$$, 6);
select t.count('super_admin sees both fixture departments', $$select 1 from public.departments where name in ('Dept A','Dept B')$$, 2);
select t.count('super_admin has NO day_status access', 'select 1 from public.day_status', 0);
select t.count('super_admin has NO overtime access', 'select 1 from public.overtime', 0);
select t.count('super_admin get_timesheet empty', $$select 1 from public.get_timesheet(null, current_date, current_date)$$, 0);
select t.count('super_admin audit limited to profiles/departments',
  $$select 1 from public.audit_log where table_name not in ('profiles','departments')$$, 0);
select t.denied('super_admin cannot set status', $$select public.set_day_status('00000000-0000-0000-0000-0000000000a2', current_date, 'X')$$);
select t.denied('super_admin cannot set own status', $$select public.set_day_status('00000000-0000-0000-0000-0000000000a0', current_date, 'X')$$);
select t.denied('super_admin cannot bulk-set overtime', $$select public.set_overtime_bulk(current_date, '[{"user":"00000000-0000-0000-0000-0000000000a2","hours":9}]'::jsonb)$$);
select t.denied('super_admin cannot use set_day_status_rows', $$select public.set_day_status_rows('[{"user":"00000000-0000-0000-0000-0000000000a2","day":"2030-01-01","status":"X"}]'::jsonb)$$);
select t.denied('super_admin cannot set overtime', $$select public.set_overtime('00000000-0000-0000-0000-0000000000a2', current_date, 2)$$);
select t.denied('super_admin cannot set holiday', $$select public.set_holiday(current_date, true)$$);
select t.denied('super_admin cannot edit user data', $$select public.update_profile('00000000-0000-0000-0000-0000000000a2', 'x', 'OPR-A2', '1')$$);
select t.denied('super_admin cannot delete a plain user', $$select public.soft_delete_user('00000000-0000-0000-0000-0000000000a2')$$);
select t.ok('super_admin creates department', $$select public.create_department('Dept C')$$);
select t.ok('super_admin may set the print settings of any department', $$select public.set_department_report('10000000-0000-0000-0000-00000000000b', '{"location":"Abu Qir"}'::jsonb, '20')$$);
select t.denied('super_admin still cannot edit people data (job title)', $$select public.update_profile('00000000-0000-0000-0000-0000000000a2', 'x', 'OPR-A2', '1', 'Boss', null)$$);
select t.ok('super_admin renames department', $$select public.rename_department('10000000-0000-0000-0000-00000000000b', 'Dept B2')$$);
select t.denied('duplicate department name rejected', $$select public.create_department('Dept A')$$, '23505');
select t.ok('super_admin promotes user across depts', $$select public.set_user_role('00000000-0000-0000-0000-0000000000b2', 'admin')$$);
select t.ok('super_admin demotes admin across depts', $$select public.set_user_role('00000000-0000-0000-0000-0000000000b2', 'user')$$);
select t.ok('super_admin demotes admin B', $$select public.set_user_role('00000000-0000-0000-0000-0000000000b1', 'user')$$);
select t.denied('super_admin cannot demote self/super_admin via RPC', $$select public.set_user_role('00000000-0000-0000-0000-0000000000a0', 'user')$$);
select t.ok('super_admin may create admin in any dept', $$select public.assert_can_create('10000000-0000-0000-0000-00000000000a', 'admin')$$);
select t.ok('super_admin may create manager in any dept', $$select public.assert_can_create('10000000-0000-0000-0000-00000000000a', 'manager')$$);
select t.denied('super_admin may not create plain user', $$select public.assert_can_create('10000000-0000-0000-0000-00000000000a', 'user')$$);
select t.ok('super_admin may reset an admin password', $$select public.assert_can_manage('00000000-0000-0000-0000-0000000000a1', 'reset')$$);
select t.denied('super_admin may not reset a plain user password', $$select public.assert_can_manage('00000000-0000-0000-0000-0000000000a2', 'reset')$$);
select t.denied('super_admin direct UPDATE profiles', $$update public.profiles set role = 'super_admin'$$);
select t.ok('super_admin soft-deletes an admin', $$select public.soft_delete_user('00000000-0000-0000-0000-0000000000a1')$$);

-- ---------------------------------------------------------------- super manager: read-only, every department, no timesheet
select t.su();
insert into auth.users (id, email, aud, role) values ('00000000-0000-0000-0000-0000000000c1', 'sm@timesheet.local', 'authenticated', 'authenticated');
insert into public.profiles (id, username, full_name, opr, department_id, role) values ('00000000-0000-0000-0000-0000000000c1', 'smgr', 'Super Manager', null, null, 'super_manager');
select t.login('00000000-0000-0000-0000-0000000000c1');
select t.eq('super manager: app_role() is super_manager', $$select public.app_role()$$, 'super_manager');
select t.count('super manager sees people of department A and B', $$select 1 from public.profiles where username in ('ua1', 'ub1')$$, 2);
select t.count('super manager sees the timesheet of dept A and dept B', $$select distinct user_id from public.day_status where user_id in ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000b2')$$, 2);
select t.count('super manager sees both departments', $$select 1 from public.departments where id in ('10000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000b')$$, 2);
select t.denied('super manager cannot set a day status', $$select public.set_day_status('00000000-0000-0000-0000-0000000000a2', current_date + 50, 'X')$$);
select t.denied('super manager cannot set overtime', $$select public.set_overtime('00000000-0000-0000-0000-0000000000a2', current_date + 50, 2, 'x')$$);
select t.denied('super manager cannot set a holiday', $$select public.set_holiday(current_date + 51, true)$$);
select t.denied('super manager cannot change a role', $$select public.set_user_role('00000000-0000-0000-0000-0000000000a2', 'admin')$$);
select t.denied('super manager cannot edit a person', $$select public.update_profile('00000000-0000-0000-0000-0000000000a2', 'x', 'OPR-A2', '1')$$);
select t.denied('super manager cannot change report settings', $$select public.set_department_report('10000000-0000-0000-0000-00000000000a', '{}'::jsonb)$$);
select t.denied('super manager cannot create a department', $$select public.create_department('Nope')$$);
select t.denied('super manager cannot create people', $$select public.assert_can_create('10000000-0000-0000-0000-00000000000a', 'user')$$);
select t.denied('super manager cannot reset passwords', $$select public.assert_can_manage('00000000-0000-0000-0000-0000000000a2', 'reset')$$);
select t.ok('super manager fixes their own name / OPR', $$select public.update_super_user('00000000-0000-0000-0000-0000000000c1', 'Super Manager Fixed', 'SM-OPR')$$);
select t.eq('...and it is saved', $$select full_name || '|' || opr from public.profiles where id = '00000000-0000-0000-0000-0000000000c1'$$, 'Super Manager Fixed|SM-OPR');
select t.denied('super manager cannot edit another super user', $$select public.update_super_user('00000000-0000-0000-0000-0000000000a0', 'x', null)$$);
select t.denied('super manager cannot edit a department person', $$select public.update_super_user('00000000-0000-0000-0000-0000000000a2', 'x', null)$$);
select t.denied('a signed-in user cannot call revoke_user_sessions (service role only)', $$select public.revoke_user_sessions('00000000-0000-0000-0000-0000000000a2')$$);
select t.denied('super manager direct UPDATE of a day status', $$update public.day_status set status = 'Y'$$);
select t.login('00000000-0000-0000-0000-0000000000a0');
select t.ok('super_admin may create a super manager (no department)', $$select public.assert_can_create(null, 'super_manager')$$);
select t.denied('super manager has no department: a department is refused', $$select public.assert_can_create('10000000-0000-0000-0000-00000000000a', 'super_manager')$$);
select t.ok('super_admin may create another super_admin (no department)', $$select public.assert_can_create(null, 'super_admin')$$);
select t.denied('...a super_admin with a department is refused', $$select public.assert_can_create('10000000-0000-0000-0000-00000000000a', 'super_admin')$$);
select t.denied('super_admin cannot delete / reset themselves through the Edge Function checks', $$select public.assert_can_manage('00000000-0000-0000-0000-0000000000a0', 'delete')$$);
select t.ok('super_admin edits a super manager', $$select public.update_super_user('00000000-0000-0000-0000-0000000000c1', 'Super Manager Two', null)$$);
select t.denied('super_admin cannot use it on a department person', $$select public.update_super_user('00000000-0000-0000-0000-0000000000a2', 'x', null)$$);
select t.denied('a blank name is refused', $$select public.update_super_user('00000000-0000-0000-0000-0000000000c1', '  ', null)$$, '22023');
select t.ok('super_admin may reset a super manager password', $$select public.assert_can_manage('00000000-0000-0000-0000-0000000000c1', 'reset')$$);
select t.login('00000000-0000-0000-0000-0000000000b1');
select t.denied('an admin of a department cannot use update_super_user', $$select public.update_super_user('00000000-0000-0000-0000-0000000000c1', 'x', null)$$);
select t.denied('an admin of a department cannot create a super admin', $$select public.assert_can_create(null, 'super_admin')$$);
select t.denied('an admin of a department cannot create a super manager', $$select public.assert_can_create(null, 'super_manager')$$);
select t.su();
select t.denied('nobody can give a super manager a day status (trigger)', $$insert into public.day_status (user_id, day, status) values ('00000000-0000-0000-0000-0000000000c1', current_date, 'X')$$, '22023');
delete from public.profiles where id = '00000000-0000-0000-0000-0000000000c1';
delete from auth.users where id = '00000000-0000-0000-0000-0000000000c1';

-- ---------------------------------------------------------------- last super_admin guard (owner / service-role path)
-- ---- super_admin ACTING as the admin of a department (header x-acting-dept, migration 13)
select t.login('00000000-0000-0000-0000-0000000000a0');
select set_config('request.headers', '{"x-acting-dept":"10000000-0000-0000-0000-00000000000a"}', true);
select t.eq('acting: app_role() answers admin and app_dept() the chosen department', $$select public.app_role() || '|' || (public.app_dept() = '10000000-0000-0000-0000-00000000000a')$$, 'admin|true');
select t.count('acting as A: sees exactly the department A people (+ nobody from B)', $$select 1 from public.profiles where username in ('adma','ua1','ua2','admb','ub1')$$, 3);
select t.ok('acting as A: sets a status of a department A person', $$select public.set_day_status('00000000-0000-0000-0000-0000000000a2', current_date + 40, 'X')$$);
select t.count('acting as A: reads it back through RLS', $$select 1 from public.day_status where user_id = '00000000-0000-0000-0000-0000000000a2' and day = current_date + 40$$, 1);
select t.denied('acting as A: cannot touch a department B person', $$select public.set_day_status('00000000-0000-0000-0000-0000000000b2', current_date + 40, 'X')$$);
select t.count('acting as A: department B timesheet stays invisible', $$select 1 from public.day_status where user_id = '00000000-0000-0000-0000-0000000000b2'$$, 0);
select t.ok('acting as A: sets overtime', $$select public.set_overtime('00000000-0000-0000-0000-0000000000a2', current_date + 40, 3, 'acting')$$);
select t.ok('acting as A: marks a department holiday for A', $$select public.set_holiday(current_date + 41, true)$$);
select t.count('...the holiday belongs to department A', $$select 1 from public.holidays where day = current_date + 41 and department_id = '10000000-0000-0000-0000-00000000000a'$$, 1);
select t.ok('acting as A: edits a person of A', $$select public.update_profile('00000000-0000-0000-0000-0000000000a2', 'User A1', 'OPR-A2', '7', null, null, null, null, 'Engineer')$$);
select t.denied('acting as A: cannot edit a person of B', $$select public.update_profile('00000000-0000-0000-0000-0000000000b2', 'x', 'x', '1')$$);
select t.ok('acting as A: may save the department data of A', $$select public.set_department_report('10000000-0000-0000-0000-00000000000a', '{}'::jsonb, '19')$$);
select t.denied('acting as A: may NOT save the department data of B', $$select public.set_department_report('10000000-0000-0000-0000-00000000000b', '{}'::jsonb, '19')$$);
select t.denied('acting: cannot create a department (super functions are off while acting)', $$select public.create_department('Dept Z')$$);
select set_config('request.headers', '{"x-acting-dept":"10000000-0000-0000-0000-00000000000b"}', true);
select t.denied('switching to B: A person is out of reach now', $$select public.set_day_status('00000000-0000-0000-0000-0000000000a2', current_date + 40, 'Y')$$);
select t.ok('switching to B: a B person is reachable', $$select public.set_day_status('00000000-0000-0000-0000-0000000000b2', current_date + 40, 'Y')$$);
select set_config('request.headers', '{"x-acting-dept":"garbage"}', true);
select t.count('a malformed header is ignored (no timesheet access)', 'select 1 from public.day_status', 0);
select set_config('request.headers', '{"x-acting-dept":"99999999-9999-9999-9999-999999999999"}', true);
select t.count('an unknown department in the header is ignored', 'select 1 from public.day_status', 0);
select set_config('request.headers', '', true);
select t.count('no header: super_admin has no timesheet access again', 'select 1 from public.day_status', 0);
select t.denied('no header: super_admin cannot set a status', $$select public.set_day_status('00000000-0000-0000-0000-0000000000a2', current_date, 'X')$$);
select t.ok('no header: super_admin manages departments again', $$select public.create_department('Dept Y')$$);
-- the header means nothing to anyone else
select t.login('00000000-0000-0000-0000-0000000000a1');
select set_config('request.headers', '{"x-acting-dept":"10000000-0000-0000-0000-00000000000b"}', true);
select t.count('a department admin sending the header still sees only his own department', $$select 1 from public.profiles where username in ('ub1','admb')$$, 0);
select t.denied('a department admin cannot use the header to reach department B', $$select public.set_day_status('00000000-0000-0000-0000-0000000000b2', current_date + 42, 'X')$$);
select t.login('00000000-0000-0000-0000-0000000000a2');
select t.count('a plain user sending the header gets no extra rows', $$select 1 from public.profiles where username in ('ub1','admb')$$, 0);
select set_config('request.headers', '', true);
select t.login('00000000-0000-0000-0000-0000000000a0');
select t.su();
-- real super_admins may exist in the target DB: remove them inside this (rolled-back) transaction so the fixture is the only one
delete from public.profiles where role = 'super_admin' and id <> '00000000-0000-0000-0000-0000000000a0';
select t.denied('cannot demote last super_admin', $$update public.profiles set role = 'user', department_id = '10000000-0000-0000-0000-00000000000a', opr = 'Z' where id = '00000000-0000-0000-0000-0000000000a0'$$, 'P0001');
select t.denied('cannot deactivate last super_admin', $$update public.profiles set active = false where id = '00000000-0000-0000-0000-0000000000a0'$$, 'P0001');
select t.denied('cannot delete last super_admin', $$delete from public.profiles where id = '00000000-0000-0000-0000-0000000000a0'$$, 'P0001');
select t.denied('cannot delete last super_admin via auth.users cascade', $$delete from auth.users where id = '00000000-0000-0000-0000-0000000000a0'$$, 'P0001');
insert into auth.users (id, email, aud, role) values ('00000000-0000-0000-0000-0000000000a9', 'sa2@timesheet.local', 'authenticated', 'authenticated');
insert into public.profiles (id, username, full_name, role) values ('00000000-0000-0000-0000-0000000000a9', 'sa2', 'Super 2', 'super_admin');
select t.ok('with a 2nd super_admin the first can be deactivated', $$update public.profiles set active = false where id = '00000000-0000-0000-0000-0000000000a0'$$);
select t.denied('...but now the 2nd is the last', $$update public.profiles set active = false where id = '00000000-0000-0000-0000-0000000000a9'$$, 'P0001');


do $$ begin raise notice '=== ALL RLS TESTS PASSED ==='; end $$;
