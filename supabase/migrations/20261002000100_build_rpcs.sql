-- Phase 3: multi-row build operations, each in one transaction.
-- All functions are SECURITY INVOKER (the default), so RLS still decides who may write.
-- Business rules are checked in domain/ before these are called; the DB keeps the data consistent.

-- Create a build from a template copy prepared by the app (stages, tasks with their plan, parts).
-- Baseline = plan (spec §7: set automatically on create). One work item per stage × part.
create or replace function public.create_build(p jsonb) returns uuid
language plpgsql set search_path = public as $$
declare
  pid uuid;
  s jsonb;
  t jsonb;
  stage_ids jsonb := '{}';
  sid uuid;
  tid uuid;
begin
  insert into projects (serial, name, template_id, template_label, client, notes, start_date, delivery_date, status, plan_end)
  values (trim(p ->> 'serial'), coalesce(p ->> 'name', ''), nullif(p ->> 'template_id', '')::uuid, coalesce(p ->> 'template_label', ''),
          coalesce(p ->> 'client', ''), coalesce(p ->> 'notes', ''), (p ->> 'start_date')::date, nullif(p ->> 'delivery_date', '')::date,
          'planned', nullif(p ->> 'plan_end', '')::timestamptz)
  returning id into pid;

  for s in select * from jsonb_array_elements(coalesce(p -> 'stages', '[]')) loop
    insert into stages (project_id, name, station_type, station_id, part_hours, sort)
    values (pid, s ->> 'name', s ->> 'station_type', nullif(s ->> 'station_id', '')::uuid, (s ->> 'part_hours')::numeric, (s ->> 'sort')::int)
    returning id into sid;
    stage_ids := stage_ids || jsonb_build_object(s ->> 'key', sid);
  end loop;

  insert into parts (project_id, name, sort)
  select pid, x ->> 'name', (x ->> 'sort')::int from jsonb_array_elements(coalesce(p -> 'parts', '[]')) x;

  for t in select * from jsonb_array_elements(coalesce(p -> 'tasks', '[]')) loop
    insert into tasks (project_id, stage_id, num, name, dur_h, plan_start, plan_end)
    values (pid, (stage_ids ->> (t ->> 'stage_key'))::uuid, (t ->> 'num')::int, t ->> 'name', (t ->> 'dur_h')::numeric,
            (t ->> 'plan_start')::timestamptz, (t ->> 'plan_end')::timestamptz)
    returning id into tid;
    insert into baselines (task_id, project_id, start_at, end_at, set_by)
    values (tid, pid, (t ->> 'plan_start')::timestamptz, (t ->> 'plan_end')::timestamptz, auth.uid());
  end loop;

  insert into work_items (project_id, stage_id, part_id)
  select pid, st.id, pa.id from stages st cross join parts pa where st.project_id = pid and pa.project_id = pid;

  perform audit_action('project.create', 'projects', pid::text, pid, trim(p ->> 'serial'));
  return pid;
end $$;

-- Write a re-flowed plan: task windows (+ optional new duration / pin) and the build's planned finish.
create or replace function public.save_plan(p_project uuid, p_plan_end timestamptz, p_tasks jsonb) returns void
language plpgsql set search_path = public as $$
begin
  update tasks t set
    plan_start = (x ->> 'plan_start')::timestamptz,
    plan_end = (x ->> 'plan_end')::timestamptz
  from jsonb_array_elements(p_tasks) x
  where t.id = (x ->> 'id')::uuid and t.project_id = p_project
    and (t.plan_start is distinct from (x ->> 'plan_start')::timestamptz or t.plan_end is distinct from (x ->> 'plan_end')::timestamptz);
  update projects set plan_end = p_plan_end where id = p_project and plan_end is distinct from p_plan_end;
end $$;

