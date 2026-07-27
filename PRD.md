# Smokzy Inventory System — PRD v1.0

**Owner:** Rohit Saha · **Date:** 26 July 2026 · **Status:** For approval

---

## 1. Why

Smokzy buys raw flavour materials, mixes them into finished flavours by recipe, and distributes them to godowns, offices, clubs and cafés across more than one city. Today that runs on memory, WhatsApp and spreadsheets.

Three things go wrong at scale, and this system exists to stop all three:

1. **Running out.** A club runs dry on a Saturday because nobody knew stock was low.
2. **Leakage.** Material disappears between the godown and the club, or between the recipe and the mix, and nobody can prove where.
3. **Recipe drift.** The same flavour tastes different every batch, and there's no record of what was actually mixed.

**Success looks like:** zero stockouts at any location, every gram traceable to a document, and a recipe you can defend six months later.

---

## 2. What it is not

- Not accounting software. It records purchases and invoices; it doesn't do books.
- Not the club app. That already exists and stays as it is — we read from its API.
- Not a POS. Sales happen in the club app.
- Not an HR system. Attendance stays where it is.

---

## 3. Who uses it

| Role | Where they sit | What they do |
|---|---|---|
| **Admin / Owner** | Everywhere | Sets recipes, approves requisitions, sees everything |
| **Branch manager** | One city | Runs their branch end to end |
| **Store manager** | Godown | Dispatches transfers, receives goods, runs counts |
| **Purchase manager** | HQ | Suppliers, rates, purchase orders, vendor receipts |
| **HOD** | A department | Raises requisitions, receives goods, counts their own stock |
| **Senior mixer** | Mixing floor | Mixes batches, picks recipe version |
| **Mixer / helper** | Mixing floor | Runs an assigned batch. Sees codes, never the formula |

Club staff are not users here.

---

## 4. How the business is modelled

### Branch → Department

A **branch** is a city. A **department** is the only thing that holds stock.

```
GUWAHATI  (HQ · mixing happens here)
  Main Godown      raw ✓  mixed ✓  can mix ✓     HOD: Bikash
  Office           raw ✕  mixed ✓                HOD: Priya
  Club Nexa        raw ✕  mixed ✓                HOD: Imran
  Club Mirage      raw ✕  mixed ✓                HOD: Imran
  Cafe Downtown    raw ✕  mixed ✓                HOD: Imran

KOLKATA  (branch · no mixing)
  Kolkata Store    raw ✓  mixed ✓  can mix ✕     HOD: Sandeep
  Kolkata Office   raw ✕  mixed ✓                HOD: Sandeep
  Club Aurum       raw ✕  mixed ✓                HOD: Sandeep
```

Adding a third city is adding a branch and its departments. No code changes.

**Kolkata holds raw materials but cannot mix.** That's deliberate — they may receive raw stock for onward supply or future mixing capability, but the `can_mix` flag stays off until you turn it on.

---

## 5. The core flows

### 5.1 Requisition — how demand starts

Any HOD raises a requisition for their department. Lines can be **raw materials or mixed flavours**, in any combination.

> Kolkata Store needs: Pan Kiwi 10 kg, Mint Storm 5 kg, Mint (raw) 3 kg — by 5 August

It goes to the admin or store manager for review. **The reviewer decides line by line**, and the screen shows them what they need to decide with:

| Line | HQ has | Decision |
|---|---|---|
| Pan Kiwi 10 kg | 3 kg mixed | **Mix then transfer** — 7 kg to be mixed first |
| Mint Storm 5 kg | 5.2 kg mixed | **Transfer** from Guwahati |
| Mint (raw) 3 kg | 8.6 kg | **Buy direct** — ship straight to Kolkata, cheaper than freight |

Four possible decisions per line: **transfer · mix then transfer · buy · reject.** Partial approval is allowed — approve 6 kg of a 10 kg ask, with a note.

Approval generates the transfers and purchase orders automatically. The requesting HOD sees status on their own screen without asking anyone.

### 5.2 Transfer — sending stock

The store manager dispatches. A transfer note records what left, who sent it, and how it's travelling (vehicle or courier docket).

