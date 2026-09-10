-- Stock module redesign, part 3 of 3: the daily closing count (§11-§14,
-- §57) and the Club App read model (§35-§41).

-- ---------------------------------------------------------------------------
-- Daily closing count
-- ---------------------------------------------------------------------------
-- The daily close is a reconciliation: someone says "there are 6.5 kg on
-- the shelf" and the system works out how that differs from what it
-- believed. That is exactly what stock_counts already models, so it lives
-- there rather than in a second table that would have to be unioned into
-- every variance report forever (§76). Only the workflow differs:
--
--   full_count  -> draft -> submitted -> approved, adjustment on approval
--   daily_close -> posted the moment it is saved (§12: 2-3 minutes, no
--                  approval queue), still fully audited through the ledger
--
-- Both end up as the same kind of row with the same variance history.
alter table public.stock_counts
  add column kind public.stock_count_kind not null default 'full_count',
  -- The business date being closed, which is not always the date the row
  -- was created — someone closing Tuesday's stock on Wednesday morning is
  -- normal. created_at still records when it was actually entered (§14).
  add column count_date date not null default current_date;

-- One daily close per location per business date. A second attempt is a
-- correction and belongs in a count or an adjustment, not a duplicate row.
create unique index stock_counts_one_daily_close_per_day
  on public.stock_counts (department_id, count_date)
  where kind = 'daily_close';

create index stock_counts_kind_date on public.stock_counts (kind, count_date desc);

-- The header-immutability trigger predates these columns, so it has to
-- learn about them — otherwise kind and count_date would be the only
-- header fields in the table that could be quietly rewritten after the
-- fact.
create or replace function public.block_stock_count_mutations()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'stock_counts rows are never deleted';
  end if;

  if new.count_no <> old.count_no
     or new.branch_id <> old.branch_id
     or new.department_id <> old.department_id
     or new.kind <> old.kind
     or new.count_date <> old.count_date
     or new.created_by is distinct from old.created_by
     or new.created_at <> old.created_at then
    raise exception 'stock_counts header fields cannot change';
  end if;

  if old.status = 'approved' then
    raise exception 'an approved count cannot be changed further';
  end if;
  if old.status = 'submitted' and new.status = 'draft' then
    raise exception 'a submitted count cannot revert to draft';
  end if;

  return new;
end;
$$;

