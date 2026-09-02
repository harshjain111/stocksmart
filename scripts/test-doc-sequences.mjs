#!/usr/bin/env node
/**
 * Hammers next_doc_no() with concurrent calls and asserts no duplicates —
 * across a single (doc_type, branch) series, and confirms different
 * doc_types/branches get fully independent series.
 *
 * Usage: node scripts/test-doc-sequences.mjs
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

const CONCURRENCY = 100;

async function nextDocNo(docType, branchId) {
  const { data, error } = await admin.rpc("next_doc_no", {
    p_doc_type: docType,
    p_branch_id: branchId,
  });
  if (error) throw new Error(`next_doc_no(${docType}): ${error.message}`);
  return data;
}

function serial(docNo) {
  return Number(docNo.split("-")[1]);
}

// An unbroken run of `numbers` starting at `from`. Deliberately relative
// to wherever the series already stood: these sequences are shared with
// every other test and with real documents, so anchoring on 0001 only
// held the very first time this script was ever run.
function isRunFrom(numbers, prefix, from) {
  const sorted = [...numbers].sort();
  for (let i = 0; i < sorted.length; i++) {
    const expected = `${prefix}-${String(from + i).padStart(4, "0")}`;
    if (sorted[i] !== expected) return false;
  }
  return true;
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

  // Where each series stands right now. Independence is then proved by
  // showing a series resumes from its own mark and not from a
  // neighbour's, which holds no matter what has already been issued.
  const reqMark = serial(await nextDocNo("REQ", guwahati.id));
  const trfMark = serial(await nextDocNo("TRF", guwahati.id));
  const kolkataMark = serial(await nextDocNo("REQ", kolkata.id));

  console.log(`Firing ${CONCURRENCY} concurrent REQ calls for Guwahati...`);
  const reqResults = await Promise.all(
    Array.from({ length: CONCURRENCY }, () => nextDocNo("REQ", guwahati.id)),
  );
  assertTrue(
    `all ${CONCURRENCY} REQ numbers unique`,
    new Set(reqResults).size === CONCURRENCY,
  );
  assertTrue(
    `REQ numbers form an unbroken run of ${CONCURRENCY} with no gaps`,
    isRunFrom(reqResults, "REQ", reqMark + 1),
  );

  console.log(
    `Firing ${CONCURRENCY} concurrent TRF calls for Guwahati (same branch, different type)...`,
  );
  const trfResults = await Promise.all(
    Array.from({ length: CONCURRENCY }, () => nextDocNo("TRF", guwahati.id)),
  );
  assertTrue(
    "TRF series is independent of REQ series (resumes from its own mark, unmoved by 100 REQ calls)",
    isRunFrom(trfResults, "TRF", trfMark + 1),
  );
  assertTrue(
    `all ${CONCURRENCY} TRF numbers unique`,
    new Set(trfResults).size === CONCURRENCY,
  );

  console.log(
    `Firing ${CONCURRENCY} concurrent REQ calls for Kolkata (different branch, same type)...`,
  );
  const kolkataResults = await Promise.all(
    Array.from({ length: CONCURRENCY }, () => nextDocNo("REQ", kolkata.id)),
  );
  assertTrue(
    "Kolkata's REQ series is independent of Guwahati's (resumes from its own mark)",
    isRunFrom(kolkataResults, "REQ", kolkataMark + 1),
  );
  assertTrue(
    `all ${CONCURRENCY} Kolkata REQ numbers unique`,
    new Set(kolkataResults).size === CONCURRENCY,
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
