-- Fix infinite recursion: the departments policy subqueried
-- user_departments, and the user_departments policy subqueried
-- departments — each SELECT re-triggered the other table's RLS,
-- looping forever (error 42P17). Route both cross-table checks through
-- SECURITY DEFINER helpers so they read past the other table's RLS
-- instead of re-entering it.

create or replace function public.department_branch_id(dept_id uuid)
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select branch_id from public.departments where id = dept_id;
$$;

create or replace function public.is_assigned_to_department(dept_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.user_departments
    where department_id = dept_id and profile_id = auth.uid()
  );
$$;

drop policy departments_select on public.departments;
create policy departments_select on public.departments
for select
using (
  public.current_profile_role() = 'admin'
  or (
    public.current_profile_role() in ('branch_manager', 'store_manager')
    and branch_id = public.current_profile_branch_id()
  )
  or public.is_assigned_to_department(id)
);

drop policy user_departments_select on public.user_departments;
create policy user_departments_select on public.user_departments
for select
using (
  profile_id = auth.uid()
  or public.current_profile_role() = 'admin'
  or (
    public.current_profile_role() in ('branch_manager', 'store_manager')
    and public.department_branch_id(department_id) = public.current_profile_branch_id()
  )
);
