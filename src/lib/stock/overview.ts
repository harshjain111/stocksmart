import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Session } from "@/lib/auth/session";

/**
 * Everything the Stock Overview needs, assembled in a fixed number of
 * queries regardless of how many locations or flavours exist (§68).
 *
 * The service-role client is used to read, and the role scoping is applied
 * here explicitly rather than relying on RLS — the same pattern the rest of
 * the app's server components use. Every query below is filtered to the
 * departments the caller is allowed to see, computed once at the top.
 */

export type ItemType = "raw" | "flavour";

export type LocationSummary = {
  id: string;
  name: string;
  branchName: string;
  type: "godown" | "office" | "club" | "cafe";
  totalG: number;
};

export type StockRow = {
  itemType: ItemType;
  itemId: string;
  name: string;
  code: string | null;
  /** Keyed by department id — only internal (non-club) locations. */
  byLocation: Record<string, number>;
  totalInternalG: number;
  clubStockG: number | null;
  clubMinimumG: number | null;
  clubStatus: "ok" | "low" | "out" | "approaching" | null;
};

export type AttentionItem = {
  label: string;
  tone: "destructive" | "warning" | "info";
  href: string;
};

export type ActivityItem = {
  id: string;
  at: string;
  itemName: string;
  qtyG: number;
  locationName: string;
  description: string;
};

export type OverviewData = {
  kpis: {
    totalInternalG: number;
    godownG: number;
    officeG: number;
    clubG: number;
    lowStockCount: number;
    outOfStockCount: number;
    flavourCount: number;
    locationCount: number;
  };
  locations: LocationSummary[];
  internalLocations: LocationSummary[];
  rows: StockRow[];
  attention: AttentionItem[];
  activity: ActivityItem[];
  club: {
    configured: boolean;
    lastSyncedAt: string | null;
    lastSyncStatus: string | null;
    lastSyncError: string | null;
    clubsTotal: number;
    clubsLow: number;
    clubsOut: number;
  };
};

type DepartmentRow = {
  id: string;
  name: string;
  type: LocationSummary["type"];
  branch_id: string;
  branches: { name: string } | null;
};

/** The departments this session may see, already scoped by role (§48). */
export async function visibleDepartments(
  session: Session,
): Promise<DepartmentRow[]> {
  const admin = createAdminClient();
  let query = admin
    .from("departments")
    .select("id, name, type, branch_id, branches(name)")
    .eq("is_active", true)
    .order("name");

  if (session.role === "hod" || session.role === "gate_man") {
    const ids = session.departments.map((d) => d.id);
    if (ids.length === 0) return [];
    query = query.in("id", ids);
  } else if (session.role !== "admin") {
    query = query.eq("branch_id", session.branchId ?? "");
  }

  const { data } = await query;
  return (data ?? []) as unknown as DepartmentRow[];
}

function clubStatusFor(
  qtyG: number,
  minimumG: number | null,
): StockRow["clubStatus"] {
  if (qtyG === 0) return "out";
  if (minimumG == null || minimumG === 0) return "ok";
  if (qtyG < minimumG) return "low";
  // §10's optional band: stocked, but only just. 20% above the minimum is
  // the threshold until the business configures its own.
  if (qtyG <= minimumG * 1.2) return "approaching";
  return "ok";
}

