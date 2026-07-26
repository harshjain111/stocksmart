import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { canAccessSendReceiveTab } from "@/lib/send-receive-tabs";
import { TransitVarianceView } from "@/components/send-receive/transit-variance-view";
import { weekKeyIst, weekLabelIst } from "@/lib/week";

type GrnRow = {
  id: string;
  grn_no: string;
  transfer_id: string;
  posted_at: string;
};

type TransferRow = {
  id: string;
  transfer_no: string;
  dispatched_at: string;
  from_department: { name: string } | null;
  to_department: { name: string } | null;
};

type GrnLineRow = {
  grn_id: string;
  item_type: "raw" | "flavour";
  item_id: string;
  expected_qty_g: number;
  received_qty_g: number | null;
  damaged_qty_g: number | null;
};

export default async function TransitVariancePage() {
  const session = await getSession();
  if (
    !session ||
    !canAccessSendReceiveTab(session.role, "/send-receive/variance")
  ) {
    redirect("/send-receive");
  }

  const admin = createAdminClient();

  let grnsQuery = admin
    .from("grns")
    .select("id, grn_no, transfer_id, branch_id, posted_at")
    .eq("source", "internal")
    .eq("status", "posted");
  if (session.role !== "admin" && session.branchId) {
    grnsQuery = grnsQuery.eq("branch_id", session.branchId);
  }
  const { data: grns } =
    await grnsQuery.returns<(GrnRow & { branch_id: string })[]>();

  const transferIds = (grns ?? []).map((g) => g.transfer_id);
  const { data: transfers } =
    transferIds.length > 0
      ? await admin
          .from("transfers")
          .select(
            "id, transfer_no, dispatched_at, from_department:from_department_id(name), to_department:to_department_id(name)",
          )
          .in("id", transferIds)
          .returns<TransferRow[]>()
      : { data: [] };

  const grnIds = (grns ?? []).map((g) => g.id);
  const { data: grnLines } =
    grnIds.length > 0
      ? await admin
          .from("grn_lines")
          .select(
            "grn_id, item_type, item_id, expected_qty_g, received_qty_g, damaged_qty_g",
          )
          .in("grn_id", grnIds)
          .returns<GrnLineRow[]>()
      : { data: [] };

  const rawIds = (grnLines ?? [])
    .filter((l) => l.item_type === "raw")
    .map((l) => l.item_id);
  const flavourIds = (grnLines ?? [])
    .filter((l) => l.item_type === "flavour")
    .map((l) => l.item_id);
  const [{ data: rawMaterials }, { data: flavours }] = await Promise.all([
    rawIds.length > 0
      ? admin.from("raw_materials").select("id, code, name").in("id", rawIds)
      : Promise.resolve({ data: [] }),
    flavourIds.length > 0
      ? admin.from("flavours").select("id, code, name").in("id", flavourIds)
      : Promise.resolve({ data: [] }),
  ]);
  const nameById = new Map(
    [...(rawMaterials ?? []), ...(flavours ?? [])].map((m) => [
      m.id,
      { name: m.name, code: m.code },
    ]),
  );

  const grnById = new Map((grns ?? []).map((g) => [g.id, g]));
  const transferById = new Map((transfers ?? []).map((t) => [t.id, t]));

  const detail = (grnLines ?? [])
    .map((l) => {
      const grn = grnById.get(l.grn_id);
      const transfer = grn ? transferById.get(grn.transfer_id) : undefined;
      const item = nameById.get(l.item_id);
      const arrivedG = (l.received_qty_g ?? 0) + (l.damaged_qty_g ?? 0);
      return {
        grnId: l.grn_id,
        grnNo: grn?.grn_no ?? "Unknown",
        transferId: grn?.transfer_id ?? "",
        transferNo: transfer?.transfer_no ?? "Unknown",
        fromDepartmentName: transfer?.from_department?.name ?? "Unknown",
        toDepartmentName: transfer?.to_department?.name ?? "Unknown",
        dispatchedAt: transfer?.dispatched_at ?? null,
        itemName: item?.name ?? "Unknown item",
        itemCode: item?.code ?? null,
        dispatchedQtyG: l.expected_qty_g,
        receivedQtyG: arrivedG,
        varianceG: l.expected_qty_g - arrivedG,
      };
    })
    .filter((d) => d.varianceG !== 0);

  function aggregate(keyFn: (row: (typeof detail)[number]) => string) {
    const groups = new Map<string, number>();
    for (const row of detail) {
      groups.set(keyFn(row), (groups.get(keyFn(row)) ?? 0) + row.varianceG);
    }
    return groups;
  }

  const byRoute = [
    ...aggregate(
      (r) => `${r.fromDepartmentName} → ${r.toDepartmentName}`,
    ).entries(),
  ]
    .map(([route, varianceG]) => ({ route, varianceG }))
    .sort((a, b) => Math.abs(b.varianceG) - Math.abs(a.varianceG));

  const byItem = [
    ...aggregate((r) => `${r.itemName}|${r.itemCode ?? ""}`).entries(),
  ]
    .map(([key, varianceG]) => {
      const [name, code] = key.split("|");
      return { name, code: code || null, varianceG };
    })
    .sort((a, b) => Math.abs(b.varianceG) - Math.abs(a.varianceG));

  const byWeekGroups = aggregate((r) =>
    r.dispatchedAt ? weekKeyIst(r.dispatchedAt) : "unknown",
  );
  const byPeriod = [...byWeekGroups.entries()]
    .map(([key, varianceG]) => ({
      key,
      label:
        key === "unknown"
          ? "Unknown"
          : weekLabelIst(
              detail.find(
                (r) => r.dispatchedAt && weekKeyIst(r.dispatchedAt) === key,
              )!.dispatchedAt!,
            ),
      varianceG,
    }))
    .sort((a, b) => b.key.localeCompare(a.key));

  return (
    <TransitVarianceView
      byRoute={byRoute}
      byItem={byItem}
      byPeriod={byPeriod}
      detail={detail}
    />
  );
}
