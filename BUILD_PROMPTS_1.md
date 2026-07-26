# Smooxy Inventory — Build Prompts

Sequential prompts for Claude Code. Run them in order. Each one assumes the previous is done and committed.

**Before prompt 1:** put `CLAUDE.md` and `PRD.md` in the repo root. Every prompt below implicitly means *"following CLAUDE.md."*

**Rhythm:** run a prompt → check it in the browser → commit → next. Don't run three at once and then debug.

---

# PHASE 1 — Foundation and masters
*Goal: you can log in as any role and every master is set up. ~2 weeks.*

### 1.1
Initialise a Next.js 15 project with the App Router, TypeScript in strict mode, Tailwind, and shadcn/ui. Set up ESLint and Prettier. Add a Supabase client for both server and browser contexts using `@supabase/ssr`. Create `.env.example` with the variables needed. No auth yet — just prove the app boots and can reach Supabase.

### 1.2
Design the visual system before building any screen. Read the mockup at `/design/mockup.jsx` if present. Set up Tailwind theme tokens for the palette (mineral paper background, bottle green primary, ember for alerts, gold for warnings), the type scale, and tabular-figure numerics for all quantity displays. Build shared primitives: `PageHeader`, `Card`, `DataTable`, `QtyInput` (always shows its unit), `StatusTag`, `EmptyState` (says what to do next, never "no data"), `ConfirmDialog` (typed confirmation for irreversible actions).

### 1.3
Create the migration for org tables: `branches`, `departments`, `profiles`, `user_departments`. Departments carry `holds_raw`, `holds_mixed`, `can_mix` flags and a `type` enum (`godown`, `office`, `club`, `cafe`). Add `created_at`, `created_by` everywhere. Seed Guwahati as HQ and Kolkata as a branch, with the departments listed in PRD section 4.

### 1.4
Set up Supabase Auth with email and password. Build the login screen and a session-aware layout shell. On first login, load the user's profile, role, branch and departments into a server-side context available to every page. Redirect unauthenticated users to login.

### 1.5
Implement the role system as defined in CLAUDE.md: seven roles, with a `can()` helper for permission checks on the server. Build the app shell — left rail navigation, filtered by role, plus a top bar showing the user's name, branch and role. Navigation items: Home, Requisitions, Send & receive, Buy, Mix, Stock, Recipes, Setup.

### 1.6
Write RLS policies for the org tables. `admin` sees all branches. `branch_manager` and `store_manager` see their branch. `hod` sees only departments listed in their `user_departments`. Everyone can read their own profile. Add a test script under `/scripts` that logs in as each role and asserts what it can and can't read.

### 1.7
Build Setup → Branches & departments. List branches, expand to show departments with their flags and HOD. Create and edit both. Departments can be archived, never deleted, and only if they hold zero stock. Admin only.

### 1.8
Build Setup → People. List users with role, branch and assigned departments. Invite a user by email, assign a role, assign departments for HODs. Deactivate rather than delete. Admin only.

### 1.9
Create the migration for `suppliers` and build Setup → Suppliers. Fields: name, area, contact person, phone, GSTIN, notes. Search and filter. Archive, never delete. Visible to admin and purchase manager.

### 1.10
Create migrations for `raw_materials` and `supplier_rates`. Materials have an auto-generated code `RM-01`, name, default supplier, and active flag. `supplier_rates` is append-only history — never updated, a new row per rate change, with a `source` column recording whether it came from a manual entry or a GRN.

### 1.11
Build Setup → Materials. List raw materials with their preferred supplier and last-known rate. Add and edit materials. Show the rate history for a material as a small timeline. Rates are visible to admin and purchase manager only — enforce in RLS, not just the UI.

### 1.12
Create the migration for `flavours` — code `FL-01`, name, `current_version_id` nullable for now, active flag. Build the flavours list under Setup → Materials & flavours as a second tab. Creating a flavour here does not create a recipe; that happens on the Recipes screen.

### 1.13
Build the document numbering system. A `document_sequences` table plus a Postgres function `next_doc_no(doc_type, branch_id)` returning `REQ-0001` style numbers, sequential per type per financial year. Never generated client-side, never reused. Write a test that hammers it concurrently and asserts no duplicates.

---

# PHASE 2 — Recipes and mixing
*Goal: recipes are versioned and protected, batches are traceable. ~1.5 weeks.*

