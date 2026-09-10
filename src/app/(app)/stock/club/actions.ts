"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { can } from "@/lib/auth/permissions";
import { visibleDepartments } from "@/lib/stock/overview";
import {
  isClubApiConfigured,
  syncClubStock,
  type SyncResult,
} from "@/lib/stock/club-stock-service";

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
  kpis: {
    totalClubs: number;
    clubsLow: number;
    outOfStock: number;
    approaching: number;
  };
  lastSyncedAt: string | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
  /** True when the figures shown are cached rather than freshly fetched (§39). */
  isStale: boolean;
};

function statusFor(
  qtyG: number,
  minimumG: number | null,
): ClubStockRowView["status"] {
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

  const [{ data: snapshots }, { data: pars }, { data: flavours }, { data: log }] =
    await Promise.all([
      clubIds.length > 0
        ? admin
            .from("club_stock_snapshots")
            .select("department_id, item_type, item_id, qty_g, synced_at")
            .in("department_id", clubIds)
        : Promise.resolve({ data: [] }),
      clubIds.length > 0
        ? admin
            .from("par_levels")
            .select("department_id, item_type, item_id, par_qty_g")
            .in("department_id", clubIds)
        : Promise.resolve({ data: [] }),
      admin.from("flavours").select("id, name, code"),
      admin
        .from("club_sync_log")
        .select("status, finished_at, error_message")
        .order("started_at", { ascending: false })
        .limit(1),
    ]);

  const meta = new Map((flavours ?? []).map((f) => [f.id, f]));
  const clubById = new Map(clubs.map((c) => [c.id, c]));
  const minByKey = new Map(
    (pars ?? []).map((p) => [
      `${p.department_id}|${p.item_type}|${p.item_id}`,
      p.par_qty_g,
    ]),
  );

  const rows: ClubStockRowView[] = [];
  for (const s of snapshots ?? []) {
    const club = clubById.get(s.department_id);
    const flavour = meta.get(s.item_id);
    if (!club || !flavour) continue;
    const minimumG =
      minByKey.get(`${s.department_id}|${s.item_type}|${s.item_id}`) ?? null;
    rows.push({
      clubId: club.id,
      clubName: club.name,
      branchName: club.branches?.name ?? "",
      flavourName: flavour.name,
      flavourCode: flavour.code,
      currentG: s.qty_g,
      minimumG,
      status: statusFor(s.qty_g, minimumG),
      syncedAt: s.synced_at,
    });
  }
  rows.sort(
    (a, b) =>
      a.clubName.localeCompare(b.clubName) ||
      a.flavourName.localeCompare(b.flavourName),
  );

  const last = (log ?? [])[0] ?? null;
  return {
    configured: isClubApiConfigured(),
    rows,
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
