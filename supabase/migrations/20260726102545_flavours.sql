-- Flavours master. current_version_id has no FK yet — recipe_versions
-- doesn't exist until phase 2 (2.1), which adds the constraint then.
-- Creating a flavour here never creates a recipe; that's the Recipes screen.

create sequence public.flavours_code_seq;

create or replace function public.set_flavour_code()
returns trigger
language plpgsql
as $$
begin
  if new.code is null then
    new.code := 'FL-' || lpad(nextval('public.flavours_code_seq')::text, 2, '0');
  end if;
  return new;
end;
$$;

create table public.flavours (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  name text not null,
  current_version_id uuid,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  updated_at timestamptz not null default now()
);

create trigger flavours_set_code
  before insert on public.flavours
  for each row execute function public.set_flavour_code();

create trigger flavours_set_updated_at
  before update on public.flavours
  for each row execute function public.set_updated_at();

alter table public.flavours enable row level security;

-- Same visibility as raw_materials for now: master data (code/name), not
-- the recipe formula itself — that's locked to admin + senior_mixer once
-- recipe_versions/lines land in phase 2.
create policy flavours_select on public.flavours
for select
using (public.current_profile_role() in ('admin', 'purchase_manager'));

create policy flavours_insert on public.flavours
for insert
with check (public.current_profile_role() in ('admin', 'purchase_manager'));

create policy flavours_update on public.flavours
for update
using (public.current_profile_role() in ('admin', 'purchase_manager'))
with check (public.current_profile_role() in ('admin', 'purchase_manager'));
