-- grns + grn_lines (4.9). One table serves both receipt sources —
-- vendor (against a PO) and internal (against a transfer) — via a
-- source enum + two nullable references, never parallel tables (matches
-- the item_type polymorphism convention already used everywhere else).
--
-- purchase_order_id has no FK yet: purchase_orders doesn't exist until
-- Phase 5.1. It's a plain uuid column for now; 5.1 (or 5.6, which is
-- the prompt that actually wires vendor GRNs into the Receive screen)
-- adds the FK constraint once that table exists. Vendor-source GRNs are
-- schema-ready here but not functionally reachable until then — 4.10/
-- 4.11 in this phase only exercise the internal (transfer) source.

create type public.grn_source as enum ('vendor', 'internal');
create type public.grn_status as enum ('draft', 'posted');

create table public.grns (
  id uuid primary key default gen_random_uuid(),
  grn_no text not null,
  branch_id uuid not null references public.branches (id),
  department_id uuid not null references public.departments (id),
  source public.grn_source not null,
  purchase_order_id uuid,
  transfer_id uuid references public.transfers (id),
  status public.grn_status not null default 'draft',
  posted_by uuid references auth.users (id),
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  unique (branch_id, grn_no),
  check (
    (source = 'vendor' and purchase_order_id is not null and transfer_id is null)
    or
    (source = 'internal' and transfer_id is not null and purchase_order_id is null)
  )
);

