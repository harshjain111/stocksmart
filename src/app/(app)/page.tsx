import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { HomeView, type HomeSection } from "@/components/home/home-view";

export default async function HomePage() {
  const session = await getSession();
  if (!session) {
    return null;
  }

  const admin = createAdminClient();

  const APPROVER_ROLES = ["admin", "branch_manager", "store_manager"];
  const RECEIVER_ROLES = ["admin", "branch_manager", "store_manager", "hod"];
  const STOCK_ROLES = ["admin", "branch_manager", "store_manager", "hod"];
  const TRANSIT_ROLES = ["admin", "branch_manager", "store_manager"];
  const RATER_ROLES = ["admin", "senior_mixer"];

  // 1. Requisitions waiting on my approval.
  async function loadApprovals(): Promise<HomeSection | null> {
    if (!APPROVER_ROLES.includes(session!.role)) return null;
    let query = admin
      .from("requisitions")
      .select("id, req_no, needed_by, departments(name)")
      .eq("status", "submitted");
    if (session!.role !== "admin") {
      query = query.eq("branch_id", session!.branchId ?? "");
    }
    const { data } = await query.order("created_at", { ascending: true });

    type Row = {
      id: string;
      req_no: string;
      needed_by: string;
      departments: { name: string } | null;
    };
    return {
      key: "approvals",
      title: "Requisitions waiting on my approval",
      href: "/requisitions/approve",
      items: ((data as unknown as Row[] | null) ?? []).map((r) => ({
        id: r.id,
        label: r.req_no,
        detail: `${r.departments?.name ?? "Unknown department"} · needed by ${new Date(r.needed_by).toLocaleDateString("en-IN")}`,
      })),
    };
  }

  // 2. Goods dispatched to me and not received.
  async function loadReceive(): Promise<HomeSection | null> {
    if (!RECEIVER_ROLES.includes(session!.role)) return null;
    let query = admin
      .from("transfers")
      .select(
        "id, transfer_no, to_department_id, dispatched_at, from_department:from_department_id(name), to_department:to_department_id(name)",
      )
      .eq("status", "dispatched");
    if (session!.role === "hod") {
      const deptIds = session!.departments.map((d) => d.id);
      query =
        deptIds.length > 0
          ? query.in("to_department_id", deptIds)
          : query.eq(
              "to_department_id",
              "00000000-0000-0000-0000-000000000000",
            );
    } else if (session!.role !== "admin") {
      query = query.eq("branch_id", session!.branchId ?? "");
    }
    const { data } = await query.order("dispatched_at", { ascending: true });

    type Row = {
      id: string;
      transfer_no: string;
      dispatched_at: string;
      from_department: { name: string } | null;
      to_department: { name: string } | null;
    };
    return {
      key: "receive",
      title: "Goods dispatched to me, not yet received",
      href: "/send-receive/receive",
      items: ((data as unknown as Row[] | null) ?? []).map((t) => ({
        id: t.id,
        label: t.transfer_no,
        detail: `${t.from_department?.name ?? "?"} → ${t.to_department?.name ?? "?"} · dispatched ${new Date(t.dispatched_at).toLocaleDateString("en-IN")}`,
      })),
    };
  }

  // 3. Items below par in my departments (flavours only, matching Setup/Stock).
  async function loadBelowPar(): Promise<HomeSection | null> {
    if (!STOCK_ROLES.includes(session!.role)) return null;
    let deptQuery = admin
      .from("departments")
      .select("id, name")
      .eq("is_active", true)
      .eq("holds_mixed", true);
    if (session!.role === "hod") {
      const deptIds = session!.departments.map((d) => d.id);
      deptQuery =
        deptIds.length > 0
          ? deptQuery.in("id", deptIds)
          : deptQuery.eq("id", "00000000-0000-0000-0000-000000000000");
    } else if (session!.role !== "admin") {
      deptQuery = deptQuery.eq("branch_id", session!.branchId ?? "");
    }
    const { data: departments } = await deptQuery;
    const departmentIds = (departments ?? []).map((d) => d.id);
    const departmentNameById = new Map(
      (departments ?? []).map((d) => [d.id, d.name]),
    );

    const [{ data: balances }, { data: parLevels }] =
      departmentIds.length > 0
        ? await Promise.all([
            admin
              .from("stock_balances")
              .select("department_id, item_id, qty_g")
              .eq("item_type", "flavour")
              .in("department_id", departmentIds),
            admin
              .from("par_levels")
              .select("department_id, item_id, par_qty_g")
              .eq("item_type", "flavour")
              .in("department_id", departmentIds),
          ])
        : [{ data: [] }, { data: [] }];

    const balanceByKey = new Map(
      (balances ?? []).map((b) => [`${b.department_id}|${b.item_id}`, b.qty_g]),
    );
    const belowPar = (parLevels ?? []).filter(
      (p) =>
        (balanceByKey.get(`${p.department_id}|${p.item_id}`) ?? 0) <
        p.par_qty_g,
    );

    const flavourIds = [...new Set(belowPar.map((p) => p.item_id))];
    const { data: flavours } =
      flavourIds.length > 0
        ? await admin
            .from("flavours")
            .select("id, code, name")
            .in("id", flavourIds)
        : { data: [] };
    const flavourById = new Map((flavours ?? []).map((f) => [f.id, f]));

    return {
      key: "below-par",
      title: "Items below par in my departments",
      href: "/stock",
      items: belowPar.map((p) => {
        const flavour = flavourById.get(p.item_id);
        const currentG =
          balanceByKey.get(`${p.department_id}|${p.item_id}`) ?? 0;
        return {
          id: `${p.department_id}-${p.item_id}`,
          label: flavour
            ? `${flavour.name}${flavour.code ? ` (${flavour.code})` : ""}`
            : "Unknown item",
          detail: `${departmentNameById.get(p.department_id) ?? "Unknown department"} · have ${(currentG / 1000).toFixed(1)} kg of ${(p.par_qty_g / 1000).toFixed(1)} kg par`,
        };
      }),
    };
  }

  // 4. In-transit items ageing past 3 days.
  async function loadAgeingTransit(): Promise<HomeSection | null> {
    if (!TRANSIT_ROLES.includes(session!.role)) return null;
    let query = admin
      .from("transfers")
      .select(
        "id, transfer_no, dispatched_at, from_department:from_department_id(name), to_department:to_department_id(name)",
      )
      .eq("status", "dispatched");
    if (session!.role !== "admin") {
      query = query.eq("branch_id", session!.branchId ?? "");
    }
    const { data } = await query;

    type Row = {
      id: string;
      transfer_no: string;
      dispatched_at: string;
      from_department: { name: string } | null;
      to_department: { name: string } | null;
    };
    const now = Date.now();
    const ageing = ((data as unknown as Row[] | null) ?? [])
      .map((t) => ({
        ...t,
        ageDays: Math.floor(
          (now - new Date(t.dispatched_at).getTime()) / (24 * 60 * 60 * 1000),
        ),
      }))
      .filter((t) => t.ageDays > 3)
      .sort((a, b) => b.ageDays - a.ageDays);

    return {
      key: "ageing-transit",
      title: "In-transit items ageing past 3 days",
      href: "/send-receive/in-transit",
      items: ageing.map((t) => ({
        id: t.id,
        label: t.transfer_no,
        detail: `${t.from_department?.name ?? "?"} → ${t.to_department?.name ?? "?"} · ${t.ageDays} days`,
      })),
    };
  }

  // 5. Batches waiting to be rated.
  async function loadRateBatches(): Promise<HomeSection | null> {
    if (!RATER_ROLES.includes(session!.role)) return null;
    let query = admin
      .from("batches")
      .select("id, batch_no, mixed_at, flavours(name)")
      .eq("status", "confirmed")
      .is("rating", null);
    if (session!.role !== "admin") {
      query = query.eq("branch_id", session!.branchId ?? "");
    }
    const { data } = await query.order("mixed_at", { ascending: true });

    type Row = {
      id: string;
      batch_no: string;
      mixed_at: string | null;
      flavours: { name: string } | null;
    };
    return {
      key: "rate-batches",
      title: "Batches waiting to be rated",
      href: "/mix/past-batches",
      items: ((data as unknown as Row[] | null) ?? []).map((b) => ({
        id: b.id,
        label: b.batch_no,
        detail: `${b.flavours?.name ?? "Unknown flavour"}${b.mixed_at ? ` · mixed ${new Date(b.mixed_at).toLocaleDateString("en-IN")}` : ""}`,
      })),
    };
  }

  const sections = (
    await Promise.all([
      loadApprovals(),
      loadReceive(),
      loadBelowPar(),
      loadAgeingTransit(),
      loadRateBatches(),
    ])
  ).filter((s): s is HomeSection => s !== null);

  return <HomeView fullName={session.fullName} sections={sections} />;
}
