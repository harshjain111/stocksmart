-- senior_mixer needs to pick a flavour and see raw material names to make a
-- batch (2.8) — flavours_select/raw_materials_select were written in phase 1
-- before Mix screens existed and only granted admin + purchase_manager.
-- Read-only: senior_mixer still can't insert/update either table.

drop policy flavours_select on public.flavours;

create policy flavours_select on public.flavours
for select
using (public.current_profile_role() in ('admin', 'purchase_manager', 'senior_mixer'));

drop policy raw_materials_select on public.raw_materials;

create policy raw_materials_select on public.raw_materials
for select
using (public.current_profile_role() in ('admin', 'purchase_manager', 'senior_mixer'));