### 2.1
Create migrations for `recipe_versions` and `recipe_lines`. A version has `version_no`, `wastage_pct`, a mandatory `note`, `created_by`, `created_at`, and `status` (`current` / `archived`). Add a DB constraint that recipe line percentages for a version sum to exactly 100. Add a trigger that blocks any UPDATE or DELETE on `recipe_versions` and `recipe_lines` except changing `status`.

### 2.2
Build the Recipes screen. Left: flavour list. Right: a version strip showing every version with its number, current/archived state, and batch count. Selecting a version shows its lines as percentage bars, the reason note, who created it and when. Read-only, always.

### 2.3
Build the new-version flow. The button says "Change → v{n+1}", not "Edit". It opens the selected version's lines prefilled and editable. Save is disabled until percentages total exactly 100 **and** a reason note is entered. Saving inserts a new version, marks it current, archives the previous one, and writes to `audit_log`. There must be no code path that edits an existing version.

### 2.4
Add version rollback. On an archived version, admin sees "Make v{n} current again". It flips the status flags and logs the rollback with the user and timestamp. No data is copied or rewritten.

### 2.5
Implement recipe read logging. Every time a version's lines are fetched, insert into `audit_log` with the user, flavour, version and timestamp. Build a small audit view under Setup showing recipe access, filterable by user and flavour.

### 2.6
Write RLS for `recipe_versions` and `recipe_lines`: readable only by `admin` and `senior_mixer`. Insert only by `admin`. Extend the role test script to assert that a `mixer` and a `purchase_manager` calling the API directly get zero rows.

### 2.7
Create migrations for `batches` and `batch_consumption`. A batch stores `batch_no`, flavour, `recipe_version_id`, `recipe_snapshot jsonb` (full formula copied in), `output_g`, department, `mixed_by`, `mixed_at`, `deviation_note`, `rating`, `feedback`, and status `draft` / `confirmed`. `batch_consumption` holds planned and actual grams per material.

### 2.8
Build Mix → Make a batch. Pick a flavour, then a recipe version (defaults to current, older versions clearly marked with a warning banner), then enter output kg. Show the batch card: each component with its exact weight, a tick box to confirm it was weighed, and a running total including wastage. Confirm is disabled until every component is ticked.

### 2.9
Implement masked mode server-side. When the requesting user's role is `mixer`, the batch card API returns component codes only — no material names, no percentages, no version number. Assert in a test that the response payload contains no material names for that role.

### 2.10
Build batch confirmation. On confirm, capture actual weights per component (defaulting to planned), write the batch, write consumption rows, and post stock movements — `batch_consume` negative for each raw material, `batch_produce` positive for the flavour, all at the mixing department. Generate the batch number. Once confirmed, a batch cannot be edited, only annotated.

### 2.11
Build Mix → Past batches. Every batch with its number, flavour, version tag, quantity, who mixed it, date, and rating. Rate an unrated batch inline with a note. Below the list, a version scoreboard per flavour: version, mix summary, batch count, average rating, current/archived.

### 2.12
Add the mixing variance view: planned vs actual grams per batch and per material, aggregated by week and by mixer. This is one of the four leakage sources.

---

# PHASE 3 — Stock
*Goal: an honest ledger you can trace and count against. ~1.5 weeks.*

### 3.1
Create the `stock_movements` migration: department, `item_type` (`raw` / `flavour`), `item_id`, signed `qty_g bigint`, `reason` enum, `ref_type`, `ref_id`, `created_by`, `created_at`. Append-only — add a trigger blocking UPDATE and DELETE. This table is the source of truth for everything.

### 3.2
Create `stock_balances` (department, item_type, item_id, qty_g) maintained by a trigger on `stock_movements`. No application code ever writes to it. Add a reconciliation script that recomputes balances from the ledger and reports any drift.

### 3.3
Build a `postMovement()` server helper — the single function every feature calls to move stock. It validates the department can hold that item type, refuses to take a balance negative without an explicit override flag, and always requires a reason and reference. Nothing else in the codebase inserts movements directly.

### 3.4
Build Stock → What we have. A toggle for raw materials or mixed flavours. Raw materials show quantity and inbound on order. Flavours show a department-by-department matrix with par levels underneath, red where below par. Filterable by branch. Users see only what their role and departments allow.

### 3.5
Create the `par_levels` migration and build par level management under Setup, per department per item. Bulk-edit in a table. Show current stock next to the par so the number being set has context.

### 3.6
Build opening stock entry. A one-time-per-department screen where admin or store manager enters starting quantities for raw materials and flavours. Posts movements with reason `opening`. Locks after submission — reopening requires an admin override that gets logged.

