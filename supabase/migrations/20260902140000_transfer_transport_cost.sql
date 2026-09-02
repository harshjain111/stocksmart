-- Multi-leg transportation (Purchases module).
--
-- A delivery's cost doesn't stop at the receiving godown. Supplier →
-- Guwahati is captured on the vendor GRN (grns.transportation_cost, added
-- in 20260902100000). Guwahati → Kolkata is a *transfer*, not a second
-- purchase — so its freight belongs on the transfer document, using the
-- existing Send & receive architecture rather than inventing a parallel
-- one. Accumulated landed cost is then simply:
--
--   purchase value (grn_lines rate x qty)
--   + inbound freight (grns.transportation_cost)
--   + freight for each onward leg (transfers.transportation_cost)
--
-- Per-unit allocation across legs (splitting one transfer's freight over
-- the specific items on it) is deliberately left to the reporting layer
-- rather than baked into a stored cost-layer table: the leg costs are now
-- captured losslessly, so that allocation can be added later without
-- restructuring anything here.
alter table public.transfers
  add column transportation_cost numeric(12, 2);
