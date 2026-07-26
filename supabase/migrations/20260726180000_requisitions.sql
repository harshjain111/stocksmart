-- Requisitions (4.1): requisitions (header) + requisition_lines (detail).
-- Lifecycle: draft -> submitted -> approved -> fulfilling -> closed, with
-- submitted -> rejected as the alternate branch (rule: document
-- lifecycles are explicit status enums with guarded transitions).

create type public.requisition_status as enum (
  'draft',
  'submitted',
  'approved',
  'fulfilling',
  'closed',
  'rejected'
);

create type public.requisition_line_decision as enum (
  'transfer',
  'mix_then_transfer',
  'buy',
  'rejected'
);

create table public.requisitions (
  id uuid primary key default gen_random_uuid(),
  req_no text not null,
  branch_id uuid not null references public.branches (id),
  department_id uuid not null references public.departments (id),
  raised_by uuid references auth.users (id),
  needed_by timestamptz not null,
  status public.requisition_status not null default 'draft',
  note text,
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  approved_by uuid references auth.users (id),
  approved_at timestamptz,
  unique (branch_id, req_no)
);

create table public.requisition_lines (
  id uuid primary key default gen_random_uuid(),
  requisition_id uuid not null references public.requisitions (id),
  item_type public.item_type not null,
  item_id uuid not null,
  qty_g bigint not null check (qty_g > 0),
  -- Set by the approver, not the raiser — null until a decision is made.
  decision public.requisition_line_decision,
  approved_qty_g bigint,
  decision_note text,
  -- Whatever fulfils the line: the transfer/buy-queue-entry/mixing
  -- suggestion created as a consequence of the decision (4.4).
  ref_type text,
  ref_id uuid,
  created_at timestamptz not null default now()
);

-- requisitions: never deleted. Header identity is permanent; once a
-- requisition reaches a terminal state (closed/rejected) nothing about it
-- changes again.
create or replace function public.block_requisition_mutations()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'requisitions rows are never deleted';
  end if;

  if new.req_no <> old.req_no
     or new.branch_id <> old.branch_id
     or new.department_id <> old.department_id
     or new.raised_by is distinct from old.raised_by
     or new.created_at <> old.created_at then
    raise exception 'requisitions header identity fields cannot change';
  end if;

  if old.status in ('closed', 'rejected') then
    raise exception 'a closed or rejected requisition cannot be changed further';
  end if;

  return new;
end;
$$;

create trigger requisitions_block_mutations
  before update or delete on public.requisitions
  for each row execute function public.block_requisition_mutations();

-- requisition_lines: never deleted, identity permanent. Editable while the
-- parent is draft or submitted (draft = the raiser building it, submitted
-- = the approver setting decision/approved_qty_g/ref) — frozen the moment
-- it moves past submitted. Once submitted, the originally requested
-- qty_g itself is locked; only the decision fields can still change.
create or replace function public.block_requisition_line_mutations()
returns trigger
language plpgsql
as $$
declare
  v_status public.requisition_status;
begin
  if tg_op = 'DELETE' then
    raise exception 'requisition_lines rows are never deleted';
  end if;

  select status into v_status from public.requisitions where id = old.requisition_id;
  if v_status not in ('draft', 'submitted') then
    raise exception 'requisition_lines cannot be edited once the requisition has moved past submitted';
  end if;

  if new.requisition_id <> old.requisition_id
     or new.item_type <> old.item_type
     or new.item_id <> old.item_id then
    raise exception 'requisition_lines identity cannot change';
  end if;

  if v_status = 'submitted' and new.qty_g <> old.qty_g then
    raise exception 'requisition_lines requested qty_g is locked once submitted';
  end if;

  return new;
end;
$$;

create trigger requisition_lines_block_mutations
  before update or delete on public.requisition_lines
  for each row execute function public.block_requisition_line_mutations();

alter table public.requisitions enable row level security;
alter table public.requisition_lines enable row level security;

create policy requisitions_select on public.requisitions
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

create policy requisitions_insert on public.requisitions
for insert
with check (
  public.current_profile_role() = 'admin'
  or (
    public.current_profile_role() = 'hod'
    and public.is_assigned_to_department(department_id)
  )
);

-- Narrow, matching stock_counts (2.7/3.7): direct updates only reach a
-- draft row, and only as far as submitted. Approval (submitted ->
-- approved, setting per-line decisions and creating transfers/buy-queue
-- entries/mixing suggestions) is 4.4's job via a dedicated SECURITY
-- DEFINER function, never through this policy.
create policy requisitions_update on public.requisitions
for update
using (
  status = 'draft'
  and (
    public.current_profile_role() = 'admin'
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
      public.current_profile_role() = 'hod'
      and public.is_assigned_to_department(department_id)
    )
  )
);

create policy requisition_lines_select on public.requisition_lines
for select
using (
  exists (
    select 1 from public.requisitions r
    where r.id = requisition_lines.requisition_id
      and (
        public.current_profile_role() = 'admin'
        or (
          public.current_profile_role() in ('branch_manager', 'store_manager')
          and r.branch_id = public.current_profile_branch_id()
        )
        or (
          public.current_profile_role() = 'hod'
          and public.is_assigned_to_department(r.department_id)
        )
      )
  )
);

create policy requisition_lines_insert on public.requisition_lines
for insert
with check (
  exists (
    select 1 from public.requisitions r
    where r.id = requisition_lines.requisition_id
      and r.status = 'draft'
      and (
        public.current_profile_role() = 'admin'
        or (
          public.current_profile_role() = 'hod'
          and public.is_assigned_to_department(r.department_id)
        )
      )
  )
);

create policy requisition_lines_update on public.requisition_lines
for update
using (
  exists (
    select 1 from public.requisitions r
    where r.id = requisition_lines.requisition_id
      and r.status = 'draft'
      and (
        public.current_profile_role() = 'admin'
        or (
          public.current_profile_role() = 'hod'
          and public.is_assigned_to_department(r.department_id)
        )
      )
  )
)
with check (
  exists (
    select 1 from public.requisitions r
    where r.id = requisition_lines.requisition_id
      and r.status = 'draft'
      and (
        public.current_profile_role() = 'admin'
        or (
          public.current_profile_role() = 'hod'
          and public.is_assigned_to_department(r.department_id)
        )
      )
  )
);
