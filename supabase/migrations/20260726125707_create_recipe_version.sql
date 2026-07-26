-- Atomically creates a new recipe version: insert the version, insert its
-- lines (the deferred sum-to-100 constraint fires when this function's
-- transaction commits, rolling back everything below if it fails),
-- archive the flavour's previous current version, repoint
-- flavours.current_version_id, and log the change. All in one transaction
-- so there's no window where a half-created version could be observed.
--
-- There is deliberately no update_recipe_version function — "editing"
-- a recipe only ever means calling this again.

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

  if v_previous_version_id is not null then
    update public.recipe_versions
    set status = 'archived'
    where id = v_previous_version_id;
  end if;

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

grant execute on function public.create_recipe_version(uuid, numeric, text, jsonb) to authenticated;