### 3.7
Create migrations for `stock_counts` and `stock_count_lines`, with status `draft` → `submitted` → `approved`.

### 3.8
Build Stock → Count stock. Pick a department (HODs see only theirs) and choose what to count: raw materials, mixed flavours, or both. Raw material options disable for departments where `holds_raw` is false. Generate the count sheet with system quantity beside a blank counted box. Difference calculates live as they type.

### 3.9
Add reason capture and approval to counts. Any line with a difference needs a reason before submission. Submitted counts go to the store manager or admin for approval. **Approval is what posts `count_adjust` movements** — not submission.

### 3.10
Build the count variance report: differences by department, by item and by period, with the count document linked. Fourth leakage source.

---

# PHASE 4 — Movement between departments
*Goal: requisition → approval → dispatch → receipt, with in-transit visible. ~2.5 weeks.*

### 4.1
Create migrations for `requisitions` and `requisition_lines`. Header: number, department, raised by, needed by, status (`draft` / `submitted` / `approved` / `fulfilling` / `closed` / `rejected`), note. Lines: item_type, item_id, qty_g requested, decision enum (`transfer` / `mix_then_transfer` / `buy` / `rejected`), approved qty, and a reference to whatever fulfils it.

### 4.2
Build Requisitions → Mine. An HOD picks items — raw materials and flavours in one list, filtered to what their department can hold — enters quantities and a needed-by date, and submits. Draft is editable, submitted is not. Show the current stock of each item at their own department beside each line as they add it.

### 4.3
Build Requisitions → To approve. The reviewer sees each line with the decision context they need: how much the branch godown has in stock, how much is already mixed if it's a flavour, and how much is on order. Approver picks a decision per line and may approve a partial quantity with a note.

### 4.4
Implement approval consequences. On approve: lines marked `transfer` group into a draft transfer from the branch godown; `mix_then_transfer` creates a mixing suggestion and then a transfer; `buy` lines flow into the buy queue with the requesting department as ship-to; `rejected` lines close with the reason. Everything is linked back to the requisition so the HOD can see status without asking anyone.

### 4.5
Build Requisitions → All, with filters for branch, department, status and date. Show a status timeline per requisition — raised, approved, dispatched, received — so a single screen answers "where is my stuff".

### 4.6
Create migrations for `transfers` and `transfer_lines`. Header: number, from department, to department, optional requisition link, status (`draft` / `dispatched` / `received` / `short_closed` / `closed`), dispatched by and at, courier or vehicle, docket number.

### 4.7
Build Send & receive → Send out. The store manager sees draft transfers created from approvals, plus can create an ad-hoc transfer. Add lines, check availability against current stock, and dispatch. **Dispatch posts negative movements at the sender only.** Print or share a dispatch note.

### 4.8
Build Send & receive → In transit. Everything dispatched and not yet fully received, with age in days, ageing past 3 days highlighted. Grouped by route (from → to). This screen is how transit leakage becomes visible instead of invisible.

### 4.9
Create migrations for `grns` and `grn_lines`. One GRN table serves both sources: `source` is `vendor` (against a PO) or `internal` (against a transfer). Lines hold expected, received and damaged quantities, plus an optional rate for vendor receipts. Status `draft` → `posted`.

### 4.10
Build Send & receive → Receive. Show everything inbound to the user's departments — dispatched transfers and sent purchase orders together in one list. Selecting one opens the GRN form: expected quantity shown, actual quantity entered, damaged quantity optional, reason required if short. Same screen and same habit for both sources.

### 4.11
Implement GRN posting. Posting is what moves stock — positive movements at the receiving department, reason `grn_transfer` or `grn_vendor`. If received is less than dispatched on an internal GRN, post a `transit_loss` movement so the ledger balances, flag the discrepancy, and mark the transfer `short_closed`. Over-receipt requires an explicit flag and a reason.

### 4.12
Build the transit variance report: dispatched vs received by route, by item and by period, with the transfer and GRN linked. Third leakage source.

### 4.13
Build the Home screen as a to-do list, not a dashboard. Sections, each showing only what applies to the signed-in user: requisitions waiting on my approval, goods dispatched to me and not received, items below par in my departments, in-transit items ageing past 3 days, batches waiting to be rated. Every item links straight to the action.

---

# PHASE 5 — Buying
*Goal: shortfall becomes a purchase order, routed to the right city. ~1.5 weeks.*

