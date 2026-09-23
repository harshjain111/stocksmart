-- Fix: recording a party return failed with
--   column "status" is of type party_status but expression is of type text
--
-- The status CASE in record_party_return() returns bare string literals.
-- Postgres types that expression as text and, in an UPDATE ... SET against
-- an enum column, will not cast it implicitly — so every return attempt
-- aborted after the party_return movement had already been posted, leaving
-- the line updated but the party's status stuck on 'out'.
--
-- Only the status expression changes; the rest is the function as
-- originally written (20260910110000), re-created in full because
-- create or replace cannot patch a single statement.
create or replace function public.record_party_return(
  p_party_id uuid,
  p_lines jsonb,
  p_close boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.user_role;
  v_party public.parties%rowtype;
  v_line jsonb;
  v_line_id uuid;
  v_new_returned bigint;
  v_existing public.party_lines%rowtype;
  v_delta bigint;
  v_total_taken bigint;
  v_total_returned bigint;
  v_is_complete boolean;
begin
  select role into v_role from public.profiles where id = auth.uid();
  if v_role is null then
    raise exception 'Not signed in';
  end if;
  if v_role not in ('admin', 'branch_manager', 'store_manager', 'hod', 'gate_man') then
    raise exception 'Your role cannot record party returns';
  end if;

  select * into v_party from public.parties where id = p_party_id for update;
  if v_party.id is null then
    raise exception 'Party not found';
  end if;
  if not public.can_see_party_department(v_party.department_id) then
    raise exception 'You are not authorised to update this party';
  end if;
  if v_party.status in ('completed', 'cancelled') then
    raise exception 'Party % is already closed', v_party.party_no;
  end if;

  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))
  loop
    v_line_id := (v_line ->> 'line_id')::uuid;
    v_new_returned := (v_line ->> 'returned_qty_g')::bigint;

    select * into v_existing
    from public.party_lines
    where id = v_line_id and party_id = p_party_id
    for update;

    if v_existing.id is null then
      raise exception 'Party line not found';
    end if;
    if v_new_returned is null or v_new_returned < 0 then
      raise exception 'Returned quantity cannot be negative';
    end if;
    if v_new_returned > v_existing.taken_qty_g then
      raise exception
        'Cannot return more than went out (took %g, tried to return %g)',
        v_existing.taken_qty_g, v_new_returned;
    end if;

    v_delta := v_new_returned - v_existing.returned_qty_g;
    if v_delta = 0 then
      continue;
    end if;

    update public.party_lines
    set returned_qty_g = v_new_returned
    where id = v_line_id;

    -- Only the change is posted, so correcting a return from 1.5kg to 2kg
    -- adds 0.5kg rather than another 2kg (§56 — no double counting).
    perform public.post_movement(
      v_party.department_id, v_existing.item_type, v_existing.item_id, v_delta,
      'party_return', 'party', p_party_id
    );
  end loop;

  select coalesce(sum(taken_qty_g), 0), coalesce(sum(returned_qty_g), 0)
  into v_total_taken, v_total_returned
  from public.party_lines
  where party_id = p_party_id;

  v_is_complete := p_close or v_total_returned = v_total_taken;

  -- Status is derived from the lines, never set by hand (§22). Closing is
  -- explicit: a party where nothing more is coming back is completed even
  -- though some stock was consumed and will never return.
  update public.parties
  set
    status = (
      case
        when v_is_complete then 'completed'
        when v_total_returned > 0 then 'partially_returned'
        else 'out'
      end
    )::public.party_status,
    closed_at = case when v_is_complete then now() else null end
  where id = p_party_id;
end;
$$;

grant execute on function public.record_party_return(uuid, jsonb, boolean) to authenticated;
