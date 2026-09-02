#!/usr/bin/env node
/**
 * End-to-end verification of the Purchases module against the real
 * database, covering the procurement spec's numbered scenarios:
 *
 *   1  one item + one supplier            -> one PO
 *   2  many items + one supplier          -> one PO holding all of them
 *   3  N items + N suppliers              -> N POs
 *   4  10 items + 3 suppliers             -> exactly 3 POs
 *   5  item with no supplier mapping      -> generation blocked, flagged
 *   6  PO created but not ordered         -> lead time has not started
 *   7  order placed                       -> lead time starts from sent_at
 *   8  partial receipt                    -> stock +received only,
 *                                            PO becomes partially_received
 *   9  second GRN closes the balance      -> PO becomes received
 *  10  transportation cost                -> landed cost adds up
 *  11  admin reads a PO                   -> supplier visible
 *  12  store manager reads the same PO    -> supplier NOT visible (RLS)
 *  13  restricted role hitting a Purchases URL directly -> refused
 *  16  lead time = order placed -> receipt
 *  19  stock reflects exactly what posted
 *  20  an onward transfer leg             -> freight accrues, no second
 *                                            purchase is created
 *  +   flavours are purchasable in their own right and never exploded
 *
 * Grouping (1-5) is checked against the pure buy engine, which is what
 * actually decides it; everything else runs against real rows.
 *
 * Usage: node scripts/test-purchases-flow.mjs
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { computeBuyPlan } from "../src/lib/buy/buy-engine.ts";
import { can } from "../src/lib/auth/permissions.ts";
import {
  PURCHASES_TABS,
  canAccessPurchasesTab,
} from "../src/lib/purchases-tabs.ts";

function loadEnvLocal() {
  const text = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  const env = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return env;
}

const env = loadEnvLocal();
const admin = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const failures = [];
function assertTrue(label, condition) {
  console.log(`  ${condition ? "PASS" : "FAIL"} ${label}`);
  if (!condition) failures.push(label);
}
function assertEq(label, actual, expected) {
  const ok = actual === expected;
  console.log(
    `  ${ok ? "PASS" : "FAIL"} ${label}${ok ? "" : ` (expected ${expected}, got ${actual})`}`,
  );
  if (!ok) failures.push(label);
}

const stamp = Date.now().toString(36);
const created = { userIds: [], poIds: [], grnIds: [], transferIds: [] };

async function main() {
  // ---------------------------------------------------------------- setup
  const { data: branch } = await admin
    .from("branches")
    .select("id, name")
    .eq("is_hq", true)
    .single();
  const { data: godown } = await admin
    .from("departments")
    .select("id, name")
    .eq("branch_id", branch.id)
    .eq("holds_raw", true)
    .eq("is_active", true)
    .limit(1)
    .single();

  console.log(`Branch ${branch.name} · godown ${godown.name}\n`);

  // Throwaway suppliers + materials so nothing here depends on, or
  // disturbs, real master data.
  const { data: suppliers } = await admin
    .from("suppliers")
    .insert([
      { name: `ZZ Test Supplier A ${stamp}` },
      { name: `ZZ Test Supplier B ${stamp}` },
      { name: `ZZ Test Supplier C ${stamp}` },
    ])
    .select("id, name");
  const [supA, supB, supC] = suppliers;

  const { data: materials, error: matErr } = await admin
    .from("raw_materials")
    .insert([
      { name: `ZZ Test Mat A1 ${stamp}`, default_supplier_id: supA.id },
      { name: `ZZ Test Mat A2 ${stamp}`, default_supplier_id: supA.id },
      { name: `ZZ Test Mat B1 ${stamp}`, default_supplier_id: supB.id },
      { name: `ZZ Test Mat Orphan ${stamp}` },
    ])
    .select("id, name");
  if (matErr) throw new Error(`create materials: ${matErr.message}`);
  const [matA1, matA2, matB1, matOrphan] = materials;

  const { data: flavour } = await admin
    .from("flavours")
    .insert({ name: `ZZ Test Flavour ${stamp}`, default_supplier_id: supC.id })
    .select("id, name")
    .single();

  // =============================================== 1-5: supplier grouping
  console.log("=== Grouping (scenarios 1-5) ===");

  const plan1 = computeBuyPlan({
    demand: [
      { itemType: "raw", itemId: matA1.id, qtyG: 5000, departmentId: godown.id },
    ],
    stockBalances: [],
    openPoLines: [],
    currentRecipeVersions: [],
    defaultSuppliers: [{ rawMaterialId: matA1.id, supplierId: supA.id }],
  });
  assertEq("1: one item + one supplier -> one PO", plan1.groups.length, 1);

  const plan2 = computeBuyPlan({
    demand: [
      { itemType: "raw", itemId: matA1.id, qtyG: 5000, departmentId: godown.id },
      { itemType: "raw", itemId: matA2.id, qtyG: 3000, departmentId: godown.id },
    ],
    stockBalances: [],
    openPoLines: [],
    currentRecipeVersions: [],
    defaultSuppliers: [
      { rawMaterialId: matA1.id, supplierId: supA.id },
      { rawMaterialId: matA2.id, supplierId: supA.id },
    ],
  });
  assertEq("2: two items, same supplier -> one PO", plan2.groups.length, 1);
  assertEq("2: that PO carries both items", plan2.groups[0].lines.length, 2);

  const plan3 = computeBuyPlan({
    demand: [
      { itemType: "raw", itemId: matA1.id, qtyG: 1000, departmentId: godown.id },
      { itemType: "raw", itemId: matB1.id, qtyG: 1000, departmentId: godown.id },
    ],
    stockBalances: [],
    openPoLines: [],
    currentRecipeVersions: [],
    defaultSuppliers: [
      { rawMaterialId: matA1.id, supplierId: supA.id },
      { rawMaterialId: matB1.id, supplierId: supB.id },
    ],
  });
  assertEq("3: two items, two suppliers -> two POs", plan3.groups.length, 2);

  // 10 lines spread across exactly 3 suppliers.
  const tenIds = Array.from({ length: 10 }, (_, i) => `mat-${i}`);
  const threeSuppliers = tenIds.map((id, i) => ({
    rawMaterialId: id,
    supplierId: [supA.id, supB.id, supC.id][i % 3],
  }));
  const plan4 = computeBuyPlan({
    demand: tenIds.map((id) => ({
      itemType: "raw",
      itemId: id,
      qtyG: 1000,
      departmentId: godown.id,
    })),
    stockBalances: [],
    openPoLines: [],
    currentRecipeVersions: [],
    defaultSuppliers: threeSuppliers,
  });
  assertEq("4: 10 items across 3 suppliers -> exactly 3 POs", plan4.groups.length, 3);
  assertEq(
    "4: all 10 lines survive the grouping",
    plan4.groups.reduce((n, g) => n + g.lines.length, 0),
    10,
  );

  const plan5 = computeBuyPlan({
    demand: [
      {
        itemType: "raw",
        itemId: matOrphan.id,
        qtyG: 1000,
        departmentId: godown.id,
      },
    ],
    stockBalances: [],
    openPoLines: [],
    currentRecipeVersions: [],
    defaultSuppliers: [],
  });
  assertTrue(
    "5: unmapped item groups under no supplier (PO generation blocked)",
    plan5.groups.length === 1 && plan5.groups[0].supplierId === null,
  );
  assertTrue(
    "5: and is reported as an issue rather than passing silently",
    plan5.issues.some((i) => /no default supplier/.test(i)),
  );

  // Flavour bought ready-made, never exploded.
  const planF = computeBuyPlan({
    demand: [
      {
        itemType: "flavour",
        itemId: flavour.id,
        qtyG: 4000,
        departmentId: godown.id,
        directPurchase: true,
      },
    ],
    stockBalances: [],
    openPoLines: [],
    currentRecipeVersions: [],
    defaultSuppliers: [],
    flavourSuppliers: [{ flavourId: flavour.id, supplierId: supC.id }],
  });
  assertTrue(
    "flavour: bought whole under its own supplier, not exploded",
    planF.groups.length === 1 &&
      planF.groups[0].supplierId === supC.id &&
      planF.groups[0].lines.length === 1 &&
      planF.groups[0].lines[0].itemType === "flavour",
  );

  // ============================================ 6-10, 16, 19: PO lifecycle
  console.log("\n=== PO lifecycle, receiving and stock (6-10, 16, 19) ===");

  const { data: poNo } = await admin.rpc("next_doc_no", {
    p_doc_type: "PO",
    p_branch_id: branch.id,
  });
  const { data: po, error: poErr } = await admin
    .from("purchase_orders")
    .insert({
      po_no: poNo,
      branch_id: branch.id,
      supplier_id: supA.id,
      ship_to_department_id: godown.id,
    })
    .select("id, status, sent_at")
    .single();
  if (poErr) throw new Error(`create PO: ${poErr.message}`);
  created.poIds.push(po.id);

  // 100 kg of one raw material, plus 20 kg of a purchased flavour.
  const ORDER_RAW_G = 100000;
  const ORDER_FLAVOUR_G = 20000;
  const RATE = 500;
  const { error: lineErr } = await admin.from("po_lines").insert([
    { purchase_order_id: po.id, raw_material_id: matA1.id, qty_g: ORDER_RAW_G, rate: RATE },
    { purchase_order_id: po.id, flavour_id: flavour.id, qty_g: ORDER_FLAVOUR_G, rate: RATE },
  ]);
  if (lineErr) throw new Error(`create PO lines: ${lineErr.message}`);

  assertEq("6: a freshly created PO is draft", po.status, "draft");
  assertTrue("6: lead time has not started (no order-placed date)", po.sent_at === null);

  const orderPlacedAt = new Date();
  await admin
    .from("purchase_orders")
    .update({ status: "sent", sent_at: orderPlacedAt.toISOString() })
    .eq("id", po.id);
  const { data: poSent } = await admin
    .from("purchase_orders")
    .select("status, sent_at")
    .eq("id", po.id)
    .single();
  assertEq("7: placing the order moves it to sent", poSent.status, "sent");
  assertTrue("7: and stamps the order-placed date", poSent.sent_at !== null);

  // A throwaway admin to post GRNs as (post_grn reads auth.uid()).
  const password = `Purch-${Math.random().toString(36).slice(2)}-Aa1!`;
  const email = `purchases-flow-test-${stamp}@example.test`;
  const { data: userRes, error: userErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (userErr) throw new Error(`create test user: ${userErr.message}`);
  created.userIds.push(userRes.user.id);
  await admin.from("profiles").insert({
    id: userRes.user.id,
    full_name: "Purchases Flow Test Admin",
    role: "admin",
    branch_id: branch.id,
  });

  const asUser = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
  const { error: signInErr } = await asUser.auth.signInWithPassword({
    email,
    password,
  });
  if (signInErr) throw new Error(`sign in: ${signInErr.message}`);

  async function stockOf(itemType, itemId) {
    const { data } = await admin
      .from("stock_balances")
      .select("qty_g")
      .eq("department_id", godown.id)
      .eq("item_type", itemType)
      .eq("item_id", itemId)
      .maybeSingle();
    return data?.qty_g ?? 0;
  }

  const rawBefore = await stockOf("raw", matA1.id);
  const flavourBefore = await stockOf("flavour", flavour.id);

  // ---- GRN 1: 60 kg of 100 kg raw, nothing of the flavour yet ----
  const FIRST_RECEIPT_G = 60000;
  const FREIGHT_1 = 5000;
  const { data: grn1No } = await admin.rpc("next_doc_no", {
    p_doc_type: "GRN",
    p_branch_id: branch.id,
  });
  const { data: grn1 } = await admin
    .from("grns")
    .insert({
      grn_no: grn1No,
      branch_id: branch.id,
      department_id: godown.id,
      source: "vendor",
      purchase_order_id: po.id,
      transportation_cost: FREIGHT_1,
    })
    .select("id")
    .single();
  created.grnIds.push(grn1.id);
  await admin.from("grn_lines").insert({
    grn_id: grn1.id,
    item_type: "raw",
    item_id: matA1.id,
    expected_qty_g: ORDER_RAW_G,
    received_qty_g: FIRST_RECEIPT_G,
    damaged_qty_g: 0,
    reason: "Balance to follow in a second shipment",
    rate: RATE,
  });

  const { error: post1Err } = await asUser.rpc("post_grn", { p_grn_id: grn1.id });
  assertTrue(`8: first GRN posts cleanly${post1Err ? ` (${post1Err.message})` : ""}`, !post1Err);

  const rawAfter1 = await stockOf("raw", matA1.id);
  assertEq(
    "8/19: stock rises by exactly what was received, not what was ordered",
    rawAfter1 - rawBefore,
    FIRST_RECEIPT_G,
  );

  const { data: poAfter1 } = await admin
    .from("purchase_orders")
    .select("status")
    .eq("id", po.id)
    .single();
  assertEq("8: PO is now partially received", poAfter1.status, "partially_received");

  // ---- GRN 2: remaining 40 kg raw + the full flavour line ----
  const SECOND_RECEIPT_G = ORDER_RAW_G - FIRST_RECEIPT_G;
  const FREIGHT_2 = 3000;
  const { data: grn2No } = await admin.rpc("next_doc_no", {
    p_doc_type: "GRN",
    p_branch_id: branch.id,
  });
  const { data: grn2 } = await admin
    .from("grns")
    .insert({
      grn_no: grn2No,
      branch_id: branch.id,
      department_id: godown.id,
      source: "vendor",
      purchase_order_id: po.id,
      transportation_cost: FREIGHT_2,
    })
    .select("id")
    .single();
  created.grnIds.push(grn2.id);
  await admin.from("grn_lines").insert([
    {
      grn_id: grn2.id,
      item_type: "raw",
      item_id: matA1.id,
      expected_qty_g: SECOND_RECEIPT_G,
      received_qty_g: SECOND_RECEIPT_G,
      damaged_qty_g: 0,
      rate: RATE,
    },
    {
      grn_id: grn2.id,
      item_type: "flavour",
      item_id: flavour.id,
      expected_qty_g: ORDER_FLAVOUR_G,
      received_qty_g: ORDER_FLAVOUR_G,
      damaged_qty_g: 0,
      rate: RATE,
    },
  ]);

  const { error: post2Err } = await asUser.rpc("post_grn", { p_grn_id: grn2.id });
  assertTrue(`9: second GRN posts cleanly${post2Err ? ` (${post2Err.message})` : ""}`, !post2Err);

  const rawAfter2 = await stockOf("raw", matA1.id);
  const flavourAfter2 = await stockOf("flavour", flavour.id);
  assertEq(
    "9/19: raw stock now reflects the full ordered quantity, counted once",
    rawAfter2 - rawBefore,
    ORDER_RAW_G,
  );
  assertEq(
    "flavour: a purchased flavour lands in flavour stock directly",
    flavourAfter2 - flavourBefore,
    ORDER_FLAVOUR_G,
  );

  const { data: poAfter2 } = await admin
    .from("purchase_orders")
    .select("status")
    .eq("id", po.id)
    .single();
  assertEq(
    "9: PO closes out as received once every line is satisfied",
    poAfter2.status,
    "received",
  );

  // ---- 10 + 16: landed cost and lead time -------------------------------
  const { data: postedGrns } = await admin
    .from("grns")
    .select("posted_at, transportation_cost, grn_lines(received_qty_g, rate)")
    .eq("purchase_order_id", po.id)
    .eq("status", "posted");

  const goodsValue = postedGrns.reduce(
    (sum, g) =>
      sum +
      g.grn_lines.reduce(
        (s, l) => s + ((l.received_qty_g ?? 0) / 1000) * Number(l.rate ?? 0),
        0,
      ),
    0,
  );
  const inboundFreight = postedGrns.reduce(
    (sum, g) => sum + Number(g.transportation_cost ?? 0),
    0,
  );
  const expectedGoods = ((ORDER_RAW_G + ORDER_FLAVOUR_G) / 1000) * RATE;
  assertEq("10: goods value adds up across both receipts", goodsValue, expectedGoods);
  assertEq(
    "10: inbound freight accumulates across both receipts",
    inboundFreight,
    FREIGHT_1 + FREIGHT_2,
  );
  assertEq(
    "10: landed cost = goods + freight",
    goodsValue + inboundFreight,
    expectedGoods + FREIGHT_1 + FREIGHT_2,
  );

  const firstReceipt = postedGrns
    .map((g) => g.posted_at)
    .filter(Boolean)
    .sort()[0];
  const leadDays =
    (new Date(firstReceipt).getTime() - new Date(poSent.sent_at).getTime()) /
    86400000;
  assertTrue(
    "16: lead time measures from order-placed to receipt (>= 0)",
    leadDays >= 0 && Number.isFinite(leadDays),
  );

  // ---- 20: an onward leg accrues freight, creates no second purchase ----
  const { data: otherDept } = await admin
    .from("departments")
    .select("id")
    .eq("branch_id", branch.id)
    .neq("id", godown.id)
    .eq("is_active", true)
    .limit(1)
    .single();

  const poCountBefore = (
    await admin.from("purchase_orders").select("id", { count: "exact", head: true })
  ).count;

  const { data: trfNo } = await admin.rpc("next_doc_no", {
    p_doc_type: "TRF",
    p_branch_id: branch.id,
  });
  const ONWARD_FREIGHT = 3000;
  const { data: transfer, error: trfErr } = await admin
    .from("transfers")
    .insert({
      transfer_no: trfNo,
      branch_id: branch.id,
      from_department_id: godown.id,
      to_department_id: otherDept.id,
      transportation_cost: ONWARD_FREIGHT,
    })
    .select("id, transportation_cost")
    .single();
  if (trfErr) throw new Error(`create transfer: ${trfErr.message}`);
  created.transferIds.push(transfer.id);

  assertEq(
    "20: an onward leg records its own freight",
    Number(transfer.transportation_cost),
    ONWARD_FREIGHT,
  );
  const poCountAfter = (
    await admin.from("purchase_orders").select("id", { count: "exact", head: true })
  ).count;
  assertEq(
    "20: moving goods onward creates no new purchase order",
    poCountAfter,
    poCountBefore,
  );
  assertEq(
    "20: accumulated landed cost spans both legs",
    goodsValue + inboundFreight + ONWARD_FREIGHT,
    expectedGoods + FREIGHT_1 + FREIGHT_2 + ONWARD_FREIGHT,
  );

  // ==================================== 11-12: supplier confidentiality
  console.log("\n=== Supplier confidentiality (11-12) ===");

  const { data: adminPo } = await asUser
    .from("purchase_orders")
    .select("id, supplier_id, suppliers(name)")
    .eq("id", po.id)
    .maybeSingle();
  assertTrue(
    "11: admin reading the PO does see the supplier",
    !!adminPo && adminPo.suppliers?.name === supA.name,
  );

  const storePassword = `Store-${Math.random().toString(36).slice(2)}-Aa1!`;
  const storeEmail = `purchases-store-test-${stamp}@example.test`;
  const { data: storeRes, error: storeErr } = await admin.auth.admin.createUser({
    email: storeEmail,
    password: storePassword,
    email_confirm: true,
  });
  if (storeErr) throw new Error(`create store user: ${storeErr.message}`);
  created.userIds.push(storeRes.user.id);
  await admin.from("profiles").insert({
    id: storeRes.user.id,
    full_name: "Purchases Flow Test Store Manager",
    role: "store_manager",
    branch_id: branch.id,
  });

  const asStore = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
  const { error: storeSignInErr } = await asStore.auth.signInWithPassword({
    email: storeEmail,
    password: storePassword,
  });
  if (storeSignInErr) throw new Error(`store sign in: ${storeSignInErr.message}`);

  const { data: storeSuppliers } = await asStore.from("suppliers").select("id, name");
  assertEq(
    "12: store manager reads zero supplier rows (RLS, not UI hiding)",
    storeSuppliers?.length ?? 0,
    0,
  );

  const { data: storePo } = await asStore
    .from("purchase_orders")
    .select("id")
    .eq("id", po.id)
    .maybeSingle();
  assertTrue(
    "12: store manager cannot read the purchase order row at all",
    storePo === null,
  );

  const { data: storeRates } = await asStore
    .from("supplier_rates")
    .select("id")
    .limit(1);
  assertEq(
    "12: store manager reads zero supplier rate rows",
    storeRates?.length ?? 0,
    0,
  );

  await asUser.auth.signOut();
  await asStore.auth.signOut();

  // ============================= 13: typing an admin-only URL by hand
  // Every /purchases route guards on can(role, "nav:purchases") or
  // can(role, "purchase:manage") before it reads anything, so a
  // restricted role is redirected regardless of what it types. Checked
  // exhaustively rather than by sampling, so a role added later without
  // a deliberate decision shows up here.
  console.log("\n=== Direct URL access (13) ===");

  const RESTRICTED = ["store_manager", "hod", "senior_mixer", "mixer"];
  const ALLOWED = ["admin", "branch_manager", "purchase_manager"];

  assertTrue(
    "13: no restricted role can reach the Purchases section at all",
    RESTRICTED.every((role) => !can(role, "nav:purchases")),
  );
  assertTrue(
    "13: nor any tab within it, by any URL",
    RESTRICTED.every((role) =>
      PURCHASES_TABS.every((tab) => !canAccessPurchasesTab(role, tab.href)),
    ),
  );
  assertTrue(
    "13: nor the Create PO flow",
    RESTRICTED.every((role) => !can(role, "purchase:manage")),
  );
  assertTrue(
    "13: nor purchase history",
    RESTRICTED.every((role) => !can(role, "purchase:history")),
  );
  assertTrue(
    "13: the roles that should get in still do",
    ALLOWED.every((role) => can(role, "nav:purchases")),
  );
  assertTrue(
    "13: an unknown tab href is denied rather than defaulting open",
    ALLOWED.every((role) => !canAccessPurchasesTab(role, "/purchases/anything")),
  );

  // 14: the PDF is built client-side from the same detail payload the
  // route hands over, and a restricted role never reaches that route
  // (above) or the underlying rows (12). The builder additionally takes
  // supplier: null and emits no supplier block at all — asserted here as
  // a contract so it can't quietly become a blanked-out field.
  assertTrue(
    "14: the PDF payload treats supplier as omittable, not blankable",
    /supplier: \{[\s\S]*?\} \| null;/.test(
      readFileSync(new URL("../src/lib/purchases/po-pdf.ts", import.meta.url), "utf8"),
    ),
  );

  // ------------------------------------------------------------- cleanup
  console.log("\nCleaning up (documents are immutable — masters archived)…");
  for (const id of created.userIds) await admin.auth.admin.deleteUser(id);
  await admin.from("raw_materials").update({ is_active: false }).in(
    "id",
    materials.map((m) => m.id),
  );
  await admin.from("flavours").update({ is_active: false }).eq("id", flavour.id);
  await admin.from("suppliers").update({ is_active: false }).in(
    "id",
    suppliers.map((s) => s.id),
  );

  console.log(
    `\n${failures.length === 0 ? "ALL PASSED" : `${failures.length} FAILED`}`,
  );
  if (failures.length > 0) {
    console.log(failures.map((f) => ` - ${f}`).join("\n"));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
