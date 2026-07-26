#!/usr/bin/env node
/**
 * Asserts the masked batch card (2.9, CLAUDE.md rule 8) never leaks a real
 * material name — the response payload for a mixer's batch card must only
 * ever contain raw material codes and planned weights.
 *
 * Uses an existing recipe version's real lines (rather than creating new
 * master data) so the created draft batch is the only new row — batches
 * can never be deleted (rule 7), so this intentionally leaves one small
 * draft batch behind each run, same as any real usage would.
 *
 * Usage: node scripts/test-masked-batch-card.mjs
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { fetchMaskedBatchCard } from "../src/lib/mix/masked-batch-card.ts";

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

const failures = [];
function assertTrue(label, condition) {
  console.log(`  ${condition ? "PASS" : "FAIL"} ${label}`);
  if (!condition) failures.push(label);
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
    .select("raw_material_id, percentage, raw_materials(code, name)")
    .eq("recipe_version_id", version.id);

  const realNames = lines.map((l) => l.raw_materials.name);
  console.log(`Real material names in this recipe: ${realNames.join(", ")}`);

  const outputG = 1000;
  const wastageMultiplier = 1 + Number(version.wastage_pct) / 100;
  const consumptionRows = lines.map((l) => ({
    raw_material_id: l.raw_material_id,
    planned_g: Math.round(
      outputG * (Number(l.percentage) / 100) * wastageMultiplier,
    ),
  }));

  const { data: batchNoRow } = await admin.rpc("next_doc_no", {
    p_doc_type: "B",
    p_branch_id: department.branch_id,
  });

  const { data: batch, error: batchError } = await admin
    .from("batches")
    .insert({
      batch_no: batchNoRow,
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
  if (batchError) throw new Error(`create test batch: ${batchError.message}`);
  console.log(`Created draft batch ${batchNoRow} (${batch.id})`);

  const { error: consumptionError } = await admin
    .from("batch_consumption")
    .insert(consumptionRows.map((c) => ({ ...c, batch_id: batch.id })));
  if (consumptionError)
    throw new Error(`create batch_consumption: ${consumptionError.message}`);

  const result = await fetchMaskedBatchCard(
    admin,
    batch.id,
    department.branch_id,
  );

  assertTrue("fetchMaskedBatchCard succeeds", result.success);
  if (!result.success) {
    console.log(failures.length === 0 ? "" : failures.join("\n"));
    process.exit(1);
  }

  const payload = JSON.stringify(result.data);
  assertTrue(
    "payload has no top-level 'name' field on any line",
    result.data.lines.every((l) => !("name" in l)),
  );
  assertTrue(
    "payload has no 'percentage' field on any line",
    result.data.lines.every((l) => !("percentage" in l)),
  );
  assertTrue(
    "payload has no version number field",
    !("versionNo" in result.data) && !("version_no" in result.data),
  );
  for (const name of realNames) {
    assertTrue(
      `payload does not contain the real material name "${name}" anywhere`,
      !payload.includes(name),
    );
  }
  assertTrue(
    "payload does contain the real material codes",
    result.data.lines.every((l) => l.code !== null),
  );
  assertTrue(
    "payload does contain the real planned grams",
    result.data.lines.every((l) => l.plannedG > 0),
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
