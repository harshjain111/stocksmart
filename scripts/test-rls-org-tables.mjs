#!/usr/bin/env node
/**
 * Logs in as each of the seven roles and asserts what it can and can't
 * read on the org tables (branches, departments, profiles, user_departments).
 * Creates throwaway auth users for the run and deletes them at the end —
 * no credentials are stored anywhere.
 *
 * Usage: node scripts/test-rls-org-tables.mjs
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
function assertEqual(label, actual, expected) {
  const ok = actual === expected;
  console.log(
    `  ${ok ? "PASS" : "FAIL"} ${label} (expected ${expected}, got ${actual})`,
  );
  if (!ok) failures.push(label);
}
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
  const { data: kolkata } = await admin
    .from("branches")
    .select("id")
    .eq("name", "Kolkata")
    .single();
  const { data: mainGodown } = await admin
    .from("departments")
    .select("id")
    .eq("name", "Main Godown")
    .single();

  const runId = Date.now().toString(36);
  const fixtures = [
    { role: "admin", branchId: guwahati.id },
    { role: "branch_manager", branchId: guwahati.id },
    { role: "store_manager", branchId: kolkata.id },
    { role: "purchase_manager", branchId: guwahati.id },
    { role: "hod", branchId: guwahati.id, assignDeptId: mainGodown.id },
    { role: "senior_mixer", branchId: guwahati.id },
    { role: "mixer", branchId: guwahati.id },
  ];

  console.log(`Creating ${fixtures.length} throwaway test users...`);
  for (const f of fixtures) {
    const password = `Rls-${Math.random().toString(36).slice(2)}-Aa1!`;
    const email = `rls-test-${f.role}-${runId}@example.test`;
    const { data: userRes, error: userErr } = await admin.auth.admin.createUser(
      {
        email,
        password,
        email_confirm: true,
      },
    );
    if (userErr) throw new Error(`create ${f.role} user: ${userErr.message}`);
    f.userId = userRes.user.id;
    f.email = email;
    f.password = password;

    const { error: profileErr } = await admin.from("profiles").insert({
      id: f.userId,
      full_name: `RLS Test ${f.role}`,
      role: f.role,
      branch_id: f.branchId,
    });
    if (profileErr)
      throw new Error(`create ${f.role} profile: ${profileErr.message}`);

    if (f.assignDeptId) {
      const { error: udErr } = await admin.from("user_departments").insert({
        profile_id: f.userId,
        department_id: f.assignDeptId,
      });
      if (udErr)
        throw new Error(`assign ${f.role} department: ${udErr.message}`);
    }
  }

  const hod = fixtures.find((f) => f.role === "hod");
  const branchManager = fixtures.find((f) => f.role === "branch_manager");
  const storeManager = fixtures.find((f) => f.role === "store_manager");

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

      const { data: branches } = await client.from("branches").select("id");
      const { data: departments } = await client
        .from("departments")
        .select("id, branch_id, name");
      const { data: profiles } = await client
        .from("profiles")
        .select("id, branch_id");
      const { data: userDepartments } = await client
        .from("user_departments")
        .select("id, profile_id");

      const branchIds = (branches ?? []).map((b) => b.id);
      const deptIds = (departments ?? []).map((d) => d.id);
      const profileIds = (profiles ?? []).map((p) => p.id);
      const udIds = (userDepartments ?? []).map((u) => u.id);

      assertTrue("sees own profile", profileIds.includes(f.userId));

      if (f.role === "admin") {
        assertEqual("branches count", branchIds.length, 2);
        assertEqual("departments count", deptIds.length, 8);
      } else {
        assertEqual("branches count (own branch only)", branchIds.length, 1);
        assertTrue(
          "own branch is the one visible",
          branchIds.includes(f.branchId),
        );
      }

      if (f.role === "branch_manager") {
        assertEqual(
          "departments count (own branch, Guwahati)",
          deptIds.length,
          5,
        );
        assertTrue(
          "all visible departments belong to own branch",
          departments.every((d) => d.branch_id === guwahati.id),
        );
      }

      if (f.role === "store_manager") {
        assertEqual(
          "departments count (own branch, Kolkata)",
          deptIds.length,
          3,
        );
        assertTrue(
          "all visible departments belong to own branch",
          departments.every((d) => d.branch_id === kolkata.id),
        );
      }

      if (f.role === "hod") {
        assertEqual("departments count (assigned only)", deptIds.length, 1);
        assertEqual(
          "assigned department is Main Godown",
          departments[0]?.name,
          "Main Godown",
        );
        assertEqual(
          "user_departments count (own assignment only)",
          udIds.length,
          1,
        );
      }

      if (["purchase_manager", "senior_mixer", "mixer"].includes(f.role)) {
        assertEqual(`departments count (no grant yet)`, deptIds.length, 0);
        assertEqual(`user_departments count (no grant yet)`, udIds.length, 0);
        assertEqual(`profiles count (own row only)`, profileIds.length, 1);
      }

      if (f.role === "branch_manager") {
        assertTrue(
          "does NOT see the Kolkata store_manager's profile",
          !profileIds.includes(storeManager.userId),
        );
        assertTrue(
          "sees the Guwahati hod's profile (same branch)",
          profileIds.includes(hod.userId),
        );
        assertTrue(
          "sees the Guwahati hod's user_departments row (same branch)",
          userDepartments.some((u) => u.profile_id === hod.userId),
        );
      }

      if (f.role === "store_manager") {
        assertTrue(
          "does NOT see the Guwahati branch_manager's profile",
          !profileIds.includes(branchManager.userId),
        );
        assertTrue(
          "does NOT see the Guwahati hod's user_departments row (different branch)",
          !userDepartments.some((u) => u.profile_id === hod.userId),
        );
      }

      await client.auth.signOut();
    }
  } finally {
    console.log("\nCleaning up test fixtures...");
    for (const f of fixtures) {
      if (f.assignDeptId) {
        await admin
          .from("user_departments")
          .delete()
          .eq("profile_id", f.userId);
      }
      await admin.auth.admin.deleteUser(f.userId);
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
