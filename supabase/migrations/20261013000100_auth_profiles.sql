-- Public profile records are deliberately private. User lookup and all admin
-- operations go through Edge Functions using the server-only service role key.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique,
  role text not null default 'member' check (role in ('member', 'super_admin')),
  created_by_admin boolean not null default false,
  created_at timestamptz not null default now(),
  constraint profiles_username_format check (username ~ '^[a-z0-9_]{3,24}$')
);

alter table public.profiles enable row level security;
revoke all on table public.profiles from anon, authenticated;
grant all on table public.profiles to service_role;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_username text;
begin
  normalized_username := nullif(
    pg_catalog.lower(pg_catalog.btrim(new.raw_user_meta_data ->> 'username')),
    ''
  );

  if normalized_username is null or normalized_username !~ '^[a-z0-9_]{3,24}$' then
    raise exception 'A valid username (3-24 letters, numbers, or underscores) is required.';
  end if;

  insert into public.profiles (id, username)
  values (new.id, normalized_username);
  return new;
end;
$$;

revoke all on function public.handle_new_auth_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_auth_user();
