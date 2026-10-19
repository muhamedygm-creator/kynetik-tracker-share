-- v2 Crew portal (docs/ux/DECISIONS.md 2026-10-07): Crew and Technicians in one place, work-type tags
-- Full time / Project based (Owner's choice), contract dates and the builds a project-based person is on,
-- plus contact and skills. No pay here: pay stays in the owner-only people_cost table.
alter table public.people
  add column employment   text not null default 'full_time' check (employment in ('full_time', 'project_based')),
  add column contract_from date,
  add column contract_to   date,
  add column phone         text not null default '',
  add column skills        text not null default '',
  add column notes         text not null default '',
  add column project_ids   uuid[] not null default '{}',
  add constraint people_contract_order check (contract_to is null or contract_from is null or contract_to >= contract_from);
