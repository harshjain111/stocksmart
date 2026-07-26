#!/usr/bin/env node
/**
 * Verifies batch confirmation (2.10): confirm_batch() captures actual
 * weights (defaulting to planned), posts batch_consume (negative, per raw
 * material) and batch_produce (positive, the flavour) stock movements, and
 * locks the batch — and post_movement() refuses to take a balance negative.
 *
 * Creates a throwaway admin test user and a real draft batch against an
 * existing recipe version's real lines (rather than new master data). The
 * confirmed batch and its movements can't be deleted (append-only/rule 7),
 * so this intentionally leaves one small confirmed batch behind each run,
 * same as any real usage would — the throwaway user is cleaned up.
 *
 * Usage: node scripts/test-confirm-batch.mjs
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
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const failures = [];
function assertTrue(label, condition) {
  console.log(`  ${condition ? "PASS" : "FAIL"} ${label}`);
  if (!condition) failures.push(label);
}
function assertEqual(label, actual, expected) {
  const ok = actual === expected;
  console.log(
    `  ${ok ? "PASS" : "FAIL"} ${label} (expected ${expected}, got ${actual})`,
  );
  if (!ok) failures.push(label);
}

async function main() {
  const { data: guwahati } = await admin
    .from("branches")
    .select("id")
    .eq("name", "Guwahati")
    .single();

  const { data: department } = await admin
    .from("departments")
    .select("id, branch_id")
    .eq("branch_id", guwahati.id)
    .eq("can_mix", true)
    .limit(1)
    .single();

  const { data: version } = await admin
    .from("recipe_versions")
    .select("id, flavour_id, wastage_pct")
    .limit(1)
    .single();

  const { data: lines } = await admin
    .from("recipe_lines")
    .select("raw_material_id, percentage")
    .eq("recipe_version_id", version.id);

  const outputG = 1000;
  const wastageMultiplier = 1 + Number(version.wastage_pct) / 100;
  const plannedByMaterial = new Map(
    lines.map((l) => [
      l.raw_material_id,
      Math.round(outputG * (Number(l.percentage) / 100) * wastageMultiplier),
    ]),
  );

  console.log("Creating throwaway admin test user...");
  const password = `Confirm-${Math.random().toString(36).slice(2)}-Aa1!`;
  const email = `confirm-batch-test-${Date.now().toString(36)}@example.test`;
  const { data: userRes, error: userErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (userErr) throw new Error(`create test user: ${userErr.message}`);
  const testUserId = userRes.user.id;

  const { error: profileErr } = await admin.from("profiles").insert({
    id: testUserId,
    full_name: "Confirm Batch Test Admin",
    role: "admin",
    branch_id: guwahati.id,
  });
  if (profileErr) throw new Error(`create profile: ${profileErr.message}`);

  try {
    // Seed enough opening stock to confirm cleanly.
    for (const [rawMaterialId, plannedG] of plannedByMaterial) {
      const { error } = await admin.rpc("post_movement", {
        p_department_id: department.id,
        p_item_type: "raw",
        p_item_id: rawMaterialId,
        p_qty_g: plannedG * 10,
        p_reason: "opening",
        p_ref_type: "test",
        p_ref_id: crypto.randomUUID(),
      });
      if (error) throw new Error(`seed opening stock: ${error.message}`);
    }

    const { data: batchNo } = await admin.rpc("next_doc_no", {
      p_doc_type: "B",
      p_branch_id: department.branch_id,
    });

    const { data: batch, error: batchErr } = await admin
      .from("batches")
      .insert({
        batch_no: batchNo,
        branch_id: department.branch_id,
        flavour_id: version.flavour_id,
        recipe_version_id: version.id,
        recipe_snapshot: { wastagePct: Number(version.wastage_pct), lines },
        output_g: outputG,
        department_id: department.id,
        status: "draft",
      })
      .select("id")
      .single();
    if (batchErr) throw new Error(`create draft batch: ${batchErr.message}`);

    const consumptionRows = [...plannedByMaterial].map(
      ([rawMaterialId, plannedG]) => ({
        batch_id: batch.id,
        raw_material_id: rawMaterialId,
        planned_g: plannedG,
      }),
    );
    const { error: consumptionErr } = await admin
      .from("batch_consumption")
      .insert(consumptionRows);
    if (consumptionErr)
      throw new Error(`create consumption: ${consumptionErr.message}`);

    const flavourBalanceBefore = await admin
      .from("stock_balances")
      .select("qty_g")
      .eq("department_id", department.id)
      .eq("item_type", "flavour")
      .eq("item_id", version.flavour_id)
      .maybeSingle();
    const flavourQtyBefore = flavourBalanceBefore.data?.qty_g ?? 0;

    console.log(`\n=== Signing in as test admin (${email}) ===`);
    const client = createClient(SUPABASE_URL, ANON_KEY);
    const { error: signInErr } = await client.auth.signInWithPassword({
      email,
      password,
    });
    if (signInErr) throw new Error(`sign in: ${signInErr.message}`);

    // Override the first component's actual weight; the rest default to planned.
    const [firstMaterialId, firstPlannedG] = [...plannedByMaterial][0];
    const overrideActualG = firstPlannedG + 3;

    const { error: confirmErr } = await client.rpc("confirm_batch", {
      p_batch_id: batch.id,
      p_actual_grams: [
        { rawMaterialId: firstMaterialId, actualG: overrideActualG },
      ],
    });
    assertTrue("confirm_batch succeeds", !confirmErr);
    if (confirmErr) console.error(confirmErr.message);

    const { data: confirmedBatch } = await admin
      .from("batches")
      .select("status, mixed_by, mixed_at")
      .eq("id", batch.id)
      .single();
    assertEqual(
      "batch status is confirmed",
      confirmedBatch.status,
      "confirmed",
    );
    assertEqual(
      "mixed_by is the calling user",
      confirmedBatch.mixed_by,
      testUserId,
    );
    assertTrue("mixed_at is set", confirmedBatch.mixed_at !== null);

    const { data: consumptionAfter } = await admin
      .from("batch_consumption")
      .select("raw_material_id, planned_g, actual_g")
      .eq("batch_id", batch.id);
    const overriddenRow = consumptionAfter.find(
      (r) => r.raw_material_id === firstMaterialId,
    );
    assertEqual(
      "overridden component's actual_g matches the explicit value",
      overriddenRow.actual_g,
      overrideActualG,
    );
    for (const row of consumptionAfter) {
      if (row.raw_material_id === firstMaterialId) continue;
      assertEqual(
        "non-overridden component's actual_g defaults to planned_g",
        row.actual_g,
        row.planned_g,
      );
    }

    const { data: consumeMovements } = await admin
      .from("stock_movements")
      .select("item_id, qty_g, ref_type, ref_id")
      .eq("department_id", department.id)
      .eq("reason", "batch_consume")
      .eq("ref_id", batch.id);
    assertEqual(
      "one batch_consume movement per raw material component",
      consumeMovements.length,
      plannedByMaterial.size,
    );
    const overriddenMovement = consumeMovements.find(
      (m) => m.item_id === firstMaterialId,
    );
    assertEqual(
      "batch_consume movement is negative and matches the overridden actual_g",
      Number(overriddenMovement.qty_g),
      -overrideActualG,
    );
    assertTrue(
      "batch_consume movements reference the batch",
      consumeMovements.every(
        (m) => m.ref_type === "batch" && m.ref_id === batch.id,
      ),
    );

    const { data: produceMovements } = await admin
      .from("stock_movements")
      .select("item_id, qty_g")
      .eq("department_id", department.id)
      .eq("reason", "batch_produce")
      .eq("ref_id", batch.id);
    assertEqual(
      "exactly one batch_produce movement",
      produceMovements.length,
      1,
    );
    assertEqual(
      "batch_produce movement is positive and equals output_g",
      Number(produceMovements[0].qty_g),
      outputG,
    );
    assertEqual(
      "batch_produce movement is for the flavour",
      produceMovements[0].item_id,
      version.flavour_id,
    );

    const { data: flavourBalanceAfter } = await admin
      .from("stock_balances")
      .select("qty_g")
      .eq("department_id", department.id)
      .eq("item_type", "flavour")
      .eq("item_id", version.flavour_id)
      .single();
    assertEqual(
      "flavour stock_balances increased by exactly output_g",
      Number(flavourBalanceAfter.qty_g),
      Number(flavourQtyBefore) + outputG,
    );

    const { error: doubleConfirmErr } = await client.rpc("confirm_batch", {
      p_batch_id: batch.id,
      p_actual_grams: [],
    });
    assertTrue(
      "confirm_batch refuses to confirm an already-confirmed batch",
      !!doubleConfirmErr,
    );

    const { error: negativeErr } = await admin.rpc("post_movement", {
      p_department_id: department.id,
      p_item_type: "raw",
      p_item_id: firstMaterialId,
      p_qty_g: -999999999,
      p_reason: "batch_consume",
      p_ref_type: "test",
      p_ref_id: crypto.randomUUID(),
    });
    assertTrue(
      "post_movement refuses to take a balance negative without override",
      !!negativeErr,
    );

    await client.auth.signOut();
  } finally {
    console.log("\nCleaning up throwaway test user...");
    await admin.auth.admin.deleteUser(testUserId);
  }

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
