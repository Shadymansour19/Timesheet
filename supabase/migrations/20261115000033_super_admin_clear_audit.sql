create or replace function public.clear_all_audit_before(p_before timestamptz)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count bigint;
begin
  if not exists (
    select 1 from public.profiles
     where id = auth.uid() and active and role = 'super_admin'
  ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_before is null then
    raise exception 'invalid cutoff' using errcode = '22023';
  end if;

  delete from public.audit_log where at < p_before;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.clear_all_audit_before(timestamptz) from public, anon;
grant execute on function public.clear_all_audit_before(timestamptz) to authenticated;