-- Count approval (3.9): approval is what posts count_adjust movements,
-- not submission. One SECURITY DEFINER function does everything
-- atomically — role check, status check, posting a movement per line that
-- actually differs, and locking the count — the same shape as
-- confirm_batch() (2.10).
create or replace function public.approve_stock_count(p_count_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count public.stock_counts%rowtype;
  v_role public.user_role;
  v_line record;
  v_delta_g bigint;
begin
  select role into v_role from public.profiles where id = auth.uid();
  if v_role is null or v_role not in ('admin', 'store_manager') then
    raise exception 'Only admin or store manager can approve a count';
  end if;

  select * into v_count from public.stock_counts where id = p_count_id for update;
  if v_count.id is null then
    raise exception 'Count not found';
  end if;
  if v_count.status <> 'submitted' then
    raise exception 'Count % is not awaiting approval', v_count.count_no;
  end if;

  for v_line in
    select item_type, item_id, system_qty_g, counted_qty_g
    from public.stock_count_lines
    where count_id = p_count_id
  loop
    if v_line.counted_qty_g is null then
      continue;
    end if;
    v_delta_g := v_line.counted_qty_g - v_line.system_qty_g;
    if v_delta_g = 0 then
      continue;
    end if;

    perform public.post_movement(
      v_count.department_id,
      v_line.item_type,
      v_line.item_id,
      v_delta_g,
      'count_adjust',
      'stock_count',
      p_count_id
    );
  end loop;

  update public.stock_counts
  set status = 'approved', approved_by = auth.uid(), approved_at = now()
  where id = p_count_id;
end;
$$;

grant execute on function public.approve_stock_count(uuid) to authenticated;
