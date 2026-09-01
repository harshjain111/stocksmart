#!/usr/bin/env node
/**
 * Verifies recipe_versions/recipe_lines immutability guarantees:
 *  - lines must sum to exactly 100 per version (deferred constraint)
 *  - recipe_versions rows can only have `status` updated, never deleted
 *  - recipe_lines rows can never be updated or deleted
 *  - log_audit_event() records the calling user, not a forged one
 *
 * Usage: node scripts/test-recipe-immutability.mjs
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

const failures = [];
function assertTrue(label, condition) {
  console.log(`  ${condition ? "PASS" : "FAIL"} ${label}`);
  if (!condition) failures.push(label);
}

async function main() {
  const { data: flavour } = await admin
    .from("flavours")
    .insert({ name: "Test Immutability Flavour" })
    .select()
    .single();
  const { data: rm1 } = await admin
    .from("raw_materials")
    .insert({ name: "Test Material A" })
    .select()
    .single();
  const { data: rm2 } = await admin
    .from("raw_materials")
    .insert({ name: "Test Material B" })
    .select()
    .single();

  // 1. Valid version (lines sum to 100) should succeed.
  const { data: version, error: versionErr } = await admin
    .from("recipe_versions")
    .insert({
      flavour_id: flavour.id,
      version_no: 1,
      note: "First mix",
    })
    .select()
    .single();
  assertTrue("valid version inserts", !versionErr && !!version);

  const { error: validLinesErr } = await admin.from("recipe_lines").insert([
    { recipe_version_id: version.id, raw_material_id: rm1.id, percentage: 60 },
    { recipe_version_id: version.id, raw_material_id: rm2.id, percentage: 40 },
  ]);
  assertTrue("lines summing to 100 insert cleanly", !validLinesErr);

  // 2. Lines NOT summing to 100 should be rejected at commit.
  const { data: version2 } = await admin
    .from("recipe_versions")
    .insert({ flavour_id: flavour.id, version_no: 2, note: "Bad version" })
    .select()
    .single();
  const { error: badLinesErr } = await admin.from("recipe_lines").insert([
    { recipe_version_id: version2.id, raw_material_id: rm1.id, percentage: 60 },
    { recipe_version_id: version2.id, raw_material_id: rm2.id, percentage: 30 },
  ]);
  assertTrue(
    "lines summing to 90 (not 100) are rejected",
    !!badLinesErr && /sum to exactly 100/.test(badLinesErr.message),
  );

  // 3. Updating a non-status column on recipe_versions is blocked.
  const { error: badUpdateErr } = await admin
    .from("recipe_versions")
    .update({ note: "sneaky edit" })
    .eq("id", version.id);
  assertTrue(
    "updating recipe_versions.note is blocked",
    !!badUpdateErr && /immutable except status/.test(badUpdateErr.message),
  );

  // 4. Updating only `status` on recipe_versions is allowed.
  const { error: statusUpdateErr } = await admin
    .from("recipe_versions")
    .update({ status: "archived" })
    .eq("id", version.id);
  assertTrue("updating recipe_versions.status is allowed", !statusUpdateErr);

  // 5. Deleting a recipe_versions row is blocked.
  const { error: deleteVersionErr } = await admin
    .from("recipe_versions")
    .delete()
    .eq("id", version.id);
  assertTrue(
    "deleting a recipe_versions row is blocked",
    !!deleteVersionErr && /never deleted/.test(deleteVersionErr.message),
  );

  // 6. recipe_lines can never be updated or deleted.
  const { data: lines } = await admin
    .from("recipe_lines")
    .select("id")
    .eq("recipe_version_id", version.id)
    .limit(1);
  const { error: lineUpdateErr } = await admin
    .from("recipe_lines")
    .update({ percentage: 99 })
    .eq("id", lines[0].id);
  assertTrue(
    "updating a recipe_lines row is blocked",
    !!lineUpdateErr && /immutable/.test(lineUpdateErr.message),
  );
  const { error: lineDeleteErr } = await admin
    .from("recipe_lines")
    .delete()
    .eq("id", lines[0].id);
  assertTrue(
    "deleting a recipe_lines row is blocked",
    !!lineDeleteErr && /immutable/.test(lineDeleteErr.message),
  );

  // 7. log_audit_event() records the actual caller via a real session, not
  // a client-supplied id. Uses a throwaway admin created here rather than a
  // fixed seeded account, so this test doesn't depend on which project it
  // runs against.
  const testPassword = `Immut-${Math.random().toString(36).slice(2)}-Aa1!`;
  const testEmail = `recipe-immutability-test-${Date.now().toString(36)}@example.test`;
  const { data: testUser, error: testUserErr } = await admin.auth.admin.createUser({
    email: testEmail,
    password: testPassword,
    email_confirm: true,
  });
  if (testUserErr) throw new Error(`create test user: ${testUserErr.message}`);
  const { data: hq } = await admin
    .from("branches")
    .select("id")
    .eq("is_hq", true)
    .single();
  const { error: testProfileErr } = await admin.from("profiles").insert({
    id: testUser.user.id,
    full_name: "Recipe Immutability Test Admin",
    role: "admin",
    branch_id: hq.id,
  });
  if (testProfileErr) throw new Error(`create test profile: ${testProfileErr.message}`);

  const anon = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
  const { data: signIn, error: signInErr } = await anon.auth.signInWithPassword({
    email: testEmail,
    password: testPassword,
  });
  if (signInErr)
    throw new Error(`sign in as ${testEmail}: ${signInErr.message}`);

  const { error: logErr } = await anon.rpc("log_audit_event", {
    p_action: "recipe_read",
    p_entity_type: "flavour",
    p_entity_id: flavour.id,
    p_metadata: { note: "immutability test" },
  });
  assertTrue("log_audit_event() call succeeds", !logErr);

  const { data: logRow } = await admin
    .from("audit_log")
    .select("actor_id")
    .eq("entity_id", flavour.id)
    .eq("action", "recipe_read")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  assertTrue(
    "audit_log recorded the signed-in user's own id",
    logRow?.actor_id === signIn.user.id,
  );
  await anon.auth.signOut();

  // Cleanup. The recipe_versions/recipe_lines rows this test created can't
  // be deleted (that's the whole point) and the flavour/materials can't
  // either once referenced by a version — so archive them instead of
  // leaving "active" fake entries in the real Materials/Flavours screens.
  await admin.from("audit_log").delete().eq("entity_id", flavour.id);
  await admin
    .from("flavours")
    .update({ is_active: false })
    .eq("id", flavour.id);
  await admin
    .from("raw_materials")
    .update({ is_active: false })
    .in("id", [rm1.id, rm2.id]);
  await admin.auth.admin.deleteUser(testUser.user.id);

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
