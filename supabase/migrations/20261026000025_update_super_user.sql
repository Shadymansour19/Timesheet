-- Super admins and super managers (no department) can fix their own name / OPR; a super admin can also edit any other super user.
create function public.update_super_user(p_user uuid, p_full_name text, p_opr text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_real text := public.real_role();
begin
  if v_real is null or v_real not in ('super_admin', 'super_manager')
     or (v_real = 'super_manager' and p_user is distinct from auth.uid()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_full_name is null or length(btrim(p_full_name)) = 0 or length(p_full_name) > 200 or length(coalesce(p_opr, '')) > 50 then
    raise exception 'invalid name or OPR' using errcode = '22023';
  end if;
  update public.profiles set full_name = btrim(p_full_name), opr = nullif(btrim(p_opr), '')
   where id = p_user and active and role in ('super_admin', 'super_manager');
  if not found then
    raise exception 'not authorized' using errcode = '42501';
  end if;
end $$;
revoke all on function public.update_super_user(uuid, text, text) from public, anon;
grant execute on function public.update_super_user(uuid, text, text) to authenticated;
