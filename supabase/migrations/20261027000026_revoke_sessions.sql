-- Sign a person out of EVERY device (used by the Edge Function after an admin resets their password). Deleting the sessions also deletes their refresh tokens,
-- so no device can renew its login; an access token already issued works until it expires (an hour at most). Only the service role may call it.
create function public.revoke_user_sessions(p_user uuid) returns integer
language plpgsql security definer set search_path = ''
as $$
declare n integer;
begin
  delete from auth.sessions where user_id = p_user;
  get diagnostics n = row_count;
  delete from auth.refresh_tokens where user_id = p_user::text;
  return n;
end $$;
revoke all on function public.revoke_user_sessions(uuid) from public, anon, authenticated;
grant execute on function public.revoke_user_sessions(uuid) to service_role;
