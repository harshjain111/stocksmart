-- dispatch_transfer(): 4.7's commit action. Posts one negative
-- stock_movements row per line at the sender (reason 'dispatch') via
-- post_movement() — which already refuses to take a balance negative
-- without an explicit override, so "check availability against current
-- stock" is enforced here for real, not just shown as a hint in the UI.
-- Locks in dispatched_qty_g (= the planned qty_g, since this prompt
-- doesn't split partial dispatch — if stock is short, the store manager
-- edits qty_g down first, while the transfer is still draft) and
-- transitions the header to 'dispatched'.
create or replace function public.dispatch_transfer(
  p_transfer_id uuid,
  p_courier text default null,
  p_docket_no text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role public.user_role;
  v_caller_branch_id uuid;
  v_branch_id uuid;
  v_from_department_id uuid;
  v_status public.transfer_status;
  v_line record;
begin
  select role, branch_id into v_caller_role, v_caller_branch_id
    from public.profiles where id = auth.uid();

  select branch_id, from_department_id, status
    into v_branch_id, v_from_department_id, v_status
    from public.transfers
    where id = p_transfer_id
    for update;

  if v_status is null then
    raise exception 'transfer not found';
  end if;

  if v_caller_role = 'admin' then
    null;
  elsif v_caller_role in ('branch_manager', 'store_manager') and v_caller_branch_id = v_branch_id then
    null;
  else
    raise exception 'access denied';
  end if;

  if v_status <> 'draft' then
    raise exception 'only a draft transfer can be dispatched';
  end if;

  if not exists (
    select 1 from public.transfer_lines where transfer_id = p_transfer_id
  ) then
    raise exception 'a transfer needs at least one line before it can be dispatched';
  end if;

  for v_line in
    select id, item_type, item_id, qty_g
    from public.transfer_lines
    where transfer_id = p_transfer_id
  loop
    perform public.post_movement(
      v_from_department_id, v_line.item_type, v_line.item_id, -v_line.qty_g,
      'dispatch', 'transfer', p_transfer_id, false
    );
    update public.transfer_lines
    set dispatched_qty_g = v_line.qty_g
    where id = v_line.id;
  end loop;

  update public.transfers
  set status = 'dispatched',
      dispatched_by = auth.uid(),
      dispatched_at = now(),
      courier = coalesce(p_courier, courier),
      docket_no = coalesce(p_docket_no, docket_no)
  where id = p_transfer_id;
end;
$$;