create table public.grn_lines (
  id uuid primary key default gen_random_uuid(),
  grn_id uuid not null references public.grns (id),
  item_type public.item_type not null,
  item_id uuid not null,
  expected_qty_g bigint not null check (expected_qty_g >= 0),
  received_qty_g bigint check (received_qty_g >= 0),
  damaged_qty_g bigint check (damaged_qty_g >= 0),
  -- Vendor receipts only — a blank rate is valid (rule: "a blank rate
  -- is valid and marks the order rate-to-confirm").
  rate numeric(12, 2),
  -- Required (enforced in the posting action, not a DB constraint,
  -- matching stock_count_lines' reason column) whenever received is
  -- short of expected, or over-received without the explicit flag.
  reason text,
  over_received boolean not null default false,
  created_at timestamptz not null default now()
);

-- grns: never deleted, header identity permanent, frozen entirely once
-- posted — posting (4.11) is what moves stock, via a dedicated
-- SECURITY DEFINER function, never a plain update.
create or replace function public.block_grn_mutations()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'grns rows are never deleted';
  end if;

  if new.grn_no <> old.grn_no
     or new.branch_id <> old.branch_id
     or new.department_id <> old.department_id
     or new.source <> old.source
     or new.purchase_order_id is distinct from old.purchase_order_id
     or new.transfer_id is distinct from old.transfer_id
     or new.created_at <> old.created_at then
    raise exception 'grns header identity fields cannot change';
  end if;

  if old.status = 'posted' then
    raise exception 'a posted grn cannot be changed further';
  end if;

  return new;
end;
$$;

create trigger grns_block_mutations
  before update or delete on public.grns
  for each row execute function public.block_grn_mutations();

-- grn_lines: never deleted, identity permanent, editable only while the
-- parent grn is still draft — posting freezes everything.
create or replace function public.block_grn_line_mutations()
returns trigger
language plpgsql
as $$
declare
  v_status public.grn_status;
begin
  if tg_op = 'DELETE' then
    raise exception 'grn_lines rows are never deleted';
  end if;

  select status into v_status from public.grns where id = old.grn_id;
  if v_status <> 'draft' then
    raise exception 'grn_lines cannot be edited once the grn is posted';
  end if;

  if new.grn_id <> old.grn_id
     or new.item_type <> old.item_type
     or new.item_id <> old.item_id then
    raise exception 'grn_lines identity cannot change';
  end if;

  return new;
end;
$$;

create trigger grn_lines_block_mutations
  before update or delete on public.grn_lines
  for each row execute function public.block_grn_line_mutations();

alter table public.grns enable row level security;
alter table public.grn_lines enable row level security;

create policy grns_select on public.grns
for select
using (
  public.current_profile_role() = 'admin'
  or (
    public.current_profile_role() in ('branch_manager', 'store_manager', 'purchase_manager')
    and branch_id = public.current_profile_branch_id()
  )
  or (
    public.current_profile_role() = 'hod'
    and public.is_assigned_to_department(department_id)
  )
);

create policy grns_insert on public.grns
for insert
with check (
  public.current_profile_role() = 'admin'
  or (
    public.current_profile_role() in ('branch_manager', 'store_manager', 'purchase_manager')
    and branch_id = public.current_profile_branch_id()
  )
  or (
    public.current_profile_role() = 'hod'
    and public.is_assigned_to_department(department_id)
  )
);

-- Narrow, matching every other document with an approval/posting step:
-- direct updates only reach a draft row. Posting (4.11) goes through a
-- dedicated SECURITY DEFINER function, never this policy.
create policy grns_update on public.grns
for update
using (
  status = 'draft'
  and (
    public.current_profile_role() = 'admin'
    or (
      public.current_profile_role() in ('branch_manager', 'store_manager', 'purchase_manager')
      and branch_id = public.current_profile_branch_id()
    )
    or (
      public.current_profile_role() = 'hod'
      and public.is_assigned_to_department(department_id)
    )
  )
)
with check (
  status = 'draft'
  and (
    public.current_profile_role() = 'admin'
    or (
      public.current_profile_role() in ('branch_manager', 'store_manager', 'purchase_manager')
      and branch_id = public.current_profile_branch_id()
    )
    or (
      public.current_profile_role() = 'hod'
      and public.is_assigned_to_department(department_id)
    )
  )
);

create policy grn_lines_select on public.grn_lines
for select
using (
  exists (
    select 1 from public.grns g
    where g.id = grn_lines.grn_id
      and (
        public.current_profile_role() = 'admin'
        or (
          public.current_profile_role() in ('branch_manager', 'store_manager', 'purchase_manager')
          and g.branch_id = public.current_profile_branch_id()
        )
        or (
          public.current_profile_role() = 'hod'
          and public.is_assigned_to_department(g.department_id)
        )
      )
  )
);

create policy grn_lines_insert on public.grn_lines
for insert
with check (
  exists (
    select 1 from public.grns g
    where g.id = grn_lines.grn_id
      and g.status = 'draft'
      and (
        public.current_profile_role() = 'admin'
        or (
          public.current_profile_role() in ('branch_manager', 'store_manager', 'purchase_manager')
          and g.branch_id = public.current_profile_branch_id()
        )
        or (
          public.current_profile_role() = 'hod'
          and public.is_assigned_to_department(g.department_id)
        )
      )
  )
);

create policy grn_lines_update on public.grn_lines
for update
using (
  exists (
    select 1 from public.grns g
    where g.id = grn_lines.grn_id
      and g.status = 'draft'
      and (
        public.current_profile_role() = 'admin'
        or (
          public.current_profile_role() in ('branch_manager', 'store_manager', 'purchase_manager')
          and g.branch_id = public.current_profile_branch_id()
        )
        or (
          public.current_profile_role() = 'hod'
          and public.is_assigned_to_department(g.department_id)
        )
      )
  )
)
with check (
  exists (
    select 1 from public.grns g
    where g.id = grn_lines.grn_id
      and g.status = 'draft'
      and (
        public.current_profile_role() = 'admin'
        or (
          public.current_profile_role() in ('branch_manager', 'store_manager', 'purchase_manager')
          and g.branch_id = public.current_profile_branch_id()
        )
        or (
          public.current_profile_role() = 'hod'
          and public.is_assigned_to_department(g.department_id)
        )
      )
  )
);
