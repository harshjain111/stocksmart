import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatGrams } from "@/lib/units";
import { PrintButton } from "@/components/send-receive/print-button";

export default async function DispatchNotePage({
  params,
}: {
  params: Promise<{ transferId: string }>;
}) {
  const { transferId } = await params;
  const session = await getSession();
  if (
    !session ||
    !["admin", "branch_manager", "store_manager"].includes(session.role)
  ) {
    redirect("/");
  }

  const admin = createAdminClient();
  const { data: transfer } = await admin
    .from("transfers")
    .select(
      "id, transfer_no, status, branch_id, courier, docket_no, dispatched_at, from_department:from_department_id(name), to_department:to_department_id(name), branches(name)",
    )
    .eq("id", transferId)
    .single();
  if (!transfer) notFound();
  if (session.role !== "admin" && transfer.branch_id !== session.branchId) {
    redirect("/");
  }

  const fromDepartment = transfer.from_department as unknown as {
    name: string;
  } | null;
  const toDepartment = transfer.to_department as unknown as {
    name: string;
  } | null;
  const branch = transfer.branches as unknown as { name: string } | null;

  const { data: lines } = await admin
    .from("transfer_lines")
    .select("item_type, item_id, qty_g, dispatched_qty_g")
    .eq("transfer_id", transferId)
    .order("created_at", { ascending: true });

  const rawIds = (lines ?? [])
    .filter((l) => l.item_type === "raw")
    .map((l) => l.item_id);
  const flavourIds = (lines ?? [])
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

  return (
    <div className="mx-auto max-w-2xl p-8 print:p-0">
      <div className="mb-6 flex items-center justify-between print:hidden">
        <h1 className="text-lg font-semibold">Dispatch note</h1>
        <PrintButton />
      </div>

      <div className="grid gap-6 rounded-lg border p-8 print:border-none">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xl font-semibold">Smokzy Inventory</p>
            <p className="text-muted-foreground text-sm">{branch?.name}</p>
          </div>
          <div className="text-right">
            <p className="font-medium">{transfer.transfer_no}</p>
            <p className="text-muted-foreground text-sm">
              {transfer.dispatched_at
                ? new Date(transfer.dispatched_at).toLocaleDateString("en-IN", {
                    dateStyle: "medium",
                  })
                : "Not yet dispatched"}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6 border-t border-b py-4 text-sm">
          <div>
            <p className="text-muted-foreground">From</p>
            <p className="font-medium">{fromDepartment?.name}</p>
          </div>
          <div>
            <p className="text-muted-foreground">To</p>
            <p className="font-medium">{toDepartment?.name}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Courier / vehicle</p>
            <p className="font-medium">{transfer.courier ?? "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Docket number</p>
            <p className="font-medium">{transfer.docket_no ?? "—"}</p>
          </div>
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="py-2 text-left font-medium">Item</th>
              <th className="py-2 text-right font-medium">Quantity</th>
            </tr>
          </thead>
          <tbody>
            {(lines ?? []).map((line, i) => {
              const item = nameById.get(line.item_id);
              return (
                <tr key={i} className="border-b last:border-0">
                  <td className="py-2">
                    {item?.name ?? "Unknown item"}
                    {item?.code && (
                      <span className="text-muted-foreground">
                        {" "}
                        · {item.code}
                      </span>
                    )}
                  </td>
                  <td className="py-2 text-right">
                    {formatGrams(line.dispatched_qty_g ?? line.qty_g)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
