-- Batch confirmation (2.10): capture actual weights (defaulting to
-- planned), post batch_consume (negative, per raw material) and
-- batch_produce (positive, the flavour) movements at the mixing
-- department, and lock the batch. Everything happens in one function so
-- it's all-or-nothing — a partial confirm (movements posted but the batch
-- still draft, or vice versa) can never happen.
--
-- p_actual_grams is a jsonb array of {"rawMaterialId": uuid, "actualG": n}.
-- Any component missing from it keeps its planned_g as the actual (rule 8's
-- masked mixer still ticks a box per component rather than typing a number,
-- so most calls will simply omit lines that weighed exactly as planned).
--
-- No role check beyond "the batch belongs to my branch" — admin,
-- branch_manager, senior_mixer and mixer can all legitimately be the one
-- physically finishing a mix. RLS gives mixer zero direct grant on batches
-- (2.7), so this SECURITY DEFINER function is the only way a mixer can
-- reach this at all, exactly like the masked read path (2.9).
create or replace function public.confirm_batch(
  p_batch_id uuid,
  p_actual_grams jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch public.batches%rowtype;
  v_role public.user_role;
  v_branch_id uuid;
  v_consumption record;
  v_actual_g bigint;
begin
  select role, branch_id into v_role, v_branch_id
  from public.profiles
  where id = auth.uid();

  if v_role is null or v_role not in ('admin', 'branch_manager', 'senior_mixer', 'mixer') then
    raise exception 'Not authorized to confirm a batch';
  end if;

  select * into v_batch from public.batches where id = p_batch_id for update;
  if v_batch.id is null then
    raise exception 'Batch not found';
  end if;
  if v_role <> 'admin' and v_batch.branch_id <> v_branch_id then
    raise exception 'Batch not found';
  end if;
  if v_batch.status <> 'draft' then
    raise exception 'Batch % is not a draft', v_batch.batch_no;
  end if;

  for v_consumption in
    select id, raw_material_id, planned_g
    from public.batch_consumption
    where batch_id = p_batch_id
  loop
    v_actual_g := coalesce(
      (
        select (elem ->> 'actualG')::bigint
        from jsonb_array_elements(p_actual_grams) elem
        where (elem ->> 'rawMaterialId')::uuid = v_consumption.raw_material_id
        limit 1
      ),
      v_consumption.planned_g
    );

    update public.batch_consumption
    set actual_g = v_actual_g
    where id = v_consumption.id;

    perform public.post_movement(
      v_batch.department_id,
      'raw',
      v_consumption.raw_material_id,
      -v_actual_g,
      'batch_consume',
      'batch',
      p_batch_id
    );
  end loop;

  perform public.post_movement(
    v_batch.department_id,
    'flavour',
    v_batch.flavour_id,
    v_batch.output_g,
    'batch_produce',
    'batch',
    p_batch_id
  );

  update public.batches
  set status = 'confirmed', mixed_by = auth.uid(), mixed_at = now()
  where id = p_batch_id;
end;
$$;

grant execute on function public.confirm_batch(uuid, jsonb) to authenticated;
