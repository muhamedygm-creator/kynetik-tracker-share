-- v1 (docs/ROADMAP.md): week planner priority flag and department TV notices.

-- ───────────── week planner: urgent flag on a plan task ─────────────
alter table public.queue_tasks
  add column priority text not null default 'normal' check (priority in ('normal', 'urgent'));

-- ───────────── TV notices ─────────────
-- Shown on the department TV, rotating in the header. Either a message, or a daily countdown
-- ("Quality check in 25 min") when daily_at is set. department_id null = every department.
create table public.notices (
  id            uuid primary key default gen_random_uuid(),
  department_id uuid references public.departments (id) on delete cascade,
  icon          text not null default '📢',
  title         text not null check (length(trim(title)) > 0),
  detail        text not null default '',
  daily_at      time,
  starts_on     date,
  ends_on       date,
  active        boolean not null default true,
  sort          integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  version       integer not null default 1,
  check (ends_on is null or starts_on is null or starts_on <= ends_on)
);
create index notices_department_idx on public.notices (department_id);

select private.standard_triggers('notices');
select private.member_policies('notices');
