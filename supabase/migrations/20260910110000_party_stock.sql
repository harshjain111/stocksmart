-- Stock module redesign, part 2 of 3: party stock (spec §19-§26).
--
-- A party is flavour leaving an office for an event and (mostly) coming
-- back. What did not come back was consumed. That is the whole model.
--
-- Consumption is never stored and never typed in by anyone (§23): it is
-- taken_qty_g - returned_qty_g, derived wherever it is needed. Storing it
-- would create a second source of truth that could disagree with the two
-- numbers it comes from.
--
-- Stock effects go through post_movement() like everything else (rule 2):
-- issuing posts a negative party_issue at the office, returning posts a
-- positive party_return. Both are recorded, so the ledger shows the round
-- trip rather than a single net figure (§26).

create type public.party_status as enum (
  'out',
  'partially_returned',
  'completed',
  'cancelled'
);

create table public.parties (
  id uuid primary key default gen_random_uuid(),
  party_no text not null,
  branch_id uuid not null references public.branches (id),
  -- The office the stock leaves from and returns to. Party stock is always
  -- an office movement; the godown supplies offices by transfer, not
  -- parties directly.
  department_id uuid not null references public.departments (id),
  party_name text not null check (length(trim(party_name)) > 0),
  event_date date not null,
  -- Drives the "return pending" warning (§22). Optional: plenty of parties
  -- have no agreed return date.
  expected_return_date date,
  status public.party_status not null default 'out',
  notes text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  cancelled_reason text,
  unique (branch_id, party_no)
);

create index parties_department_status on public.parties (department_id, status);
create index parties_event_date on public.parties (event_date desc);

create table public.party_lines (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references public.parties (id),
  item_type public.item_type not null,
  item_id uuid not null,
  taken_qty_g bigint not null check (taken_qty_g > 0),
  returned_qty_g bigint not null default 0 check (returned_qty_g >= 0),
  -- §21/§67: you cannot return more than went out. The business has no
  -- over-return concept, and allowing one would silently manufacture stock.
  constraint party_lines_return_not_more_than_taken
    check (returned_qty_g <= taken_qty_g),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (party_id, item_type, item_id)
);

create index party_lines_party on public.party_lines (party_id);

create trigger parties_set_updated_at
  before update on public.parties
  for each row execute function public.set_updated_at();

create trigger party_lines_set_updated_at
  before update on public.party_lines
  for each row execute function public.set_updated_at();

-- Nothing is ever deleted (rule 7), and the identity of a party never
-- changes. A cancelled or completed party is closed for good.
create or replace function public.block_party_mutations()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'parties rows are never deleted — cancel the party instead';
  end if;

  if new.party_no <> old.party_no
     or new.branch_id <> old.branch_id
     or new.department_id <> old.department_id
     or new.created_by is distinct from old.created_by
     or new.created_at <> old.created_at then
    raise exception 'party identity cannot change';
  end if;

  if old.status in ('completed', 'cancelled')
     and new.status is distinct from old.status then
    raise exception 'party % is already closed', old.party_no;
  end if;

  return new;
end;
$$;

create trigger parties_block_mutations
  before update or delete on public.parties
  for each row execute function public.block_party_mutations();

-- Lines: never deleted, and taken_qty_g is fixed once issued — the stock
-- has physically left. Changing it after the fact would desynchronise the
-- line from the party_issue movement already in the ledger. Only the
-- returned quantity and notes move.
create or replace function public.block_party_line_mutations()
returns trigger
language plpgsql
as $$
declare
  v_status public.party_status;
begin
  if tg_op = 'DELETE' then
    raise exception 'party_lines rows are never deleted';
  end if;

  if new.party_id <> old.party_id
     or new.item_type <> old.item_type
     or new.item_id is distinct from old.item_id
     or new.taken_qty_g <> old.taken_qty_g then
    raise exception
      'party line identity and taken quantity cannot change once issued';
  end if;

  select status into v_status from public.parties where id = old.party_id;
  if v_status in ('completed', 'cancelled') then
    raise exception 'party is closed — its lines can no longer change';
  end if;

  return new;
end;
$$;

create trigger party_lines_block_mutations
  before update or delete on public.party_lines
  for each row execute function public.block_party_line_mutations();

alter table public.parties enable row level security;
alter table public.party_lines enable row level security;

