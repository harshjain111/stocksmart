"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { can } from "@/lib/auth/permissions";
import { visibleDepartments } from "@/lib/stock/overview";
import {
  isClubApiConfigured,
  syncClubStock,
  checkClubApiHealth,
  type SyncResult,
} from "@/lib/stock/club-stock-service";

type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

export type ClubStockRowView = {
  clubId: string;
  clubName: string;
  branchName: string;
  flavourName: string;
  flavourCode: string | null;
  currentG: number;
  minimumG: number | null;
  status: "ok" | "low" | "out" | "approaching";
  syncedAt: string;
};

export type ClubStockData = {
  configured: boolean;
  rows: ClubStockRowView[];
  /** Club app flavours with no mapping — their stock cannot be shown. */
  unmappedCount: number;
  kpis: {
    totalClubs: number;
    clubsLow: number;
    outOfStock: number;
    approaching: number;
  };
  lastSyncedAt: string | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
  isStale: boolean;
};

/**
 * The Club App computes and sends its own status, so it is trusted rather
 * than recalculated — recomputing risks the two systems disagreeing about
 * the same club. "approaching" is ours: the Club App has no such band, so
 * it is derived only when a minimum is known.
 */
function statusFor(
  qtyG: number,
  minimumG: number | null,
  reported: string | null,
): ClubStockRowView["status"] {
  switch ((reported ?? "").trim().toUpperCase()) {
    case "OUT_OF_STOCK":
      return "out";
    case "LOW":
      return "low";
    case "OK":
      return minimumG != null && minimumG > 0 && qtyG <= minimumG * 1.2
        ? "approaching"
        : "ok";
    default:
      break;
  }
  if (qtyG === 0) return "out";
  if (minimumG == null || minimumG === 0) return "ok";
  if (qtyG < minimumG) return "low";
  if (qtyG <= minimumG * 1.2) return "approaching";
  return "ok";
}

export async function getClubStock(): Promise<ClubStockData> {
  const session = await getSession();
  const empty: ClubStockData = {
    configured: isClubApiConfigured(),
    rows: [],
    unmappedCount: 0,
    kpis: { totalClubs: 0, clubsLow: 0, outOfStock: 0, approaching: 0 },
    lastSyncedAt: null,
    lastSyncStatus: null,
    lastSyncError: null,
    isStale: false,
  };
  if (!session || !can(session.role, "stock:club")) return empty;

  const admin = createAdminClient();
  const departments = await visibleDepartments(session);
  const clubs = departments.filter((d) => d.type === "club");
  const clubIds = clubs.map((c) => c.id);

  const [
    { data: snapshots },
    { data: flavours },
    { data: log },
    { data: catalogue },
    { data: flavourMaps },
  ] = await Promise.all([
    clubIds.length > 0
      ? admin
          .from("club_stock_snapshots")
          .select(
            "department_id, item_type, item_id, qty_g, minimum_qty_g, status, synced_at",
          )
          .in("department_id", clubIds)
      : Promise.resolve({ data: [] }),
    admin.from("flavours").select("id, name, code"),
    admin
      .from("club_sync_log")
      .select("status, finished_at, error_message")
      .order("started_at", { ascending: false })
      .limit(1),
    admin.from("club_app_flavours").select("external_key"),
    admin.from("club_flavour_map").select("external_key"),
  ]);

  const meta = new Map((flavours ?? []).map((f) => [f.id, f]));
  const clubById = new Map(clubs.map((c) => [c.id, c]));

  const rows: ClubStockRowView[] = [];
  for (const s of snapshots ?? []) {
    const club = clubById.get(s.department_id);
    const flavour = meta.get(s.item_id);
    if (!club || !flavour) continue;
    rows.push({
      clubId: club.id,
      clubName: club.name,
      branchName: club.branches?.name ?? "",
      flavourName: flavour.name,
      flavourCode: flavour.code,
      currentG: s.qty_g,
      minimumG: s.minimum_qty_g,
      status: statusFor(s.qty_g, s.minimum_qty_g, s.status),
      syncedAt: s.synced_at,
    });
  }
  rows.sort(
    (a, b) =>
      a.clubName.localeCompare(b.clubName) ||
      a.flavourName.localeCompare(b.flavourName),
  );

  // "Unmapped" is simply a catalogue entry with no mapping — derived
  // rather than stored, so it cannot go stale between syncs.
  const mappedKeys = new Set((flavourMaps ?? []).map((m) => m.external_key));
  const unmappedCount = (catalogue ?? []).filter(
    (c) => !mappedKeys.has(c.external_key),
  ).length;
  const last = (log ?? [])[0] ?? null;

  return {
    configured: isClubApiConfigured(),
    rows,
    unmappedCount,
    kpis: {
      totalClubs: clubs.length,
      clubsLow: rows.filter((r) => r.status === "low").length,
      outOfStock: rows.filter((r) => r.status === "out").length,
      approaching: rows.filter((r) => r.status === "approaching").length,
    },
    lastSyncedAt: last?.finished_at ?? null,
    lastSyncStatus: last?.status ?? null,
    lastSyncError: last?.error_message ?? null,
    isStale: last?.status !== "success",
  };
}

export async function triggerClubSync(): Promise<SyncResult> {
  const session = await getSession();
  if (!session || !can(session.role, "stock:club")) {
    return { status: "failed", message: "You cannot sync club stock." };
  }
  const result = await syncClubStock(session.userId);
  revalidatePath("/stock/club");
  revalidatePath("/stock");
  return result;
}

export async function testClubConnection(): Promise<ActionResult<null>> {
  const session = await getSession();
  if (!session || !can(session.role, "stock:club")) {
    return { success: false, error: "You cannot test the Club connection." };
  }
  const health = await checkClubApiHealth();
  return health.ok
    ? { success: true, data: null }
    : { success: false, error: health.message };
}
