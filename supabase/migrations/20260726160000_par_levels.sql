-- par_levels, pulled forward from 3.5 — 3.4's "Stock > What we have" screen
-- needs it for the flavour matrix's below-par highlighting. The Setup
-- management screen for editing these (3.5's actual UI ask) comes later;
-- this migration is schema + read access only.

create table public.par_levels (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments (id),
  item_type public.item_type not null,
  item_id uuid not null,
  par_qty_g bigint not null check (par_qty_g >= 0),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  updated_at timestamptz not null default now(),
  unique (department_id, item_type, item_id)
);

create trigger par_levels_set_updated_at
  before update on public.par_levels
  for each row execute function public.set_updated_at();

alter table public.par_levels enable row level security;

-- Same visibility shape as stock_balances (3.1/3.2): admin sees everything,
-- everyone else scoped to their own branch. Write access (Setup's bulk-edit
-- table) is 3.5's concern — no insert/update policy yet.
create policy par_levels_select on public.par_levels
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
