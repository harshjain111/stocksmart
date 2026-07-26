-- Suppliers master. Global (not branch-scoped) — owned by purchase, visible
-- to admin and purchase_manager. Archive only, never deleted.

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  area text,
  contact_person text,
  phone text,
  gstin text,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  updated_at timestamptz not null default now()
);

create trigger suppliers_set_updated_at
  before update on public.suppliers
  for each row execute function public.set_updated_at();

alter table public.suppliers enable row level security;

create policy suppliers_select on public.suppliers
for select
using (public.current_profile_role() in ('admin', 'purchase_manager'));

create policy suppliers_insert on public.suppliers
for insert
with check (public.current_profile_role() in ('admin', 'purchase_manager'));

create policy suppliers_update on public.suppliers
for update
using (public.current_profile_role() in ('admin', 'purchase_manager'))
with check (public.current_profile_role() in ('admin', 'purchase_manager'));
