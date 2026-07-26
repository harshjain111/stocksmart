-- Org tables: branches, departments, profiles, user_departments.
-- A branch is a city. A department is the only thing that holds stock.

create type public.user_role as enum (
  'admin',
  'branch_manager',
  'store_manager',
  'purchase_manager',
  'hod',
  'senior_mixer',
  'mixer'
);

create type public.department_type as enum (
  'godown',
  'office',
  'club',
  'cafe'
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- branches
-- ---------------------------------------------------------------------------
create table public.branches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_hq boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  updated_at timestamptz not null default now()
);

create trigger branches_set_updated_at
  before update on public.branches
  for each row execute function public.set_updated_at();

alter table public.branches enable row level security;

-- ---------------------------------------------------------------------------
-- profiles (extends auth.users)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  role public.user_role not null,
  branch_id uuid references public.branches (id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  updated_at timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;

-- ---------------------------------------------------------------------------
-- departments
-- ---------------------------------------------------------------------------
create table public.departments (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches (id),
  name text not null,
  type public.department_type not null,
  holds_raw boolean not null default false,
  holds_mixed boolean not null default false,
  can_mix boolean not null default false,
  hod_id uuid references public.profiles (id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  updated_at timestamptz not null default now()
);

create trigger departments_set_updated_at
  before update on public.departments
  for each row execute function public.set_updated_at();

alter table public.departments enable row level security;

-- ---------------------------------------------------------------------------
-- user_departments (an HOD can own several departments)
-- ---------------------------------------------------------------------------
create table public.user_departments (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id),
  department_id uuid not null references public.departments (id),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  unique (profile_id, department_id)
);

alter table public.user_departments enable row level security;

-- ---------------------------------------------------------------------------
-- Seed: Guwahati (HQ) and Kolkata, with departments per PRD section 4.
-- HODs are assigned later via Setup > People once real accounts exist.
-- ---------------------------------------------------------------------------
insert into public.branches (name, is_hq) values
  ('Guwahati', true),
  ('Kolkata', false);

insert into public.departments (branch_id, name, type, holds_raw, holds_mixed, can_mix)
select b.id, d.name, d.type::public.department_type, d.holds_raw, d.holds_mixed, d.can_mix
from public.branches b
join (
  values
    ('Guwahati', 'Main Godown',   'godown', true,  true,  true),
    ('Guwahati', 'Office',        'office', false, true,  false),
    ('Guwahati', 'Club Nexa',     'club',   false, true,  false),
    ('Guwahati', 'Club Mirage',   'club',   false, true,  false),
    ('Guwahati', 'Cafe Downtown', 'cafe',   false, true,  false),
    ('Kolkata',  'Kolkata Store', 'godown', true,  true,  false),
    ('Kolkata',  'Kolkata Office','office', false, true,  false),
    ('Kolkata',  'Club Aurum',    'club',   false, true,  false)
) as d(branch_name, name, type, holds_raw, holds_mixed, can_mix)
  on d.branch_name = b.name;
