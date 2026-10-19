-- v2: "Save as template" on a build (docs/ux/DECISIONS.md 2026-10-07). The app prepares the copy
-- (stages, tasks with hours, parts; never dates, people or costs) and this writes it in one transaction.
-- SECURITY INVOKER (the default), so RLS on the template tables decides who may write.
create or replace function public.create_template(p jsonb) returns uuid
language plpgsql set search_path = public as $$
declare
  tid uuid;
  sid uuid;
  s jsonb;
  t jsonb;
  i int := 0;
  j int;
begin
  insert into templates (key, label) values (p ->> 'key', trim(p ->> 'label')) returning id into tid;
  for s in select * from jsonb_array_elements(coalesce(p -> 'stages', '[]')) loop
    i := i + 1;
    insert into template_stages (template_id, name, station_type, part_hours, sort)
    values (tid, s ->> 'name', s ->> 'station_type', (s ->> 'part_hours')::numeric, i)
    returning id into sid;
    j := 0;
    for t in select * from jsonb_array_elements(coalesce(s -> 'tasks', '[]')) loop
      j := j + 1;
      insert into template_tasks (template_id, template_stage_id, name, dur_h, sort)
      values (tid, sid, t ->> 'name', (t ->> 'dur_h')::numeric, j);
    end loop;
  end loop;
  insert into template_parts (template_id, name, sort)
  select tid, x.name, x.ord::int from jsonb_array_elements_text(coalesce(p -> 'parts', '[]')) with ordinality as x(name, ord);
  perform audit_action('template.create', 'templates', tid::text, nullif(p ->> 'from_project', '')::uuid, trim(p ->> 'label'));
  return tid;
end $$;

revoke all on function public.create_template(jsonb) from public, anon;
grant execute on function public.create_template(jsonb) to authenticated, service_role;
