-- stock_movements + stock_balances, pulled forward from Phase 3 (3.1-3.3)
-- because batch confirmation (2.10) needs somewhere real to post
-- batch_consume/batch_produce movements — CLAUDE.md rule 2 is explicit that
-- stock is never written directly, only ever through a movement.
--
-- item_type polymorphism (rule: no parallel tables for raw vs flavour) means
-- item_id has no FK — it points at raw_materials.id or flavours.id depending
-- on item_type, which no single foreign key can express.

create type public.item_type as enum ('raw', 'flavour');

create type public.movement_reason as enum (
  'grn_vendor',
  'grn_transfer',
  'dispatch',
  'batch_consume',
  'batch_produce',
  'count_adjust',
  'transit_loss',
  'club_sync',
  'opening'
);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments (id),
  item_type public.item_type not null,
  item_id uuid not null,
  qty_g bigint not null,
  reason public.movement_reason not null,
  ref_type text not null,
  ref_id uuid not null,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create index stock_movements_balance_lookup
  on public.stock_movements (department_id, item_type, item_id);

-- Append-only: no update, no delete, ever.
create or replace function public.block_stock_movement_mutations()
returns trigger
language plpgsql
as $$
begin
  raise exception 'stock_movements rows are append-only — never updated or deleted';
end;
$$;

create trigger stock_movements_block_mutations
  before update or delete on public.stock_movements
  for each row execute function public.block_stock_movement_mutations();

-- stock_balances is derived, never written directly by application code
-- (rule 2) — this trigger is the only thing that ever changes it.
create table public.stock_balances (
  department_id uuid not null references public.departments (id),
  item_type public.item_type not null,
  item_id uuid not null,
  qty_g bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (department_id, item_type, item_id)
);

create or replace function public.apply_stock_movement()
returns trigger
language plpgsql
as $$
begin
  insert into public.stock_balances (department_id, item_type, item_id, qty_g, updated_at)
  values (new.department_id, new.item_type, new.item_id, new.qty_g, now())
  on conflict (department_id, item_type, item_id)
  do update set
    qty_g = public.stock_balances.qty_g + new.qty_g,
    updated_at = now();
  return new;
end;
$$;

create trigger stock_movements_apply
  after insert on public.stock_movements
  for each row execute function public.apply_stock_movement();

alter table public.stock_movements enable row level security;
alter table public.stock_balances enable row level security;

-- Read-only for everyone who might reasonably need to see stock (Phase 3's
-- screens land later); no insert/update/delete policy on either table for
-- any role — every movement goes through post_movement()/confirm_batch()
-- below, both SECURITY DEFINER, so they bypass RLS entirely regardless of
-- policy. That absence of an insert policy is what makes rule 2 real: a
-- client hitting the REST API directly, admin included, cannot insert a
-- movement or touch a balance no matter what.
create policy stock_movements_select on public.stock_movements
for select
using (
  public.current_profile_role() = 'admin'
  or (
    public.current_profile_role() in ('branch_manager', 'store_manager', 'hod', 'senior_mixer')
    and department_id in (
      select id from public.departments where branch_id = public.current_profile_branch_id()
    )
  )
);

create policy stock_balances_select on public.stock_balances
for select
using (
  public.current_profile_role() = 'admin'
  or (
    public.current_profile_role() in ('branch_manager', 'store_manager', 'hod', 'senior_mixer')
    and department_id in (
      select id from public.departments where branch_id = public.current_profile_branch_id()
    )
  )
);

-- The one function every feature calls to move stock (3.3). Validates the
-- department can hold that item type and refuses to take a balance negative
-- unless explicitly overridden. SECURITY DEFINER so it can write regardless
-- of the caller's own (deliberately absent) insert grant, while auth.uid()
-- still resolves to the real caller for created_by.
create or replace function public.post_movement(
  p_department_id uuid,
  p_item_type public.item_type,
  p_item_id uuid,
  p_qty_g bigint,
  p_reason public.movement_reason,
  p_ref_type text,
  p_ref_id uuid,
  p_allow_negative boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_holds_raw boolean;
  v_holds_mixed boolean;
  v_current_balance bigint;
  v_movement_id uuid;
begin
  select holds_raw, holds_mixed into v_holds_raw, v_holds_mixed
  from public.departments
  where id = p_department_id;

  if v_holds_raw is null then
    raise exception 'Department % not found', p_department_id;
  end if;
  if p_item_type = 'raw' and not v_holds_raw then
    raise exception 'Department % does not hold raw materials', p_department_id;
  end if;
  if p_item_type = 'flavour' and not v_holds_mixed then
    raise exception 'Department % does not hold mixed flavours', p_department_id;
  end if;

  select qty_g into v_current_balance
  from public.stock_balances
  where department_id = p_department_id
    and item_type = p_item_type
    and item_id = p_item_id
  for update;

  if not p_allow_negative and (coalesce(v_current_balance, 0) + p_qty_g) < 0 then
    raise exception
      'Movement would take % % balance negative at department % (current %, change %)',
      p_item_type, p_item_id, p_department_id, coalesce(v_current_balance, 0), p_qty_g;
  end if;

  insert into public.stock_movements
    (department_id, item_type, item_id, qty_g, reason, ref_type, ref_id, created_by)
  values
    (p_department_id, p_item_type, p_item_id, p_qty_g, p_reason, p_ref_type, p_ref_id, auth.uid())
  returning id into v_movement_id;

  return v_movement_id;
end;
$$;

grant execute on function public.post_movement(
  uuid, public.item_type, uuid, bigint, public.movement_reason, text, uuid, boolean
) to authenticated;
