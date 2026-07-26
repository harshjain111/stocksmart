-- Batches and batch_consumption (2.7). A batch snapshots the flavour's
-- recipe at the moment it's made (rule 6) — recipe_snapshot is a full copy
-- of the version's lines, never re-derived from recipe_versions later, so
-- the batch's record of what went into it can't shift even if the version
-- is later rolled back or superseded.
--
-- branch_id is denormalized from department_id purely so batch_no can be
-- made unique per branch (next_doc_no() issues numbers scoped per branch
-- per financial year, so "B-0001" is expected to repeat across branches
-- in the same year — a bare `unique(batch_no)` would break the moment two
-- branches both mix their first batch of the year).
--
-- RLS deliberately excludes `mixer` entirely on both tables. A mixer's
-- batch card must show component codes only, never real material names or
-- percentages (CLAUDE.md rule 8) — and recipe_snapshot carries the real
-- names. Rather than trying to mask jsonb contents through a row policy,
-- mixer gets no direct table grant at all: every mixer-facing read goes
-- through a masking Server Action (2.9), and the confirm action (2.10)
-- goes through a SECURITY DEFINER function that checks the caller's
-- identity itself, the same pattern already used for recipe mutations.

create table public.batches (
  id uuid primary key default gen_random_uuid(),
  batch_no text not null,
  branch_id uuid not null references public.branches (id),
  flavour_id uuid not null references public.flavours (id),
  recipe_version_id uuid not null references public.recipe_versions (id),
  recipe_snapshot jsonb not null,
  output_g bigint not null check (output_g > 0),
  department_id uuid not null references public.departments (id),
  mixed_by uuid references auth.users (id),
  mixed_at timestamptz,
  status text not null default 'draft' check (status in ('draft', 'confirmed')),
  deviation_note text,
  rating smallint check (rating between 1 and 5),
  feedback text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  updated_at timestamptz not null default now(),
  unique (branch_id, batch_no)
);

create trigger batches_set_updated_at
  before update on public.batches
  for each row execute function public.set_updated_at();

create table public.batch_consumption (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.batches (id),
  raw_material_id uuid not null references public.raw_materials (id),
  planned_g bigint not null check (planned_g >= 0),
  actual_g bigint check (actual_g >= 0),
  created_at timestamptz not null default now(),
  unique (batch_id, raw_material_id)
);

-- batches: never deleted. Once confirmed, only rating/feedback/
-- deviation_note may still change — every other column, including status
-- itself, is frozen (so a confirmed batch can never revert to draft).
create or replace function public.block_batch_mutations()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'batches rows are never deleted';
  end if;

  if old.status = 'confirmed' then
    if new.batch_no <> old.batch_no
       or new.branch_id <> old.branch_id
       or new.flavour_id <> old.flavour_id
       or new.recipe_version_id <> old.recipe_version_id
       or new.recipe_snapshot <> old.recipe_snapshot
       or new.output_g <> old.output_g
       or new.department_id <> old.department_id
       or new.mixed_by is distinct from old.mixed_by
       or new.mixed_at is distinct from old.mixed_at
       or new.status <> old.status then
      raise exception 'confirmed batches cannot be edited, only annotated (rating, feedback, deviation_note)';
    end if;
  end if;

  return new;
end;
$$;

create trigger batches_block_mutations
  before update or delete on public.batches
  for each row execute function public.block_batch_mutations();

-- batch_consumption: never deleted. planned_g stays editable while the
-- batch is still draft (actual_g null) — e.g. output_g changes before
-- confirming should be able to recompute it. The moment actual_g is set
-- (at confirmation), the row is frozen entirely, planned_g included.
create or replace function public.block_batch_consumption_mutations()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'batch_consumption rows are never deleted';
  end if;

  if old.actual_g is not null then
    raise exception 'batch_consumption rows are locked once actual grams are recorded';
  end if;

  if new.batch_id <> old.batch_id or new.raw_material_id <> old.raw_material_id then
    raise exception 'batch_consumption identity (batch, material) cannot change';
  end if;

  return new;
end;
$$;

create trigger batch_consumption_block_mutations
  before update or delete on public.batch_consumption
  for each row execute function public.block_batch_consumption_mutations();

alter table public.batches enable row level security;
alter table public.batch_consumption enable row level security;

create policy batches_select on public.batches
for select
using (
  public.current_profile_role() = 'admin'
  or (
    public.current_profile_role() in ('branch_manager', 'senior_mixer')
    and branch_id = public.current_profile_branch_id()
  )
);

create policy batches_insert on public.batches
for insert
with check (
  public.current_profile_role() = 'admin'
  or (
    public.current_profile_role() in ('branch_manager', 'senior_mixer')
    and branch_id = public.current_profile_branch_id()
  )
);

create policy batches_update on public.batches
for update
using (
  public.current_profile_role() = 'admin'
  or (
    public.current_profile_role() in ('branch_manager', 'senior_mixer')
    and branch_id = public.current_profile_branch_id()
  )
)
with check (
  public.current_profile_role() = 'admin'
  or (
    public.current_profile_role() in ('branch_manager', 'senior_mixer')
    and branch_id = public.current_profile_branch_id()
  )
);

create policy batch_consumption_select on public.batch_consumption
for select
using (
  exists (
    select 1 from public.batches b
    where b.id = batch_consumption.batch_id
      and (
        public.current_profile_role() = 'admin'
        or (
          public.current_profile_role() in ('branch_manager', 'senior_mixer')
          and b.branch_id = public.current_profile_branch_id()
        )
      )
  )
);

create policy batch_consumption_insert on public.batch_consumption
for insert
with check (
  exists (
    select 1 from public.batches b
    where b.id = batch_consumption.batch_id
      and (
        public.current_profile_role() = 'admin'
        or (
          public.current_profile_role() in ('branch_manager', 'senior_mixer')
          and b.branch_id = public.current_profile_branch_id()
        )
      )
  )
);

create policy batch_consumption_update on public.batch_consumption
for update
using (
  exists (
    select 1 from public.batches b
    where b.id = batch_consumption.batch_id
      and (
        public.current_profile_role() = 'admin'
        or (
          public.current_profile_role() in ('branch_manager', 'senior_mixer')
          and b.branch_id = public.current_profile_branch_id()
        )
      )
  )
);
