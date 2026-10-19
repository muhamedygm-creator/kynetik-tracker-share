-- Phase 4: floor log (spec §12). Saving a day replaces its hour logs in one transaction and snapshots
-- each log's hour rate into the owner-only hour_log_cost (§13). Runs as SECURITY DEFINER so a Supervisor
-- can log hours without ever reading a rate; the caller must be Owner or Supervisor.

-- Working hours in a day from the calendar settings (D2: shift minus the break inside it).
create or replace function private.day_hours() returns numeric
language sql stable security definer set search_path = '' as $$
  with c as (select coalesce((select value from public.settings where key = 'calendar'), '{}'::jsonb) v),
  m as (
    select
      extract(epoch from coalesce(v ->> 'shiftStart', '09:00')::time) / 60 s,
      extract(epoch from coalesce(v ->> 'shiftEnd', '18:00')::time) / 60 e,
      extract(epoch from coalesce(v ->> 'breakStart', '13:00')::time) / 60 bs,
      coalesce((v ->> 'breakMins')::numeric, 60) bm
    from c
  )
  select (e - s - greatest(0, least(e, bs + bm) - greatest(s, bs))) / 60 from m
$$;

-- Hour rate for a person now: loaded monthly ÷ working days ÷ day hours; admin class never enters build cost.
create or replace function private.hour_rate(p_person uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select case when p.cost_class = 'admin' then 0 else
    coalesce(pc.base_salary, 0)
      * (1 + coalesce(pc.loading_pct, sc.default_loading_pct, 25) / 100)
      / nullif(coalesce(sc.working_days_per_month, 26), 0)
      / nullif(private.day_hours(), 0)
  end
  from public.people p
  left join public.people_cost pc on pc.person_id = p.id
  left join public.settings_cost sc on true
  where p.id = p_person
$$;

-- Save one day: attendance [{person_id, present}] and logs [{person_id, work_item_id, hours}].
-- Logs that existed before for the same person and part-step keep their original rate (snapshot at logging time).
create or replace function public.commit_day(p_day date, p_attendance jsonb, p_logs jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  cap numeric := private.day_hours();
  over record;
begin
  if not private.can_write() then
    raise exception 'Read-only access. Ask the Owner for Supervisor access to make changes.' using errcode = '42501';
  end if;

  insert into public.attendance (day, person_id, present)
  select distinct on ((a ->> 'person_id')::uuid) p_day, (a ->> 'person_id')::uuid, (a ->> 'present')::boolean
  from jsonb_array_elements(coalesce(p_attendance, '[]')) a
  on conflict (day, person_id) do update set present = excluded.present where public.attendance.present is distinct from excluded.present;

  -- A working day holds `cap` hours per person (§12, §15).
  select p.name, sum((l ->> 'hours')::numeric) h into over
  from jsonb_array_elements(coalesce(p_logs, '[]')) l join public.people p on p.id = (l ->> 'person_id')::uuid
  group by p.name having sum((l ->> 'hours')::numeric) > cap limit 1;
  if found then
    raise exception '% already has %h on % — a working day holds %h.', over.name, trim_scale(over.h), to_char(p_day, 'FMDD Mon'), trim_scale(cap) using errcode = 'P0001';
  end if;

  drop table if exists _old_rates;
  create temp table _old_rates on commit drop as
    select l.person_id, l.work_item_id, max(c.rate) rate
    from public.hour_logs l join public.hour_log_cost c on c.log_id = l.id
    where l.day = p_day group by l.person_id, l.work_item_id;

  delete from public.hour_logs where day = p_day;  -- hour_log_cost cascades

  with ins as (
    insert into public.hour_logs (day, person_id, work_item_id, project_id, hours, created_by)
    select p_day, (l ->> 'person_id')::uuid, w.id, w.project_id, (l ->> 'hours')::numeric, auth.uid()
    from jsonb_array_elements(coalesce(p_logs, '[]')) l
    join public.work_items w on w.id = (l ->> 'work_item_id')::uuid
    where (l ->> 'hours')::numeric > 0
    returning id, person_id, work_item_id, hours
  )
  insert into public.hour_log_cost (log_id, rate, cost)
  select ins.id, r.rate, round(ins.hours * r.rate, 2)
  from ins
  cross join lateral (
    select coalesce((select o.rate from _old_rates o where o.person_id = ins.person_id and o.work_item_id = ins.work_item_id), private.hour_rate(ins.person_id), 0) rate
  ) r;
end $$;

revoke all on function public.commit_day(date, jsonb, jsonb) from public, anon;
grant execute on function public.commit_day(date, jsonb, jsonb) to authenticated, service_role;
revoke all on function private.day_hours(), private.hour_rate(uuid) from public, anon, authenticated;

-- Labour per day for the owner (Floor log tiles / This week). security_invoker: owner-only via hour_log_cost RLS.
create or replace view public.day_labour with (security_invoker = true) as
  select l.day, l.person_id, sum(c.cost)::numeric(12,2) as cost
  from public.hour_logs l join public.hour_log_cost c on c.log_id = l.id
  group by l.day, l.person_id;
grant select on public.day_labour to authenticated;
revoke all on public.day_labour from anon;
