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
select t.denied('user set_holiday', $$select public.set_holiday(current_date, true)$$);
select t.denied('user direct INSERT holidays',
  $$insert into public.holidays (department_id, day) values ('10000000-0000-0000-0000-00000000000a', current_date)$$);
select t.denied('user update_profile on self', $$select public.update_profile('00000000-0000-0000-0000-0000000000a2', 'Hacker', 'OPR-A2', 99)$$);
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
-- profile edits
select t.ok('adminA edits ua1 data', $$select public.update_profile('00000000-0000-0000-0000-0000000000a2', 'User A1 Renamed', 'OPR-A2', 7)$$);
select t.eq('edit persisted', $$select level::text from public.profiles where username = 'ua1'$$, '7');
select t.denied('adminA edits dept B user', $$select public.update_profile('00000000-0000-0000-0000-0000000000b2', 'x', 'OPR-B2', 1)$$);
select t.denied('adminA edits super_admin', $$select public.update_profile('00000000-0000-0000-0000-0000000000a0', 'x', 'x', 1)$$);
select t.denied('duplicate OPR rejected', $$select public.update_profile('00000000-0000-0000-0000-0000000000a2', 'x', 'OPR-B2', 1)$$, '23505');
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
select t.denied('adminA may not create admin', $$select public.assert_can_create('10000000-0000-0000-0000-00000000000a', 'admin')$$);
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
select t.denied('adminB overtime in dept A', $$select public.set_overtime('00000000-0000-0000-0000-0000000000a2', current_date, 2)$$);
select t.denied('adminB edit dept A user', $$select public.update_profile('00000000-0000-0000-0000-0000000000a2', 'x', 'OPR-A2', 1)$$);
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
select t.denied('super_admin cannot set overtime', $$select public.set_overtime('00000000-0000-0000-0000-0000000000a2', current_date, 2)$$);
select t.denied('super_admin cannot set holiday', $$select public.set_holiday(current_date, true)$$);
select t.denied('super_admin cannot edit user data', $$select public.update_profile('00000000-0000-0000-0000-0000000000a2', 'x', 'OPR-A2', 1)$$);
select t.denied('super_admin cannot delete a plain user', $$select public.soft_delete_user('00000000-0000-0000-0000-0000000000a2')$$);
select t.ok('super_admin creates department', $$select public.create_department('Dept C')$$);
select t.ok('super_admin renames department', $$select public.rename_department('10000000-0000-0000-0000-00000000000b', 'Dept B2')$$);
select t.denied('duplicate department name rejected', $$select public.create_department('Dept A')$$, '23505');
select t.ok('super_admin promotes user across depts', $$select public.set_user_role('00000000-0000-0000-0000-0000000000b2', 'admin')$$);
select t.ok('super_admin demotes admin across depts', $$select public.set_user_role('00000000-0000-0000-0000-0000000000b2', 'user')$$);
select t.ok('super_admin demotes admin B', $$select public.set_user_role('00000000-0000-0000-0000-0000000000b1', 'user')$$);
select t.denied('super_admin cannot demote self/super_admin via RPC', $$select public.set_user_role('00000000-0000-0000-0000-0000000000a0', 'user')$$);
select t.ok('super_admin may create admin in any dept', $$select public.assert_can_create('10000000-0000-0000-0000-00000000000a', 'admin')$$);
select t.denied('super_admin may not create plain user', $$select public.assert_can_create('10000000-0000-0000-0000-00000000000a', 'user')$$);
select t.ok('super_admin may reset an admin password', $$select public.assert_can_manage('00000000-0000-0000-0000-0000000000a1', 'reset')$$);
select t.denied('super_admin may not reset a plain user password', $$select public.assert_can_manage('00000000-0000-0000-0000-0000000000a2', 'reset')$$);
select t.denied('super_admin direct UPDATE profiles', $$update public.profiles set role = 'super_admin'$$);
select t.ok('super_admin soft-deletes an admin', $$select public.soft_delete_user('00000000-0000-0000-0000-0000000000a1')$$);

-- ---------------------------------------------------------------- last super_admin guard (owner / service-role path)
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
