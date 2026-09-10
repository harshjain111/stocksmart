-- Stock module redesign, part 1 of 3: enum values only.
--
-- Postgres will add a value to an enum inside a transaction but refuses to
-- let the same transaction *use* it ("unsafe use of new value"). Every
-- migration here runs in one, so the new values have to land in their own
-- file ahead of the tables, policies and functions that reference them.
-- Nothing else belongs in this migration.

-- The Gate Man (spec §25): party movements and nothing else. Deliberately
-- the narrowest role in the system — he records what went out to a party
-- and what came back, and never sees stock levels, costs or purchasing.
alter type public.user_role add value if not exists 'gate_man';

-- Party movements are their own reasons rather than reusing 'dispatch'.
-- A dispatch is an internal transfer between departments and is matched by
-- a GRN at the far end; a party issue leaves the business entirely and is
-- matched by a party return, or by nothing at all when the stock is
-- consumed. Keeping them distinct is what lets consumption be derived
-- (§23) without having to exclude transfers from the same query.
alter type public.movement_reason add value if not exists 'party_issue';
alter type public.movement_reason add value if not exists 'party_return';

-- Party entries are numbered documents like every other one (rule 9).
alter type public.document_type add value if not exists 'PARTY';

-- Distinguishes the fast daily closing count (§11) from the formal,
-- approval-gated reconciliation count (§27). Both live in stock_counts so
-- there is one reconciliation ledger and one variance history rather than
-- two competing sources of truth (§76); only the workflow differs.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'stock_count_kind') then
    create type public.stock_count_kind as enum ('daily_close', 'full_count');
  end if;
end
$$;
