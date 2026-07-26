-- Par level management (3.5's Setup screen) is admin-only, matching the
-- other Setup master-data screens (Branches, People, Recipe access).
-- par_levels_select (3.4) already covers reads for the broader set of
-- roles that need to see pars on Stock > What we have.

create policy par_levels_insert on public.par_levels
for insert
with check (public.current_profile_role() = 'admin');

create policy par_levels_update on public.par_levels
for update
using (public.current_profile_role() = 'admin')
with check (public.current_profile_role() = 'admin');