**Dispatch reduces the sender's stock. It does not increase the receiver's.** The difference sits in a state called **in transit**, on its own screen, visible to everyone.

That gap is the whole point. Stock that has left Guwahati and not arrived in Kolkata is not "somewhere in the system" — it's a number on a screen with a date next to it, ageing.

### 5.3 Goods Receipt Note — the single receiving screen

**Everything that arrives is received the same way**, whether it came from a supplier or from another department. One screen, one habit, one document.

The receiver enters actual quantity — not the expected quantity, the actual one. If it's short or damaged, they say so and give a reason.

| | From a supplier | From another department |
|---|---|---|
| Raised against | A purchase order | A transfer |
| Raised by | Purchase manager or store manager | The receiving HOD |
| Extra field | Rate (editable) + invoice upload | — |
| Short receipt | Flags against the supplier | Posts a transit loss, flags the route |

**Posting the GRN is what moves stock.** Until then, nothing has arrived.

### 5.4 Mixing

Guwahati only. Pick a flavour, pick a recipe version (defaults to current), enter the output quantity, get exact component weights. Confirm the actual weights used.

Raw material stock goes down. Flavour stock goes up. The batch is permanently locked to the version it was mixed with, with a full copy of the formula stored inside the batch record.

Planned weight vs actual weight is the **mixing variance** — it's how you find out where material is being over-poured.

### 5.5 Buying

Demand comes from three places: approved requisition lines marked "buy", manual entry, and an optional par top-up.

The engine nets it off, explodes flavour demand through current recipe versions, groups the shortfall by preferred supplier, and drafts one order per supplier.

**Every order has a ship-to department.** That's what allows a Kolkata requirement to be delivered straight from the supplier to Kolkata, instead of routing through Guwahati and paying freight twice.

Rates are always editable — on the order, and again when goods arrive. Blank is allowed. Whatever is entered on the GRN becomes the new last-known rate for that supplier and material.

### 5.6 Counting stock

Any HOD counts their own department. The store manager or admin counts any.

Pick **location** and **what to count: raw materials · mixed flavours · both.** System quantity sits next to a blank box. Difference calculates live. Differences need a reason before submitting, and get approved before they post.

Nothing is ever silently overwritten.

### 5.7 Club sync

The Smokzy Club app stays exactly as it is. This system pulls from its API — nightly, plus a Sync now button.

**Pulled:** club, date, flavour, closing stock, quantity received, shishas sold.
**Not pulled:** attendance, staff details, photos.

A one-time flavour mapping screen makes both apps agree on names. If the sync fails, the last good sync time is shown and closing stock can be entered manually so nobody is blocked. Read-only — we never write back.

---

## 6. Recipes and versions

One flavour, many versions. **A version is frozen the moment it's saved.**

```
PAN KIWI
  v1  Pan 50 · Kiwi 30 · Mint 20    12 Mar   "First mix"                  6 batches · 3.5
  v2  Pan 55 · Kiwi 30 · Mint 15    02 May   "Too minty at Nexa"          4 batches · 3.0
  v3  Pan 60 · Kiwi 30 · Mint 10    18 Jun   "Pan forward. Best yet."     9 batches · 4.5  ← current
```

There is **no edit path.** Changing a recipe creates the next version, and won't save without a written reason. Old versions are archived, never deleted, and can be made current again — that rollback is logged too.

Batches can be rated after they've been out at the clubs. Ratings roll up to the version, so the system tells you which mix actually performs rather than you guessing.

**Protecting the formula:**

1. A helper's batch card shows `RM-04 → 6.120 kg`. No names, no percentages, no version. Masked on the server, not hidden in the browser.
2. Non-admins can't export or print. Live watermark with the viewer's name and time.
3. Every recipe view is logged, version by version.
4. Split knowledge: purchase manager knows materials, not ratios. Senior mixer knows ratios, not suppliers. Only the owner holds both halves.

---

## 7. Screens

Eight. Most people see three or four.

