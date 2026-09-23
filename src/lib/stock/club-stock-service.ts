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
 * Two places where the live API differs from its own integration guide,
 * both of which would corrupt stock if taken on trust:
 *
 *   - The guide says quantities are in packets with a 28g default packet
 *     weight. The live API returns `"unit": "grams"` with
 *     packet_weight_grams = null. So the unit field is read per row and
 *     the conversion follows it; assuming packets would have multiplied
 *     every figure by 28.
 *   - The guide says to key on flavour.id. The live API returns null for
 *     it on every row (documented as legacy catalogue data), so a
 *     name-derived key has to be a supported case, not a failure.
 */

/** Documented default when the Club App sends packets without a weight. */
const DEFAULT_PACKET_WEIGHT_G = 28;

/** Max the API allows; fewer round trips for the same data. */
const PAGE_LIMIT = 500;

/** Stops a hung Club App from holding a page request open indefinitely. */
const REQUEST_TIMEOUT_MS = 15000;

export type ClubStockRow = {
  clubId: string | null;
  clubName: string;
  clubLocation: string | null;
  flavourId: string | null;
  flavourName: string;
  qtyG: number;
  minimumQtyG: number | null;
  status: string | null;
  sourceUnit: string | null;
  sourceQuantity: number;
  updatedAt: string | null;
};

export type SyncResult =
  | {
      status: "success";
      clubs: number;
      items: number;
      unmapped: number;
      at: string;
    }
  | { status: "not_configured"; message: string }
  | { status: "failed"; message: string };

type ClubApiConfig = { baseUrl: string; apiKey: string };

function readConfig(): ClubApiConfig | null {
  const baseUrl = process.env.CLUB_APP_BASE_URL;
  const apiKey = process.env.CLUB_APP_API_KEY;
  if (!baseUrl || !apiKey) return null;
  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey };
}

export function isClubApiConfigured(): boolean {
  return readConfig() !== null;
}

/** Normalised key used to match a name across the two systems. */
function nameKey(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * What the Club App calls this thing: its UUID where it has one, and a
 * normalised name where it does not.
 */
function externalKey(id: string | null, name: string): string {
  return id ?? `name:${nameKey(name)}`;
}

async function apiGet(
  config: ClubApiConfig,
  path: string,
  params?: Record<string, string>,
): Promise<unknown> {
  const url = new URL(`${config.baseUrl}${path}`);
  for (const [k, v] of Object.entries(params ?? {})) {
    url.searchParams.set(k, v);
  }

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    // Club stock is operational data; a cached fetch would defeat the
    // point of a manual "Sync Now".
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    // The API documents a consistent error envelope; prefer its message
    // over a bare status code, but never show a raw payload (§65).
    const message =
      (body as { error?: { message?: string } } | null)?.error?.message ??
      `Club App responded ${response.status}.`;
    throw new Error(message);
  }
  if (!body || (body as { success?: boolean }).success === false) {
    const message =
      (body as { error?: { message?: string } } | null)?.error?.message ??
      "Club App reported a failure.";
    throw new Error(message);
  }
  return body;
}

/** Health check — cheap, and tells the operator whether credentials work. */
export async function checkClubApiHealth(): Promise<
  { ok: true } | { ok: false; message: string }
> {
  const config = readConfig();
  if (!config) return { ok: false, message: "Club API is not configured." };
  try {
    await apiGet(config, "/inventory-health");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Club App unreachable.",
    };
  }
}

/**
 * Converts whatever the Club App reports into integer grams (rule 1).
 * Grams pass through; packets multiply by the packet weight it gave us,
 * falling back to the documented default only when it sends none.
 */
function toGrams(
  quantity: number,
  unit: string | null,
  packetWeightG: number | null,
): number {
  if (!Number.isFinite(quantity)) return 0;
  const normalised = (unit ?? "").trim().toLowerCase();
  if (normalised === "packets" || normalised === "packet") {
    return Math.round(quantity * (packetWeightG ?? DEFAULT_PACKET_WEIGHT_G));
  }
  // "grams" and anything unrecognised are treated as grams, which is what
  // the live API sends. An unknown unit is reported rather than guessed —
  // see the caller.
  return Math.round(quantity);
}

