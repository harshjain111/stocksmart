-- Found in manual testing: create_recipe_version() only archived whatever
-- flavours.current_version_id pointed to. A flavour whose pointer had
-- drifted out of sync with recipe_versions.status (e.g. rows inserted
-- directly, bypassing this function) ended up with two versions marked
-- 'current' after calling it — the pointer got updated correctly, but the
-- stale 'current' status on the old row was never touched.
--
-- Fix: archive every OTHER version for this flavour with status='current',
-- not just the one the pointer names. "At most one current version per
-- flavour" becomes a self-healing invariant of this function instead of
-- something that depends on the pointer already being right.

create or replace function public.create_recipe_version(
  p_flavour_id uuid,
  p_wastage_pct numeric,
  p_note text,
  p_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next_version_no integer;
  v_previous_version_id uuid;
  v_new_version_id uuid;
begin
  if public.current_profile_role() <> 'admin' then
    raise exception 'Only admin can create a new recipe version';
  end if;

  select coalesce(max(version_no), 0) + 1 into v_next_version_no
  from public.recipe_versions
  where flavour_id = p_flavour_id;

  select current_version_id into v_previous_version_id
  from public.flavours
  where id = p_flavour_id;

  insert into public.recipe_versions (flavour_id, version_no, wastage_pct, note, status, created_by)
  values (p_flavour_id, v_next_version_no, p_wastage_pct, p_note, 'current', auth.uid())
  returning id into v_new_version_id;

  insert into public.recipe_lines (recipe_version_id, raw_material_id, percentage)
  select v_new_version_id, (line ->> 'raw_material_id')::uuid, (line ->> 'percentage')::numeric
  from jsonb_array_elements(p_lines) as line;

  set constraints public.recipe_lines_sum_check immediate;

  update public.recipe_versions
  set status = 'archived'
  where flavour_id = p_flavour_id
    and status = 'current'
    and id <> v_new_version_id;

  update public.flavours
  set current_version_id = v_new_version_id
  where id = p_flavour_id;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(),
    'version_created',
    'flavour',
    p_flavour_id,
    jsonb_build_object(
      'version_no', v_next_version_no,
      'version_id', v_new_version_id,
      'previous_version_id', v_previous_version_id
    )
  );

  return v_new_version_id;
end;
$$;
