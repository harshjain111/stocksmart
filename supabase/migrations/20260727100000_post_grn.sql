-- post_grn(): 4.11's commit action, the only place a GRN moves stock.
--
-- Per line, the receiving department always ends up credited with
-- exactly (received_qty_g + damaged_qty_g) — damaged goods physically
-- occupy real inventory even though they aren't usable, so they count
-- as real stock here; a later stock count is what eventually writes
-- them off via count_adjust, matching how every other physical-vs-book
-- discrepancy in this system gets reconciled.
--
-- The transit_loss requirement ("post a transit_loss movement so the
-- ledger always balances") is implemented as a reporting-friendly split
-- of that same net credit rather than a second, separately-accounted
-- deduction: when internal and short, post +expected_qty_g (reason
-- grn_transfer) and -shortfall (reason transit_loss) — together they
-- net to the same total as posting the arrived amount directly, but
-- the loss now has its own reason-coded, queryable stock_movements row
-- for the transit variance report (4.12), which — per rule "don't
-- build reporting on stock_balances, build it on stock_movements" —
-- needs that row to exist rather than inferring loss from a difference
-- between two documents. When exactly matched or over-received, the
-- arrived amount is posted directly with no transit_loss row and no
-- special handling: an over-receipt is simply more physical stock
-- than the paperwork expected, not a loss.
--
-- Over-receipt requires the line's over_received flag AND a reason
-- (validated here again, not just trusted from the UI, since this is
-- the actual commit point). Vendor-source GRNs use grn_vendor and have
-- no transit_loss concept — that's specific to internal transfers.
create or replace function public.post_grn(p_grn_id uuid)
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
  v_source public.grn_source;
  v_transfer_id uuid;
  v_status public.grn_status;
  v_line record;
  v_total_arrived bigint;
  v_shortfall bigint;
  v_any_shortfall boolean := false;
  v_any_discrepancy boolean := false;
begin
  select role, branch_id into v_caller_role, v_caller_branch_id
    from public.profiles where id = auth.uid();

  select branch_id, department_id, source, transfer_id, status
    into v_branch_id, v_department_id, v_source, v_transfer_id, v_status
    from public.grns
    where id = p_grn_id
    for update;

  if v_status is null then
    raise exception 'grn not found';
  end if;

  if v_caller_role = 'admin' then
    null;
  elsif v_caller_role in ('branch_manager', 'store_manager') and v_caller_branch_id = v_branch_id then
    null;
  elsif v_caller_role = 'hod' and public.is_assigned_to_department(v_department_id) then
    null;
  else
    raise exception 'access denied';
  end if;

  if v_status <> 'draft' then
    raise exception 'only a draft grn can be posted';
  end if;

  if exists (
    select 1 from public.grn_lines where grn_id = p_grn_id and received_qty_g is null
  ) then
    raise exception 'every line needs a received quantity before this grn can be posted';
  end if;

  for v_line in
    select id, item_type, item_id, expected_qty_g,
           coalesce(received_qty_g, 0) as received_qty_g,
           coalesce(damaged_qty_g, 0) as damaged_qty_g,
           reason, over_received
    from public.grn_lines
    where grn_id = p_grn_id
  loop
    v_total_arrived := v_line.received_qty_g + v_line.damaged_qty_g;
    v_shortfall := v_line.expected_qty_g - v_total_arrived;

    if v_shortfall > 0 and coalesce(trim(v_line.reason), '') = '' then
      raise exception 'a reason is required for the short receipt of item %', v_line.item_id;
    end if;

    if v_shortfall < 0 and (not v_line.over_received or coalesce(trim(v_line.reason), '') = '') then
      raise exception 'over-receipt of item % needs the explicit over-received flag and a reason', v_line.item_id;
    end if;

    if v_shortfall <> 0 then
      v_any_discrepancy := true;
    end if;

    if v_source = 'internal' and v_shortfall > 0 then
      perform public.post_movement(
        v_department_id, v_line.item_type, v_line.item_id, v_line.expected_qty_g,
        'grn_transfer', 'grn', p_grn_id, false
      );
      perform public.post_movement(
        v_department_id, v_line.item_type, v_line.item_id, -v_shortfall,
        'transit_loss', 'grn', p_grn_id, true
      );
      v_any_shortfall := true;
    else
      perform public.post_movement(
        v_department_id, v_line.item_type, v_line.item_id, v_total_arrived,
        (case when v_source = 'internal' then 'grn_transfer' else 'grn_vendor' end)::public.movement_reason,
        'grn', p_grn_id, false
      );
    end if;
  end loop;

  update public.grns
  set status = 'posted', posted_by = auth.uid(), posted_at = now()
  where id = p_grn_id;

  if v_source = 'internal' and v_any_shortfall and v_transfer_id is not null then
    update public.transfers
    set status = 'short_closed'
    where id = v_transfer_id;
  end if;

  if v_any_discrepancy then
    perform public.log_audit_event(
      'grn_discrepancy',
      'grn',
      p_grn_id,
      jsonb_build_object('branch_id', v_branch_id, 'department_id', v_department_id)
    );
  end if;
end;
$$;
