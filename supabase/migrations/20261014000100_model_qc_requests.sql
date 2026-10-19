-- My models (Owner, 2026-10-14; docs/ux/DECISIONS.md):
--   · a Modeller's "Ask for QC" also shows on Requests (badge and chime), like a Floor Station QC request;
--   · deciding a step on the QC page closes its pending QC request, and deciding the request decides the step
--     (decide_request already calls decide_qc), so the two lists never disagree.

-- Close the pending QC requests of a step (SECURITY DEFINER: nobody writes requests directly).
create or replace function private.close_qc_requests(p_item uuid, p_approve boolean, p_reply text) returns void
language sql security definer set search_path = '' as $$
  update public.requests set status = case when p_approve then 'approved' else 'rejected' end,
    decided_by = auth.uid(), decided_at = now(), reply = trim(coalesce(p_reply, ''))
  where work_item_id = p_item and kind = 'qc' and status = 'pending';
$$;
revoke all on function private.close_qc_requests(uuid, boolean, text) from public, anon;
grant execute on function private.close_qc_requests(uuid, boolean, text) to authenticated;

create or replace function public.submit_qc(p_item uuid) returns void
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
  select * into st from stages where id = w.stage_id;
  if st.step = 'modelling' and not private.model_complete(w.part_id) then
    raise exception 'Fill in every model measurement and add the render before submitting for QC.' using errcode = 'P0001';
  end if;
  update work_items set qc_since = now(), qc_by = auth.uid() where id = w.id;
  insert into qc_reviews (project_id, work_item_id, tech_id, attempt, submitted_by)
  values (w.project_id, w.id, w.tech_id, w.attempt, auth.uid());
  -- Sent by a Modeller (not an admin): it also goes to Requests so admins hear about it.
  if not private.can_write() and not exists (select 1 from requests r where r.work_item_id = w.id and r.kind = 'qc' and r.status = 'pending') then
    select * into pa from parts where id = w.part_id;
    insert into requests (kind, queue_task_id, work_item_id, person_id, task_title, sent_by)
    values ('qc', (select q.id from queue_tasks q where q.work_item_id = w.id order by q.created_at limit 1), w.id, w.tech_id,
            trim(coalesce(pa.serial, '') || ' ' || coalesce(pa.name, '')) || ': ' || st.name, auth.uid());
  end if;
end $$;
revoke all on function public.submit_qc(uuid) from public, anon;
grant execute on function public.submit_qc(uuid) to authenticated;

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
