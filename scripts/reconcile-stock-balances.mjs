#!/usr/bin/env node
/**
 * Recomputes stock_balances from stock_movements (the source of truth,
 * rule 2) and reports any drift. Read-only — never writes. If this ever
 * finds drift, something bypassed post_movement()/the stock_movements_apply
 * trigger, since stock_balances is derived and no application code writes
 * to it directly.
 *
 * Usage: node scripts/reconcile-stock-balances.mjs
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

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
  {
    auth: { autoRefreshToken: false, persistSession: false },
  },
);

function keyOf(row) {
  return `${row.department_id}|${row.item_type}|${row.item_id}`;
}

async function fetchAllMovements() {
  const pageSize = 1000;
  let from = 0;
  const rows = [];
  for (;;) {
    const { data, error } = await admin
      .from("stock_movements")
      .select("department_id, item_type, item_id, qty_g")
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`fetch stock_movements: ${error.message}`);
    rows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

async function main() {
  console.log("Recomputing balances from stock_movements...");
  const movements = await fetchAllMovements();

  const expected = new Map();
  for (const m of movements) {
    const key = keyOf(m);
    expected.set(key, (expected.get(key) ?? 0) + Number(m.qty_g));
  }

  const { data: balances, error: balancesError } = await admin
    .from("stock_balances")
    .select("department_id, item_type, item_id, qty_g");
  if (balancesError)
    throw new Error(`fetch stock_balances: ${balancesError.message}`);

  const actual = new Map(balances.map((b) => [keyOf(b), Number(b.qty_g)]));

  const allKeys = new Set([...expected.keys(), ...actual.keys()]);
  const drift = [];
  for (const key of allKeys) {
    const expectedQty = expected.get(key) ?? 0;
    const actualQty = actual.get(key) ?? 0;
    if (expectedQty !== actualQty) {
      const [departmentId, itemType, itemId] = key.split("|");
      drift.push({ departmentId, itemType, itemId, expectedQty, actualQty });
    }
  }

  console.log(`Checked ${allKeys.size} (department, item) balances.`);
  if (drift.length === 0) {
    console.log("No drift — every balance matches the ledger exactly.");
    return;
  }

  console.log(`\n${drift.length} DRIFTED:`);
  for (const d of drift) {
    console.log(
      `  department=${d.departmentId} item_type=${d.itemType} item_id=${d.itemId}: ` +
        `ledger says ${d.expectedQty}g, stock_balances has ${d.actualQty}g ` +
        `(off by ${d.actualQty - d.expectedQty}g)`,
    );
  }
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
