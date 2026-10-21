-- A super_admin may ACT AS the admin of any department.
-- The browser tells the API which department by sending the request header "x-acting-dept: <uuid>" (PostgREST exposes it as
-- request.headers). It is honoured ONLY when the caller really is an active super_admin and the department exists; for anyone
-- else it is ignored. While a valid header is present, app_role() answers 'admin' and app_dept() answers that department, so
-- every existing admin policy / RPC applies unchanged (an acting super_admin can do exactly what that department's admin can,
-- and nothing more). Without the header nothing changes: super_admin keeps managing departments and admins only.

create function public.real_role() returns text
language sql stable security definer set search_path = ''
as $$ select role from public.profiles where id = auth.uid() and active $$;

create function public.acting_dept() returns uuid
language plpgsql stable security definer set search_path = ''
as $$
declare h text; d uuid;
begin
  begin
    h := (current_setting('request.headers', true))::json ->> 'x-acting-dept';
  exception when others then
    return null;
  end;
  if h is null or h !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then return null; end if;
  if public.real_role() is distinct from 'super_admin' then return null; end if;
  select id into d from public.departments where id = h::uuid;
  return d;
end $$;

create or replace function public.app_role() returns text
language sql stable security definer set search_path = ''
as $$
  select case when role = 'super_admin' and public.acting_dept() is not null then 'admin' else role end
    from public.profiles where id = auth.uid() and active
$$;

create or replace function public.app_dept() returns uuid
language sql stable security definer set search_path = ''
as $$
  select case when role = 'super_admin' then coalesce(public.acting_dept(), department_id) else department_id end
    from public.profiles where id = auth.uid() and active
$$;

-- live channels: a super_admin may listen to any department's channels (it can read the same data while acting)
drop policy rt_receive on realtime.messages;
create policy rt_receive on realtime.messages for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (
      (select realtime.topic()) = 'user:' || (select auth.uid())::text
      or (select realtime.topic()) = 'deptpub:' || (select public.app_dept())::text
      or ((select realtime.topic()) = 'dept:' || (select public.app_dept())::text and (select public.app_role()) = 'admin')
      or ((select public.real_role()) = 'super_admin' and (select realtime.topic()) ~ '^(dept|deptpub):[0-9a-fA-F-]{36}$')
    )
  );

revoke all on function public.real_role(), public.acting_dept() from public, anon;
grant execute on function public.real_role(), public.acting_dept() to authenticated;
