-- Amends round 3 (Owner, 2026-10-14; docs/ux/DECISIONS.md), AM-20:
--   · each employee is Active or Inactive (the existing `active` switch); Inactive people are hidden from the TV,
--     the Floor Station and task assignment but stay in Crew;
--   · Delete erases nothing: the person moves to "Deleted accounts" (archived_at) with all their history, and can
--     be restored;
--   · before someone is set Inactive or deleted, their open tasks are moved to another person or left unassigned;
--   · salaries: the Owner and Supervisors view and change them (people_cost); every other role still can't.
--     Hour rates, labour costs and the cost settings stay Owner-only.

alter table public.people add column archived_at timestamptz;
alter table public.people add constraint people_archived_inactive check (archived_at is null or not active);

drop policy if exists people_cost_owner on public.people_cost;
create policy people_cost_admin on public.people_cost for all to authenticated
  using (private.can_write()) with check (private.can_write());

-- Set a person Inactive, delete (archive) them, or restore / reactivate them. Open work (part steps not done,
-- queue tasks not done) moves to p_move_to; without one, part steps are left unassigned and queue tasks stay on
-- the person's (hidden) queue. Owner and Supervisors only (RLS on people, work_items and queue_tasks).
create or replace function public.set_person_status(p_person uuid, p_status text, p_move_to uuid default null) returns jsonb
language plpgsql set search_path = public as $$
declare
  pe people;
  moved_steps int := 0;
  moved_tasks int := 0;
begin
  if not private.can_write() then
    raise exception 'Only the Owner and Supervisors change a crew member''s status.' using errcode = '42501';
  end if;
  if p_status not in ('active', 'inactive', 'deleted', 'restored') then raise exception 'Unknown status.' using errcode = 'P0001'; end if;
  select * into pe from people where id = p_person for update;
  if not found then raise exception 'That person no longer exists. Reload the page.' using errcode = 'P0001'; end if;
  if p_move_to is not null then
    if p_move_to = p_person then raise exception 'Pick someone else to take the open tasks.' using errcode = 'P0001'; end if;
    if not exists (select 1 from people where id = p_move_to and active and archived_at is null) then
      raise exception 'Open tasks can only move to an active crew member.' using errcode = 'P0001';
    end if;
  end if;

  if p_status in ('inactive', 'deleted') then
    update work_items set tech_id = p_move_to where tech_id = p_person and status <> 'done';
    get diagnostics moved_steps = row_count;
    if p_move_to is not null then
      update queue_tasks set person_id = p_move_to where person_id = p_person and status <> 'done';
      get diagnostics moved_tasks = row_count;
    end if;
    update people set active = false, archived_at = case when p_status = 'deleted' then now() else archived_at end where id = p_person;
  elsif p_status = 'restored' then
    update people set archived_at = null where id = p_person;
  else
    update people set active = true, archived_at = null where id = p_person;
  end if;

  perform audit_action('crew_' || p_status, 'people', p_person::text, null,
    pe.name || ' · ' || case p_status when 'active' then 'set active' when 'inactive' then 'set inactive'
      when 'deleted' then 'moved to Deleted accounts' else 'restored from Deleted accounts' end,
    jsonb_build_object('moved_to', p_move_to, 'part_steps', moved_steps, 'queue_tasks', moved_tasks));
  return jsonb_build_object('part_steps', moved_steps, 'queue_tasks', moved_tasks);
end $$;
revoke all on function public.set_person_status(uuid, text, uuid) from public, anon;
grant execute on function public.set_person_status(uuid, text, uuid) to authenticated;
