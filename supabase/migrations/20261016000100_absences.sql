-- Amends round 4 (Owner, 2026-10-16; docs/ux/DECISIONS.md), AM-29: Floor log attendance.
--   · Everyone is present by default; an admin marks someone absent for a number of working days with a leave
--     type (sick, annual, unpaid / other, unexcused) and an optional note.
--   · Before saving, each of their pending tasks is reassigned or kept; the first kept task is pinned to start at
--     shift start on the day they return (the app works out the dates on the shop calendar).
--   · No hours can be logged for someone on a day they are marked absent (cancel or shorten the absence first).
--   · Absences can be edited or cancelled; every change is in the audit log (generic trigger).

create type public.leave_type as enum ('sick', 'annual', 'unpaid', 'unexcused');

create table public.absences (
  id           uuid primary key default gen_random_uuid(),
  person_id    uuid not null references public.people (id) on delete cascade,
  kind         public.leave_type not null,
  starts_on    date not null,
  days         integer not null check (days between 1 and 365),
  -- Last absent working day and the day they are back, from the shop calendar (rest days and holidays skipped).
  ends_on      date not null,
  back_on      date not null,
  note         text not null default '' check (length(note) <= 1000),
  cancelled_at timestamptz,
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  version      integer not null default 1,
  check (ends_on >= starts_on and back_on > ends_on)
);
create index absences_person_idx on public.absences (person_id, starts_on);
alter table public.absences enable row level security;
select private.standard_triggers('absences');
select private.member_policies('absences');

-- Someone marked absent on a day can't have hours logged that day.
create or replace function private.no_hours_when_absent() returns trigger
language plpgsql security definer set search_path = '' as $$
declare a public.absences; who text;
begin
  select * into a from public.absences
  where person_id = new.person_id and cancelled_at is null and new.day between starts_on and ends_on limit 1;
  if found then
    select name into who from public.people where id = new.person_id;
    raise exception '% is marked absent on %. Cancel or shorten the absence before logging hours.', who, to_char(new.day, 'DD Mon')
      using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger hour_logs_absent before insert or update on public.hour_logs
  for each row execute function private.no_hours_when_absent();

-- Mark someone absent, with the decision on each pending task, in one go. SECURITY INVOKER: RLS applies.
--   p_reassign: [{ "task": queue task id, "to": person id }]; their linked part steps move too.
--   p_push_task / p_push_at: the first kept task, pinned to start when they are back.
create or replace function public.mark_absent(p_person uuid, p_kind public.leave_type, p_starts date, p_days integer,
  p_ends date, p_back date, p_note text, p_reassign jsonb, p_push_task uuid, p_push_at timestamptz) returns uuid
language plpgsql set search_path = public as $$
declare r jsonb; t queue_tasks; new_id uuid;
begin
  if not private.can_write() then
    raise exception 'Only the Owner and Supervisors mark someone absent.' using errcode = '42501';
  end if;
  if exists (select 1 from absences where person_id = p_person and cancelled_at is null
             and daterange(starts_on, ends_on, '[]') && daterange(p_starts, p_ends, '[]')) then
    raise exception 'This person already has an absence in those days. Edit that one instead.' using errcode = 'P0001';
  end if;
  insert into absences (person_id, kind, starts_on, days, ends_on, back_on, note, created_by)
  values (p_person, p_kind, p_starts, p_days, p_ends, p_back, trim(coalesce(p_note, '')), auth.uid())
  returning id into new_id;

  for r in select * from jsonb_array_elements(coalesce(p_reassign, '[]')) loop
    select * into t from queue_tasks where id = (r ->> 'task')::uuid and person_id = p_person and status <> 'done';
    continue when not found;
    if (r ->> 'to')::uuid = p_person then continue; end if;
    update queue_tasks set person_id = (r ->> 'to')::uuid, fixed_start = null where id = t.id;
    if t.work_item_id is not null then
      update work_items set tech_id = (r ->> 'to')::uuid where id = t.work_item_id and status <> 'done';
    end if;
  end loop;

  if p_push_task is not null then
    update queue_tasks set fixed_start = p_push_at where id = p_push_task and person_id = p_person and status <> 'done';
  end if;

  perform audit_action('absence', 'absences', new_id::text, null,
    (select name from people where id = p_person) || ' · ' || p_kind::text || ' from ' || to_char(p_starts, 'DD Mon') || ', ' || p_days || ' working day(s), back ' || to_char(p_back, 'DD Mon'),
    jsonb_build_object('reassigned', jsonb_array_length(coalesce(p_reassign, '[]')), 'pushed', p_push_task is not null));
  return new_id;
end $$;
revoke all on function public.mark_absent(uuid, public.leave_type, date, integer, date, date, text, jsonb, uuid, timestamptz) from public, anon;
grant execute on function public.mark_absent(uuid, public.leave_type, date, integer, date, date, text, jsonb, uuid, timestamptz) to authenticated;
