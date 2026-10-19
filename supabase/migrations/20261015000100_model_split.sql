-- Amends round 3 (Owner, 2026-10-14; docs/ux/DECISIONS.md), AM-22 and AM-23:
--   · "Add sub-parts" in My Models: before asking for QC the modeller plans a split of the part (how many pieces
--     and their names). Nothing is created yet: the plan sits on the part (parts.split_plan) and the serials are
--     only given when QC approves the model, so a changed plan never burns a serial.
--   · Approving the model applies the plan: one sub-part per entry, serial = the part's serial + a letter
--     (12-02-105-A, or 12-02-110-1-A for a unit), material and finish copied, each with its own steps from
--     3D printing on. The original keeps its approved Modelling step as history and leaves the active list
--     (it becomes a folder). The model data stays on the original.
--   · Asking for QC can carry a note; the QC page shows it with the model data, render and planned sub-parts.

-- A unit can be split too: 12-02-110-1-A.
alter table public.parts drop constraint if exists parts_serial_check;
alter table public.parts add constraint parts_serial_check
  check (serial ~ '^\d{2}-\d{2}-\d{3}((-[A-Z])?(-[1-9]\d*)?|-[1-9]\d*-[A-Z])$');

alter table public.parts
  add column split_plan jsonb check (split_plan is null or jsonb_typeof(split_plan) = 'array'),
  add column split_at   timestamptz;

alter table public.qc_reviews add column notes text not null default '' check (length(notes) <= 1000);

