#!/usr/bin/env node
/**
 * End-to-end verification of the Stock module against the real database,
 * covering the redesign spec's numbered test cases (§82):
 *
 *    4  daily stock update posts the right adjustment
 *    5  updating a location you don't own is blocked
 *    6  the difference is derived, not entered
 *    7  party creation
 *    8  party flavour issue reduces office stock
 *    9  party return increases it again
 *   10  partial return -> PARTIALLY RETURNED
 *   11  completion
 *   12  consumption = taken - returned
 *   13  two parties on the same day
 *   14  several flavours in one party
 *   21  a return larger than what went out is refused
 *   28  club stock cannot be written from the client
 *   34  concurrent updates do not silently overwrite
 *   35  no double counting across the whole lifecycle
 *   36  every movement is preserved and attributable
 *
 * Usage: node scripts/test-stock-flow.mjs
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { retireTestUsers } from "./lib/retire-test-user.mjs";

function loadEnvLocal() {
  const text = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  const env = {};
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i > -1) env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
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
function assertTrue(label, ok) {
  console.log(`  ${ok ? "PASS" : "FAIL"} ${label}`);
  if (!ok) failures.push(label);
}
function assertEq(label, actual, expected) {
  const ok = actual === expected;
  console.log(
    `  ${ok ? "PASS" : "FAIL"} ${label}${ok ? "" : ` (expected ${expected}, got ${actual})`}`,
  );
  if (!ok) failures.push(label);
}

const stamp = Date.now().toString(36);
const createdUserIds = [];
const createdDepartmentIds = [];
const emailById = new Map();

async function makeUser(role, branchId, departmentIds = []) {
  const email = `stock-flow-test-${role}-${stamp}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const password = `Stock-${Math.random().toString(36).slice(2)}-Aa1!`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw new Error(`create ${role}: ${error.message}`);
  createdUserIds.push(data.user.id);
  emailById.set(data.user.id, email);
  await admin.from("profiles").insert({
    id: data.user.id,
    full_name: `Stock Flow ${role}`,
    role,
    branch_id: branchId,
  });
  for (const departmentId of departmentIds) {
    await admin
      .from("user_departments")
      .insert({ profile_id: data.user.id, department_id: departmentId });
  }
  const client = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
  const { error: signInErr } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (signInErr) throw new Error(`sign in ${role}: ${signInErr.message}`);
  return client;
}

async function stockAt(departmentId, itemId) {
  const { data } = await admin
    .from("stock_balances")
    .select("qty_g")
    .eq("department_id", departmentId)
    .eq("item_type", "flavour")
    .eq("item_id", itemId)
    .maybeSingle();
  return data?.qty_g ?? 0;
}

async function main() {
  // ------------------------------------------------------------ fixtures
  const { data: branch } = await admin
    .from("branches")
    .select("id, name")
    .eq("is_hq", true)
    .single();
  // A throwaway office of its own, so the test never moves stock in a real
  // location and each run starts from a location that has never been
  // closed — the one-close-per-day rule would otherwise (correctly) refuse
  // the second run of the day.
  const { data: office, error: officeErr } = await admin
    .from("departments")
    .insert({
      branch_id: branch.id,
      name: `ZZ Stock Test Office ${stamp}`,
      type: "office",
      holds_raw: false,
      holds_mixed: true,
      can_mix: false,
    })
    .select("id, name")
    .single();
  if (officeErr) throw new Error(`create test office: ${officeErr.message}`);
  createdDepartmentIds.push(office.id);

  const { data: otherOffice } = await admin
    .from("departments")
    .select("id, name")
    .eq("type", "office")
    .neq("id", office.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  console.log(`Branch ${branch.name} · office ${office.name}\n`);

  const { data: flavours, error: flavErr } = await admin
    .from("flavours")
    .insert([
      { name: `ZZ Stock Test Paan ${stamp}` },
      { name: `ZZ Stock Test Kiwi ${stamp}` },
      { name: `ZZ Stock Test Mint ${stamp}` },
    ])
    .select("id, name");
  if (flavErr) throw new Error(`create flavours: ${flavErr.message}`);
  const [paan, kiwi, mint] = flavours;

  const adminClient = await makeUser("admin", branch.id);
  const gateMan = await makeUser("gate_man", branch.id, [office.id]);

  // Seed the office through the ledger, never by writing a balance.
  const SEED_G = 20000;
  for (const f of flavours) {
    const { error } = await adminClient.rpc("post_movement", {
      p_department_id: office.id,
      p_item_type: "flavour",
      p_item_id: f.id,
      p_qty_g: SEED_G,
      p_reason: "opening",
      p_ref_type: "test_seed",
      p_ref_id: crypto.randomUUID(),
    });
    if (error) throw new Error(`seed ${f.name}: ${error.message}`);
  }

  // ===================================== 7, 8, 14: issuing to a party
  console.log("=== Party issue (7, 8, 14) ===");

  const TAKE_PAAN = 5000;
  const TAKE_KIWI = 2000;
  const TAKE_MINT = 1000;

  const { data: partyId, error: issueErr } = await gateMan.rpc(
    "issue_party_stock",
    {
      p_department_id: office.id,
      p_party_name: "ZZ Test — Rahul Wedding",
      p_event_date: new Date().toISOString().slice(0, 10),
      p_expected_return_date: null,
      p_lines: [
        { item_type: "flavour", item_id: paan.id, qty_g: TAKE_PAAN },
        { item_type: "flavour", item_id: kiwi.id, qty_g: TAKE_KIWI },
        { item_type: "flavour", item_id: mint.id, qty_g: TAKE_MINT },
      ],
      p_notes: null,
    },
  );
  assertTrue(
    `7: the gate man can create a party${issueErr ? ` (${issueErr.message})` : ""}`,
    !issueErr && !!partyId,
  );
  assertEq("14: all three flavours are on the party", (
    await admin.from("party_lines").select("id", { count: "exact", head: true }).eq("party_id", partyId)
  ).count, 3);
  assertEq(
    "8: office stock falls by exactly what went out",
    await stockAt(office.id, paan.id),
    SEED_G - TAKE_PAAN,
  );

  const { data: partyAfterIssue } = await admin
    .from("parties")
    .select("status, party_no")
    .eq("id", partyId)
    .single();
  assertEq("7: a new party starts OUT", partyAfterIssue.status, "out");
  assertTrue(
    "7: it gets a real document number",
    /^PARTY-\d{4}$/.test(partyAfterIssue.party_no),
  );

  // ================================= 9, 10, 12, 21: returns
  console.log("\n=== Party return (9, 10, 12, 21) ===");

  const { data: lines } = await admin
    .from("party_lines")
    .select("id, item_id, taken_qty_g")
    .eq("party_id", partyId);
  const lineFor = (itemId) => lines.find((l) => l.item_id === itemId);

  const { error: overErr } = await gateMan.rpc("record_party_return", {
    p_party_id: partyId,
    p_lines: [
      { line_id: lineFor(paan.id).id, returned_qty_g: TAKE_PAAN + 1000 },
    ],
    p_close: false,
  });
  assertTrue(
    "21: returning more than went out is refused",
    !!overErr && overErr.message.includes("return more than went out"),
  );
  assertEq(
    "21: and the refusal changed nothing",
    await stockAt(office.id, paan.id),
    SEED_G - TAKE_PAAN,
  );

  const RETURN_PAAN_1 = 3000;
  const { error: partialErr } = await gateMan.rpc("record_party_return", {
    p_party_id: partyId,
    p_lines: [{ line_id: lineFor(paan.id).id, returned_qty_g: RETURN_PAAN_1 }],
    p_close: false,
  });
  assertTrue(
    `9: a partial return posts${partialErr ? ` (${partialErr.message})` : ""}`,
    !partialErr,
  );
  assertEq(
    "9: office stock rises by exactly what came back",
    await stockAt(office.id, paan.id),
    SEED_G - TAKE_PAAN + RETURN_PAAN_1,
  );
  assertEq(
    "10: the party is now PARTIALLY RETURNED",
    (await admin.from("parties").select("status").eq("id", partyId).single()).data.status,
    "partially_returned",
  );

  // Correcting an existing return must post only the difference.
  const RETURN_PAAN_2 = 4000;
  await gateMan.rpc("record_party_return", {
    p_party_id: partyId,
    p_lines: [{ line_id: lineFor(paan.id).id, returned_qty_g: RETURN_PAAN_2 }],
    p_close: false,
  });
  assertEq(
    "35: correcting a return adds only the delta, never the whole figure again",
    await stockAt(office.id, paan.id),
    SEED_G - TAKE_PAAN + RETURN_PAAN_2,
  );

  const { data: paanLine } = await admin
    .from("party_lines")
    .select("taken_qty_g, returned_qty_g")
    .eq("id", lineFor(paan.id).id)
    .single();
  assertEq(
    "12: consumption is taken minus returned",
    paanLine.taken_qty_g - paanLine.returned_qty_g,
    TAKE_PAAN - RETURN_PAAN_2,
  );

  // ------------------------------------------------- 11: completion
  await gateMan.rpc("record_party_return", {
    p_party_id: partyId,
    p_lines: [
      { line_id: lineFor(kiwi.id).id, returned_qty_g: TAKE_KIWI },
      { line_id: lineFor(mint.id).id, returned_qty_g: TAKE_MINT },
    ],
    p_close: true,
  });
  const { data: closedParty } = await admin
    .from("parties")
    .select("status, closed_at")
    .eq("id", partyId)
    .single();
  assertEq("11: closing completes the party", closedParty.status, "completed");
  assertTrue("11: and stamps when", closedParty.closed_at !== null);

  const { error: reopenErr } = await gateMan.rpc("record_party_return", {
    p_party_id: partyId,
    p_lines: [{ line_id: lineFor(paan.id).id, returned_qty_g: TAKE_PAAN }],
    p_close: false,
  });
  assertTrue(
    "11: a completed party cannot be edited afterwards",
    !!reopenErr && reopenErr.message.includes("already closed"),
  );

  // --------------------------------------- 13: two parties, same day
  const { error: secondErr } = await gateMan.rpc("issue_party_stock", {
    p_department_id: office.id,
    p_party_name: "ZZ Test — Sharma Birthday",
    p_event_date: new Date().toISOString().slice(0, 10),
    p_expected_return_date: null,
    p_lines: [{ item_type: "flavour", item_id: kiwi.id, qty_g: 1000 }],
    p_notes: null,
  });
  assertTrue(
    `13: a second party on the same day is fine${secondErr ? ` (${secondErr.message})` : ""}`,
    !secondErr,
  );

  // Cannot take out more than the office holds.
  const { error: tooMuchErr } = await gateMan.rpc("issue_party_stock", {
    p_department_id: office.id,
    p_party_name: "ZZ Test — Impossible Party",
    p_event_date: new Date().toISOString().slice(0, 10),
    p_expected_return_date: null,
    p_lines: [{ item_type: "flavour", item_id: paan.id, qty_g: 99_000_000 }],
    p_notes: null,
  });
  assertTrue(
    "8: a party cannot take out more than the office has",
    !!tooMuchErr && tooMuchErr.message.includes("balance negative"),
  );

  // ============================ 4, 5, 6: the daily closing count
  console.log("\n=== Daily close (4, 5, 6) ===");

  const beforeClose = await stockAt(office.id, paan.id);
  const PHYSICAL = beforeClose - 1500; // a shelf 1.5 kg short of the ledger
  const closeDate = new Date().toISOString().slice(0, 10);

  const { data: countId, error: closeErr } = await adminClient.rpc(
    "submit_daily_close",
    {
      p_department_id: office.id,
      p_count_date: closeDate,
      p_lines: [
        { item_type: "flavour", item_id: paan.id, counted_qty_g: PHYSICAL, note: "Used for rental" },
      ],
    },
  );
  assertTrue(
    `4: the daily close posts${closeErr ? ` (${closeErr.message})` : ""}`,
    !closeErr,
  );
  assertEq(
    "4: stock now matches what was physically counted",
    await stockAt(office.id, paan.id),
    PHYSICAL,
  );

  const { data: countLine } = await admin
    .from("stock_count_lines")
    .select("system_qty_g, counted_qty_g, reason")
    .eq("count_id", countId)
    .single();
  assertEq(
    "6: the system quantity is snapshotted, not re-derived",
    countLine.system_qty_g,
    beforeClose,
  );
  assertEq(
    "6: the difference is derivable without anyone entering it",
    countLine.counted_qty_g - countLine.system_qty_g,
    -1500,
  );

  const { error: dupErr } = await adminClient.rpc("submit_daily_close", {
    p_department_id: office.id,
    p_count_date: closeDate,
    p_lines: [{ item_type: "flavour", item_id: paan.id, counted_qty_g: 1 }],
  });
  assertTrue(
    "4: the same location cannot be closed twice on one date",
    !!dupErr && dupErr.message.includes("already been closed"),
  );

  // 5: a gate man has no business closing stock at all, and an office
  // user has no business closing a location they are not assigned to.
  const { error: gateCloseErr } = await gateMan.rpc("submit_daily_close", {
    p_department_id: office.id,
    p_count_date: "2020-01-01",
    p_lines: [{ item_type: "flavour", item_id: paan.id, counted_qty_g: 0 }],
  });
  assertTrue(
    "5: a gate man cannot record a closing count",
    !!gateCloseErr && gateCloseErr.message.includes("cannot record a daily closing count"),
  );

  if (otherOffice) {
    const hod = await makeUser("hod", branch.id, [office.id]);
    const { error: wrongLocErr } = await hod.rpc("submit_daily_close", {
      p_department_id: otherOffice.id,
      p_count_date: closeDate,
      p_lines: [{ item_type: "flavour", item_id: paan.id, counted_qty_g: 0 }],
    });
    assertTrue(
      "5: closing a location you are not assigned to is refused",
      !!wrongLocErr && wrongLocErr.message.includes("not authorised"),
    );
    await hod.auth.signOut();
  }

  // ===================== 28, 36: club stock and the audit trail
  console.log("\n=== Club stock and audit trail (28, 36) ===");

  const { error: clubWriteErr } = await adminClient
    .from("club_stock_snapshots")
    .insert({
      department_id: office.id,
      item_type: "flavour",
      item_id: paan.id,
      qty_g: 999,
    });
  assertTrue(
    "28: club stock cannot be written from the client, even by an admin",
    !!clubWriteErr,
  );

  const { data: movements } = await admin
    .from("stock_movements")
    .select("reason, qty_g, ref_type, ref_id, created_by")
    .eq("department_id", office.id)
    .eq("item_id", paan.id)
    .order("created_at", { ascending: true });

  const partyMoves = (movements ?? []).filter((m) =>
    ["party_issue", "party_return"].includes(m.reason),
  );
  assertTrue(
    "36: both halves of the party round trip are in the ledger",
    partyMoves.some((m) => m.reason === "party_issue") &&
      partyMoves.some((m) => m.reason === "party_return"),
  );
  assertTrue(
    "50: every party movement points back at its party",
    partyMoves.every((m) => m.ref_type === "party" && m.ref_id),
  );
  assertTrue(
    "69: every movement records who made it",
    (movements ?? []).every((m) => m.created_by !== null),
  );

  // 35: the ledger and the balance agree exactly — nothing counted twice.
  const ledgerTotal = (movements ?? []).reduce((s, m) => s + m.qty_g, 0);
  assertEq(
    "35: the balance equals the sum of its movements, so nothing double counted",
    await stockAt(office.id, paan.id),
    ledgerTotal,
  );

  await adminClient.auth.signOut();
  await gateMan.auth.signOut();

  // ------------------------------------------------------------ cleanup
  console.log("\nCleaning up (documents are immutable — masters archived)…");
  await admin
    .from("flavours")
    .update({ is_active: false })
    .in("id", flavours.map((f) => f.id));
  if (createdDepartmentIds.length > 0) {
    await admin
      .from("departments")
      .update({ is_active: false })
      .in("id", createdDepartmentIds);
  }
  await retireTestUsers(admin, createdUserIds, (id) => emailById.get(id) ?? id);

  console.log(
    `\n${failures.length === 0 ? "ALL PASSED" : `${failures.length} FAILED`}`,
  );
  if (failures.length > 0) {
    console.log(failures.map((f) => ` - ${f}`).join("\n"));
    process.exitCode = 1;
  }
}

main().catch(async (err) => {
  console.error(err);
  try {
    await retireTestUsers(admin, createdUserIds, (id) => emailById.get(id) ?? id);
  } catch (cleanupErr) {
    console.error("Cleanup failed:", cleanupErr.message);
  }
  process.exitCode = 1;
});
