-- raw_materials master, and supplier_rates as append-only rate history.
-- Visible to admin and purchase_manager for now — broadened as other
-- screens (requisitions, batches, ...) need to reference materials.

create sequence public.raw_materials_code_seq;

create or replace function public.set_raw_material_code()
returns trigger
language plpgsql
as $$
begin
  if new.code is null then
    new.code := 'RM-' || lpad(nextval('public.raw_materials_code_seq')::text, 2, '0');
  end if;
  return new;
end;
$$;

create table public.raw_materials (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  name text not null,
  default_supplier_id uuid references public.suppliers (id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  updated_at timestamptz not null default now()
);

create trigger raw_materials_set_code
  before insert on public.raw_materials
  for each row execute function public.set_raw_material_code();

create trigger raw_materials_set_updated_at
  before update on public.raw_materials
  for each row execute function public.set_updated_at();

alter table public.raw_materials enable row level security;

create policy raw_materials_select on public.raw_materials
for select
using (public.current_profile_role() in ('admin', 'purchase_manager'));

create policy raw_materials_insert on public.raw_materials
for insert
with check (public.current_profile_role() in ('admin', 'purchase_manager'));

create policy raw_materials_update on public.raw_materials
for update
using (public.current_profile_role() in ('admin', 'purchase_manager'))
with check (public.current_profile_role() in ('admin', 'purchase_manager'));

-- ---------------------------------------------------------------------------
-- supplier_rates: append-only. A new row per rate change — no update path,
-- no delete path, enforced structurally (no such policies exist).
-- ---------------------------------------------------------------------------
create type public.rate_source as enum ('manual', 'grn');

create table public.supplier_rates (
  id uuid primary key default gen_random_uuid(),
  raw_material_id uuid not null references public.raw_materials (id),
  supplier_id uuid not null references public.suppliers (id),
  rate numeric(12, 2) not null,
  source public.rate_source not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id)
);

alter table public.supplier_rates enable row level security;

create policy supplier_rates_select on public.supplier_rates
for select
using (public.current_profile_role() in ('admin', 'purchase_manager'));

create policy supplier_rates_insert on public.supplier_rates
for insert
with check (public.current_profile_role() in ('admin', 'purchase_manager'));
