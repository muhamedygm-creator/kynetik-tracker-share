-- Amends round 2026-10-12, part 2 (AMENDS_NEXT_ROUND AM-06, AM-07, AM-08; answers in docs/ux/DECISIONS.md):
--   · admin QC gate on projects made on the new workflow (projects.gated): a finished step is submitted for
--     QC and only an approval marks it Done; a rejection sends it back to the same technician as rework;
--   · a step can't start before every earlier stage of its part is approved;
--   · mold components: after pre-mold is approved an admin sets how many, and each becomes its own
--     tracked step in Mold production;
--   · rework time is kept apart from the first attempt (work_segments.attempt).
-- Waiting for QC is not a new status: the step stays In Progress (its clock keeps running, so QC time
-- counts inside the allocated time, AM-07) with qc_since set. Old projects are untouched.

-- ───────────── which stage is which (new workflow) ─────────────
alter table public.template_stages add column step text;
alter table public.stages add column step text;
update public.template_stages ts set step = s.step
from (values ('Modelling', 'modelling'), ('3D printing', 'printing'), ('Prototyping', 'prototyping'),
             ('Pre-mold production', 'premold'), ('Mold production', 'mold'), ('Carbon fibre component production', 'carbon'),
             ('Fitment', 'fitment'), ('Paint preparation & painting', 'paint'), ('Sanding & polishing', 'sanding'), ('Assembly', 'assembly')) as s (name, step)
where ts.name = s.name and ts.template_id = (select id from public.templates where key = 'exteriorPanels');
update public.stages st set step = ts.step
from public.projects p, public.template_stages ts
where p.id = st.project_id and p.gated and ts.template_id = p.template_id and ts.name = st.name;

-- ───────────── work items: QC, attempts, mold components ─────────────
alter table public.work_items
  add column qc_since      timestamptz,
  add column qc_by         uuid references auth.users (id) on delete set null,
  add column attempt       integer not null default 1 check (attempt >= 1),
  add column component_no  integer check (component_no >= 1),
  add column component_total integer check (component_total >= 1),
  add check ((component_no is null) = (component_total is null) and (component_no is null or component_no <= component_total));
alter table public.work_items drop constraint work_items_stage_id_part_id_key;
create unique index work_items_stage_part_key on public.work_items (stage_id, part_id, coalesce(component_no, 0));

-- Allocated time to the minute, like the task queue (AM-08: set by admins on the queue).
alter table public.work_items alter column plan_h type numeric(10,4);

alter table public.work_segments add column attempt integer not null default 1 check (attempt >= 1);

-- ───────────── QC history (who submitted, who decided, why it failed) ─────────────
create table public.qc_reviews (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects (id) on delete cascade,
  work_item_id uuid not null references public.work_items (id) on delete cascade,
  tech_id      uuid references public.people (id) on delete set null,
  attempt      integer not null default 1,
  submitted_at timestamptz not null default now(),
  submitted_by uuid references auth.users (id) on delete set null,
  decided_at   timestamptz,
  decided_by   uuid references auth.users (id) on delete set null,
  result       text check (result in ('approved', 'rejected')),
  reason       text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version    integer not null default 1,
  check ((result is null) = (decided_at is null)),
  check (result is distinct from 'rejected' or length(trim(reason)) > 0)
);
create index qc_reviews_item_idx on public.qc_reviews (work_item_id);
create index qc_reviews_open_idx on public.qc_reviews (project_id) where result is null;
select private.standard_triggers('qc_reviews');
select private.member_policies('qc_reviews');

-- ───────────── the gate ─────────────
create or replace function private.qc_gate() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  gated boolean;
  st public.stages;
  waiting text;
begin
  select p.gated into gated from public.projects p where p.id = new.project_id;
  if not coalesce(gated, false) then return new; end if;
  select * into st from public.stages where id = new.stage_id;

  -- No start before every earlier stage of this part is approved.
  if new.status in ('doing', 'done') and old.status in ('todo', 'blocked') then
    select string_agg(distinct s2.name, ', ') into waiting
    from public.work_items w join public.stages s2 on s2.id = w.stage_id
    where w.part_id = new.part_id and s2.project_id = new.project_id and s2.sort < st.sort and w.status <> 'done';
    if waiting is not null then
      raise exception 'This part is still in %. A stage starts once the stage before it has passed QC.', waiting using errcode = 'P0001';
    end if;
    if st.step = 'mold' and new.component_total is null then
      raise exception 'Set how many mold components this part needs before Mold production starts.' using errcode = 'P0001';
    end if;
  end if;

  -- Done only through an approval.
  if new.status = 'done' and old.status <> 'done' and current_setting('app.qc_approve', true) is distinct from 'on' then
    raise exception 'On this project a step is marked Done by approving it in QC. Submit it for QC instead.' using errcode = 'P0001';
  end if;
  -- Leaving In Progress some other way (blocked, reset) withdraws a pending QC request.
  if new.status <> 'doing' and old.qc_since is not null then
    new.qc_since := null; new.qc_by := null;
    delete from public.qc_reviews where work_item_id = new.id and result is null;
  end if;
  return new;
end $$;

create trigger qc_gate before update of status on public.work_items
  for each row execute function private.qc_gate();

