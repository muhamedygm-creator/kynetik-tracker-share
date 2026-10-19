-- Amends round 3 (Owner, 2026-10-14; docs/ux/DECISIONS.md), AM-24: 3D Printing section and the
-- "Modelling & 3D Printing" role (the existing `modeller` role, renamed in the app).
--   · When a model (or each of its sub-parts) passes QC, its 3D printing step is a print job.
--   · A Modelling & 3D Printing user takes a job by starting it (it is then assigned to them; a job already
--     assigned to someone else stays theirs), enters filament (g), printing time (min) and the number of slice
--     components, and asks for QC. Like modelling, the request shows on QC and Requests (submit_qc).
--   · All three values are required before a print step can go to QC; they are kept on the part (AM-13).

alter table public.parts
  add column print_filament_g numeric(10,2) check (print_filament_g > 0),
  add column print_min        numeric(10,2) check (print_min > 0),
  add column print_slices     integer       check (print_slices >= 1),
  add column print_at         timestamptz,
  add column print_by         uuid references auth.users (id) on delete set null;

-- Admins on any print step; a Modelling & 3D Printing user on an unassigned one or one assigned to them.
create or replace function private.may_print(p_item uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.can_write() or (
    private.current_role() = 'modeller' and private.my_person() is not null and exists (
      select 1 from public.work_items w join public.stages s on s.id = w.stage_id
      where w.id = p_item and s.step = 'printing' and (w.tech_id is null or w.tech_id = private.my_person())))
$$;

create or replace function private.print_complete(p_part uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select print_filament_g is not null and print_min is not null and print_slices is not null
                   from public.parts where id = p_part), false)
$$;

-- Start a print job; a Modelling & 3D Printing user who starts an unassigned job takes it.
create or replace function public.start_print_step(p_item uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.may_print(p_item) then
    raise exception 'Only the person on this print job, or an admin, can start it.' using errcode = '42501';
  end if;
  if private.current_role() = 'modeller' then
    update public.work_items set tech_id = private.my_person() where id = p_item and tech_id is null;
  end if;
  update public.work_items set status = 'doing', start_at = coalesce(start_at, now()), seg_start = coalesce(seg_start, now()), end_at = null
  where id = p_item and status in ('todo', 'blocked');
  update public.queue_tasks set status = 'doing', actual_start = coalesce(actual_start, now())
  where work_item_id = p_item and status in ('todo', 'blocked');
end $$;
revoke all on function public.start_print_step(uuid) from public, anon;
grant execute on function public.start_print_step(uuid) to authenticated;

-- Print data for the part of a 3D printing step; only the keys sent change.
create or replace function public.save_print_data(p_item uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare part_id uuid;
begin
  if not private.may_print(p_item) then
    raise exception 'Only the person on this print job, or an admin, can enter its print data.' using errcode = '42501';
  end if;
  select w.part_id into part_id from public.work_items w join public.stages s on s.id = w.stage_id where w.id = p_item and s.step = 'printing';
  if part_id is null then raise exception 'Print data goes on a 3D printing step.' using errcode = 'P0001'; end if;
  update public.parts pa set
    print_filament_g = case when p ? 'print_filament_g' then nullif(p ->> 'print_filament_g', '')::numeric else pa.print_filament_g end,
    print_min        = case when p ? 'print_min'        then nullif(p ->> 'print_min', '')::numeric        else pa.print_min end,
    print_slices     = case when p ? 'print_slices'     then nullif(p ->> 'print_slices', '')::int         else pa.print_slices end,
    print_by = auth.uid(), print_at = now()
  where pa.id = part_id;
end $$;
revoke all on function public.save_print_data(uuid, jsonb) from public, anon;
grant execute on function public.save_print_data(uuid, jsonb) to authenticated;

-- Ask for QC: a print step also needs its print data, and its user (like a modeller) may send it.
create or replace function public.submit_qc(p_item uuid, p_notes text default '') returns void
language plpgsql security definer set search_path = public as $$
declare w work_items; st stages; pa parts;
begin
  select * into w from work_items where id = p_item for update;
  if not found then raise exception 'That step no longer exists. Reload the page.' using errcode = 'P0001'; end if;
  if not private.can_write() and not private.may_model(p_item) and not private.may_print(p_item) then
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
  if st.step = 'printing' and not private.print_complete(w.part_id) then
    raise exception 'Enter the filament, printing time and slice components before asking for QC.' using errcode = 'P0001';
  end if;
  update work_items set qc_since = now(), qc_by = auth.uid() where id = w.id;
  insert into qc_reviews (project_id, work_item_id, tech_id, attempt, submitted_by, notes)
  values (w.project_id, w.id, w.tech_id, w.attempt, auth.uid(), trim(coalesce(p_notes, '')));
  -- Sent by a Modelling & 3D Printing user (not an admin): it also goes to Requests so admins hear about it.
  if not private.can_write() and not exists (select 1 from requests r where r.work_item_id = w.id and r.kind = 'qc' and r.status = 'pending') then
    select * into pa from parts where id = w.part_id;
    insert into requests (kind, queue_task_id, work_item_id, person_id, task_title, notes, sent_by)
    values ('qc', (select q.id from queue_tasks q where q.work_item_id = w.id order by q.created_at limit 1), w.id, w.tech_id,
            trim(coalesce(pa.serial, '') || ' ' || coalesce(pa.name, '')) || ': ' || st.name, trim(coalesce(p_notes, '')), auth.uid());
  end if;
end $$;
revoke all on function public.submit_qc(uuid, text) from public, anon;
grant execute on function public.submit_qc(uuid, text) to authenticated;

-- Board QC and Requests pass the same check before a print step can pass.
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
  if p_pass and st.step = 'printing' and not private.print_complete(w.part_id) then
    raise exception 'No print record yet: the filament, printing time and slice components must be saved on 3D Printing first.' using errcode = 'P0001';
  end if;
  if not p_pass and length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'Say what failed — it is the only way the rework history is useful.' using errcode = 'P0001';
  end if;
  if w.qc_since is null then
    if w.tech_id is null then raise exception 'Assign a technician before deciding QC.' using errcode = 'P0001'; end if;
    update work_items set qc_since = now(), qc_by = auth.uid() where id = w.id;
    insert into qc_reviews (project_id, work_item_id, tech_id, attempt, submitted_by)
    values (w.project_id, w.id, w.tech_id, w.attempt, auth.uid());
  end if;
  perform decide_qc(w.id, p_pass, coalesce(p_reason, ''));
end $$;
revoke all on function public.board_qc(uuid, boolean, text) from public, anon;
grant execute on function public.board_qc(uuid, boolean, text) to authenticated;
