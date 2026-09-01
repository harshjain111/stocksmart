#!/usr/bin/env node
/**
 * One-time bootstrap: creates the first admin login on a freshly-migrated,
 * otherwise-empty Supabase project (branches/departments already exist via
 * migration seed data, but there is no auth user or profiles row yet, so
 * nobody can sign in until this runs once).
 *
 * Usage: node scripts/bootstrap-admin.mjs <email> <password> <full name>
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

const [, , email, password, ...nameParts] = process.argv;
const fullName = nameParts.join(" ") || "Admin";

if (!email || !password) {
  console.error("Usage: node scripts/bootstrap-admin.mjs <email> <password> <full name>");
  process.exit(1);
}

const env = loadEnvLocal();
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: hq, error: hqErr } = await admin
  .from("branches")
  .select("id, name")
  .eq("is_hq", true)
  .single();
if (hqErr || !hq) {
  console.error("Could not find the HQ branch — did migrations run?", hqErr);
  process.exit(1);
}

const { data: created, error: createErr } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
});
if (createErr || !created.user) {
  console.error("Could not create the auth user:", createErr);
  process.exit(1);
}

const { error: profileErr } = await admin.from("profiles").insert({
  id: created.user.id,
  full_name: fullName,
  role: "admin",
  branch_id: hq.id,
});
if (profileErr) {
  console.error("Auth user created but profile insert failed:", profileErr);
  process.exit(1);
}

console.log(`Admin created: ${email} · role admin · branch ${hq.name}`);
