-- MANUAL, run once by the project owner in the Supabase SQL editor. NOT a migration.
--
-- 1. Dashboard -> Authentication -> Users -> Add user:
--      email    = <username>@timesheet.local   (must match the username below)
--      password = a strong password
--      tick "Auto Confirm User"
-- 2. Replace the two values below, then run:

insert into public.profiles (id, username, full_name, role)
select id, 'CHANGE_ME_USERNAME', 'CHANGE ME FULL NAME', 'super_admin'
  from auth.users
 where email = 'CHANGE_ME_USERNAME@timesheet.local';

-- Expect: INSERT 0 1
