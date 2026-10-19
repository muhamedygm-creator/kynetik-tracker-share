-- Amends round 2026-10-12, part 3 (AMENDS_NEXT_ROUND AM-05, AM-11; answers in docs/ux/DECISIONS.md):
--   · model data on each part: length × width × height (m), weight (g), surface area (m²), volume (m³) and
--     one render image, entered when its Modelling step is finished; all required before QC;
--   · Modeller login: a member who reads like a Viewer (no costs) and may only start their own Modelling
--     steps, fill in the model data and submit them for QC. Approving stays with Owner and Supervisors.
--   · a login can be linked to its crew person (profiles.person_id), so "own steps" is known.

alter table public.profiles add column person_id uuid unique references public.people (id) on delete set null;

alter table public.parts
  add column length_m   numeric(10,4) check (length_m > 0),
  add column width_m    numeric(10,4) check (width_m > 0),
  add column height_m   numeric(10,4) check (height_m > 0),
  add column weight_g   numeric(12,2) check (weight_g > 0),
  add column surface_m2 numeric(12,4) check (surface_m2 > 0),
  add column volume_m3  numeric(14,6) check (volume_m3 > 0),
  add column render_path text,
  add column model_by   uuid references auth.users (id) on delete set null,
  add column model_at   timestamptz;

-- The signed-in user's crew person, if linked.
create or replace function private.my_person() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.person_id from public.profiles p where p.user_id = auth.uid() and p.active
$$;
grant execute on function private.my_person() to authenticated;

-- Is this the caller's own Modelling step (Modeller login), or is the caller an admin?
create or replace function private.may_model(p_item uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.can_write() or (
    private.current_role() = 'modeller' and exists (
      select 1 from public.work_items w join public.stages s on s.id = w.stage_id
      where w.id = p_item and s.step = 'modelling' and w.tech_id is not null and w.tech_id = private.my_person()))
$$;

create or replace function private.model_complete(p_part uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select length_m is not null and width_m is not null and height_m is not null and weight_g is not null
                     and surface_m2 is not null and volume_m3 is not null and coalesce(render_path, '') <> ''
                   from public.parts where id = p_part), false)
$$;

-- Model data for the part of a Modelling step. SECURITY DEFINER with its own check (may_model), because a
-- Modeller can't write parts directly.
create or replace function public.save_model_data(p_item uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare part_id uuid;
begin
  if not private.may_model(p_item) then
    raise exception 'Only the modeller on this step, or an admin, can enter its model data.' using errcode = '42501';
  end if;
  select w.part_id into part_id from public.work_items w join public.stages s on s.id = w.stage_id where w.id = p_item and s.step = 'modelling';
  if part_id is null then raise exception 'Model data goes on a Modelling step.' using errcode = 'P0001'; end if;
  -- Only the keys sent change (the render upload sends just render_path).
  update public.parts pa set
    length_m   = case when p ? 'length_m'   then nullif(p ->> 'length_m', '')::numeric   else pa.length_m end,
    width_m    = case when p ? 'width_m'    then nullif(p ->> 'width_m', '')::numeric    else pa.width_m end,
    height_m   = case when p ? 'height_m'   then nullif(p ->> 'height_m', '')::numeric   else pa.height_m end,
    weight_g   = case when p ? 'weight_g'   then nullif(p ->> 'weight_g', '')::numeric   else pa.weight_g end,
    surface_m2 = case when p ? 'surface_m2' then nullif(p ->> 'surface_m2', '')::numeric else pa.surface_m2 end,
    volume_m3  = case when p ? 'volume_m3'  then nullif(p ->> 'volume_m3', '')::numeric  else pa.volume_m3 end,
    render_path = case when p ? 'render_path' then nullif(p ->> 'render_path', '') else pa.render_path end,
    model_by = auth.uid(), model_at = now()
  where pa.id = part_id;
end $$;
revoke all on function public.save_model_data(uuid, jsonb) from public, anon;
grant execute on function public.save_model_data(uuid, jsonb) to authenticated;

-- A Modeller starts their own Modelling step (the gate trigger still applies).
create or replace function public.start_model_step(p_item uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.may_model(p_item) then
    raise exception 'Only the modeller on this step, or an admin, can start it.' using errcode = '42501';
  end if;
  update public.work_items set status = 'doing', start_at = coalesce(start_at, now()), seg_start = coalesce(seg_start, now()), end_at = null
  where id = p_item and status in ('todo', 'blocked');
  update public.queue_tasks set status = 'doing', actual_start = coalesce(actual_start, now())
  where work_item_id = p_item and status in ('todo', 'blocked');
end $$;
revoke all on function public.start_model_step(uuid) from public, anon;
grant execute on function public.start_model_step(uuid) to authenticated;

-- Submit for QC: admins for any step; a Modeller for their own Modelling step. A Modelling step needs all its
-- model data first (AM-05).
create or replace function public.submit_qc(p_item uuid) returns void
language plpgsql security definer set search_path = public as $$
declare w work_items; st stages;
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
end $$;
revoke all on function public.submit_qc(uuid) from public, anon;
grant execute on function public.submit_qc(uuid) to authenticated;

-- Renders: a private bucket like the photos. Members read; admins and Modellers upload (the link to a part is
-- set through save_model_data, which checks the step).
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('part-renders', 'part-renders', false, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do nothing;
    execute $p$create policy part_renders_read on storage.objects for select to authenticated
      using (bucket_id = 'part-renders' and private.is_member())$p$;
    execute $p$create policy part_renders_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'part-renders' and (private.can_write() or private.current_role() = 'modeller'))$p$;
    execute $p$create policy part_renders_delete on storage.objects for delete to authenticated
      using (bucket_id = 'part-renders' and private.can_write())$p$;
  end if;
end $$;

-- Approving or rejecting stays with Owner and Supervisors (a Modeller's write would otherwise be ignored by RLS
-- without a word).
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
end $$;