-- Plan (or clear, with an empty list) the split of the part on a Modelling step. The modeller on the step or
-- an admin; only while the step isn't waiting for QC or done; a sub-part or a unit's piece can't be split again.
create or replace function public.save_split(p_item uuid, p_names jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  w public.work_items;
  pa public.parts;
  n int := coalesce(jsonb_array_length(p_names), 0);
  nm text;
begin
  if not private.may_model(p_item) then
    raise exception 'Only the modeller on this step, or an admin, can add sub-parts.' using errcode = '42501';
  end if;
  select * into w from public.work_items where id = p_item;
  if not found or (select s.step from public.stages s where s.id = w.stage_id) is distinct from 'modelling' then
    raise exception 'Sub-parts are added on a Modelling step.' using errcode = 'P0001';
  end if;
  if w.qc_since is not null then raise exception 'This model is waiting for QC; the split can''t change now.' using errcode = 'P0001'; end if;
  if w.status = 'done' then raise exception 'This model is already approved.' using errcode = 'P0001'; end if;
  select * into pa from public.parts where id = w.part_id;
  if pa.parent_id is not null then raise exception 'A sub-part can''t be split again.' using errcode = 'P0001'; end if;
  if n = 1 or n > 26 then raise exception 'Split into 2 to 26 sub-parts.' using errcode = 'P0001'; end if;
  for nm in select jsonb_array_elements_text(coalesce(p_names, '[]')) loop
    if length(trim(nm)) = 0 or length(trim(nm)) > 200 then
      raise exception 'Every sub-part needs a name (up to 200 characters).' using errcode = 'P0001';
    end if;
  end loop;
  update public.parts set split_plan = case when n = 0 then null
      else (select jsonb_agg(trim(v)) from jsonb_array_elements_text(p_names) v) end
  where id = pa.id;
end $$;
revoke all on function public.save_split(uuid, jsonb) from public, anon;
grant execute on function public.save_split(uuid, jsonb) to authenticated;

-- Apply an approved split (called from decide_qc). SECURITY DEFINER: it writes parts and steps for the admin
-- who approved, with the same checks as everywhere else (serial registry, one level, same project).
create or replace function private.apply_split(p_item uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  w public.work_items;
  pa public.parts;
  modelling_sort int;
  k int := 0;
  nm text;
  sub_id uuid;
begin
  select * into w from public.work_items where id = p_item;
  select * into pa from public.parts where id = w.part_id;
  if pa.split_plan is null or jsonb_array_length(pa.split_plan) < 2 or pa.split_at is not null then return; end if;
  select s.sort into modelling_sort from public.stages s where s.id = w.stage_id;
  -- The original's later steps never started (the QC gate), so they go; its Modelling step stays as history.
  delete from public.work_items x using public.stages s
  where x.part_id = pa.id and s.id = x.stage_id and s.sort > modelling_sort and x.status = 'todo';
  for nm in select jsonb_array_elements_text(pa.split_plan) loop
    insert into public.parts (project_id, parent_id, serial, name, description, material, finish_colour, finish_sheen, sort)
    values (pa.project_id, pa.id, pa.serial || '-' || chr(65 + k), nm, '', pa.material, pa.finish_colour, pa.finish_sheen, pa.sort)
    returning id into sub_id;
    insert into public.work_items (project_id, stage_id, part_id)
    select pa.project_id, s.id, sub_id from public.stages s where s.project_id = pa.project_id and s.sort > modelling_sort;
    k := k + 1;
  end loop;
  update public.parts set split_at = now() where id = pa.id;
end $$;
revoke all on function private.apply_split(uuid) from public, anon;
grant execute on function private.apply_split(uuid) to authenticated;

-- Ask for QC, now with an optional note (kept on the review and the request).
drop function if exists public.submit_qc(uuid);
create or replace function public.submit_qc(p_item uuid, p_notes text default '') returns void
language plpgsql security definer set search_path = public as $$
declare w work_items; st stages; pa parts;
begin
  select * into w from work_items where id = p_item for update;
  if not found then raise exception 'That step no longer exists. Reload the page.' using errcode = 'P0001'; end if;
  if not private.can_write() and not private.may_model(p_item) then
    raise exception 'Read-only access. Ask the Owner for Supervisor access to make changes.' using errcode = '42501';
  end if;
  if not (select gated from projects where id = w.project_id) then
    raise exception 'This project has no QC step; mark it Done.' using errcode = 'P0001';
  end if;
  if w.status <> 'doing' then raise exception 'Only a step In Progress can be submitted for QC.' using errcode = 'P0001'; end if;
  if w.tech_id is null then raise exception 'Assign a technician before submitting for QC.' using errcode = 'P0001'; end if;
  if w.qc_since is not null then raise exception 'This step is already waiting for QC.' using errcode = 'P0001'; end if;
  if length(coalesce(p_notes, '')) > 1000 then raise exception 'Keep the note under 1000 characters.' using errcode = 'P0001'; end if;
  select * into st from stages where id = w.stage_id;
  if st.step = 'modelling' and not private.model_complete(w.part_id) then
    raise exception 'Fill in every model measurement and add the render before submitting for QC.' using errcode = 'P0001';
  end if;
  update work_items set qc_since = now(), qc_by = auth.uid() where id = w.id;
  insert into qc_reviews (project_id, work_item_id, tech_id, attempt, submitted_by, notes)
  values (w.project_id, w.id, w.tech_id, w.attempt, auth.uid(), trim(coalesce(p_notes, '')));
  -- Sent by a Modeller (not an admin): it also goes to Requests so admins hear about it.
  if not private.can_write() and not exists (select 1 from requests r where r.work_item_id = w.id and r.kind = 'qc' and r.status = 'pending') then
    select * into pa from parts where id = w.part_id;
    insert into requests (kind, queue_task_id, work_item_id, person_id, task_title, notes, sent_by)
    values ('qc', (select q.id from queue_tasks q where q.work_item_id = w.id order by q.created_at limit 1), w.id, w.tech_id,
            trim(coalesce(pa.serial, '') || ' ' || coalesce(pa.name, '')) || ': ' || st.name, trim(coalesce(p_notes, '')), auth.uid());
  end if;
end $$;
revoke all on function public.submit_qc(uuid, text) from public, anon;
grant execute on function public.submit_qc(uuid, text) to authenticated;

-- Approving a Modelling step applies its planned split.
create or replace function public.decide_qc(p_item uuid, p_approve boolean, p_reason text) returns void
language plpgsql set search_path = public as $$
declare w work_items;
begin
  if not private.can_write() then
    raise exception 'Only the Owner and Supervisors approve or reject in QC.' using errcode = '42501';
  end if;
  select * into w from work_items where id = p_item for update;
  if not found then raise exception 'That step no longer exists. Reload the page.' using errcode = 'P0001'; end if;
  if w.qc_since is null then raise exception 'This step is not waiting for QC.' using errcode = 'P0001'; end if;
  if p_approve then
    update qc_reviews set decided_at = now(), decided_by = auth.uid(), result = 'approved'
    where work_item_id = w.id and result is null;
    perform set_config('app.qc_approve', 'on', true);
    update work_items set status = 'done', end_at = now() where id = w.id;
    perform set_config('app.qc_approve', 'off', true);
    update queue_tasks set status = 'done', actual_end = now() where work_item_id = w.id and status <> 'done';
    if (select s.step from stages s where s.id = w.stage_id) = 'modelling' then perform private.apply_split(w.id); end if;
  else
    if length(trim(coalesce(p_reason, ''))) = 0 then
      raise exception 'Say what failed — it is the only way the rework history is useful.' using errcode = 'P0001';
    end if;
    -- The attempt so far (its QC wait included) closes; the same technician carries on as rework.
    insert into work_segments (work_item_id, project_id, tech_id, start_at, end_at, attempt)
    values (w.id, w.project_id, w.tech_id, coalesce(w.seg_start, w.start_at, now()), now(), w.attempt);
    insert into rework_log (work_item_id, project_id, at, reason, by_user, by_role)
    values (w.id, w.project_id, now(), 'QC: ' || trim(p_reason), auth.uid(), private.current_role());
    update work_items set rework = rework + 1, attempt = attempt + 1, seg_start = now(), qc_since = null, qc_by = null where id = w.id;
    update qc_reviews set decided_at = now(), decided_by = auth.uid(), result = 'rejected', reason = trim(p_reason)
    where work_item_id = w.id and result is null;
  end if;
  perform private.close_qc_requests(w.id, p_approve, case when p_approve then '' else p_reason end);
end $$;
