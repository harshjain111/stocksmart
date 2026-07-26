-- RLS for recipe_versions and recipe_lines: the formula itself is
-- confidential (this is the entire reason 2.5 built a read-audit trail),
-- so only admin and senior_mixer can read it at all. Insert is admin-only,
-- matching create_recipe_version()'s own role check inside the function —
-- this is defense in depth for a client that ever tried to insert directly
-- via the REST API instead of going through the RPC.
--
-- No update/delete policies: recipe_lines has no update/delete path at all
-- (blocked by its own trigger), and recipe_versions' only mutable field
-- (status) is flipped exclusively by create_recipe_version() and
-- rollback_recipe_version(), both SECURITY DEFINER and so unaffected by
-- this RLS. Leaving update/delete unpoliced keeps them default-denied for
-- every direct API caller, admin included.

create policy recipe_versions_select on public.recipe_versions
for select
using (public.current_profile_role() in ('admin', 'senior_mixer'));

create policy recipe_versions_insert on public.recipe_versions
for insert
with check (public.current_profile_role() = 'admin');

create policy recipe_lines_select on public.recipe_lines
for select
using (public.current_profile_role() in ('admin', 'senior_mixer'));

create policy recipe_lines_insert on public.recipe_lines
for insert
with check (public.current_profile_role() = 'admin');