function parsePage(payload: unknown): {
  rows: ClubStockRow[];
  totalPages: number;
  unknownUnits: Set<string>;
} {
  const body = payload as {
    data?: unknown;
    pagination?: { total_pages?: number };
  };
  if (!Array.isArray(body.data)) {
    throw new Error("Club App returned an unexpected shape — expected a data array.");
  }

  const unknownUnits = new Set<string>();
  const rows = body.data.map((raw) => {
    const row = raw as {
      club?: { id?: string | null; name?: string; location?: string | null };
      flavour?: {
        id?: string | null;
        name?: string;
        packet_weight_grams?: number | null;
      };
      stock?: {
        quantity?: number;
        unit?: string | null;
        minimum_required?: number | null;
        status?: string | null;
      };
      updated_at?: string | null;
    };

    const clubName = row.club?.name?.trim() ?? "";
    const flavourName = row.flavour?.name?.trim() ?? "";
    const unit = row.stock?.unit ?? null;
    const packetWeight = row.flavour?.packet_weight_grams ?? null;
    const quantity = Number(row.stock?.quantity ?? 0);

    const normalisedUnit = (unit ?? "").trim().toLowerCase();
    if (
      normalisedUnit &&
      !["grams", "gram", "g", "packets", "packet"].includes(normalisedUnit)
    ) {
      unknownUnits.add(normalisedUnit);
    }

    const minimum = row.stock?.minimum_required;
    return {
      clubId: row.club?.id ?? null,
      clubName,
      clubLocation: row.club?.location?.trim() || null,
      flavourId: row.flavour?.id ?? null,
      flavourName,
      qtyG: toGrams(quantity, unit, packetWeight),
      minimumQtyG:
        minimum == null ? null : toGrams(Number(minimum), unit, packetWeight),
      status: row.stock?.status ?? null,
      sourceUnit: unit,
      sourceQuantity: quantity,
      updatedAt: row.updated_at ?? null,
    };
  });

  return {
    rows,
    totalPages: body.pagination?.total_pages ?? 1,
    unknownUnits,
  };
}