-- Freeze the current plan as the baseline (replaces any old one).
create or replace function public.set_baseline(p_project uuid, p_label text default 'rebaseline') returns void
language plpgsql set search_path = public as $$
declare serial_ text;
begin
  delete from baselines where project_id = p_project;
  insert into baselines (task_id, project_id, start_at, end_at, set_by)
  select id, project_id, plan_start, plan_end, auth.uid() from tasks
  where project_id = p_project and plan_start is not null and plan_end is not null;
  select serial into serial_ from projects where id = p_project;
  perform audit_action(p_label, 'projects', p_project::text, p_project, serial_);
end $$;

-- Send a Done part back for rework: keep the old segment, log the reason, start a new segment.
create or replace function public.rework_item(p_item uuid, p_version int, p_reason text, p_at timestamptz) returns int
language plpgsql set search_path = public as $$
declare w work_items;
begin
  select * into w from work_items where id = p_item for update;
  if not found or w.version <> p_version then
    raise exception 'Someone else changed this — reload and try again.' using errcode = '40001';
  end if;
  if w.status <> 'done' then
    raise exception 'Only a Done part can be sent back for rework.' using errcode = 'P0001';
  end if;
  insert into work_segments (work_item_id, project_id, tech_id, start_at, end_at)
  values (w.id, w.project_id, w.tech_id, coalesce(w.seg_start, w.start_at, p_at), coalesce(w.end_at, p_at));
  insert into rework_log (work_item_id, project_id, at, reason, by_user, by_role)
  values (w.id, w.project_id, p_at, trim(p_reason), auth.uid(), private.current_role());
  update work_items set status = 'doing', rework = rework + 1, seg_start = p_at, end_at = null where id = w.id
  returning version into p_version;
  return p_version;
end $$;

-- Add parts to a build (one work item per stage for each).
create or replace function public.add_parts(p_project uuid, p_names text[]) returns void
language plpgsql set search_path = public as $$
declare base int;
begin
  select coalesce(max(sort), -1) + 1 into base from parts where project_id = p_project;
  with ins as (
    insert into parts (project_id, name, sort)
    select p_project, trim(n), base + ord - 1 from unnest(p_names) with ordinality as u(n, ord)
    returning id
  )
  insert into work_items (project_id, stage_id, part_id)
  select p_project, st.id, ins.id from stages st cross join ins where st.project_id = p_project;
end $$;

-- Add a stage to a build (one work item per part).
create or replace function public.add_stage(p_project uuid, p_name text, p_station_type text, p_station uuid, p_part_hours numeric) returns uuid
language plpgsql set search_path = public as $$
declare sid uuid;
begin
  insert into stages (project_id, name, station_type, station_id, part_hours, sort)
  values (p_project, trim(p_name), p_station_type, p_station, p_part_hours,
          (select coalesce(max(sort), -1) + 1 from stages where project_id = p_project))
  returning id into sid;
  insert into work_items (project_id, stage_id, part_id) select p_project, sid, id from parts where project_id = p_project;
  return sid;
end $$;

-- audit_action is SECURITY DEFINER and checks can_write(); the functions above inherit RLS.
revoke all on function public.create_build(jsonb) from public, anon;
revoke all on function public.save_plan(uuid, timestamptz, jsonb) from public, anon;
revoke all on function public.set_baseline(uuid, text) from public, anon;
revoke all on function public.rework_item(uuid, int, text, timestamptz) from public, anon;
revoke all on function public.add_parts(uuid, text[]) from public, anon;
revoke all on function public.add_stage(uuid, text, text, uuid, numeric) from public, anon;
grant execute on function public.create_build(jsonb), public.save_plan(uuid, timestamptz, jsonb), public.set_baseline(uuid, text),
  public.rework_item(uuid, int, text, timestamptz), public.add_parts(uuid, text[]), public.add_stage(uuid, text, text, uuid, numeric)
  to authenticated, service_role;

-- Segments and rework history are part of the item's record; keep them readable with the item.
create index if not exists work_segments_project_idx on public.work_segments (project_id);
create index if not exists rework_log_project_idx on public.rework_log (project_id);
