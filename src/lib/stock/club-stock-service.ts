import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The one place that talks to the Club App (§38). Nothing else in the
 * codebase fetches club data — components read the cached snapshot table,
 * and only this module ever writes it.
 *
 * The Club App is the source of truth for club stock (§4). This side
 * caches what it last said so a failed sync can show real last-known
 * figures with an honest timestamp, rather than zeros that would read as
 * "every club is empty" (§39).
 *
 * ---------------------------------------------------------------------
 * NOT YET CONFIGURED
 * ---------------------------------------------------------------------
 * The Club App's endpoint, auth scheme and response shape have not been
 * provided, so `parseClubResponse` below describes the contract this
 * expects rather than one that has been verified against a live server.
 * Until CLUB_API_URL is set, every sync records `not_configured` and the
 * cache is left untouched — deliberately, because writing invented rows
 * would be indistinguishable from real data once it landed in the table.
 *
 * To go live: set CLUB_API_URL (and CLUB_API_KEY if the API needs one),
 * then adjust `parseClubResponse` to match the real payload. Nothing else
 * needs to change.
 */

export type ClubStockRow = {
  /** The Club App's identifier for the club. */
  clubRef: string;
  clubName: string;
  /** The Club App's identifier for the flavour. */
  flavourRef: string;
  flavourName: string;
  qtyG: number;
};

export type SyncResult =
  | { status: "success"; clubs: number; items: number; at: string }
  | { status: "not_configured"; message: string }
  | { status: "failed"; message: string };

type ClubApiConfig = { url: string; apiKey: string | null };

function readConfig(): ClubApiConfig | null {
  const url = process.env.CLUB_API_URL;
  if (!url) return null;
  return { url, apiKey: process.env.CLUB_API_KEY ?? null };
}

export function isClubApiConfigured(): boolean {
  return readConfig() !== null;
}

/**
 * Maps the Club App's payload onto ClubStockRow.
 *
 * This is the single point that has to change when the real contract
 * arrives. It is written defensively — an unexpected shape throws with a
 * readable message instead of silently producing zero rows, because a
 * silent empty sync would wipe the cache's usefulness.
 */
function parseClubResponse(payload: unknown): ClubStockRow[] {
  const items = Array.isArray(payload)
    ? payload
    : typeof payload === "object" && payload !== null && "data" in payload
      ? (payload as { data: unknown }).data
      : null;

  if (!Array.isArray(items)) {
    throw new Error(
      "Club API returned an unexpected shape — expected an array of stock rows.",
    );
  }

  return items.map((raw, index) => {
    const row = raw as Record<string, unknown>;
    const clubRef = row.club_id ?? row.clubId ?? row.club;
    const flavourRef = row.flavour_id ?? row.flavourId ?? row.flavour;
    const qty = row.qty_g ?? row.quantity_g ?? row.qtyG;

    if (clubRef == null || flavourRef == null || qty == null) {
      throw new Error(
        `Club API row ${index} is missing club, flavour or quantity.`,
      );
    }
    return {
      clubRef: String(clubRef),
      clubName: String(row.club_name ?? row.clubName ?? clubRef),
      flavourRef: String(flavourRef),
      flavourName: String(row.flavour_name ?? row.flavourName ?? flavourRef),
      qtyG: Math.round(Number(qty)),
    };
  });
}

async function fetchClubStock(config: ClubApiConfig): Promise<ClubStockRow[]> {
  const response = await fetch(config.url, {
    headers: {
      Accept: "application/json",
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    },
    // Club stock is operational data; a stale cached fetch would defeat
    // the point of a manual "Sync Now".
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(
      `Club API responded ${response.status}${
        response.statusText ? ` ${response.statusText}` : ""
      }.`,
    );
  }
  return parseClubResponse(await response.json());
}

/**
 * Pulls club stock and refreshes the cache. Every attempt is logged,
 * successful or not, so the UI can always say when data last arrived.
 */
export async function syncClubStock(userId: string | null): Promise<SyncResult> {
  const admin = createAdminClient();
  const startedAt = new Date().toISOString();

  const logAttempt = async (
    status: "success" | "failed" | "not_configured",
    fields: { clubs?: number; items?: number; error?: string },
  ) => {
    await admin.from("club_sync_log").insert({
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      status,
      clubs_synced: fields.clubs ?? 0,
      items_synced: fields.items ?? 0,
      error_message: fields.error ?? null,
      triggered_by: userId,
    });
  };

  const config = readConfig();
  if (!config) {
    const message =
      "Club API is not configured. Set CLUB_API_URL to enable syncing.";
    await logAttempt("not_configured", { error: message });
    return { status: "not_configured", message };
  }

  let rows: ClubStockRow[];
  try {
    rows = await fetchClubStock(config);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not reach the Club App.";
    await logAttempt("failed", { error: message });
    // The cache is deliberately left exactly as it was (§39).
    return { status: "failed", message };
  }

  // Map the Club App's refs onto this system's clubs and flavours. A row
  // that maps to neither is skipped rather than guessed at — an unmapped
  // club is a setup problem, not stock data.
  const [{ data: clubs }, { data: flavours }] = await Promise.all([
    admin
      .from("departments")
      .select("id, name")
      .eq("type", "club")
      .eq("is_active", true),
    admin.from("flavours").select("id, name, code").eq("is_active", true),
  ]);

  const clubByName = new Map(
    (clubs ?? []).map((c) => [c.name.trim().toLowerCase(), c.id]),
  );
  const flavourByName = new Map(
    (flavours ?? []).map((f) => [f.name.trim().toLowerCase(), f.id]),
  );
  const flavourByCode = new Map(
    (flavours ?? [])
      .filter((f) => f.code)
      .map((f) => [f.code!.trim().toLowerCase(), f.id]),
  );

  const snapshots: {
    department_id: string;
    item_type: "flavour";
    item_id: string;
    qty_g: number;
    source_ref: string;
    synced_at: string;
  }[] = [];
  const syncedClubs = new Set<string>();
  const now = new Date().toISOString();

  for (const row of rows) {
    const departmentId = clubByName.get(row.clubName.trim().toLowerCase());
    const itemId =
      flavourByName.get(row.flavourName.trim().toLowerCase()) ??
      flavourByCode.get(row.flavourRef.trim().toLowerCase());
    if (!departmentId || !itemId) continue;

    syncedClubs.add(departmentId);
    snapshots.push({
      department_id: departmentId,
      item_type: "flavour",
      item_id: itemId,
      qty_g: row.qtyG,
      source_ref: `${row.clubRef}:${row.flavourRef}`,
      synced_at: now,
    });
  }

  if (snapshots.length > 0) {
    const { error } = await admin
      .from("club_stock_snapshots")
      .upsert(snapshots, {
        onConflict: "department_id,item_type,item_id",
      });
    if (error) {
      await logAttempt("failed", { error: error.message });
      return { status: "failed", message: "Could not store the synced data." };
    }
  }

  await logAttempt("success", {
    clubs: syncedClubs.size,
    items: snapshots.length,
  });
  return {
    status: "success",
    clubs: syncedClubs.size,
    items: snapshots.length,
    at: now,
  };
}
