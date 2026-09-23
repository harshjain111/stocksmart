"use server";

import { z } from "zod";
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

export type UnmappedItem = {
  externalKey: string;
  clubName: string;
  location: string | null;
  flavourName: string;
  qtyG: number;
  missing: "club" | "flavour" | "both";
};

export type ClubStockData = {
  configured: boolean;
  rows: ClubStockRowView[];
  unmapped: UnmappedItem[];
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
  /** Inventory clubs and flavours offered when mapping by hand. */
  mappableClubs: { id: string; name: string }[];
  mappableFlavours: { id: string; name: string }[];
  canMap: boolean;
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
    unmapped: [],
    kpis: { totalClubs: 0, clubsLow: 0, outOfStock: 0, approaching: 0 },
    lastSyncedAt: null,
    lastSyncStatus: null,
    lastSyncError: null,
    isStale: false,
    mappableClubs: [],
    mappableFlavours: [],
    canMap: false,
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
    { data: unmappedRows },
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
    admin
      .from("club_unmapped_items")
      .select(
        "external_key, club_app_club_name, club_app_location, club_app_flavour_name, qty_g, missing",
      )
      .order("club_app_club_name"),
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

  const canMap = can(session.role, "setup:manage") || session.role === "admin";
  const last = (log ?? [])[0] ?? null;

  return {
    configured: isClubApiConfigured(),
    rows,
    unmapped: (unmappedRows ?? []).map((u) => ({
      externalKey: u.external_key,
      clubName: u.club_app_club_name,
      location: u.club_app_location,
      flavourName: u.club_app_flavour_name,
      qtyG: u.qty_g,
      missing: u.missing,
    })),
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
    mappableClubs: canMap ? clubs.map((c) => ({ id: c.id, name: c.name })) : [],
    mappableFlavours: canMap
      ? (flavours ?? [])
          .map((f) => ({ id: f.id, name: f.name }))
          .sort((a, b) => a.name.localeCompare(b.name))
      : [],
    canMap,
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

const mapSchema = z.object({
  externalKey: z.string().min(1),
  clubId: z.uuid().nullable().optional(),
  flavourId: z.uuid().nullable().optional(),
});

/**
 * Records that a Club App venue or flavour is a particular one of ours.
 * Deliberately admin-only: a wrong pairing silently attributes one club's
 * stock to another, and unlike a bad quantity there is nothing in the
 * numbers to give it away.
 */
export async function mapClubItem(
  input: z.input<typeof mapSchema>,
): Promise<ActionResult<null>> {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return { success: false, error: "Only an admin can map Club App data." };
  }

  const parsed = mapSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Pick an inventory club or flavour first." };
  }
  const { externalKey, clubId, flavourId } = parsed.data;
  if (!clubId && !flavourId) {
    return { success: false, error: "Pick an inventory club or flavour first." };
  }

  const admin = createAdminClient();
  const { data: item } = await admin
    .from("club_unmapped_items")
    .select(
      "club_app_club_id, club_app_club_name, club_app_location, club_app_flavour_id, club_app_flavour_name",
    )
    .eq("external_key", externalKey)
    .maybeSingle();
  if (!item) {
    return {
      success: false,
      error: "That item is no longer in the unmapped list — sync again.",
    };
  }

  const nameKey = (v: string) => v.trim().replace(/\s+/g, " ").toLowerCase();

  if (clubId) {
    const key = item.club_app_club_id ?? `name:${nameKey(item.club_app_club_name)}`;
    const { error } = await admin.from("club_venue_map").upsert(
      {
        external_key: key,
        club_app_club_id: item.club_app_club_id,
        club_app_name: item.club_app_club_name,
        club_app_location: item.club_app_location,
        department_id: clubId,
        created_by: session.userId,
      },
      { onConflict: "external_key" },
    );
    if (error) {
      return {
        success: false,
        error: error.message.includes("club_venue_map_department_id_key")
          ? "That inventory club is already mapped to another Club App venue."
          : "Could not save the club mapping.",
      };
    }
  }

  if (flavourId) {
    const key =
      item.club_app_flavour_id ?? `name:${nameKey(item.club_app_flavour_name)}`;
    const { error } = await admin.from("club_flavour_map").upsert(
      {
        external_key: key,
        club_app_flavour_id: item.club_app_flavour_id,
        club_app_flavour_name: item.club_app_flavour_name,
        flavour_id: flavourId,
        created_by: session.userId,
      },
      { onConflict: "external_key" },
    );
    if (error) {
      return { success: false, error: "Could not save the flavour mapping." };
    }
  }

  revalidatePath("/stock/club");
  return { success: true, data: null };
}
