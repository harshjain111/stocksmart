-- Recipe versions and lines. Immutable once inserted — the only mutable
-- field on recipe_versions is status; recipe_lines never change at all.
-- Percentage-sums-to-100 is enforced with a deferred constraint trigger so
-- a version's lines can be inserted together in one transaction.
--
-- audit_log is pulled forward from prompt 2.5 (recipe read logging):
-- 2.3 (new version) and 2.4 (rollback) both need to write to it before
-- 2.5 formally builds the audit view, so the table + a secure logging
-- function are created here instead of leaving a dangling dependency.

create table public.recipe_versions (
  id uuid primary key default gen_random_uuid(),
  flavour_id uuid not null references public.flavours (id),
  version_no integer not null,
  wastage_pct numeric(5, 2) not null default 2.00,
  note text not null check (btrim(note) <> ''),
  status text not null default 'current' check (status in ('current', 'archived')),
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  unique (flavour_id, version_no)
);

alter table public.flavours
  add constraint flavours_current_version_id_fkey
  foreign key (current_version_id) references public.recipe_versions (id);

create table public.recipe_lines (
  id uuid primary key default gen_random_uuid(),
  recipe_version_id uuid not null references public.recipe_versions (id),
  raw_material_id uuid not null references public.raw_materials (id),
  percentage numeric(5, 2) not null check (percentage > 0),
  created_at timestamptz not null default now()
);

-- recipe_versions: block everything except a status-only update, and all deletes.
create or replace function public.block_recipe_version_mutations()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'recipe_versions rows are never deleted';
  end if;

  if new.flavour_id <> old.flavour_id
     or new.version_no <> old.version_no
     or new.wastage_pct <> old.wastage_pct
     or new.note <> old.note
     or new.created_by is distinct from old.created_by
     or new.created_at <> old.created_at then
    raise exception 'recipe_versions rows are immutable except status';
  end if;

  return new;
end;
$$;

create trigger recipe_versions_block_mutations
  before update or delete on public.recipe_versions
  for each row execute function public.block_recipe_version_mutations();

-- recipe_lines: no update or delete path at all, ever.
create or replace function public.block_recipe_lines_mutations()
returns trigger
language plpgsql
as $$
begin
  raise exception 'recipe_lines rows are immutable and never deleted';
end;
$$;

create trigger recipe_lines_block_mutations
  before update or delete on public.recipe_lines
  for each row execute function public.block_recipe_lines_mutations();

-- A version's lines must sum to exactly 100. Deferred to transaction commit
-- so all lines for a new version can be inserted before the check runs.
create or replace function public.check_recipe_lines_sum()
returns trigger
language plpgsql
as $$
declare
  v_version_id uuid := coalesce(new.recipe_version_id, old.recipe_version_id);
  v_sum numeric;
begin
  select sum(percentage) into v_sum
  from public.recipe_lines
  where recipe_version_id = v_version_id;

  if v_sum is not null and v_sum <> 100 then
    raise exception 'Recipe line percentages for version % must sum to exactly 100, got %', v_version_id, v_sum;
  end if;

  return null;
end;
$$;

create constraint trigger recipe_lines_sum_check
  after insert or update or delete on public.recipe_lines
  deferrable initially deferred
  for each row execute function public.check_recipe_lines_sum();

alter table public.recipe_versions enable row level security;
alter table public.recipe_lines enable row level security;
-- No policies yet — default deny for every role. Real policies (admin +
-- senior_mixer read, admin insert) land in prompt 2.6.

-- ---------------------------------------------------------------------------
-- audit_log
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users (id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.audit_log enable row level security;

create policy audit_log_select_admin on public.audit_log
for select
using (public.current_profile_role() = 'admin');

-- Callable by any authenticated user so they can log their own actions
-- (e.g. reading a recipe version) — actor_id always comes from auth.uid(),
-- never a client-supplied value, so it can't be forged.
create or replace function public.log_audit_event(
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_log (actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), p_action, p_entity_type, p_entity_id, p_metadata);
end;
$$;

grant execute on function public.log_audit_event(text, text, uuid, jsonb) to authenticated;
