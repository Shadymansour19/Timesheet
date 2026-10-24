-- DEPARTURE position. By default a departure sits on the first REST day (E) after a working period. A person (or the admin) may move
-- it back to the LAST WORKING DAY of that period: one row (user_id, work_day) = "the departure of the period that ends on work_day
-- is shown on work_day itself". Removing the row puts it back on the rest day. Written only through set_departure_move.
create table public.departure_moves (
  user_id uuid not null references public.profiles (id) on delete cascade,
  work_day date not null,
  moved_by uuid,
  moved_at timestamptz not null default now(),
  primary key (user_id, work_day)
);
alter table public.departure_moves enable row level security;
create policy departure_moves_select on public.departure_moves for select to authenticated
  using (
    (user_id = auth.uid() and (select public.app_role()) is not null)
    or ((select public.app_role()) = 'admin' and public.dept_of(user_id) = (select public.app_dept()))
  );
revoke all on public.departure_moves from anon, authenticated;
grant select on public.departure_moves to authenticated;

-- same authorisation as set_day_status: a user for himself (inside the edit window), an admin for his department (super admin acting
-- as that admin included). The day must be a working day (X / Y).
create function public.set_departure_move(p_user uuid, p_day date, p_on boolean) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_role text := public.app_role();
  v_win int;
begin
  if v_role = 'user' then
    if p_user is distinct from auth.uid() then
      raise exception 'not authorized' using errcode = '42501';
    end if;
    select (value #>> '{}')::int into v_win from public.settings where key = 'user_edit_window_days';
    if v_win is not null and p_day < current_date - v_win then
      raise exception 'day is outside the edit window' using errcode = '42501';
    end if;
  elsif v_role = 'admin' then
    if public.dept_of(p_user) is distinct from public.app_dept() then
      raise exception 'not authorized' using errcode = '42501';
    end if;
  else
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_user and active) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_on then
    if not exists (select 1 from public.day_status where user_id = p_user and day = p_day) then
      raise exception 'only a working day can carry the departure' using errcode = '22023';
    end if;
    insert into public.departure_moves (user_id, work_day, moved_by) values (p_user, p_day, auth.uid())
      on conflict (user_id, work_day) do update set moved_by = excluded.moved_by, moved_at = now();
  else
    delete from public.departure_moves where user_id = p_user and work_day = p_day;
  end if;
end $$;
revoke all on function public.set_departure_move(uuid, date, boolean) from public, anon;
grant execute on function public.set_departure_move(uuid, date, boolean) to authenticated;
