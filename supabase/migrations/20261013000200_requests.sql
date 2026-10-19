-- Amends AM-14 / AM-15 (Owner, 2026-10-13; answers in docs/ux/DECISIONS.md):
--   · the Floor Station (shared workshop iPad) sends two kinds of request about an employee's task:
--     a time extension or a QC check, with an optional note; it can't change anything else;
--   · Owner and Supervisors decide on the Requests page:
--       time extension approved → the extra time is added to the task's allocated time (it doesn't count
--         against the employee); rejected → nothing changes and time beyond the allocation is delay;
--       QC approved → the step passes QC (same as the QC page) or a workshop task is done;
--       QC rejected → the task stays open and the clock keeps running (rework rules of the QC gate);
--   · every request and decision is kept for the performance data.
-- The Floor Station reads like a Viewer (no costs); it writes only through send_request.

create table public.requests (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('extension', 'qc')),
  queue_task_id uuid references public.queue_tasks (id) on delete set null,
  work_item_id  uuid references public.work_items (id) on delete set null,
  person_id     uuid references public.people (id) on delete set null,
  task_title    text not null default '',
  notes         text not null default '' check (length(notes) <= 1000),
  sent_by       uuid references auth.users (id) on delete set null,
  sent_at       timestamptz not null default now(),
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by    uuid references auth.users (id) on delete set null,
  decided_at    timestamptz,
  reply         text not null default '' check (length(reply) <= 1000),
  extra_h       numeric(10,4) check (extra_h > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version    integer not null default 1,
  check ((status = 'pending') = (decided_at is null))
);
create index requests_pending_idx on public.requests (sent_at) where status = 'pending';
select private.standard_triggers('requests');
-- Members read; nobody writes directly: send_request and decide_request below do.
create policy requests_read on public.requests for select to authenticated using (private.is_member());

-- Send a request from the Floor Station (admins may too). Recorded against the task's employee; no PIN.
create or replace function public.send_request(p_queue_task uuid, p_kind text, p_notes text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  t public.queue_tasks;
  w public.work_items;
  rid uuid;
begin
  if not (private.current_role() = 'floor_station' or private.can_write()) then
    raise exception 'Only the Floor Station or an admin can send requests.' using errcode = '42501';
  end if;
  if p_kind not in ('extension', 'qc') then raise exception 'Unknown request type.' using errcode = 'P0001'; end if;
  select * into t from public.queue_tasks where id = p_queue_task;
  if not found then raise exception 'That task no longer exists. Reload the page.' using errcode = 'P0001'; end if;
  if t.status = 'done' then raise exception 'That task is already done.' using errcode = 'P0001'; end if;
  if exists (select 1 from public.requests r where r.queue_task_id = t.id and r.kind = p_kind and r.status = 'pending') then
    raise exception 'A request like this is already waiting for an admin.' using errcode = 'P0001';
  end if;
  if t.work_item_id is not null then select * into w from public.work_items where id = t.work_item_id; end if;

  -- A QC request on a step of a new-workflow project also puts it in the QC list (its clock keeps running).
  if p_kind = 'qc' and w.id is not null and (select p.gated from public.projects p where p.id = w.project_id) then
    if w.status <> 'doing' then raise exception 'Only a task In Progress can be sent for QC.' using errcode = 'P0001'; end if;
    if w.qc_since is null then
      if (select s.step from public.stages s where s.id = w.stage_id) = 'modelling' and not private.model_complete(w.part_id) then
        raise exception 'The model data and render aren''t complete yet; the modeller fills them in on My models first.' using errcode = 'P0001';
      end if;
      update public.work_items set qc_since = now(), qc_by = auth.uid() where id = w.id;
      insert into public.qc_reviews (project_id, work_item_id, tech_id, attempt, submitted_by)
      values (w.project_id, w.id, w.tech_id, w.attempt, auth.uid());
    end if;
  elsif p_kind = 'qc' and t.status <> 'doing' then
    raise exception 'Only a task In Progress can be sent for QC.' using errcode = 'P0001';
  end if;

  insert into public.requests (kind, queue_task_id, work_item_id, person_id, task_title, notes, sent_by)
  values (p_kind, t.id, t.work_item_id, t.person_id, t.title, trim(coalesce(p_notes, '')), auth.uid())
  returning id into rid;
  return rid;
end $$;
revoke all on function public.send_request(uuid, text, text) from public, anon;
grant execute on function public.send_request(uuid, text, text) to authenticated;

-- Decide on a request (Owner and Supervisors).
create or replace function public.decide_request(p_request uuid, p_approve boolean, p_reply text, p_extra_h numeric) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.requests;
  t public.queue_tasks;
  gated boolean;
begin
  if not private.can_write() then
    raise exception 'Only the Owner and Supervisors decide on requests.' using errcode = '42501';
  end if;
  select * into r from public.requests where id = p_request for update;
  if not found then raise exception 'That request no longer exists. Reload the page.' using errcode = 'P0001'; end if;
  if r.status <> 'pending' then raise exception 'Someone has already decided on this request.' using errcode = 'P0001'; end if;
  if r.queue_task_id is not null then select * into t from public.queue_tasks where id = r.queue_task_id; end if;
  select coalesce(p.gated, false) into gated from public.work_items w join public.projects p on p.id = w.project_id where w.id = r.work_item_id;

  if r.kind = 'extension' and p_approve then
    if p_extra_h is null or p_extra_h <= 0 or p_extra_h > 200 then
      raise exception 'Enter the extra time to add, more than 0.' using errcode = 'P0001';
    end if;
    if t.id is not null then
      -- Allocated time in hours (a task planned in days becomes hours; one working day is the day's hours).
      update public.queue_tasks set dur_value = (case when dur_unit = 'days'
          then dur_value * coalesce((select (extract(epoch from ((value ->> 'shiftEnd')::time - (value ->> 'shiftStart')::time)) / 3600)
                                             - coalesce((value ->> 'breakMins')::numeric, 0) / 60 from public.settings where key = 'calendar'), 8)
          else dur_value end) + p_extra_h,
        dur_unit = 'hours'
      where id = t.id;
    end if;
    if r.work_item_id is not null and gated then
      update public.work_items set plan_h = coalesce(plan_h, 0) + p_extra_h where id = r.work_item_id;
    end if;
  elsif r.kind = 'qc' and r.work_item_id is not null and gated then
    -- Same as deciding on the QC page (the step was put in the QC list when the request was sent).
    if exists (select 1 from public.work_items w where w.id = r.work_item_id and w.qc_since is not null) then
      perform public.decide_qc(r.work_item_id, p_approve, case when p_approve then '' else coalesce(nullif(trim(p_reply), ''), 'QC not approved') end);
    end if;
  elsif r.kind = 'qc' and p_approve and t.id is not null then
    -- A workshop task (or an old-project step): approved QC finishes it.
    update public.queue_tasks set status = 'done', actual_end = now() where id = t.id and status <> 'done';
  end if;

  update public.requests set status = case when p_approve then 'approved' else 'rejected' end,
    decided_by = auth.uid(), decided_at = now(), reply = trim(coalesce(p_reply, '')),
    extra_h = case when r.kind = 'extension' and p_approve then p_extra_h end
  where id = r.id;
end $$;
revoke all on function public.decide_request(uuid, boolean, text, numeric) from public, anon;
grant execute on function public.decide_request(uuid, boolean, text, numeric) to authenticated;
