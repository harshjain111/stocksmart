-- approve_requisition(): the single atomic commit for 4.4's approval
-- consequences. Requires every line to already have a decision (set via
-- the 4.3 screen) — SECURITY DEFINER so it can write requisitions,
-- requisition_lines, transfers, transfer_lines and batches together
-- regardless of the caller's own RLS grants, after checking the caller's
-- role and branch itself.
--
-- Per decision:
--   transfer            -> grouped into one draft transfer from the
--                          branch godown to the requesting department
--   mix_then_transfer   -> a draft batch (a "mixing suggestion") at a
--                          can_mix department in the branch, using the
--                          flavour's current recipe version — the
--                          transfer for its output happens once that
--                          batch is confirmed, not here (batch doesn't
--                          exist as stock yet)
--   buy                 -> left as decision = 'buy', ref_id null — this
--                          is exactly the demand source Phase 5's buy
--                          engine (5.2/5.3) queries directly, so there
--                          is nothing to create yet
--   rejected             -> the decision + decision_note already is the
--                          closure, nothing further to do
create or replace function public.approve_requisition(p_requisition_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role public.user_role;
  v_caller_branch_id uuid;
  v_branch_id uuid;
  v_department_id uuid;
  v_status public.requisition_status;
  v_undecided_count int;
  v_godown_id uuid;
  v_transfer_id uuid;
  v_transfer_no text;
  v_mixing_dept_id uuid;
  v_line record;
  v_recipe_version_id uuid;
  v_wastage_pct numeric;
  v_snapshot_lines jsonb;
  v_batch_id uuid;
  v_batch_no text;
begin
  select role, branch_id into v_caller_role, v_caller_branch_id
    from public.profiles where id = auth.uid();

  select branch_id, department_id, status
    into v_branch_id, v_department_id, v_status
    from public.requisitions
    where id = p_requisition_id
    for update;

  if v_status is null then
    raise exception 'requisition not found';
  end if;

  if v_caller_role = 'admin' then
    null;
  elsif v_caller_role in ('branch_manager', 'store_manager') and v_caller_branch_id = v_branch_id then
    null;
  else
    raise exception 'access denied';
  end if;

  if v_status <> 'submitted' then
    raise exception 'only a submitted requisition can be approved';
  end if;

  select count(*) into v_undecided_count
    from public.requisition_lines
    where requisition_id = p_requisition_id and decision is null;
  if v_undecided_count > 0 then
    raise exception 'every line needs a decision before this requisition can be approved';
  end if;

  select id into v_godown_id
    from public.departments
    where branch_id = v_branch_id and holds_raw = true and is_active = true
    limit 1;
  if v_godown_id is null then
    raise exception 'no godown department found for this branch';
  end if;

  -- transfer: one draft transfer covering every transfer-decision line.
  -- Meaningless (and would double-count stock movements once dispatched
  -- and received) if the requesting department IS the godown itself.
  if v_godown_id = v_department_id and exists (
    select 1 from public.requisition_lines
    where requisition_id = p_requisition_id and decision = 'transfer'
  ) then
    raise exception 'this requisition was raised by the godown department itself — "transfer" is not a valid decision here';
  end if;

  if exists (
    select 1 from public.requisition_lines
    where requisition_id = p_requisition_id and decision = 'transfer'
  ) then
    v_transfer_no := public.next_doc_no('TRF', v_branch_id);

    insert into public.transfers (
      transfer_no, branch_id, from_department_id, to_department_id,
      requisition_id, created_by
    )
    values (
      v_transfer_no, v_branch_id, v_godown_id, v_department_id,
      p_requisition_id, auth.uid()
    )
    returning id into v_transfer_id;

    insert into public.transfer_lines (transfer_id, item_type, item_id, qty_g)
    select v_transfer_id, item_type, item_id, approved_qty_g
    from public.requisition_lines
    where requisition_id = p_requisition_id and decision = 'transfer';

    update public.requisition_lines
    set ref_type = 'transfer', ref_id = v_transfer_id
    where requisition_id = p_requisition_id and decision = 'transfer';
  end if;

  -- mix_then_transfer: one draft batch per line.
  if exists (
    select 1 from public.requisition_lines
    where requisition_id = p_requisition_id and decision = 'mix_then_transfer'
  ) then
    select id into v_mixing_dept_id
      from public.departments
      where branch_id = v_branch_id and can_mix = true and is_active = true
      limit 1;
    if v_mixing_dept_id is null then
      raise exception 'no mixing-capable department found for this branch';
    end if;

    for v_line in
      select id, item_id, approved_qty_g
      from public.requisition_lines
      where requisition_id = p_requisition_id and decision = 'mix_then_transfer'
    loop
      select current_version_id into v_recipe_version_id
        from public.flavours where id = v_line.item_id;
      if v_recipe_version_id is null then
        raise exception 'flavour % has no current recipe version', v_line.item_id;
      end if;

      select wastage_pct into v_wastage_pct
        from public.recipe_versions where id = v_recipe_version_id;

      select jsonb_agg(jsonb_build_object(
        'rawMaterialId', rl.raw_material_id,
        'code', rm.code,
        'name', rm.name,
        'percentage', rl.percentage,
        'plannedG', round(v_line.approved_qty_g * (rl.percentage / 100) * (1 + v_wastage_pct / 100))
      )) into v_snapshot_lines
      from public.recipe_lines rl
      join public.raw_materials rm on rm.id = rl.raw_material_id
      where rl.recipe_version_id = v_recipe_version_id;

      v_batch_no := public.next_doc_no('B', v_branch_id);

      insert into public.batches (
        batch_no, branch_id, flavour_id, recipe_version_id, recipe_snapshot,
        output_g, department_id, status, created_by
      )
      values (
        v_batch_no, v_branch_id, v_line.item_id, v_recipe_version_id,
        jsonb_build_object('wastagePct', v_wastage_pct, 'lines', v_snapshot_lines),
        v_line.approved_qty_g, v_mixing_dept_id, 'draft', auth.uid()
      )
      returning id into v_batch_id;

      insert into public.batch_consumption (batch_id, raw_material_id, planned_g)
      select v_batch_id, (l ->> 'rawMaterialId')::uuid, (l ->> 'plannedG')::bigint
      from jsonb_array_elements(v_snapshot_lines) as l;

      update public.requisition_lines
      set ref_type = 'batch', ref_id = v_batch_id
      where id = v_line.id;
    end loop;
  end if;

  -- buy and rejected: no document to create — decision itself is the
  -- outcome (buy is picked up by Phase 5's engine; rejected is closed).

  update public.requisitions
  set status = 'approved', approved_by = auth.uid(), approved_at = now()
  where id = p_requisition_id;

  perform public.log_audit_event(
    'requisition_approved',
    'requisition',
    p_requisition_id,
    jsonb_build_object('branch_id', v_branch_id, 'department_id', v_department_id)
  );
end;
$$;
