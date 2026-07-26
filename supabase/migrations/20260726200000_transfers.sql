-- transfers + transfer_lines, pulled forward from 4.6 — 4.4 (approval
-- consequences) needs a real place to land requisition lines decided
-- "transfer" or "mix_then_transfer", so the table is built here in full
-- rather than half now and half in 4.6. Send & receive screens (4.7/4.8)
-- and the dispatch-posts-movements behavior come later; this migration
-- only creates the documents and their RLS/immutability.

create type public.transfer_status as enum (
  'draft',
  'dispatched',
  'received',
  'short_closed',
  'closed'
);

create table public.transfers (
  id uuid primary key default gen_random_uuid(),
  transfer_no text not null,
  branch_id uuid not null references public.branches (id),
  from_department_id uuid not null references public.departments (id),
  to_department_id uuid not null references public.departments (id),
  requisition_id uuid references public.requisitions (id),
  status public.transfer_status not null default 'draft',
  courier text,
  docket_no text,
  dispatched_by uuid references auth.users (id),
  dispatched_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  unique (branch_id, transfer_no)
);

create table public.transfer_lines (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references public.transfers (id),
  item_type public.item_type not null,
  item_id uuid not null,
  qty_g bigint not null check (qty_g > 0),
  -- Set at dispatch (4.7) — the sender may send less than planned.
  dispatched_qty_g bigint,
  created_at timestamptz not null default now()
);

-- transfers: never deleted, header identity permanent. Frozen entirely
-- once closed or short_closed — every other transition (4.7/4.8/4.11)
-- goes through dedicated SECURITY DEFINER functions, matching batches/
-- stock_counts/requisitions.
create or replace function public.block_transfer_mutations()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'transfers rows are never deleted';
  end if;

  if new.transfer_no <> old.transfer_no
     or new.branch_id <> old.branch_id
     or new.from_department_id <> old.from_department_id
     or new.to_department_id <> old.to_department_id
     or new.requisition_id is distinct from old.requisition_id
     or new.created_at <> old.created_at then
    raise exception 'transfers header identity fields cannot change';
  end if;

  if old.status in ('closed', 'short_closed') then
    raise exception 'a closed or short-closed transfer cannot be changed further';
  end if;

  return new;
end;
$$;

create trigger transfers_block_mutations
  before update or delete on public.transfers
  for each row execute function public.block_transfer_mutations();

-- transfer_lines: never deleted, identity permanent. dispatched_qty_g is
-- the only field that can still change once the transfer leaves draft
-- (set once at dispatch, 4.7).
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
     or new.item_id <> old.item_id
     or new.qty_g <> old.qty_g then
    raise exception 'transfer_lines requested fields cannot change';
  end if;

  return new;
end;
$$;

create trigger transfer_lines_block_mutations
  before update or delete on public.transfer_lines
  for each row execute function public.block_transfer_line_mutations();

alter table public.transfers enable row level security;
alter table public.transfer_lines enable row level security;

create policy transfers_select on public.transfers
for select
using (
  public.current_profile_role() = 'admin'
  or (
    public.current_profile_role() in ('branch_manager', 'store_manager')
    and branch_id = public.current_profile_branch_id()
  )
  or (
    public.current_profile_role() = 'hod'
    and (
      public.is_assigned_to_department(from_department_id)
      or public.is_assigned_to_department(to_department_id)
    )
  )
);

create policy transfers_insert on public.transfers
for insert
with check (
  public.current_profile_role() = 'admin'
  or (
    public.current_profile_role() in ('branch_manager', 'store_manager')
    and branch_id = public.current_profile_branch_id()
  )
);

-- Narrow, matching requisitions/stock_counts: direct updates only reach
-- a draft row. Dispatch (draft -> dispatched, 4.7) and everything past
-- it goes through dedicated SECURITY DEFINER functions.
create policy transfers_update on public.transfers
for update
using (
  status = 'draft'
  and (
    public.current_profile_role() = 'admin'
    or (
      public.current_profile_role() in ('branch_manager', 'store_manager')
      and branch_id = public.current_profile_branch_id()
    )
  )
)
with check (
  status = 'draft'
  and (
    public.current_profile_role() = 'admin'
    or (
      public.current_profile_role() in ('branch_manager', 'store_manager')
      and branch_id = public.current_profile_branch_id()
    )
  )
);

create policy transfer_lines_select on public.transfer_lines
for select
using (
  exists (
    select 1 from public.transfers t
    where t.id = transfer_lines.transfer_id
      and (
        public.current_profile_role() = 'admin'
        or (
          public.current_profile_role() in ('branch_manager', 'store_manager')
          and t.branch_id = public.current_profile_branch_id()
        )
        or (
          public.current_profile_role() = 'hod'
          and (
            public.is_assigned_to_department(t.from_department_id)
            or public.is_assigned_to_department(t.to_department_id)
          )
        )
      )
  )
);

create policy transfer_lines_insert on public.transfer_lines
for insert
with check (
  exists (
    select 1 from public.transfers t
    where t.id = transfer_lines.transfer_id
      and t.status = 'draft'
      and (
        public.current_profile_role() = 'admin'
        or (
          public.current_profile_role() in ('branch_manager', 'store_manager')
          and t.branch_id = public.current_profile_branch_id()
        )
      )
  )
);

create policy transfer_lines_update on public.transfer_lines
for update
using (
  exists (
    select 1 from public.transfers t
    where t.id = transfer_lines.transfer_id
      and t.status in ('draft', 'dispatched')
      and (
        public.current_profile_role() = 'admin'
        or (
          public.current_profile_role() in ('branch_manager', 'store_manager')
          and t.branch_id = public.current_profile_branch_id()
        )
      )
  )
)
with check (
  exists (
    select 1 from public.transfers t
    where t.id = transfer_lines.transfer_id
      and t.status in ('draft', 'dispatched')
      and (
        public.current_profile_role() = 'admin'
        or (
          public.current_profile_role() in ('branch_manager', 'store_manager')
          and t.branch_id = public.current_profile_branch_id()
        )
      )
  )
);
