#!/usr/bin/env node
/**
 * Asserts recipe_versions/recipe_lines RLS: admin and senior_mixer can read
 * them, mixer and purchase_manager get zero rows back, and only admin can
 * insert directly (a client bypassing create_recipe_version() and hitting
 * the REST API should still be blocked). Creates throwaway auth users for
 * the run and deletes them at the end — no credentials are stored anywhere.
 *
 * Usage: node scripts/test-rls-recipes.mjs
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

  const { data: anyVersion } = await admin
    .from("recipe_versions")
    .select("id, flavour_id")
    .limit(1)
    .single();
  if (!anyVersion) {
    throw new Error(
      "No recipe_versions rows exist to test against — run the app and create at least one version first.",
    );
  }

  const runId = Date.now().toString(36);
  const fixtures = [
    { role: "admin", expectRows: true, canInsert: true },
    { role: "senior_mixer", expectRows: true, canInsert: false },
    { role: "mixer", expectRows: false, canInsert: false },
    { role: "purchase_manager", expectRows: false, canInsert: false },
  ];

  console.log(`Creating ${fixtures.length} throwaway test users...`);
  for (const f of fixtures) {
    const password = `Rls-${Math.random().toString(36).slice(2)}-Aa1!`;
    const email = `rls-recipe-test-${f.role}-${runId}@example.test`;
    const { data: userRes, error: userErr } = await admin.auth.admin.createUser(
      { email, password, email_confirm: true },
    );
    if (userErr) throw new Error(`create ${f.role} user: ${userErr.message}`);
    f.userId = userRes.user.id;
    f.email = email;
    f.password = password;

    const { error: profileErr } = await admin.from("profiles").insert({
      id: f.userId,
      full_name: `RLS Recipe Test ${f.role}`,
      role: f.role,
      branch_id: guwahati.id,
    });
    if (profileErr)
      throw new Error(`create ${f.role} profile: ${profileErr.message}`);
  }

  try {
    for (const f of fixtures) {
      console.log(`\n=== ${f.role} (${f.email}) ===`);
      const client = createClient(SUPABASE_URL, ANON_KEY);
      const { error: signInErr } = await client.auth.signInWithPassword({
        email: f.email,
        password: f.password,
      });
      if (signInErr)
        throw new Error(`sign in as ${f.role}: ${signInErr.message}`);

      const { data: versions } = await client
        .from("recipe_versions")
        .select("id");
      const { data: lines } = await client.from("recipe_lines").select("id");

      if (f.expectRows) {
        assertTrue("recipe_versions returns rows", (versions ?? []).length > 0);
        assertTrue("recipe_lines returns rows", (lines ?? []).length > 0);
      } else {
        assertEqual("recipe_versions count", (versions ?? []).length, 0);
        assertEqual("recipe_lines count", (lines ?? []).length, 0);
      }

      // Direct-insert attempt, bypassing create_recipe_version() entirely.
      // version_no is derived from the run so repeat runs never collide with
      // each other on the (flavour_id, version_no) unique constraint —
      // recipe_versions can never be deleted (rule 7), so a fixed number
      // would only succeed once and leave every later run unable to tell
      // "blocked by RLS" apart from "blocked by a stale leftover row".
      const probeVersionNo = 900000 + (Date.now() % 100000);
      const { error: insertErr } = await client.from("recipe_versions").insert({
        flavour_id: anyVersion.flavour_id,
        version_no: probeVersionNo,
        note: "RLS insert probe (test artifact — recipe_versions rows can never be deleted, safe to ignore)",
        status: "current",
      });

      if (f.canInsert) {
        // Admin CAN pass the RLS check; that's what this asserts, not that
        // the insert succeeds end-to-end.
        const isRlsError =
          insertErr?.message?.toLowerCase().includes("row-level security") ??
          false;
        assertTrue("admin insert not blocked by RLS", !isRlsError);
        // Can't delete it (rule 7) — the closest thing to cleanup is
        // flipping status to archived, the one field that's still mutable,
        // so it doesn't show up as a phantom "current" version anywhere.
        if (!insertErr) {
          await admin
            .from("recipe_versions")
            .update({ status: "archived" })
            .eq("flavour_id", anyVersion.flavour_id)
            .eq("version_no", probeVersionNo);
        }
      } else {
        assertTrue("non-admin direct insert is rejected", insertErr !== null);
      }

      await client.auth.signOut();
    }
  } finally {
    console.log("\nCleaning up test fixtures...");
    for (const f of fixtures) {
      if (f.userId) await admin.auth.admin.deleteUser(f.userId);
    }
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
