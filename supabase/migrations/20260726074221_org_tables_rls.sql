-- RLS policies for the org tables. All four already have RLS enabled
-- with zero policies (default deny) from the previous migration.
--
-- Rules:
--   admin                sees everything
--   branch_manager /
--   store_manager         see their own branch (all its departments/profiles)
--   hod                   sees only departments listed in their user_departments
--   everyone              can read their own profile, and their own branch row
--
-- purchase_manager / senior_mixer / mixer get no extra department/profile
-- visibility yet — later phases grant narrow access as their own screens
-- need it (e.g. senior_mixer + recipes in phase 2).
--
-- Helper functions are SECURITY DEFINER so policies can look up the
-- calling user's own role/branch without recursing into profiles' RLS.
-- They only ever resolve auth.uid() — never a client-supplied id — so
-- they can't be used to probe another user's data.

create or replace function public.current_profile_role()
returns public.user_role
language sql
security definer
stable
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.current_profile_branch_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select branch_id from public.profiles where id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- branches
-- ---------------------------------------------------------------------------
create policy branches_select on public.branches
for select
using (
  public.current_profile_role() = 'admin'
  or id = public.current_profile_branch_id()
);

create policy branches_admin_insert on public.branches
for insert
with check (public.current_profile_role() = 'admin');

create policy branches_admin_update on public.branches
for update
using (public.current_profile_role() = 'admin')
with check (public.current_profile_role() = 'admin');

-- ---------------------------------------------------------------------------
-- departments
-- ---------------------------------------------------------------------------
create policy departments_select on public.departments
for select
using (
  public.current_profile_role() = 'admin'
  or (
    public.current_profile_role() in ('branch_manager', 'store_manager')
    and branch_id = public.current_profile_branch_id()
  )
  or exists (
    select 1 from public.user_departments ud
    where ud.department_id = departments.id
      and ud.profile_id = auth.uid()
  )
);

create policy departments_admin_insert on public.departments
for insert
with check (public.current_profile_role() = 'admin');

create policy departments_admin_update on public.departments
for update
using (public.current_profile_role() = 'admin')
with check (public.current_profile_role() = 'admin');

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create policy profiles_select on public.profiles
for select
using (
  id = auth.uid()
  or public.current_profile_role() = 'admin'
  or (
    public.current_profile_role() in ('branch_manager', 'store_manager')
    and branch_id = public.current_profile_branch_id()
  )
);

-- Profile creation/mutation (invite, deactivate, role/branch change) is
-- admin-only and goes through a service-role server action in prompt 1.8 —
-- no insert/update policy for the regular authenticated role here.

-- ---------------------------------------------------------------------------
-- user_departments
-- ---------------------------------------------------------------------------
create policy user_departments_select on public.user_departments
for select
using (
  profile_id = auth.uid()
  or public.current_profile_role() = 'admin'
  or (
    public.current_profile_role() in ('branch_manager', 'store_manager')
    and exists (
      select 1 from public.departments d
      where d.id = user_departments.department_id
        and d.branch_id = public.current_profile_branch_id()
    )
  )
);

-- Assignment mutation is admin-only, built alongside Setup > People (1.8).
