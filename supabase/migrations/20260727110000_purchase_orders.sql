-- purchase_orders + po_lines (5.1). Lifecycle: draft -> sent ->
-- partially_received -> received -> closed, mirroring the shape every
-- other document lifecycle in this project uses (explicit enum, no
-- free-form status strings). ship_to_department_id is what lets a
-- Kolkata requisition drive a PO shipped straight to Kolkata, never
-- through Guwahati.

create type public.purchase_order_status as enum (
  'draft',
  'sent',
  'partially_received',
  'received',
  'closed'
);

create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  po_no text not null,
  branch_id uuid not null references public.branches (id),
  supplier_id uuid not null references public.suppliers (id),
  ship_to_department_id uuid not null references public.departments (id),
  requisition_id uuid references public.requisitions (id),
  status public.purchase_order_status not null default 'draft',
  sent_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  unique (branch_id, po_no)
);

create table public.po_lines (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders (id),
  raw_material_id uuid not null references public.raw_materials (id),
  qty_g bigint not null check (qty_g > 0),
  -- A blank rate is valid (rule: "a blank rate is valid and marks the
  -- order rate-to-confirm") and stays editable at any status — "Rates
  -- are always editable — on the PO and again on the GRN."
  rate numeric(12, 2),
  created_at timestamptz not null default now()
);

-- Now that purchase_orders exists, wire up the FK the grns migration
-- (4.9) deliberately left off — vendor-source GRNs reference a real PO.
alter table public.grns
  add constraint grns_purchase_order_id_fkey
  foreign key (purchase_order_id) references public.purchase_orders (id);

-- purchase_orders: never deleted, header identity permanent. Unlike
-- batches/counts/requisitions, the row never fully freezes — rate on
-- its lines stays editable even once closed, so there's no terminal
-- "cannot be changed further" branch here, only identity protection.
create or replace function public.block_purchase_order_mutations()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'purchase_orders rows are never deleted';
  end if;

  if new.po_no <> old.po_no
     or new.branch_id <> old.branch_id
     or new.supplier_id <> old.supplier_id
     or new.ship_to_department_id <> old.ship_to_department_id
     or new.requisition_id is distinct from old.requisition_id
     or new.created_at <> old.created_at then
    raise exception 'purchase_orders header identity fields cannot change';
  end if;

  return new;
end;
$$;

create trigger purchase_orders_block_mutations
  before update or delete on public.purchase_orders
  for each row execute function public.block_purchase_order_mutations();

-- po_lines: never deleted, raw_material_id identity permanent. qty_g
-- locks once the order leaves draft ("sending locks quantities but not
-- rates") — rate has no lock at all, ever.
create or replace function public.block_po_line_mutations()
returns trigger
language plpgsql
as $$
declare
  v_status public.purchase_order_status;
begin
  if tg_op = 'DELETE' then
    raise exception 'po_lines rows are never deleted';
  end if;

  if new.purchase_order_id <> old.purchase_order_id
     or new.raw_material_id <> old.raw_material_id then
    raise exception 'po_lines identity cannot change';
  end if;

  select status into v_status from public.purchase_orders where id = old.purchase_order_id;
  if v_status <> 'draft' and new.qty_g <> old.qty_g then
    raise exception 'po_lines qty_g is locked once the order has been sent';
  end if;

  return new;
end;
$$;

create trigger po_lines_block_mutations
  before update or delete on public.po_lines
  for each row execute function public.block_po_line_mutations();

alter table public.purchase_orders enable row level security;
alter table public.po_lines enable row level security;

-- nav:buy is admin/branch_manager/purchase_manager per the permissions
-- table — store_manager, hod and the mix roles have no reason to see
-- purchase orders.
create policy purchase_orders_select on public.purchase_orders
for select
using (
  public.current_profile_role() = 'admin'
  or (
    public.current_profile_role() in ('branch_manager', 'purchase_manager')
    and branch_id = public.current_profile_branch_id()
  )
);

create policy purchase_orders_insert on public.purchase_orders
for insert
with check (
  public.current_profile_role() = 'admin'
  or (
    public.current_profile_role() in ('branch_manager', 'purchase_manager')
    and branch_id = public.current_profile_branch_id()
  )
);

create policy purchase_orders_update on public.purchase_orders
for update
using (
  public.current_profile_role() = 'admin'
  or (
    public.current_profile_role() in ('branch_manager', 'purchase_manager')
    and branch_id = public.current_profile_branch_id()
  )
)
with check (
  public.current_profile_role() = 'admin'
  or (
    public.current_profile_role() in ('branch_manager', 'purchase_manager')
    and branch_id = public.current_profile_branch_id()
  )
);

create policy po_lines_select on public.po_lines
for select
using (
  exists (
    select 1 from public.purchase_orders po
    where po.id = po_lines.purchase_order_id
      and (
        public.current_profile_role() = 'admin'
        or (
          public.current_profile_role() in ('branch_manager', 'purchase_manager')
          and po.branch_id = public.current_profile_branch_id()
        )
      )
  )
);

create policy po_lines_insert on public.po_lines
for insert
with check (
  exists (
    select 1 from public.purchase_orders po
    where po.id = po_lines.purchase_order_id
      and (
        public.current_profile_role() = 'admin'
        or (
          public.current_profile_role() in ('branch_manager', 'purchase_manager')
          and po.branch_id = public.current_profile_branch_id()
        )
      )
  )
);

create policy po_lines_update on public.po_lines
for update
using (
  exists (
    select 1 from public.purchase_orders po
    where po.id = po_lines.purchase_order_id
      and (
        public.current_profile_role() = 'admin'
        or (
          public.current_profile_role() in ('branch_manager', 'purchase_manager')
          and po.branch_id = public.current_profile_branch_id()
        )
      )
  )
)
with check (
  exists (
    select 1 from public.purchase_orders po
    where po.id = po_lines.purchase_order_id
      and (
        public.current_profile_role() = 'admin'
        or (
          public.current_profile_role() in ('branch_manager', 'purchase_manager')
          and po.branch_id = public.current_profile_branch_id()
        )
      )
  )
);
