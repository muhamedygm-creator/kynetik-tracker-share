-- Amends round 2026-10-12 (AMENDS_NEXT_ROUND.md AM-01, AM-04, AM-11; answers in docs/ux/DECISIONS.md):
--   · parts get a serial (unique across the whole system and never reused), a parent (one level only:
--     a part with sub-parts is a folder), description, material and finish;
--   · projects made on the new workflow are "gated" (old projects keep working as they do now);
--   · a Modelling department and station type;
--   · the 10-stage "Exterior panels" template replaces the old ones for new projects (old ones archived).

-- ───────────── Modelling department ─────────────
insert into public.station_types (key, label, colour, sort)
values ('modelling', 'Modelling', '#9C8FC4', -1)
on conflict (key) do nothing;

insert into public.departments (key, name, colour, emoji, sort)
values ('modelling', 'Modelling', '#9C8FC4', '📐', -1)
on conflict (key) do nothing;

-- ───────────── parts: serial, sub-parts, material and finish ─────────────
alter table public.parts
  add column serial        text check (serial ~ '^\d{2}-\d{2}-\d{3}(-[A-Z])?(-[1-9]\d*)?$'),
  add column parent_id     uuid references public.parts (id) on delete cascade,
  add column description   text not null default '',
  add column material      text check (material in ('Carbon fiber', 'Twill', 'Forged carbon', 'Fiberglass')),
  add column finish_colour text,
  add column finish_sheen  text check (finish_sheen in ('Matte', 'Satin', 'Gloss')),
  add column unit_no       integer check (unit_no >= 1),
  add check (parent_id is null or parent_id <> id);

create unique index parts_serial_key on public.parts (lower(serial)) where serial is not null;
create index parts_parent_idx on public.parts (parent_id) where parent_id is not null;

-- Two units of one part share a name, so names stay unique only for old (serial-less) parts.
drop index public.parts_project_name_key;
create unique index parts_project_name_key on public.parts (project_id, lower(name)) where serial is null;

-- One level only, same project.
create or replace function private.check_part_parent() returns trigger
language plpgsql security definer set search_path = '' as $$
declare par public.parts;
begin
  if new.parent_id is null then return new; end if;
  select * into par from public.parts where id = new.parent_id;
  if par.project_id <> new.project_id then
    raise exception 'A sub-part belongs to the same project as its parent.' using errcode = 'P0001';
  end if;
  if par.parent_id is not null then
    raise exception 'Only one level of sub-parts: % is already a sub-part.', coalesce(par.serial, par.name) using errcode = 'P0001';
  end if;
  if exists (select 1 from public.parts c where c.parent_id = new.id) then
    raise exception 'A part with sub-parts can''t become a sub-part.' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger check_part_parent before insert or update of parent_id, project_id on public.parts
  for each row execute function private.check_part_parent();

-- Serials are never reused: every serial ever given is kept here, even after its part is deleted.
create table public.serial_registry (
  serial     text primary key,
  created_at timestamptz not null default now()
);
alter table public.serial_registry enable row level security;
alter table public.serial_registry force row level security;
revoke all on public.serial_registry from anon;
grant select on public.serial_registry to authenticated;
grant all on public.serial_registry to service_role;
create policy serial_registry_read on public.serial_registry for select to authenticated using (private.is_member());

create or replace function private.register_serial() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.serial is null or (tg_op = 'UPDATE' and lower(new.serial) = lower(coalesce(old.serial, ''))) then return new; end if;
  insert into public.serial_registry (serial) values (lower(new.serial)) on conflict do nothing;
  if not found then
    raise exception 'Serial % has already been used. Serials are never reused.', new.serial using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger register_serial before insert or update of serial on public.parts
  for each row execute function private.register_serial();

-- ───────────── projects on the new workflow ─────────────
alter table public.projects add column gated boolean not null default false;

