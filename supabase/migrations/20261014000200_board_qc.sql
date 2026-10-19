-- Project board QC (Owner, 2026-10-14; docs/ux/DECISIONS.md): on a new-workflow project a Supervisor passes or
-- fails a step straight from the board's status menu, after a confirmation. Only a step In Progress (or already
-- waiting for QC) can be decided. A Modelling step can't pass without its model record (measurements and render
-- saved on My models). The decision is a normal QC review: same history, rework and leaderboard data, and it
-- closes any pending QC request.
create or replace function public.board_qc(p_item uuid, p_pass boolean, p_reason text) returns void
language plpgsql set search_path = public as $$
declare w work_items; st stages;
begin
  if not private.can_write() then
    raise exception 'Only the Owner and Supervisors approve or reject in QC.' using errcode = '42501';
  end if;
  select * into w from work_items where id = p_item for update;
  if not found then raise exception 'That step no longer exists. Reload the page.' using errcode = 'P0001'; end if;
  if not (select gated from projects where id = w.project_id) then
    raise exception 'This project has no QC step; mark it Done.' using errcode = 'P0001';
  end if;
  if w.qc_since is null and w.status <> 'doing' then
    raise exception 'Only a step In Progress can pass or fail QC. Set it In Progress first.' using errcode = 'P0001';
  end if;
  select * into st from stages where id = w.stage_id;
  if p_pass and st.step = 'modelling' and not private.model_complete(w.part_id) then
    raise exception 'No model record yet: the measurements and render must be saved on My models first.' using errcode = 'P0001';
  end if;
  if not p_pass and length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'Say what failed — it is the only way the rework history is useful.' using errcode = 'P0001';
  end if;
  if w.qc_since is null then
    if w.tech_id is null then raise exception 'Assign a technician before deciding QC.' using errcode = 'P0001'; end if;
    -- Open the QC review here (submit_qc would also demand the model record, which a failed model may lack).
    update work_items set qc_since = now(), qc_by = auth.uid() where id = w.id;
    insert into qc_reviews (project_id, work_item_id, tech_id, attempt, submitted_by)
    values (w.project_id, w.id, w.tech_id, w.attempt, auth.uid());
  end if;
  perform decide_qc(w.id, p_pass, coalesce(p_reason, ''));
end $$;
revoke all on function public.board_qc(uuid, boolean, text) from public, anon;
grant execute on function public.board_qc(uuid, boolean, text) to authenticated;
