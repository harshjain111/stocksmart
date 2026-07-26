-- 5.6: extends post_grn() (4.11) to finish the vendor path. Everything
-- from the original function is unchanged — same access checks, same
-- shortfall/over-receipt validation, same stock movements (the
-- grn_vendor reason was already wired in 4.11, just never exercised).
-- New for vendor-source grns, after movements are posted:
--   1. Every line with a rate set writes a new supplier_rates row
--      (source 'grn') — a blank rate writes nothing, matching "a blank
--      rate is valid."
--   2. purchase_orders.status is recomputed from cumulative received
--      quantity across every posted vendor grn against that PO (not
--      just this one) — a PO can be receipted across more than one
--      shipment, so "received" only applies once every line's running
--      total (received + damaged, same "physically arrived" definition
--      used for the internal shortfall math above) meets its ordered
--      qty_g; otherwise it's "partially_received".
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
  v_purchase_order_id uuid;
  v_status public.grn_status;
  v_line record;
  v_total_arrived bigint;
  v_shortfall bigint;
  v_any_shortfall boolean := false;
  v_any_discrepancy boolean := false;
  v_supplier_id uuid;
  v_fully_received boolean;
begin
  select role, branch_id into v_caller_role, v_caller_branch_id
    from public.profiles where id = auth.uid();

  select branch_id, department_id, source, transfer_id, purchase_order_id, status
    into v_branch_id, v_department_id, v_source, v_transfer_id, v_purchase_order_id, v_status
    from public.grns
    where id = p_grn_id
    for update;

  if v_status is null then
    raise exception 'grn not found';
  end if;

  if v_caller_role = 'admin' then
    null;
  elsif v_caller_role in ('branch_manager', 'store_manager', 'purchase_manager') and v_caller_branch_id = v_branch_id then
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

  if v_source = 'vendor' then
    select supplier_id into v_supplier_id from public.purchase_orders where id = v_purchase_order_id;
  end if;

  for v_line in
    select id, item_type, item_id, expected_qty_g,
           coalesce(received_qty_g, 0) as received_qty_g,
           coalesce(damaged_qty_g, 0) as damaged_qty_g,
           reason, over_received, rate
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

    if v_source = 'vendor' and v_line.rate is not null then
      insert into public.supplier_rates (raw_material_id, supplier_id, rate, source, created_by)
      values (v_line.item_id, v_supplier_id, v_line.rate, 'grn', auth.uid());
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

  if v_source = 'vendor' and v_purchase_order_id is not null then
    select not exists (
      select 1
      from public.po_lines pl
      where pl.purchase_order_id = v_purchase_order_id
        and pl.qty_g > coalesce((
          select sum(coalesce(gl.received_qty_g, 0) + coalesce(gl.damaged_qty_g, 0))
          from public.grn_lines gl
          join public.grns g on g.id = gl.grn_id
          where g.purchase_order_id = v_purchase_order_id
            and g.status = 'posted'
            and gl.item_type = 'raw'
            and gl.item_id = pl.raw_material_id
        ), 0)
    ) into v_fully_received;

    update public.purchase_orders
    set status = case when v_fully_received then 'received' else 'partially_received' end::public.purchase_order_status
    where id = v_purchase_order_id;
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
