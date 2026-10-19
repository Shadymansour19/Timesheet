-- Core schema. All client writes go through SECURITY DEFINER RPCs (see 0003);
-- clients only ever get SELECT, filtered by RLS (see 0002).

-- No implicit grants for objects created later in public.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated;

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(btrim(name)) > 0),
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9._-]{3,32}$'),
  full_name text not null check (length(btrim(full_name)) > 0),
  opr text,
  level integer check (level is null or level >= 0),
  department_id uuid references public.departments (id),
  role text not null default 'user' check (role in ('user', 'admin', 'super_admin')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  -- super_admin has no department; everyone else must have one and an OPR
  check ((role = 'super_admin') = (department_id is null)),
  check (role = 'super_admin' or opr is not null)
);
-- OPR unique among active people; a soft-deleted person's OPR can be reused.
create unique index profiles_opr_active_key on public.profiles (opr) where active and opr is not null;
create index profiles_department_idx on public.profiles (department_id);

create table public.settings (
  key text primary key,
  value jsonb not null
);
-- NULL = users may edit any past day. Integer N = users may edit days >= today - N.
insert into public.settings (key, value) values ('user_edit_window_days', 'null'::jsonb);

-- Missing row = 'E'. RPC deletes the row when status is set back to E.
create table public.day_status (
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  status text not null check (status in ('X', 'Y', 'E')),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

create table public.holidays (
  department_id uuid not null references public.departments (id) on delete cascade,
  day date not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  primary key (department_id, day)
);

create table public.overtime (
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  hours smallint not null check (hours between 0 and 24),
  note text,
  entered_by uuid,
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid,
  table_name text not null,
  department_id uuid,
  target_user uuid,
  day date,
  field text,
  old_value text,
  new_value text
);
create index audit_log_dept_at_idx on public.audit_log (department_id, at desc);