-- ───────────── submit, approve, reject ─────────────
-- SECURITY INVOKER: RLS decides who may write (Owner and Supervisors).
create or replace function public.submit_qc(p_item uuid) returns void
language plpgsql set search_path = public as $$
declare w work_items;
begin
  select * into w from work_items where id = p_item for update;
  if not found then raise exception 'That step no longer exists. Reload the page.' using errcode = 'P0001'; end if;
  if not (select gated from projects where id = w.project_id) then
    raise exception 'This project has no QC step; mark it Done.' using errcode = 'P0001';
  end if;
  if w.status <> 'doing' then raise exception 'Only a step In Progress can be submitted for QC.' using errcode = 'P0001'; end if;
  if w.tech_id is null then raise exception 'Assign a technician before submitting for QC.' using errcode = 'P0001'; end if;
  if w.qc_since is not null then raise exception 'This step is already waiting for QC.' using errcode = 'P0001'; end if;
  update work_items set qc_since = now(), qc_by = auth.uid() where id = w.id;
  insert into qc_reviews (project_id, work_item_id, tech_id, attempt, submitted_by)
  values (w.project_id, w.id, w.tech_id, w.attempt, auth.uid());
end $$;

create or replace function public.decide_qc(p_item uuid, p_approve boolean, p_reason text) returns void
language plpgsql set search_path = public as $$
declare w work_items;
begin
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

-- Rework of an approved step (found later) counts as another attempt too.
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
  insert into work_segments (work_item_id, project_id, tech_id, start_at, end_at, attempt)
  values (w.id, w.project_id, w.tech_id, coalesce(w.seg_start, w.start_at, p_at), coalesce(w.end_at, p_at), w.attempt);
  insert into rework_log (work_item_id, project_id, at, reason, by_user, by_role)
  values (w.id, w.project_id, p_at, trim(p_reason), auth.uid(), private.current_role());
  update work_items set status = 'doing', rework = rework + 1, attempt = attempt + 1, seg_start = p_at, end_at = null where id = w.id
  returning version into p_version;
  return p_version;
end $$;

-- ───────────── mold components (AM-06) ─────────────
-- After pre-mold is approved: n components replace the part's single Mold step (or change the count while
-- none has started). Each is a tracked step with its own technician and status.
create or replace function public.set_mold_components(p_part uuid, p_n int) returns void
language plpgsql set search_path = public as $$
declare
  pa parts;
  mold stages;
  premold_done boolean;
begin
  if p_n is null or p_n < 1 or p_n > 50 then raise exception 'Enter how many mold components: a whole number from 1 to 50.' using errcode = 'P0001'; end if;
  select * into pa from parts where id = p_part;
  if not found then raise exception 'That part no longer exists. Reload the page.' using errcode = 'P0001'; end if;
  select * into mold from stages where project_id = pa.project_id and step = 'mold';
  if not found then raise exception 'This project has no Mold production stage.' using errcode = 'P0001'; end if;
  select bool_and(w.status = 'done') into premold_done
  from work_items w join stages s on s.id = w.stage_id where w.part_id = p_part and s.step = 'premold';
  if not coalesce(premold_done, false) then
    raise exception 'Pre-mold production has to pass QC before the mold components are set.' using errcode = 'P0001';
  end if;
  if exists (select 1 from work_items where part_id = p_part and stage_id = mold.id and status <> 'todo') then
    raise exception 'Work has started on this part''s mold, so the number of components can''t change.' using errcode = 'P0001';
  end if;
  delete from work_items where part_id = p_part and stage_id = mold.id;
  insert into work_items (project_id, stage_id, part_id, component_no, component_total)
  select pa.project_id, mold.id, p_part, n, p_n from generate_series(1, p_n) n;
  perform audit_action('part.mold_components', 'parts', p_part::text, pa.project_id, coalesce(pa.serial, pa.name) || ': ' || p_n);
end $$;

-- New projects record which stage is which.
create or replace function public.create_panel_project(p jsonb) returns uuid
language plpgsql set search_path = public as $$
declare
  pid uuid;
  tid uuid;
  x jsonb;
  keys jsonb := '{}';
  new_id uuid;
begin
  select id into tid from templates where key = 'exteriorPanels';
  if tid is null then raise exception 'The Exterior panels template is missing.' using errcode = 'P0001'; end if;

  insert into projects (serial, name, template_id, template_label, client, notes, start_date, delivery_date, status, gated)
  values (trim(p ->> 'serial'), coalesce(p ->> 'name', ''), tid, 'Exterior panels', coalesce(p ->> 'client', ''),
          coalesce(p ->> 'notes', ''), (p ->> 'start_date')::date, nullif(p ->> 'delivery_date', '')::date, 'planned', true)
  returning id into pid;

  insert into stages (project_id, name, station_type, station_id, part_hours, sort, step)
  select pid, ts.name, ts.station_type,
         (select w.id from workstations w where w.station_type = ts.station_type order by w.sort, w.name limit 1), 0, ts.sort, ts.step
  from template_stages ts where ts.template_id = tid;

  for x in select * from jsonb_array_elements(coalesce(p -> 'parts', '[]')) order by (value ->> 'parent_key') is not null loop
    insert into parts (project_id, parent_id, serial, name, description, material, finish_colour, finish_sheen, unit_no, sort)
    values (pid, nullif(keys ->> (x ->> 'parent_key'), '')::uuid, x ->> 'serial', trim(x ->> 'name'), coalesce(x ->> 'description', ''),
            x ->> 'material', x ->> 'finish_colour', x ->> 'finish_sheen', nullif(x ->> 'unit_no', '')::int, (x ->> 'sort')::int)
    returning id into new_id;
    keys := keys || jsonb_build_object(x ->> 'key', new_id);
  end loop;

  insert into work_items (project_id, stage_id, part_id)
  select pid, st.id, pa.id from stages st cross join parts pa
  where st.project_id = pid and pa.project_id = pid
    and not exists (select 1 from parts c where c.parent_id = pa.id);

  perform audit_action('project.create', 'projects', pid::text, pid, trim(p ->> 'serial'));
  return pid;
end $$;
