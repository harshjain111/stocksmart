-- Fixes a mismatch found while building 4.7 (Send & receive > Send out):
-- the transfer_lines migration's own comment says qty_g should stay
-- editable while the transfer is still draft (only dispatched_qty_g is
-- exclusively post-draft, set once at dispatch) — matching the same
-- pattern already used for requisition_lines. The trigger code itself
-- froze qty_g unconditionally instead, so a store manager reviewing a
-- transfer created from an approval had no way to correct a planned
-- quantity before dispatch (e.g. if less stock turns out to be
-- available than was approved).

create or replace function public.block_transfer_line_mutations()
returns trigger
language plpgsql
as $$
declare
  v_status public.transfer_status;
begin
  if tg_op = 'DELETE' then
    raise exception 'transfer_lines rows are never deleted';
  end if;

  select status into v_status from public.transfers where id = old.transfer_id;
  if v_status not in ('draft', 'dispatched') then
    raise exception 'transfer_lines cannot be edited once the transfer is received or closed';
  end if;

  if new.transfer_id <> old.transfer_id
     or new.item_type <> old.item_type
     or new.item_id <> old.item_id then
    raise exception 'transfer_lines identity cannot change';
  end if;

  if v_status = 'dispatched' and new.qty_g <> old.qty_g then
    raise exception 'transfer_lines planned qty_g is locked once dispatched';
  end if;

  return new;
end;
$$;