async function fetchAllClubStock(config: ClubApiConfig): Promise<{
  rows: ClubStockRow[];
  unknownUnits: Set<string>;
}> {
  const first = parsePage(
    await apiGet(config, "/inventory-club-stock", {
      page: "1",
      limit: String(PAGE_LIMIT),
    }),
  );

  const rows = [...first.rows];
  const unknownUnits = new Set(first.unknownUnits);

  // Pages are fetched in sequence rather than in parallel to stay well
  // inside the documented 60 requests/minute budget.
  for (let page = 2; page <= first.totalPages; page++) {
    const next = parsePage(
      await apiGet(config, "/inventory-club-stock", {
        page: String(page),
        limit: String(PAGE_LIMIT),
      }),
    );
    rows.push(...next.rows);
    for (const u of next.unknownUnits) unknownUnits.add(u);
  }

  return { rows, unknownUnits };
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
    fields: { clubs?: number; items?: number; unmapped?: number; error?: string },
  ) => {
    await admin.from("club_sync_log").insert({
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      status,
      clubs_synced: fields.clubs ?? 0,
      items_synced: fields.items ?? 0,
      unmapped_items: fields.unmapped ?? 0,
      error_message: fields.error ?? null,
      triggered_by: userId,
    });
  };

  const config = readConfig();
  if (!config) {
    const message =
      "Club API is not configured. Set CLUB_APP_BASE_URL and CLUB_APP_API_KEY to enable syncing.";
    await logAttempt("not_configured", { error: message });
    return { status: "not_configured", message };
  }

  let fetched: { rows: ClubStockRow[]; unknownUnits: Set<string> };
  try {
    fetched = await fetchAllClubStock(config);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not reach the Club App.";
    await logAttempt("failed", { error: message });
    // The cache is deliberately left exactly as it was (§39).
    return { status: "failed", message };
  }

  if (fetched.unknownUnits.size > 0) {
    // Refusing beats guessing: a unit we do not understand cannot be
    // converted to grams, and writing the raw number would silently
    // corrupt every figure for those rows.
    const message = `Club App sent an unrecognised unit (${[...fetched.unknownUnits].join(", ")}). Nothing was changed.`;
    await logAttempt("failed", { error: message });
    return { status: "failed", message };
  }

  // Existing confirmed mappings win; names only ever propose a match.
  const [{ data: venueMaps }, { data: flavourMaps }, { data: clubs }, { data: flavours }] =
    await Promise.all([
      admin.from("club_venue_map").select("external_key, department_id"),
      admin.from("club_flavour_map").select("external_key, flavour_id"),
      admin
        .from("departments")
        .select("id, name")
        .eq("type", "club")
        .eq("is_active", true),
      admin.from("flavours").select("id, name").eq("is_active", true),
    ]);

  const departmentByKey = new Map(
    (venueMaps ?? []).map((m) => [m.external_key, m.department_id]),
  );
  const flavourByKey = new Map(
    (flavourMaps ?? []).map((m) => [m.external_key, m.flavour_id]),
  );
  const clubByName = new Map(
    (clubs ?? []).map((c) => [nameKey(c.name), c.id]),
  );
  const flavourByName = new Map(
    (flavours ?? []).map((f) => [nameKey(f.name), f.id]),
  );

  const now = new Date().toISOString();
  const snapshots = new Map<
    string,
    {
      department_id: string;
      item_type: "flavour";
      item_id: string;
      qty_g: number;
      minimum_qty_g: number | null;
      status: string | null;
      source_ref: string;
      source_unit: string | null;
      source_quantity: number;
      source_updated_at: string | null;
      synced_at: string;
    }
  >();
  const unmapped: {
    external_key: string;
    club_app_club_id: string | null;
    club_app_club_name: string;
    club_app_location: string | null;
    club_app_flavour_id: string | null;
    club_app_flavour_name: string;
    qty_g: number;
    minimum_qty_g: number | null;
    status: string | null;
    missing: "club" | "flavour" | "both";
    seen_at: string;
  }[] = [];
  const syncedClubs = new Set<string>();

  for (const row of fetched.rows) {
    const venueKey = externalKey(row.clubId, row.clubName);
    const flavourKey = externalKey(row.flavourId, row.flavourName);

    const departmentId =
      departmentByKey.get(venueKey) ?? clubByName.get(nameKey(row.clubName));
    const itemId =
      flavourByKey.get(flavourKey) ?? flavourByName.get(nameKey(row.flavourName));

    if (!departmentId || !itemId) {
      unmapped.push({
        external_key: `${venueKey}|${flavourKey}`,
        club_app_club_id: row.clubId,
        club_app_club_name: row.clubName,
        club_app_location: row.clubLocation,
        club_app_flavour_id: row.flavourId,
        club_app_flavour_name: row.flavourName,
        qty_g: row.qtyG,
        minimum_qty_g: row.minimumQtyG,
        status: row.status,
        missing: !departmentId && !itemId ? "both" : !departmentId ? "club" : "flavour",
        seen_at: now,
      });
      continue;
    }

    syncedClubs.add(departmentId);
    const key = `${departmentId}|${itemId}`;
    const existing = snapshots.get(key);
    if (existing) {
      // Two Club App rows landing on the same inventory club and flavour
      // are summed rather than one silently overwriting the other.
      existing.qty_g += row.qtyG;
      existing.source_quantity += row.sourceQuantity;
      if (row.minimumQtyG != null) {
        existing.minimum_qty_g = (existing.minimum_qty_g ?? 0) + row.minimumQtyG;
      }
      continue;
    }
    snapshots.set(key, {
      department_id: departmentId,
      item_type: "flavour",
      item_id: itemId,
      qty_g: row.qtyG,
      minimum_qty_g: row.minimumQtyG,
      status: row.status,
      source_ref: `${venueKey}:${flavourKey}`,
      source_unit: row.sourceUnit,
      source_quantity: row.sourceQuantity,
      source_updated_at: row.updatedAt,
      synced_at: now,
    });
  }

  if (snapshots.size > 0) {
    const { error } = await admin
      .from("club_stock_snapshots")
      .upsert([...snapshots.values()], {
        onConflict: "department_id,item_type,item_id",
      });
    if (error) {
      await logAttempt("failed", { error: error.message });
      return { status: "failed", message: "Could not store the synced data." };
    }
  }

  // The unmapped list describes the latest sync, so stale entries from a
  // mapping that has since been made must not linger.
  await admin
    .from("club_unmapped_items")
    .delete()
    .neq("external_key", "__never__");
  if (unmapped.length > 0) {
    await admin.from("club_unmapped_items").insert(unmapped);
  }

  await logAttempt("success", {
    clubs: syncedClubs.size,
    items: snapshots.size,
    unmapped: unmapped.length,
  });
  return {
    status: "success",
    clubs: syncedClubs.size,
    items: snapshots.size,
    unmapped: unmapped.length,
    at: now,
  };
}