-- ───────────── the 10-stage Exterior panels template ─────────────
-- On a fresh database the station types come with the seed (after migrations), so the seed adds the
-- template there (supabase/seed/generate.ts); here it is added for a database that already has them.
do $$
declare tid uuid;
begin
  if (select count(*) from public.station_types where key in ('modification', 'fitment', 'paint')) < 3 then
    return;
  end if;
  insert into public.templates (key, label) values ('exteriorPanels', 'Exterior panels')
  on conflict (key) do nothing returning id into tid;
  if tid is not null then
    insert into public.template_stages (template_id, name, station_type, part_hours, sort)
    select tid, s.name, s.station_type, 0, s.sort
    from (values
      ('Modelling', 'modelling', 0),
      ('3D printing', 'modification', 1),
      ('Prototyping', 'modification', 2),
      ('Pre-mold production', 'modification', 3),
      ('Mold production', 'modification', 4),
      ('Carbon fibre component production', 'modification', 5),
      ('Fitment', 'fitment', 6),
      ('Paint preparation & painting', 'paint', 7),
      ('Sanding & polishing', 'paint', 8),
      ('Assembly', 'fitment', 9)
    ) as s (name, station_type, sort);
  end if;
  update public.templates set archived = true where key <> 'exteriorPanels' and not archived;
end $$;

-- ───────────── create a project on the new workflow ─────────────
-- p: { serial, name, client, notes, start_date, delivery_date,
--      parts: [{ key, parent_key, serial, name, description, material, finish_colour, finish_sheen, unit_no, sort }] }
-- Stages come from the Exterior panels template (first workstation of each type). Work items are made for
-- trackable parts only: a part with sub-parts is a folder. No tasks: admins set every time (AM-08).
-- SECURITY INVOKER, so RLS decides who may write.
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

  insert into stages (project_id, name, station_type, station_id, part_hours, sort)
  select pid, ts.name, ts.station_type,
         (select w.id from workstations w where w.station_type = ts.station_type order by w.sort, w.name limit 1), 0, ts.sort
  from template_stages ts where ts.template_id = tid;

  -- Parents first, so sub-parts can point at them.
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

-- Add parts (and their sub-parts) to a project on the new workflow; same payload shape as above, plus
-- parent_id for a sub-part added under an existing part. A part that gains its first sub-part becomes a
-- folder: its own work items go, as long as none of them has started.
create or replace function public.add_panel_parts(p_project uuid, p_parts jsonb) returns void
language plpgsql set search_path = public as $$
declare
  x jsonb;
  keys jsonb := '{}';
  new_id uuid;
  par uuid;
begin
  for x in select * from jsonb_array_elements(coalesce(p_parts, '[]')) order by (value ->> 'parent_key') is not null loop
    par := coalesce(nullif(x ->> 'parent_id', '')::uuid, nullif(keys ->> (x ->> 'parent_key'), '')::uuid);
    if par is not null and exists (select 1 from work_items w where w.part_id = par and w.status <> 'todo') then
      raise exception 'That part has work started on it, so it can''t be split into sub-parts.' using errcode = 'P0001';
    end if;
    insert into parts (project_id, parent_id, serial, name, description, material, finish_colour, finish_sheen, unit_no, sort)
    values (p_project, par, x ->> 'serial', trim(x ->> 'name'), coalesce(x ->> 'description', ''),
            x ->> 'material', x ->> 'finish_colour', x ->> 'finish_sheen', nullif(x ->> 'unit_no', '')::int,
            coalesce((x ->> 'sort')::int, (select coalesce(max(sort), -1) + 1 from parts where project_id = p_project)))
    returning id into new_id;
    keys := keys || jsonb_build_object(x ->> 'key', new_id);
    if par is not null then delete from work_items w where w.part_id = par; end if;
  end loop;

  insert into work_items (project_id, stage_id, part_id)
  select p_project, st.id, pa.id from stages st cross join parts pa
  where st.project_id = p_project and pa.project_id = p_project
    and not exists (select 1 from parts c where c.parent_id = pa.id)
    and not exists (select 1 from work_items w where w.stage_id = st.id and w.part_id = pa.id);
end $$;
