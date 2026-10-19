-- Phase 3.5: departments, employee photos, per-employee task queue, department displays (docs/PLAN.md §7).

-- New settings section.
alter table public.settings drop constraint if exists settings_key_check;
alter table public.settings add constraint settings_key_check
  check (key in ('calendar','booking','health','scoring','labels','brand','floor','timeline','gamification'));

-- Attach the standard row triggers (version bump, audit, realtime ping) to a table created after the first migrations.
create or replace function private.standard_triggers(tbl text) returns void
language plpgsql as $$
begin
  execute format('alter table public.%I enable row level security', tbl);
  execute format('alter table public.%I force row level security', tbl);
  execute format('create trigger touch_row before update on public.%I for each row execute function private.touch_row()', tbl);
  execute format('create trigger audit_row after insert or update or delete on public.%I for each row execute function private.audit_row()', tbl);
  execute format('create trigger notify_change after insert or update or delete on public.%I for each statement execute function private.notify_change()', tbl);
  execute format('revoke all on public.%I from anon', tbl);
  execute format('grant select, insert, update, delete on public.%I to authenticated', tbl);
  execute format('grant all on public.%I to service_role', tbl);
end $$;

-- Members read, owner/supervisor write (same as the standard tables).
create or replace function private.member_policies(tbl text) returns void
language plpgsql as $$
begin
  execute format('create policy %I on public.%I for select to authenticated using (private.is_member())', tbl || '_read', tbl);
  execute format('create policy %I on public.%I for insert to authenticated with check (private.can_write())', tbl || '_insert', tbl);
  execute format('create policy %I on public.%I for update to authenticated using (private.can_write()) with check (private.can_write())', tbl || '_update', tbl);
  execute format('create policy %I on public.%I for delete to authenticated using (private.can_write())', tbl || '_delete', tbl);
end $$;

-- ───────────── departments ─────────────
create table public.departments (
  id         uuid primary key default gen_random_uuid(),
  key        text not null unique check (key ~ '^[a-z][a-z0-9_-]*$'),
  name       text not null check (length(trim(name)) > 0),
  colour     text not null check (colour ~ '^#[0-9A-Fa-f]{6}$'),
  emoji      text not null default '',
  sort       integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version    integer not null default 1
);
select private.standard_triggers('departments');
select private.member_policies('departments');

alter table public.people
  add column department_id uuid references public.departments (id) on delete set null,
  add column photo_path text;
create index people_department_idx on public.people (department_id);

-- ───────────── task queue ─────────────
create type public.duration_unit as enum ('hours', 'days');

create table public.queue_tasks (
  id           uuid primary key default gen_random_uuid(),
  person_id    uuid not null references public.people (id) on delete cascade,
  title        text not null check (length(trim(title)) > 0),
  dur_value    numeric(8,2) not null check (dur_value > 0),
  dur_unit     public.duration_unit not null default 'hours',
  project_id   uuid references public.projects (id) on delete set null,
  stage_id     uuid references public.stages (id) on delete set null,
  work_item_id uuid references public.work_items (id) on delete set null,
  notes        text not null default '',
  colour       text check (colour is null or colour ~ '^#[0-9A-Fa-f]{6}$'),
  fixed_start  timestamptz,
  -- Fractional index (byte order): reordering writes only the moved row.
  position     text collate "C" not null,
  status       public.item_status not null default 'todo',
  actual_start timestamptz,
  actual_end   timestamptz,
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  version      integer not null default 1,
  unique (person_id, position),
  check (actual_end is null or actual_start is null or actual_start <= actual_end)
);
create index queue_tasks_person_idx on public.queue_tasks (person_id, position);
create index queue_tasks_work_item_idx on public.queue_tasks (work_item_id) where work_item_id is not null;
select private.standard_triggers('queue_tasks');
select private.member_policies('queue_tasks');

-- ───────────── displays: one department per link ─────────────
create type public.leaderboard_mode as enum ('side', 'rotate', 'off');
alter table public.displays
  add column department_id uuid references public.departments (id) on delete set null,
  add column leaderboard_mode public.leaderboard_mode not null default 'side',
  add column confetti boolean not null default true;

-- ───────────── employee photos (Supabase Storage) ─────────────
-- Private bucket; members read, owner/supervisor write. Guarded so the migration also runs where Storage isn't installed (tests).
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('people-photos', 'people-photos', false, 1048576, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do nothing;
    execute $p$create policy people_photos_read on storage.objects for select to authenticated
      using (bucket_id = 'people-photos' and private.is_member())$p$;
    execute $p$create policy people_photos_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'people-photos' and private.can_write())$p$;
    execute $p$create policy people_photos_update on storage.objects for update to authenticated
      using (bucket_id = 'people-photos' and private.can_write())$p$;
    execute $p$create policy people_photos_delete on storage.objects for delete to authenticated
      using (bucket_id = 'people-photos' and private.can_write())$p$;
  end if;
end $$;
