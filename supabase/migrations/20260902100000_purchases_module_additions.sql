-- Purchases module (Phase 6): adds the columns the new Overview/PO-detail/
-- GRN screens need that don't already exist. Everything else the module
-- needs (order-placed date, partial receiving across multiple GRNs, PO
-- numbering, supplier-wise grouping) already exists from 5.1/5.6 — this is
-- deliberately the smallest schema change that unblocks the new UI.

-- Expected delivery date: distinct from sent_at (order placed) and from
-- any GRN's posted_at (actual receipt) — needed for the "days left"/
-- overdue calculations on the Overview and Purchase Orders pages. Freely
-- editable like notes/rate (not covered by block_purchase_order_mutations'
-- identity check), since a supplier-promised date can change after the
-- order is placed.
alter table public.purchase_orders
  add column expected_delivery_date date;

-- Cancelled: the lifecycle documented in CLAUDE.md's Buying logic section
-- and 5.1's header comment never included a terminal "we're not going
-- through with this" state. Added as a new enum value (safe, additive —
-- existing rows/queries are unaffected) plus a reason, matching the
-- pattern used for transit_loss/short_closed elsewhere in this schema.
alter type public.purchase_order_status add value 'cancelled';

alter table public.purchase_orders
  add column cancelled_at timestamptz,
  add column cancelled_reason text,
  add column closed_at timestamptz;

-- Transportation cost: recorded against the actual receipt (GRN), never
-- the PO, because it's a real cost incurred bringing goods to the
-- receiving location — see CLAUDE.md-style reasoning in the PRD's landed
-- cost section. Nullable/freely editable while the GRN is still draft
-- (block_grn_mutations only freezes the row once posted, no per-column
-- lock), same as grn_lines.rate.
alter table public.grns
  add column transportation_cost numeric(12, 2);