-- Who can see a party. The gate man is scoped to the departments he is
-- actually assigned to, exactly like an hod — he should see the parties at
-- his own gate and nobody else's (§25, §46).
create or replace function public.can_see_party_department(dept_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    public.current_profile_role() = 'admin'
    or (
      public.current_profile_role() in ('branch_manager', 'store_manager')
      and dept_id in (
        select id from public.departments
        where branch_id = public.current_profile_branch_id()
      )
    )
    or (
      public.current_profile_role() in ('hod', 'gate_man')
      and public.is_assigned_to_department(dept_id)
    );
$$;

grant execute on function public.can_see_party_department(uuid) to authenticated;

create policy parties_select on public.parties
for select
using (public.can_see_party_department(department_id));

create policy party_lines_select on public.party_lines
for select
using (
  exists (
    select 1 from public.parties p
    where p.id = party_lines.party_id
      and public.can_see_party_department(p.department_id)
  )
);

-- No insert/update/delete policy on either table, deliberately, and by the
-- same reasoning as stock_movements: the only ways to create a party, issue
-- stock or record a return are the SECURITY DEFINER functions below, which
-- post the matching movements in the same transaction. Without that there
-- is no way to write a party line and forget to move the stock.

-- ---------------------------------------------------------------------------
-- Issuing stock to a party (§20, §26)
-- ---------------------------------------------------------------------------
create or replace function public.issue_party_stock(
  p_department_id uuid,
  p_party_name text,
  p_event_date date,
  p_expected_return_date date,
  p_lines jsonb,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.user_role;
  v_branch_id uuid;
  v_party_id uuid;
  v_party_no text;
  v_line jsonb;
  v_item_type public.item_type;
  v_item_id uuid;
  v_qty_g bigint;
begin
  select role into v_role from public.profiles where id = auth.uid();
  if v_role is null then
    raise exception 'Not signed in';
  end if;
  if v_role not in ('admin', 'branch_manager', 'store_manager', 'hod', 'gate_man') then
    raise exception 'Your role cannot issue party stock';
  end if;

  -- Location authorisation is enforced here, server-side, not by which
  -- dropdown the UI happened to render (§47, §48).
  if not public.can_see_party_department(p_department_id) then
    raise exception 'You are not authorised to issue stock from this location';
  end if;

  select branch_id into v_branch_id
  from public.departments
  where id = p_department_id and is_active;
  if v_branch_id is null then
    raise exception 'Location not found';
  end if;

  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then
    raise exception 'A party needs at least one flavour';
  end if;

  v_party_no := public.next_doc_no('PARTY', v_branch_id);

  insert into public.parties
    (party_no, branch_id, department_id, party_name, event_date,
     expected_return_date, notes, created_by)
  values
    (v_party_no, v_branch_id, p_department_id, trim(p_party_name), p_event_date,
     p_expected_return_date, p_notes, auth.uid())
  returning id into v_party_id;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_item_type := (v_line ->> 'item_type')::public.item_type;
    v_item_id := (v_line ->> 'item_id')::uuid;
    v_qty_g := (v_line ->> 'qty_g')::bigint;

    if v_qty_g is null or v_qty_g <= 0 then
      raise exception 'Quantity must be greater than zero';
    end if;

    insert into public.party_lines (party_id, item_type, item_id, taken_qty_g)
    values (v_party_id, v_item_type, v_item_id, v_qty_g);

    -- Stock leaves the office now. post_movement refuses to take the
    -- balance negative, so a party cannot take out more than the office
    -- actually holds.
    perform public.post_movement(
      p_department_id, v_item_type, v_item_id, -v_qty_g,
      'party_issue', 'party', v_party_id
    );
  end loop;

  return v_party_id;
end;
$$;

grant execute on function public.issue_party_stock(
  uuid, text, date, date, jsonb, text
) to authenticated;

-- ---------------------------------------------------------------------------
-- Recording what came back (§21, §22, §26)
-- ---------------------------------------------------------------------------
-- Takes the cumulative returned quantity per line, not a delta, because
-- that is what the person at the gate is actually looking at: the form
-- shows what has come back so far and they correct it. The function works
-- out the difference and posts only that.
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

  -- Status is derived from the lines, never set by hand (§22). Closing is
  -- explicit: a party where nothing more is coming back is completed even
  -- though some stock was consumed and will never return.
  update public.parties
  set
    status = case
      when p_close or v_total_returned = v_total_taken then 'completed'
      when v_total_returned > 0 then 'partially_returned'
      else 'out'
    end,
    closed_at = case
      when p_close or v_total_returned = v_total_taken then now()
      else null
    end
  where id = p_party_id;
end;
$$;

grant execute on function public.record_party_return(uuid, jsonb, boolean) to authenticated;