| Screen | Tabs | Who sees it |
|---|---|---|
| **Home** | — | Everyone |
| **Requisitions** | Mine · To approve · All | HOD, store, branch manager, admin |
| **Send & receive** | Send out · In transit · Receive | Store manager, HOD, purchase |
| **Buy** | What to buy · Orders | Purchase manager, admin |
| **Mix** | Make a batch · Past batches | Mixers, admin |
| **Stock** | What we have · Count stock | Store, HOD, admin |
| **Recipes** | — | Admin, senior mixer |
| **Setup** | Suppliers · Materials & flavours · Branches & departments · People · Club link | Admin |

**Home** is a to-do list, not a dashboard. It answers "what needs me today":
- Requisitions waiting on my approval
- Goods dispatched to me, not yet received
- Anything below par in my departments
- In-transit items ageing past 3 days
- Batches waiting to be rated

An HOD in Kolkata sees four nav items and a to-do list. That's the whole product for them.

---

## 8. Par levels and alerts

Par is set per department, per item — raw or mixed. Below par shows on Home for that department's HOD and for the admin.

The system then checks: **do we have it at the branch godown?** If yes, it suggests a transfer. If no, it drops into the buy queue.

After roughly 60 days of real data, the system proposes better par levels per department per item, since a Saturday club and a weekday office don't behave alike.

---

## 9. Leakage — the four variances

One report, four sources.

| Variance | What it compares | What it catches |
|---|---|---|
| **Transit** | Dispatched vs received | Loss between branches or departments |
| **Mixing** | Planned vs actual component weights | Over-pouring, spillage at the mixing floor |
| **Club** | Shishas sold × standard grams vs actual consumption | Leakage at the outlet |
| **Count** | System vs physical | Everything the other three missed |

Each one is a number with a name, a date and a document attached to it. That's the difference between suspecting a problem and being able to fix it.

---

## 10. Non-negotiable rules

1. All quantities in grams, stored as integers.
2. Stock balances change only through the movement ledger. Never edited directly.
3. Stock moves on **receipt**, not dispatch.
4. Recipe versions are immutable. Editing creates a new version. A reason is mandatory.
5. Batches store a full copy of the formula used.
6. Nothing is deleted. Archive only.
7. Access enforced in the database, not just the interface.
8. Every document is sequentially numbered.
9. Branch stock is not fungible — Kolkata's requirement is never quietly netted against Guwahati's stock.
10. Every recipe view is logged.

---

## 11. Build phases

| Phase | Scope | Effort |
|---|---|---|
| **1 — Foundation** | Auth, roles, branches, departments, people, suppliers, raw materials, flavours | 2 wk |
| **2 — Recipes & mixing** | Versioning, batch card, masked mode, batch log, ratings | 1.5 wk |
| **3 — Stock** | Movement ledger, balances, opening stock, par levels, stock counts | 1.5 wk |
| **4 — Movement** | Requisitions, approval, transfers, in-transit, GRN | 2.5 wk |
| **5 — Buying** | Buy engine, purchase orders, ship-to routing, vendor GRN, invoices, rate history | 1.5 wk |
| **6 — Intelligence** | Club API sync, flavour mapping, par suggestions, leakage report | 1.5 wk |

**~10.5 weeks.** Phases 1–4 are a usable system on their own.

---

## 12. How we'll know it worked

| Measure | Target |
|---|---|
| Stockouts at any department | Zero per month by month 3 |
| Transit variance | Under 1% of dispatched weight |
| Mixing variance | Under 2% of planned weight |
| Requisition to dispatch | Same day for in-stock items |
| Stock counts matching system | 95%+ of lines within tolerance |
| Recipe traceability | 100% — every batch links to a version |

---

## 13. Open decisions

1. **Who rates a batch?** Anyone with access, or admin and senior mixer only?
2. **Standard grams per shisha** — one number, or per flavour? Needed for the club variance.
3. **Real mixing wastage %** — currently 2% as a placeholder, set per recipe version.
4. **Multiple suppliers for one material** — auto-pick cheapest, or always the preferred one?
5. **GST fields** on orders and invoices — needed for accounting handoff, or purely operational?
6. **Can a club transfer to another club directly**, or must everything route through the branch godown?
7. **Approval threshold** — should small requisitions auto-approve, or does every one need a human?
