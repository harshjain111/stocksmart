-- Stock counts (3.7): stock_counts (header) + stock_count_lines (detail),
-- status draft -> submitted -> approved. Approval is what posts
-- count_adjust movements (3.9), not submission — this migration is schema,
-- immutability and RLS only; the approval function itself lands in 3.9.

create type public.stock_count_status as enum ('draft', 'submitted', 'approved');

create table public.stock_counts (
  id uuid primary key default gen_random_uuid(),
  count_no text not null,
  branch_id uuid not null references public.branches (id),
  department_id uuid not null references public.departments (id),
  status public.stock_count_status not null default 'draft',
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  submitted_by uuid references auth.users (id),
  submitted_at timestamptz,
  approved_by uuid references auth.users (id),
  approved_at timestamptz,
  unique (branch_id, count_no)
);

create table public.stock_count_lines (
  id uuid primary key default gen_random_uuid(),
  count_id uuid not null references public.stock_counts (id),
  item_type public.item_type not null,
  item_id uuid not null,
  -- Snapshotted once when the count sheet is generated (rule 6's spirit —
  -- what the system said stock was at count time never shifts later),
  -- never re-derived from stock_balances afterward.
  system_qty_g bigint not null,
  counted_qty_g bigint,
  reason text,
  created_at timestamptz not null default now(),
  unique (count_id, item_type, item_id)
);

-- stock_counts: never deleted. Header fields are permanent; status only
-- moves forward (draft -> submitted -> approved), never back, and once
-- approved nothing about the row changes again.
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

create trigger stock_counts_block_mutations
  before update or delete on public.stock_counts
  for each row execute function public.block_stock_count_mutations();

-- stock_count_lines: never deleted, identity and system_qty_g never change,
-- and counted_qty_g/reason are only editable while the parent count is
-- still a draft — submitting freezes every line.
create or replace function public.block_stock_count_line_mutations()
returns trigger
language plpgsql
as $$
declare
  v_status public.stock_count_status;
begin
  if tg_op = 'DELETE' then
    raise exception 'stock_count_lines rows are never deleted';
  end if;

  select status into v_status from public.stock_counts where id = old.count_id;
  if v_status <> 'draft' then
    raise exception 'stock_count_lines cannot be edited once the count is no longer a draft';
  end if;

  if new.count_id <> old.count_id
     or new.item_type <> old.item_type
     or new.item_id <> old.item_id
     or new.system_qty_g <> old.system_qty_g then
    raise exception 'stock_count_lines identity and system_qty_g cannot change';
  end if;

  return new;
end;
$$;

create trigger stock_count_lines_block_mutations
  before update or delete on public.stock_count_lines
  for each row execute function public.block_stock_count_line_mutations();

alter table public.stock_counts enable row level security;
alter table public.stock_count_lines enable row level security;

create policy stock_counts_select on public.stock_counts
for select
using (
  public.current_profile_role() = 'admin'
  or (
    public.current_profile_role() in ('branch_manager', 'store_manager')
    and branch_id = public.current_profile_branch_id()
  )
  or (
    public.current_profile_role() = 'hod'
    and public.is_assigned_to_department(department_id)
  )
);

create policy stock_counts_insert on public.stock_counts
for insert
with check (
  public.current_profile_role() = 'admin'
  or (
    public.current_profile_role() in ('branch_manager', 'store_manager')
    and branch_id = public.current_profile_branch_id()
  )
  or (
    public.current_profile_role() = 'hod'
    and public.is_assigned_to_department(department_id)
  )
);

-- Update is deliberately narrow: only reachable while still draft, and only
-- as far as submitted. The draft -> submitted -> approved -> (movements
-- posted) transition specifically goes through a SECURITY DEFINER function
-- (3.9), which bypasses RLS and does its own admin/store_manager check —
-- this policy can never itself approve a count.
create policy stock_counts_update on public.stock_counts
for update
using (
  status = 'draft'
  and (
    public.current_profile_role() = 'admin'
    or (
      public.current_profile_role() in ('branch_manager', 'store_manager')
      and branch_id = public.current_profile_branch_id()
    )
    or (
      public.current_profile_role() = 'hod'
      and public.is_assigned_to_department(department_id)
    )
  )
)
with check (
  status in ('draft', 'submitted')
  and (
    public.current_profile_role() = 'admin'
    or (
      public.current_profile_role() in ('branch_manager', 'store_manager')
      and branch_id = public.current_profile_branch_id()
    )
    or (
      public.current_profile_role() = 'hod'
      and public.is_assigned_to_department(department_id)
    )
  )
);

create policy stock_count_lines_select on public.stock_count_lines
for select
using (
  exists (
    select 1 from public.stock_counts c
    where c.id = stock_count_lines.count_id
      and (
        public.current_profile_role() = 'admin'
        or (
          public.current_profile_role() in ('branch_manager', 'store_manager')
          and c.branch_id = public.current_profile_branch_id()
        )
        or (
          public.current_profile_role() = 'hod'
          and public.is_assigned_to_department(c.department_id)
        )
      )
  )
);

create policy stock_count_lines_insert on public.stock_count_lines
for insert
with check (
  exists (
    select 1 from public.stock_counts c
    where c.id = stock_count_lines.count_id
      and c.status = 'draft'
      and (
        public.current_profile_role() = 'admin'
        or (
          public.current_profile_role() in ('branch_manager', 'store_manager')
          and c.branch_id = public.current_profile_branch_id()
        )
        or (
          public.current_profile_role() = 'hod'
          and public.is_assigned_to_department(c.department_id)
        )
      )
  )
);

create policy stock_count_lines_update on public.stock_count_lines
for update
using (
  exists (
    select 1 from public.stock_counts c
    where c.id = stock_count_lines.count_id
      and c.status = 'draft'
      and (
        public.current_profile_role() = 'admin'
        or (
          public.current_profile_role() in ('branch_manager', 'store_manager')
          and c.branch_id = public.current_profile_branch_id()
        )
        or (
          public.current_profile_role() = 'hod'
          and public.is_assigned_to_department(c.department_id)
        )
      )
  )
)
with check (
  exists (
    select 1 from public.stock_counts c
    where c.id = stock_count_lines.count_id
      and c.status = 'draft'
      and (
        public.current_profile_role() = 'admin'
        or (
          public.current_profile_role() in ('branch_manager', 'store_manager')
          and c.branch_id = public.current_profile_branch_id()
        )
        or (
          public.current_profile_role() = 'hod'
          and public.is_assigned_to_department(c.department_id)
        )
      )
  )
);
