-- Rollback: make an archived version current again. No data is copied or
-- rewritten — only status flags flip and the flavour's pointer moves.
-- Same "archive every other current version" defensive pattern as
-- create_recipe_version, so the invariant holds regardless of any drift.

create or replace function public.rollback_recipe_version(p_version_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_flavour_id uuid;
  v_status text;
begin
  if public.current_profile_role() <> 'admin' then
    raise exception 'Only admin can roll back a recipe version';
  end if;

  select flavour_id, status into v_flavour_id, v_status
  from public.recipe_versions
  where id = p_version_id;

  if v_flavour_id is null then
    raise exception 'Version not found';
  end if;

  if v_status <> 'archived' then
    raise exception 'Only an archived version can be made current again';
  end if;

  update public.recipe_versions
  set status = 'archived'
  where flavour_id = v_flavour_id
    and status = 'current';

  update public.recipe_versions
  set status = 'current'
  where id = p_version_id;

  update public.flavours
  set current_version_id = p_version_id
  where id = v_flavour_id;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(),
    'version_rollback',
    'flavour',
    v_flavour_id,
    jsonb_build_object('version_id', p_version_id)
  );
end;
$$;

grant execute on function public.rollback_recipe_version(uuid) to authenticated;