### 5.1
Create migrations for `purchase_orders` and `po_lines`. Header: number, supplier, `ship_to_department_id`, optional requisition link, status (`draft` / `sent` / `partially_received` / `received` / `closed`), sent at, notes. Lines: raw material, qty_g, nullable rate.

### 5.2
Build the buy engine as a pure, tested function. Input: demand lines (item, quantity, fulfilling department). Output: raw material shortfall grouped by supplier. It must net off mixed flavour stock at the fulfilling department, explode remaining flavour demand through current recipe versions applying that version's wastage, then net raw material need off stock and open inbound orders at that department. **It must never net one branch's requirement against another branch's stock.** Write unit tests for these cases before wiring any UI.

### 5.3
Build Buy → What to buy. Three demand sources shown together: approved requisition lines marked `buy`, manual entry, and an optional par top-up toggle. Show the working clearly — needed, have, on order, buy — and group the result into draft orders by supplier with the correct ship-to department on each.

### 5.4
Build purchase order creation and the Orders list. Filter by supplier, status, ship-to branch and date. Rates pre-fill from the last known rate and stay editable. A blank rate is valid and marks the order rate-to-confirm.

### 5.5
Build the PO detail and send flow. Generate a clean printable or shareable order document with Smooxy's letterhead, the supplier's details, the ship-to address, and the lines. Sending locks quantities but not rates.

### 5.6
Wire vendor GRNs into the Receive screen from phase 4. A vendor GRN additionally captures the rate per line and an invoice file upload to Supabase Storage. Posting it writes a new `supplier_rates` row, updates the PO status to partially or fully received, and posts stock movements at the ship-to department.

### 5.7
Build the purchase history view: every order and receipt by supplier and by material, with rate movement over time as a small chart. Purchase manager and admin only.

### 5.8
Add supplier performance: on-time percentage, short-supply percentage, and rate trend per supplier. Keep it to one screen — it's a decision aid, not a report suite.

---

# PHASE 6 — Intelligence
*Goal: the system starts telling you things instead of only recording them. ~1.5 weeks.*

### 6.1
Build the club API client. Fetch daily closing stock from the Smooxy Club app: club, date, flavour, closing stock, quantity received, shishas sold. Handle auth, retries and partial failures. Log every run into `club_sync_log` with status, row count and any error. Read-only — never write back.

### 6.2
Create `club_flavour_map` and build the mapping screen under Setup → Club link. Club app flavour name on the left, our flavour on the right, with unmapped entries flagged. Sync refuses to run for unmapped flavours rather than guessing.

### 6.3
Implement the sync itself. Closing stock becomes the department's balance via a `club_sync` movement equal to the difference. Compute consumption as opening plus received minus closing. Run nightly on a Vercel cron, plus a Sync now button on Home.

### 6.4
Handle sync failure gracefully. Home shows the last successful sync time and a clear warning when stale. Manual closing stock entry stays available for club departments so nobody is ever blocked by a broken integration.

### 6.5
Build the club variance report: shishas sold × standard grams versus actual consumption, per club per flavour per week. First leakage source. Make the standard grams per shisha configurable in Setup.

### 6.6
Build the combined Leakage report — one screen, four sections: transit, mixing, club and count variance. Each row shows the number, the period, and a link to the underlying document. This is the screen that pays for the system.

### 6.7
Build par level suggestions. Using at least 60 days of consumption data, compute average daily use per department per item, multiply by lead time and a safety factor, and propose a revised par. Present as suggestions to accept or ignore, never applied automatically.

### 6.8
Build the reorder forecast: for each department and item, days of cover remaining at current consumption, sorted by urgency. Feed anything under lead time into the buy queue automatically.

### 6.9
Final pass on RLS. Re-run the full role test script across every table added since phase 1. Verify a `mixer` cannot read recipes, a `purchase_manager` cannot read recipes, an `hod` cannot read another department's stock, and a Kolkata user cannot read Guwahati data. Fix anything that leaks.

### 6.10
Performance and polish. Add indexes on `stock_movements` for department, item and date. Make every list paginate. Verify all screens work on a phone at 380px. Add loading skeletons. Check keyboard focus is visible throughout and reduced motion is respected.

---

## Order of value

If you need something usable before the full build:

- **After phase 2** — recipes are protected and versioned, batches traceable. That alone stops recipe drift.
- **After phase 4** — the whole physical flow works. Requisition to receipt, multi-city, with leakage visible. This is a complete system.
- **Phases 5 and 6** — buying automation and intelligence. High value, but the business runs without them.
