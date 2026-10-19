-- Owner, 2026-10-15 (docs/ux/DECISIONS.md): "Preview as Modelling & 3D Printing". The Owner tests the role's
-- pages from their own login; a Submit for QC sent from the preview also shows on Requests, as a Modelling &
-- 3D Printing user's would (submit_qc only adds the request for non-admins). Sent by the Owner's login.
create or replace function public.preview_qc_request(p_item uuid, p_notes text default '') returns void
language plpgsql security definer set search_path = public as $$
declare w work_items; st stages; pa parts;
begin
  if private.current_role() is distinct from 'owner' then
    raise exception 'Only the Owner can use the preview.' using errcode = '42501';
  end if;
  select * into w from work_items where id = p_item;
  if not found or w.qc_since is null then return; end if;
  if exists (select 1 from requests r where r.work_item_id = w.id and r.kind = 'qc' and r.status = 'pending') then return; end if;
  select * into st from stages where id = w.stage_id;
  select * into pa from parts where id = w.part_id;
  insert into requests (kind, queue_task_id, work_item_id, person_id, task_title, notes, sent_by)
  values ('qc', (select q.id from queue_tasks q where q.work_item_id = w.id order by q.created_at limit 1), w.id, w.tech_id,
          trim(coalesce(pa.serial, '') || ' ' || coalesce(pa.name, '')) || ': ' || st.name, trim(coalesce(p_notes, '')), auth.uid());
end $$;
revoke all on function public.preview_qc_request(uuid, text) from public, anon;
grant execute on function public.preview_qc_request(uuid, text) to authenticated;
