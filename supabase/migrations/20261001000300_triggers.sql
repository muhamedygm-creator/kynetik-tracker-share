-- Row bookkeeping, audit log, realtime pings, and invite → profile.

-- ───────────── updated_at + optimistic version ─────────────
-- Every UPDATE bumps `version`. The app updates with `... where id = $1 and version = $2`;
-- zero rows affected means somebody else saved first (fixes §18-3: no silent last-write-wins).
create or replace function private.touch_row() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  new.version := old.version + 1;
  return new;
end $$;

do $$
declare t text;
begin
  for t in
    select c.table_name from information_schema.columns c
    join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name
    where c.table_schema = 'public' and c.column_name = 'version' and tb.table_type = 'BASE TABLE'
  loop
    execute format('create trigger touch_row before update on public.%I for each row execute function private.touch_row()', t);
  end loop;
end $$;

-- ───────────── audit ─────────────
-- Tables whose rows are owner-only: their audit entries are flagged sensitive (owner-only too).
create or replace function private.audit_sensitive(tbl text) returns boolean
language sql immutable as $$
  select tbl in ('settings_cost', 'people_cost', 'hour_log_cost', 'displays', 'invitations')
$$;

create or replace function private.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  b jsonb; a jsonb; k text;
  bd jsonb := '{}'; ad jsonb := '{}';
  noise text[] := array['updated_at', 'version', 'token_hash'];
  rid text; pid uuid;
begin
  if coalesce(current_setting('app.skip_audit', true), '') = 'on' then
    return null;
  end if;

  if tg_op in ('UPDATE', 'DELETE') then b := to_jsonb(old) - noise; end if;
  if tg_op in ('UPDATE', 'INSERT') then a := to_jsonb(new) - noise; end if;

  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(a) loop
      if (b -> k) is distinct from (a -> k) then
        bd := bd || jsonb_build_object(k, b -> k);
        ad := ad || jsonb_build_object(k, a -> k);
      end if;
    end loop;
    if ad = '{}'::jsonb then return null; end if;   -- nothing really changed
    b := bd; a := ad;
  end if;

  rid := coalesce(to_jsonb(coalesce(new, old)) ->> 'id',
                  to_jsonb(coalesce(new, old)) ->> 'key',
                  to_jsonb(coalesce(new, old)) ->> 'user_id',
                  to_jsonb(coalesce(new, old)) ->> 'task_id',
                  to_jsonb(coalesce(new, old)) ->> 'person_id',
                  to_jsonb(coalesce(new, old)) ->> 'log_id',
                  to_jsonb(coalesce(new, old)) ->> 'day');
  pid := case when tg_table_name = 'projects' then (to_jsonb(coalesce(new, old)) ->> 'id')::uuid
              else (to_jsonb(coalesce(new, old)) ->> 'project_id')::uuid end;

  insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, project_id, before, after, sensitive)
  values (auth.uid(), private.current_role(), lower(tg_op), tg_table_name, rid, pid, b, a,
          private.audit_sensitive(tg_table_name));
  return null;
end $$;

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' and tablename <> 'audit_log' loop
    execute format('create trigger audit_row after insert or update or delete on public.%I for each row execute function private.audit_row()', t);
  end loop;
end $$;

-- Domain-level actions with a readable label (e.g. 'rebaseline', 'rework'), called by the app.
create or replace function public.audit_action(p_action text, p_entity text, p_entity_id text, p_project_id uuid, p_label text, p_details jsonb default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.can_write() then raise exception 'Read-only access.' using errcode = '42501'; end if;
  insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, project_id, label, after)
  values (auth.uid(), private.current_role(), p_action, p_entity, p_entity_id, p_project_id, p_label, p_details);
end $$;
revoke all on function public.audit_action(text, text, text, uuid, text, jsonb) from public, anon;
grant execute on function public.audit_action(text, text, text, uuid, text, jsonb) to authenticated;

-- ───────────── realtime "something changed" ping ─────────────
-- Statement-level, so a bulk update sends one ping. The payload carries NO row data —
-- clients refetch through their own permission path (RLS for the console, the display route for TVs).
create or replace function private.notify_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  begin
    perform realtime.send(jsonb_build_object('table', tg_table_name, 'op', lower(tg_op)), 'changed', 'kynetik-changes', false);
  exception when others then
    null;  -- realtime must never block a write
  end;
  return null;
end $$;

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' and tablename <> 'audit_log' loop
    execute format('create trigger notify_change after insert or update or delete on public.%I for each statement execute function private.notify_change()', t);
  end loop;
end $$;

-- ───────────── invite → profile ─────────────
-- Only invited emails get a profile. Anyone else who somehow gets an auth user has no role and sees nothing.
create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare inv public.invitations;
begin
  select * into inv from public.invitations where lower(email) = lower(new.email);
  if found then
    insert into public.profiles (user_id, email, name, role)
    values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)), inv.role)
    on conflict (user_id) do nothing;
    update public.invitations set accepted_at = coalesce(accepted_at, now()) where id = inv.id;
  end if;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- An invitation created for someone who already has an auth user takes effect immediately.
create or replace function private.apply_invitation() returns trigger
language plpgsql security definer set search_path = '' as $$
declare u auth.users;
begin
  select * into u from auth.users where lower(email) = lower(new.email);
  if found then
    insert into public.profiles (user_id, email, name, role)
    values (u.id, u.email, split_part(u.email, '@', 1), new.role)
    on conflict (user_id) do update set role = excluded.role, active = true;
    new.accepted_at := coalesce(new.accepted_at, now());
  end if;
  return new;
end $$;

create trigger apply_invitation before insert on public.invitations
  for each row execute function private.apply_invitation();

-- ───────────── always keep one active owner ─────────────
create or replace function private.guard_last_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles where role = 'owner' and active) then
    raise exception 'There must always be at least one active Owner.' using errcode = 'P0001';
  end if;
  return null;
end $$;

create constraint trigger guard_last_owner after update or delete on public.profiles
  deferrable initially immediate
  for each row execute function private.guard_last_owner();
