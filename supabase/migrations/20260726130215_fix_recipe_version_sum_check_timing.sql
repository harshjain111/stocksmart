-- Fix: recipe_lines_sum_check is DEFERRABLE INITIALLY DEFERRED, meant to
-- fire when create_recipe_version()'s transaction commits. Verified via
-- direct table inserts through PostgREST (test-recipe-immutability.mjs) and
-- via a single raw-SQL statement calling the function — both correctly
-- reject a bad sum. But calling the SAME function through PostgREST's RPC
-- endpoint (supabase-js .rpc()) let a sum of 80 through and persisted it,
-- archiving the previous version and repointing flavours.current_version_id
-- to the bad version. However PostgREST manages the transaction boundary
-- for RPC calls, the deferred check isn't firing before it reports success.
--
-- Fix: force the constraint to be checked immediately, inside the function,
-- right after the lines are inserted — so it can't depend on where the
-- transaction actually ends.

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

  -- Force the deferred sum-to-100 check to run right here instead of
  -- trusting it to fire before the caller sees a result.
  set constraints public.recipe_lines_sum_check immediate;

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