-- Saves a whole day's closing figures for one location and posts the
-- resulting adjustments atomically. The caller sends only what was
-- physically counted; the system snapshots what it believed at that
-- moment and derives every difference itself (§11: staff never calculate).
create or replace function public.submit_daily_close(
  p_department_id uuid,
  p_count_date date,
  p_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.user_role;
  v_branch_id uuid;
  v_count_id uuid;
  v_count_no text;
  v_line jsonb;
  v_item_type public.item_type;
  v_item_id uuid;
  v_counted_g bigint;
  v_system_g bigint;
  v_delta_g bigint;
begin
  select role into v_role from public.profiles where id = auth.uid();
  if v_role is null then
    raise exception 'Not signed in';
  end if;
  if v_role not in ('admin', 'branch_manager', 'store_manager', 'hod') then
    raise exception 'Your role cannot record a daily closing count';
  end if;

  -- Server-side location authorisation (§13, §48): being able to name a
  -- department is not permission to close its stock.
  if not (
    v_role = 'admin'
    or (
      v_role in ('branch_manager', 'store_manager')
      and p_department_id in (
        select id from public.departments
        where branch_id = public.current_profile_branch_id()
      )
    )
    or (v_role = 'hod' and public.is_assigned_to_department(p_department_id))
  ) then
    raise exception 'You are not authorised to update stock for this location';
  end if;

  if p_count_date > current_date then
    raise exception 'Cannot close stock for a future date';
  end if;

  select branch_id into v_branch_id
  from public.departments
  where id = p_department_id and is_active;
  if v_branch_id is null then
    raise exception 'Location not found';
  end if;

  if exists (
    select 1 from public.stock_counts
    where department_id = p_department_id
      and count_date = p_count_date
      and kind = 'daily_close'
  ) then
    raise exception
      'Stock has already been closed for this location on %', p_count_date;
  end if;

  v_count_no := public.next_doc_no('CNT', v_branch_id);

  insert into public.stock_counts
    (count_no, branch_id, department_id, kind, count_date, status,
     created_by, submitted_by, submitted_at, approved_by, approved_at)
  values
    (v_count_no, v_branch_id, p_department_id, 'daily_close', p_count_date,
     'draft', auth.uid(), auth.uid(), now(), auth.uid(), now())
  returning id into v_count_id;

  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))
  loop
    v_item_type := (v_line ->> 'item_type')::public.item_type;
    v_item_id := (v_line ->> 'item_id')::uuid;
    v_counted_g := (v_line ->> 'counted_qty_g')::bigint;

    -- A blank box means "not counted", which is not the same as zero and
    -- must not be treated as one.
    if v_counted_g is null then
      continue;
    end if;
    if v_counted_g < 0 then
      raise exception 'Closing stock cannot be negative';
    end if;

    -- Locked for the duration so a concurrent transfer or party issue
    -- cannot slip between reading the balance and posting the difference
    -- (§66).
    select coalesce(qty_g, 0) into v_system_g
    from public.stock_balances
    where department_id = p_department_id
      and item_type = v_item_type
      and item_id = v_item_id
    for update;
    v_system_g := coalesce(v_system_g, 0);

    insert into public.stock_count_lines
      (count_id, item_type, item_id, system_qty_g, counted_qty_g, reason)
    values
      (v_count_id, v_item_type, v_item_id, v_system_g, v_counted_g,
       nullif(trim(coalesce(v_line ->> 'note', '')), ''));

    v_delta_g := v_counted_g - v_system_g;
    if v_delta_g <> 0 then
      -- Allowed to go negative: the shelf is the truth. If the ledger says
      -- 2 kg and there is nothing there, the correct balance is zero, and
      -- refusing the adjustment would leave the system knowingly wrong.
      perform public.post_movement(
        p_department_id, v_item_type, v_item_id, v_delta_g,
        'count_adjust', 'stock_count', v_count_id, true
      );
    end if;
  end loop;

  update public.stock_counts set status = 'approved' where id = v_count_id;

  return v_count_id;
end;
$$;

grant execute on function public.submit_daily_close(uuid, date, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Club App read model (§35-§41)
-- ---------------------------------------------------------------------------
-- The Club App owns club stock. This side only ever caches what it last
-- said, so a failed sync can show real last-known figures with an honest
-- timestamp instead of inventing zeros (§39).
--
-- Minimum requirements are deliberately NOT stored here: par_levels
-- already means "the minimum this department should hold of this item",
-- keyed exactly (department, item_type, item_id), and a club is a
-- department. A second minimums table would be the duplicate source of
-- truth §76 warns about.
create table public.club_stock_snapshots (
  -- The club as this system knows it. Clubs are departments of type
  -- 'club', so club stock hangs off the same org structure as everything
  -- else rather than a parallel list of names.
  department_id uuid not null references public.departments (id),
  item_type public.item_type not null,
  item_id uuid not null,
  qty_g bigint not null,
  -- What the Club App called this item, kept for diagnosing mapping gaps
  -- without having to re-query it.
  source_ref text,
  synced_at timestamptz not null default now(),
  primary key (department_id, item_type, item_id)
);

create table public.club_sync_log (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null check (status in ('success', 'failed', 'not_configured')),
  clubs_synced integer not null default 0,
  items_synced integer not null default 0,
  -- Operator-facing, not a raw stack trace (§65).
  error_message text,
  triggered_by uuid references auth.users (id)
);

create index club_sync_log_recent on public.club_sync_log (started_at desc);

alter table public.club_stock_snapshots enable row level security;
alter table public.club_sync_log enable row level security;

-- Read-only to every role that can see stock at all. There is deliberately
-- no insert or update policy: the cache is only ever written by the sync
-- service through the service role, which is what makes club stock
-- genuinely uneditable here rather than merely hidden (§4, §35).
create policy club_stock_snapshots_select on public.club_stock_snapshots
for select
using (
  public.current_profile_role() in
    ('admin', 'branch_manager', 'store_manager', 'hod')
);

create policy club_sync_log_select on public.club_sync_log
for select
using (
  public.current_profile_role() in
    ('admin', 'branch_manager', 'store_manager', 'hod')
);