export async function getStockOverview(
  session: Session,
): Promise<OverviewData> {
  const admin = createAdminClient();
  const departments = await visibleDepartments(session);
  const deptIds = departments.map((d) => d.id);

  const internal = departments.filter((d) => d.type !== "club");
  const clubs = departments.filter((d) => d.type === "club");
  const internalIds = internal.map((d) => d.id);
  const clubIds = clubs.map((d) => d.id);

  const empty: OverviewData = {
    kpis: {
      totalInternalG: 0,
      godownG: 0,
      officeG: 0,
      clubG: 0,
      lowStockCount: 0,
      outOfStockCount: 0,
      flavourCount: 0,
      locationCount: 0,
    },
    locations: [],
    internalLocations: [],
    rows: [],
    attention: [],
    activity: [],
    club: {
      configured: false,
      lastSyncedAt: null,
      lastSyncStatus: null,
      lastSyncError: null,
      clubsTotal: 0,
      clubsLow: 0,
      clubsOut: 0,
    },
  };
  if (deptIds.length === 0) return empty;

  const [
    { data: balances },
    { data: flavours },
    { data: rawMaterials },
    { data: pars },
    { data: clubSnapshots },
    { data: syncLog },
    { data: openParties },
    { data: pendingCounts },
    { data: movements },
  ] = await Promise.all([
    admin
      .from("stock_balances")
      .select("department_id, item_type, item_id, qty_g")
      .in("department_id", internalIds.length > 0 ? internalIds : [""]),
    admin.from("flavours").select("id, name, code").eq("is_active", true),
    admin.from("raw_materials").select("id, name, code").eq("is_active", true),
    admin
      .from("par_levels")
      .select("department_id, item_type, item_id, par_qty_g")
      .in("department_id", deptIds),
    clubIds.length > 0
      ? admin
          .from("club_stock_snapshots")
          .select("department_id, item_type, item_id, qty_g, synced_at")
          .in("department_id", clubIds)
      : Promise.resolve({ data: [] }),
    admin
      .from("club_sync_log")
      .select("status, finished_at, started_at, error_message")
      .order("started_at", { ascending: false })
      .limit(1),
    admin
      .from("parties")
      .select("id, status")
      .in("department_id", deptIds)
      .in("status", ["out", "partially_returned"]),
    admin
      .from("stock_counts")
      .select("id, status")
      .in("department_id", deptIds)
      .eq("status", "submitted"),
    admin
      .from("stock_movements")
      .select("id, department_id, item_type, item_id, qty_g, reason, created_at")
      .in("department_id", deptIds)
      .order("created_at", { ascending: false })
      .limit(12),
  ]);

  const nameById = new Map<string, { name: string; code: string | null }>();
  for (const f of flavours ?? []) {
    nameById.set(`flavour|${f.id}`, { name: f.name, code: f.code });
  }
  for (const m of rawMaterials ?? []) {
    nameById.set(`raw|${m.id}`, { name: m.name, code: m.code });
  }
  const deptById = new Map(departments.map((d) => [d.id, d]));

  // Internal balances, pivoted per item across locations.
  const rowByKey = new Map<string, StockRow>();
  const locationTotals = new Map<string, number>();

  for (const b of balances ?? []) {
    const key = `${b.item_type}|${b.item_id}`;
    const meta = nameById.get(key);
    if (!meta) continue; // archived master — not shown on an operational screen
    let row = rowByKey.get(key);
    if (!row) {
      row = {
        itemType: b.item_type as ItemType,
        itemId: b.item_id,
        name: meta.name,
        code: meta.code,
        byLocation: {},
        totalInternalG: 0,
        clubStockG: null,
        clubMinimumG: null,
        clubStatus: null,
      };
      rowByKey.set(key, row);
    }
    row.byLocation[b.department_id] =
      (row.byLocation[b.department_id] ?? 0) + b.qty_g;
    row.totalInternalG += b.qty_g;
    locationTotals.set(
      b.department_id,
      (locationTotals.get(b.department_id) ?? 0) + b.qty_g,
    );
  }

  // Club stock comes from the cache, never from stock_balances — the Club
  // App owns it (§4).
  const clubQtyByKey = new Map<string, number>();
  for (const s of clubSnapshots ?? []) {
    const key = `${s.item_type}|${s.item_id}`;
    clubQtyByKey.set(key, (clubQtyByKey.get(key) ?? 0) + s.qty_g);
    locationTotals.set(
      s.department_id,
      (locationTotals.get(s.department_id) ?? 0) + s.qty_g,
    );
  }

  const clubMinByKey = new Map<string, number>();
  const clubMinByDeptItem = new Map<string, number>();
  for (const p of pars ?? []) {
    const dept = deptById.get(p.department_id);
    if (!dept) continue;
    const key = `${p.item_type}|${p.item_id}`;
    if (dept.type === "club") {
      clubMinByKey.set(key, (clubMinByKey.get(key) ?? 0) + p.par_qty_g);
      clubMinByDeptItem.set(`${p.department_id}|${key}`, p.par_qty_g);
    }
  }

  for (const [key, row] of rowByKey) {
    if (clubQtyByKey.has(key) || clubMinByKey.has(key)) {
      row.clubStockG = clubQtyByKey.get(key) ?? 0;
      row.clubMinimumG = clubMinByKey.get(key) ?? null;
      row.clubStatus = clubStatusFor(row.clubStockG, row.clubMinimumG);
    }
  }
  // Items held only at clubs still belong in the table.
  for (const [key, qty] of clubQtyByKey) {
    if (rowByKey.has(key)) continue;
    const meta = nameById.get(key);
    if (!meta) continue;
    const [itemType, itemId] = key.split("|");
    const minimumG = clubMinByKey.get(key) ?? null;
    rowByKey.set(key, {
      itemType: itemType as ItemType,
      itemId,
      name: meta.name,
      code: meta.code,
      byLocation: {},
      totalInternalG: 0,
      clubStockG: qty,
      clubMinimumG: minimumG,
      clubStatus: clubStatusFor(qty, minimumG),
    });
  }

  const rows = [...rowByKey.values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  const withTotals = (list: DepartmentRow[]): LocationSummary[] =>
    list.map((d) => ({
      id: d.id,
      name: d.name,
      branchName: d.branches?.name ?? "",
      type: d.type,
      totalG: locationTotals.get(d.id) ?? 0,
    }));

  const godownG = internal
    .filter((d) => d.type === "godown")
    .reduce((sum, d) => sum + (locationTotals.get(d.id) ?? 0), 0);
  const officeG = internal
    .filter((d) => d.type !== "godown")
    .reduce((sum, d) => sum + (locationTotals.get(d.id) ?? 0), 0);
  const clubG = clubs.reduce(
    (sum, d) => sum + (locationTotals.get(d.id) ?? 0),
    0,
  );

  // Club shortfalls are counted per club-and-flavour, which is the unit a
  // shortage actually happens in (§36).
  let clubsLow = 0;
  let clubsOut = 0;
  for (const s of clubSnapshots ?? []) {
    const minimum =
      clubMinByDeptItem.get(
        `${s.department_id}|${s.item_type}|${s.item_id}`,
      ) ?? null;
    const status = clubStatusFor(s.qty_g, minimum);
    if (status === "out") clubsOut += 1;
    else if (status === "low") clubsLow += 1;
  }

  const attention: AttentionItem[] = [];
  if (clubsOut > 0) {
    attention.push({
      label: `${clubsOut} club flavour${clubsOut === 1 ? "" : "s"} out of stock`,
      tone: "destructive",
      href: "/stock/club?status=out",
    });
  }
  if (clubsLow > 0) {
    attention.push({
      label: `${clubsLow} club flavour level${clubsLow === 1 ? "" : "s"} below minimum`,
      tone: "warning",
      href: "/stock/club?status=low",
    });
  }
  const partiesOut = (openParties ?? []).length;
  if (partiesOut > 0) {
    attention.push({
      label: `${partiesOut} party return${partiesOut === 1 ? "" : "s"} pending`,
      tone: "warning",
      href: "/stock/party?status=open",
    });
  }
  const countsPending = (pendingCounts ?? []).length;
  if (countsPending > 0) {
    attention.push({
      label: `${countsPending} count sheet${countsPending === 1 ? "" : "s"} awaiting approval`,
      tone: "info",
      href: "/stock/count?status=submitted",
    });
  }

  const REASON_LABEL: Record<string, string> = {
    grn_vendor: "GRN received",
    grn_transfer: "Transfer received",
    dispatch: "Stock dispatched",
    batch_consume: "Consumed in mixing",
    batch_produce: "Produced by mixing",
    count_adjust: "Count adjustment",
    transit_loss: "Transit loss",
    club_sync: "Club sync",
    opening: "Opening stock",
    party_issue: "Party stock issued",
    party_return: "Party stock returned",
  };

  const activity: ActivityItem[] = (movements ?? [])
    .map((m) => {
      const meta = nameById.get(`${m.item_type}|${m.item_id}`);
      return {
        id: m.id,
        at: m.created_at,
        itemName: meta?.name ?? "Unknown item",
        qtyG: m.qty_g,
        locationName: deptById.get(m.department_id)?.name ?? "",
        description: REASON_LABEL[m.reason] ?? m.reason,
      };
    })
    .filter((a) => a.itemName !== "Unknown item");

  const lastSync = (syncLog ?? [])[0] ?? null;

  return {
    kpis: {
      totalInternalG: godownG + officeG,
      godownG,
      officeG,
      clubG,
      // Internal low/out is measured against par levels where the business
      // has set them; no par level means no opinion, not a problem (§10).
      lowStockCount: (pars ?? []).filter((p) => {
        const dept = deptById.get(p.department_id);
        if (!dept || dept.type === "club") return false;
        const row = rowByKey.get(`${p.item_type}|${p.item_id}`);
        const qty = row?.byLocation[p.department_id] ?? 0;
        return qty > 0 && qty < p.par_qty_g;
      }).length,
      outOfStockCount: (pars ?? []).filter((p) => {
        const dept = deptById.get(p.department_id);
        if (!dept || dept.type === "club") return false;
        const row = rowByKey.get(`${p.item_type}|${p.item_id}`);
        return (row?.byLocation[p.department_id] ?? 0) === 0;
      }).length,
      flavourCount: (flavours ?? []).length,
      locationCount: internal.length,
    },
    locations: withTotals(departments),
    internalLocations: withTotals(internal),
    rows,
    attention,
    activity,
    club: {
      configured: Boolean(process.env.CLUB_API_URL),
      lastSyncedAt: lastSync?.finished_at ?? null,
      lastSyncStatus: lastSync?.status ?? null,
      lastSyncError: lastSync?.error_message ?? null,
      clubsTotal: clubs.length,
      clubsLow,
      clubsOut,
    },
  };
}
