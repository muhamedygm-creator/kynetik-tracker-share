-- Kynetik Build Tracker v2 — core schema.
-- See docs/PLAN.md §2. Cost data lives ONLY in the *_cost tables (owner-only, see RLS migration).
-- Datetimes are timestamptz; the shop timezone is a setting (calendar.timezone, default Asia/Dubai).

create extension if not exists pgcrypto;

create schema if not exists private;

-- ───────────────────────────── enums ─────────────────────────────
create type public.app_role      as enum ('owner', 'supervisor', 'viewer');
create type public.item_status   as enum ('todo', 'doing', 'blocked', 'done');
create type public.project_status as enum ('planned', 'active', 'hold', 'done');
create type public.cost_class    as enum ('production', 'admin');

-- ───────────────────────────── access ─────────────────────────────
create table public.profiles (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  email      text not null,
  name       text not null default '',
  role       public.app_role not null default 'viewer',
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version    integer not null default 1
);
create unique index profiles_email_key on public.profiles (lower(email));

create table public.invitations (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  role        public.app_role not null,
  invited_by  uuid references auth.users (id) on delete set null,
  accepted_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  version     integer not null default 1
);
create unique index invitations_email_key on public.invitations (lower(email));

-- ───────────────────────────── config ─────────────────────────────
-- One row per settings section; value is validated by the Zod schema in domain/settings.ts.
create table public.settings (
  key        text primary key check (key in ('calendar','booking','health','scoring','labels','brand','floor','timeline')),
  value      jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version    integer not null default 1
);

