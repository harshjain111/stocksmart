-- Club App integration: identity mapping and a richer snapshot.
--
-- The Club App is a separate system with its own ids for venues and
-- flavours. Nothing guarantees its "Nyx" is our "Club Aurum", or that its
-- "Black magic" is our "Black Magic" — in the live data today it is
-- neither: no venue name overlaps at all, and only one flavour name
-- matches once case and trailing spaces are ignored.
--
-- So identity is stored, not guessed afresh on every sync. A name can be
-- used to *propose* a match, but once a human confirms it the pairing is
-- recorded and survives either side renaming things, which is exactly
-- what the integration guide asks for.
--
-- external_key is what the Club App calls the thing: its UUID where it
-- has one, and a normalised name where it does not. The live API returns
-- flavour.id = null for every row today (documented as legacy catalogue
-- data), so a name-only key has to be a first-class case rather than an
-- error path.

create table public.club_venue_map (
  external_key text primary key,
  club_app_club_id uuid,
  club_app_name text not null,
  club_app_location text,
  -- Clubs are departments of type 'club', like every other stock
  -- location; the Club App just owns what is in them.
  department_id uuid not null references public.departments (id),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  updated_at timestamptz not null default now(),
  -- One venue per department: two Club App venues pointing at the same
  -- inventory club would silently sum into one balance.
  unique (department_id)
);

create table public.club_flavour_map (
  external_key text primary key,
  club_app_flavour_id uuid,
  club_app_flavour_name text not null,
  flavour_id uuid not null references public.flavours (id),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  updated_at timestamptz not null default now()
);

create trigger club_venue_map_set_updated_at
  before update on public.club_venue_map
  for each row execute function public.set_updated_at();

create trigger club_flavour_map_set_updated_at
  before update on public.club_flavour_map
  for each row execute function public.set_updated_at();

-- Rows the last sync could not place. Kept so the mapping screen has
-- something concrete to offer — without this, an unmapped club is simply
-- invisible and the stock silently never arrives.
create table public.club_unmapped_items (
  external_key text primary key,
  club_app_club_id uuid,
  club_app_club_name text not null,
  club_app_location text,
  club_app_flavour_id uuid,
  club_app_flavour_name text not null,
  qty_g bigint not null,
  minimum_qty_g bigint,
  status text,
  -- Which half is missing: 'club', 'flavour', or 'both'.
  missing text not null check (missing in ('club', 'flavour', 'both')),
  seen_at timestamptz not null default now()
);

-- The Club App reports quantities in its own unit and computes its own
-- status. Both are kept verbatim alongside the converted grams, so a
-- disagreement can be investigated against what it actually sent rather
-- than against our arithmetic.
alter table public.club_stock_snapshots
  add column minimum_qty_g bigint,
  add column status text,
  add column source_unit text,
  add column source_quantity numeric,
  add column source_updated_at timestamptz;

alter table public.club_sync_log
  add column unmapped_items integer not null default 0;

alter table public.club_venue_map enable row level security;
alter table public.club_flavour_map enable row level security;
alter table public.club_unmapped_items enable row level security;

-- Readable by anyone who can see stock. No insert/update/delete policy on
-- any of them: mappings are written by server actions through the service
-- role after an authorisation check, and the snapshot cache only by the
-- sync. That absence is what keeps club data genuinely uneditable from a
-- browser rather than merely hidden (§4, §35).
create policy club_venue_map_select on public.club_venue_map
for select
using (
  public.current_profile_role() in
    ('admin', 'branch_manager', 'store_manager', 'hod')
);

create policy club_flavour_map_select on public.club_flavour_map
for select
using (
  public.current_profile_role() in
    ('admin', 'branch_manager', 'store_manager', 'hod')
);

create policy club_unmapped_items_select on public.club_unmapped_items
for select
using (
  public.current_profile_role() in
    ('admin', 'branch_manager', 'store_manager', 'hod')
);
