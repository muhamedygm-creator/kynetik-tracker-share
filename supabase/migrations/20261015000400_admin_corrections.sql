-- Owner, 2026-10-15 (docs/ux/DECISIONS.md): Owner and Supervisors can correct model and print data on any step,
-- also while it waits for QC and after it is approved. A Modelling & 3D Printing user can't change a step once it
-- is sent to QC or approved (the app already locked it; now the database does too). A step waiting for QC or
-- approved never loses a value: every field (and the render) must stay filled.

create or replace function public.save_model_data(p_item uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare w public.work_items;
begin
  if not private.may_model(p_item) then
    raise exception 'Only the modeller on this step, or an admin, can enter its model data.' using errcode = '42501';
  end if;
  select wi.* into w from public.work_items wi join public.stages s on s.id = wi.stage_id where wi.id = p_item and s.step = 'modelling';
  if w.id is null then raise exception 'Model data goes on a Modelling step.' using errcode = 'P0001'; end if;
  if (w.qc_since is not null or w.status = 'done') and not private.can_write() then
    raise exception 'This model is with QC or approved; only the Owner or a Supervisor can change it now.' using errcode = '42501';
  end if;
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
  where pa.id = w.part_id;
  if (w.qc_since is not null or w.status = 'done') and not private.model_complete(w.part_id) then
    raise exception 'A model with QC or approved keeps every measurement and its render.' using errcode = 'P0001';
  end if;
end $$;

create or replace function public.save_print_data(p_item uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare w public.work_items;
begin
  if not private.may_print(p_item) then
    raise exception 'Only the person on this print job, or an admin, can enter its print data.' using errcode = '42501';
  end if;
  select wi.* into w from public.work_items wi join public.stages s on s.id = wi.stage_id where wi.id = p_item and s.step = 'printing';
  if w.id is null then raise exception 'Print data goes on a 3D printing step.' using errcode = 'P0001'; end if;
  if (w.qc_since is not null or w.status = 'done') and not private.can_write() then
    raise exception 'This print job is with QC or approved; only the Owner or a Supervisor can change it now.' using errcode = '42501';
  end if;
  update public.parts pa set
    print_filament_g = case when p ? 'print_filament_g' then nullif(p ->> 'print_filament_g', '')::numeric else pa.print_filament_g end,
    print_min        = case when p ? 'print_min'        then nullif(p ->> 'print_min', '')::numeric        else pa.print_min end,
    print_slices     = case when p ? 'print_slices'     then nullif(p ->> 'print_slices', '')::int         else pa.print_slices end,
    print_by = auth.uid(), print_at = now()
  where pa.id = w.part_id;
  if (w.qc_since is not null or w.status = 'done') and not private.print_complete(w.part_id) then
    raise exception 'A print job with QC or approved keeps its filament, printing time and slice components.' using errcode = 'P0001';
  end if;
end $$;