-- Cost settings: owner-only. Single row.
create table public.settings_cost (
  id                     boolean primary key default true check (id),
  currency               text not null default 'AED',
  default_loading_pct    numeric(6,2) not null default 25 check (default_loading_pct >= 0),
  working_days_per_month numeric(5,2) not null default 26 check (working_days_per_month > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version    integer not null default 1
);

create table public.holidays (
  day        date primary key,
  name       text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version    integer not null default 1
);

create table public.station_types (
  key        text primary key check (key ~ '^[a-z][a-z0-9_-]*$'),
  label      text not null,
  colour     text not null check (colour ~ '^#[0-9A-Fa-f]{6}$'),
  sort       integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version    integer not null default 1
);

create table public.displays (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  token_hash    text not null unique,            -- sha256 hex of the secret token; the token itself is never stored
  screens       jsonb not null default '[]',     -- [{type, seconds, enabled}]
  filters       jsonb not null default '{}',     -- {projectIds?, stationIds?, stationTypes?}
  leaderboard   jsonb not null default '{"show": false, "anonymous": true}',
  announcement  text not null default '',
  announcement_on boolean not null default false,
  revoked_at    timestamptz,
  last_seen_at  timestamptz,
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  version       integer not null default 1
);

-- ───────────────────────────── shop ─────────────────────────────
create table public.workstations (
  id           uuid primary key default gen_random_uuid(),
  legacy_id    text unique,
  name         text not null,
  station_type text not null references public.station_types (key) on update cascade,
  sort         integer not null default 0,
  active       boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version    integer not null default 1
);

create table public.people (
  id         uuid primary key default gen_random_uuid(),
  legacy_id  text unique,
  name       text not null,
  crew       text not null default '',          -- station type key | 'design' | 'admin' | ''
  cost_class public.cost_class not null default 'production',
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version    integer not null default 1
);

-- Owner-only: salary & loading.
create table public.people_cost (
  person_id   uuid primary key references public.people (id) on delete cascade,
  base_salary numeric(12,2) not null default 0 check (base_salary >= 0),   -- per month, in settings_cost.currency
  loading_pct numeric(6,2) check (loading_pct >= 0),                        -- null → settings_cost.default_loading_pct
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version    integer not null default 1
);

-- ───────────────────────────── templates ─────────────────────────────
create table public.templates (
  id         uuid primary key default gen_random_uuid(),
  key        text not null unique,
  label      text not null,
  archived   boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version    integer not null default 1
);

create table public.template_stages (
  id           uuid primary key default gen_random_uuid(),
  template_id  uuid not null references public.templates (id) on delete cascade,
  name         text not null,
  station_type text not null references public.station_types (key) on update cascade,
  part_hours   numeric(8,2) not null default 0 check (part_hours >= 0),
  sort         integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version    integer not null default 1,
  unique (template_id, name)
);

create table public.template_tasks (
  id                uuid primary key default gen_random_uuid(),
  template_id       uuid not null references public.templates (id) on delete cascade,
  template_stage_id uuid not null references public.template_stages (id) on delete cascade,
  name              text not null,
  dur_h             numeric(8,2) not null check (dur_h > 0),
  sort              integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version    integer not null default 1
);

create table public.template_parts (
  id          uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.templates (id) on delete cascade,
  name        text not null,
  sort        integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version    integer not null default 1,
  unique (template_id, name)
);

-- ───────────────────────────── builds ─────────────────────────────
create table public.projects (
  id             uuid primary key default gen_random_uuid(),
  legacy_id      text unique,
  serial         text not null check (length(trim(serial)) > 0),
  name           text not null default '',
  template_id    uuid references public.templates (id) on delete set null,  -- §18-4: deleting a template never breaks a build
  template_label text not null default '',
  client         text not null default '',
  notes          text not null default '',
  start_date     date not null,
  delivery_date  date,
  status         public.project_status not null default 'planned',
  delivered_on   date,
  plan_end       timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version    integer not null default 1
);
create unique index projects_serial_key on public.projects (lower(serial));

create table public.stages (
  id           uuid primary key default gen_random_uuid(),
  legacy_id    text,
  project_id   uuid not null references public.projects (id) on delete cascade,
  name         text not null,
  station_type text not null references public.station_types (key) on update cascade,
  station_id   uuid references public.workstations (id) on delete set null,
  part_hours   numeric(8,2) not null default 0 check (part_hours >= 0),
  sort         integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version    integer not null default 1
);
create index stages_project_idx on public.stages (project_id);

-- §18-7: history is keyed by part id, so renaming keeps it.
create table public.parts (
  id         uuid primary key default gen_random_uuid(),
  legacy_id  text,
  project_id uuid not null references public.projects (id) on delete cascade,
  name       text not null check (length(trim(name)) > 0),
  notes      text not null default '',
  sort       integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version    integer not null default 1
);
create unique index parts_project_name_key on public.parts (project_id, lower(name));

create table public.tasks (
  id           uuid primary key default gen_random_uuid(),
  legacy_id    text,
  project_id   uuid not null references public.projects (id) on delete cascade,
  stage_id     uuid not null references public.stages (id) on delete cascade,
  num          integer not null,
  name         text not null,
  assignee     uuid references public.people (id) on delete set null,
  status       public.item_status not null default 'todo',
  dur_h        numeric(8,2) not null check (dur_h > 0),
  pct          numeric(5,2) not null default 0 check (pct between 0 and 100),
  plan_start   timestamptz,
  plan_end     timestamptz,
  pinned_start timestamptz,
  actual_start timestamptz,
  actual_end   timestamptz,
  notes        text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version    integer not null default 1
);
create index tasks_project_idx on public.tasks (project_id, num);

create table public.baselines (
  task_id    uuid primary key references public.tasks (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  start_at   timestamptz not null,
  end_at     timestamptz not null,
  set_at     timestamptz not null default now(),
  set_by     uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version    integer not null default 1
);
create index baselines_project_idx on public.baselines (project_id);

-- One part in one stage (v1 work[stageId][partId]).
create table public.work_items (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  stage_id   uuid not null references public.stages (id) on delete cascade,
  part_id    uuid not null references public.parts (id) on delete cascade,
  status     public.item_status not null default 'todo',
  tech_id    uuid references public.people (id) on delete set null,
  start_at   timestamptz,
  end_at     timestamptz,
  seg_start  timestamptz,
  plan_h     numeric(8,2) check (plan_h >= 0),     -- override of stage part_hours
  rework     integer not null default 0 check (rework >= 0),
  notes      text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version    integer not null default 1,
  unique (stage_id, part_id),
  check (end_at is null or start_at is null or start_at <= end_at)
);
create index work_items_project_idx on public.work_items (project_id);
create index work_items_tech_idx on public.work_items (tech_id) where tech_id is not null;

-- v1 prevSegs: closed time segments from before a rework.
create table public.work_segments (
  id           uuid primary key default gen_random_uuid(),
  work_item_id uuid not null references public.work_items (id) on delete cascade,
  project_id   uuid not null references public.projects (id) on delete cascade,
  tech_id      uuid references public.people (id) on delete set null,
  start_at     timestamptz not null,
  end_at       timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version    integer not null default 1,
  check (start_at <= end_at)
);
create index work_segments_item_idx on public.work_segments (work_item_id);

create table public.rework_log (
  id           uuid primary key default gen_random_uuid(),
  work_item_id uuid not null references public.work_items (id) on delete cascade,
  project_id   uuid not null references public.projects (id) on delete cascade,
  at           timestamptz not null default now(),
  reason       text not null check (length(trim(reason)) > 0),
  by_user      uuid references auth.users (id) on delete set null,
  by_role      public.app_role,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version    integer not null default 1
);
create index rework_log_item_idx on public.rework_log (work_item_id);

-- ───────────────────────────── floor log ─────────────────────────────
-- A missing row means "In" (v1 default).
create table public.attendance (
  day        date not null,
  person_id  uuid not null references public.people (id) on delete cascade,
  present    boolean not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version    integer not null default 1,
  primary key (day, person_id)
);

create table public.hour_logs (
  id           uuid primary key default gen_random_uuid(),
  day          date not null,
  person_id    uuid not null references public.people (id) on delete cascade,
  work_item_id uuid not null references public.work_items (id) on delete cascade,
  project_id   uuid not null references public.projects (id) on delete cascade,
  hours        numeric(6,2) not null check (hours > 0),
  created_by   uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version    integer not null default 1
);
create index hour_logs_day_idx on public.hour_logs (day);
create index hour_logs_item_idx on public.hour_logs (work_item_id);

-- Owner-only: hour rate snapshotted at logging time (§13).
create table public.hour_log_cost (
  log_id     uuid primary key references public.hour_logs (id) on delete cascade,
  rate       numeric(12,4) not null check (rate >= 0),
  cost       numeric(12,2) not null check (cost >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version    integer not null default 1
);

-- ───────────────────────────── audit ─────────────────────────────
create table public.audit_log (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  actor_id   uuid references auth.users (id) on delete set null,
  actor_role public.app_role,
  action     text not null,         -- insert | update | delete | or a domain action like 'rebaseline'
  entity     text not null,         -- table name
  entity_id  text,
  project_id uuid,
  label      text not null default '',
  before     jsonb,
  after      jsonb,
  sensitive  boolean not null default false
);
create index audit_log_at_idx on public.audit_log (at desc);
create index audit_log_entity_idx on public.audit_log (entity, entity_id);
create index audit_log_project_idx on public.audit_log (project_id) where project_id is not null;

-- ───────────────────────────── views ─────────────────────────────
-- Hours per work item (non-cost; everyone can read).
create view public.work_item_hours with (security_invoker = true) as
  select work_item_id,
         sum(person_hours)::numeric(10,2) as hours,
         jsonb_object_agg(person_id, person_hours) as hours_by
  from (
    select work_item_id, person_id, sum(hours) as person_hours
    from public.hour_logs group by work_item_id, person_id
  ) s
  group by work_item_id;

-- Cost per work item and per build (owner-only via the underlying hour_log_cost RLS).
create view public.work_item_cost with (security_invoker = true) as
  select l.work_item_id, sum(c.cost)::numeric(12,2) as cost
  from public.hour_logs l join public.hour_log_cost c on c.log_id = l.id
  group by l.work_item_id;

create view public.project_labour with (security_invoker = true) as
  select l.project_id, sum(c.cost)::numeric(12,2) as labour
  from public.hour_logs l join public.hour_log_cost c on c.log_id = l.id
  group by l.project_id;
