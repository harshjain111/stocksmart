-- Venues come from the Club App; flavours need a human.
--
-- A venue is unambiguous: the Club App knows every club it serves, and if
-- a new one opens there is nothing for anyone here to decide — it is that
-- club, and it should simply appear. So the sync now creates a department
-- of type 'club' for any venue it has not seen and records the pairing,
-- which means "Cafe in" shows up as a location without anyone mapping it.
--
-- A flavour is not unambiguous. "Paan Kiwi" might be our "Paan Kiwi Mint",
-- might be a flavour we do not stock, and getting it wrong silently
-- attributes one product's stock to another. That stays a decision, and
-- gets its own screen to make it quick.

-- Every flavour the Club App has ever sent, whether or not it maps to one
-- of ours. This is what the mapping screen lists: without it, a flavour
-- that is already mapped is invisible and can never be corrected, and an
-- unmapped one only exists for as long as the last sync's leftovers.
create table public.club_app_flavours (
  external_key text primary key,
  club_app_flavour_id uuid,
  name text not null,
  -- Context for whoever is mapping: how much is sitting under this name
  -- and in how many clubs, so an obviously-dead entry is recognisable.
  last_qty_g bigint not null default 0,
  club_count integer not null default 0,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

alter table public.club_app_flavours enable row level security;

create policy club_app_flavours_select on public.club_app_flavours
for select
using (
  public.current_profile_role() in
    ('admin', 'branch_manager', 'store_manager', 'hod')
);

-- Marks a department the sync created rather than a person, so the Setup
-- screens can say where it came from and nobody wonders why a club they
-- never added is listed.
alter table public.club_venue_map
  add column auto_created boolean not null default false;

-- club_unmapped_items is superseded by club_app_flavours: "unmapped" is
-- now simply a catalogue row with no club_flavour_map, which cannot go
-- stale between syncs the way a rebuilt leftovers table did. Dropped
-- rather than left dead — it is a sync cache introduced in the previous
-- migration and never held business data, so rule 7 does not apply.
drop table if exists public.club_unmapped_items;
