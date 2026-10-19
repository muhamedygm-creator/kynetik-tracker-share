-- Roles & Row Level Security.
--   owner      → everything, including cost tables
--   supervisor → read/write everything except cost tables (which it cannot even read)
--   viewer     → read-only, no cost
--   anon       → nothing. The shop-floor display reads through a server route with the service role.

-- Current user's role, or null if the user has no active profile (uninvited / deactivated).
create or replace function private.current_role() returns public.app_role
language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p where p.user_id = auth.uid() and p.active
$$;

create or replace function private.is_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.current_role() is not null
$$;

create or replace function private.can_write() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.current_role() in ('owner', 'supervisor'), false)
$$;

create or replace function private.is_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.current_role() = 'owner', false)
$$;

grant usage on schema private to authenticated;
grant execute on function private.current_role(), private.is_member(), private.can_write(), private.is_owner() to authenticated;

-- Small RPC so the app can show "Owner · costs visible" etc. without reading profiles.
create or replace function public.my_role() returns public.app_role
language sql stable security definer set search_path = '' as $$ select private.current_role() $$;
revoke all on function public.my_role() from public, anon;
grant execute on function public.my_role() to authenticated;

-- ───────────── grants: anon gets nothing; authenticated gets table privileges, RLS decides rows ─────────────
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage on all sequences in schema public to authenticated;
-- The audit log is written only by triggers.
revoke insert, update, delete on public.audit_log from authenticated;
-- Hour-log cost rows are written only by SECURITY DEFINER functions (phase 4) or the owner.

-- ───────────── enable RLS everywhere ─────────────
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end $$;

-- ───────────── standard tables: members read, owner/supervisor write ─────────────
do $$
declare t text;
begin
  foreach t in array array[
    'settings','holidays','station_types','workstations','people',
    'templates','template_stages','template_tasks','template_parts',
    'projects','stages','parts','tasks','baselines','work_items','work_segments','rework_log',
    'attendance','hour_logs'
  ] loop
    execute format('create policy %I on public.%I for select to authenticated using (private.is_member())', t || '_read', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (private.can_write())', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (private.can_write()) with check (private.can_write())', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (private.can_write())', t || '_delete', t);
  end loop;
end $$;

-- ───────────── owner-only tables (cost + admin) ─────────────
do $$
declare t text;
begin
  foreach t in array array['settings_cost','people_cost','hour_log_cost','invitations','displays'] loop
    execute format('create policy %I on public.%I for all to authenticated using (private.is_owner()) with check (private.is_owner())', t || '_owner', t);
  end loop;
end $$;

-- ───────────── profiles ─────────────
-- Members can see who is who (names in the audit log); only the owner changes roles.
create policy profiles_read on public.profiles for select to authenticated
  using (private.is_member() or user_id = auth.uid());
create policy profiles_owner_write on public.profiles for update to authenticated
  using (private.is_owner()) with check (private.is_owner());
create policy profiles_owner_delete on public.profiles for delete to authenticated
  using (private.is_owner());
-- Inserts happen only in the auth.users trigger (security definer).

-- ───────────── audit log ─────────────
-- Rows that touch cost tables are flagged sensitive and visible to the owner only.
create policy audit_read on public.audit_log for select to authenticated
  using (private.is_member() and (not sensitive or private.is_owner()));
