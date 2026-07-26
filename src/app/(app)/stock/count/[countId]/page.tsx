import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { canAccessStockTab } from "@/lib/stock-tabs";
import { PageHeader } from "@/components/shared/page-header";
import { StatusTag } from "@/components/shared/status-tag";
import { buttonVariants } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { formatGrams } from "@/lib/units";

export default async function CountDetailPage({
  params,
}: {
  params: Promise<{ countId: string }>;
}) {
  const { countId } = await params;

  const session = await getSession();
  if (!session || !canAccessStockTab(session.role, "/stock/count")) {
    redirect("/stock");
  }

  const admin = createAdminClient();

  const { data: count } = await admin
    .from("stock_counts")
    .select(
      "id, count_no, status, branch_id, approved_at, departments(id, name, branches(name))",
    )
    .eq("id", countId)
    .single();
  if (!count) notFound();

  if (session.role !== "admin") {
    const inBranch = count.branch_id === session.branchId;
    const inDept =
      session.role === "hod"
        ? session.departments.some(
            (d) =>
              d.id ===
              (count.departments as unknown as { id: string } | null)?.id,
          )
        : inBranch;
    if (!inBranch || (session.role === "hod" && !inDept)) notFound();
  }

  const { data: lines } = await admin
    .from("stock_count_lines")
    .select("item_type, item_id, system_qty_g, counted_qty_g, reason")
    .eq("count_id", countId)
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

  const department = count.departments as unknown as {
    name: string;
    branches: { name: string } | null;
  } | null;

  return (
    <div className="grid gap-6 p-6">
      <PageHeader
        title={count.count_no}
        description={`${department?.name ?? "Unknown department"} (${department?.branches?.name ?? ""})`}
        action={
          <Link
            href="/stock/variance"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <ArrowLeft /> Back to variance report
          </Link>
        }
      />

      <div className="flex items-center gap-2">
        <StatusTag status={count.status} />
        {count.approved_at && (
          <span className="text-muted-foreground text-sm">
            Approved{" "}
            {new Date(count.approved_at).toLocaleDateString("en-IN", {
              dateStyle: "medium",
            })}
          </span>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="text-muted-foreground px-3 py-2 text-left font-medium">
                Item
              </th>
              <th className="text-muted-foreground px-3 py-2 text-right font-medium">
                System
              </th>
              <th className="text-muted-foreground px-3 py-2 text-right font-medium">
                Counted
              </th>
              <th className="text-muted-foreground px-3 py-2 text-right font-medium">
                Difference
              </th>
              <th className="text-muted-foreground px-3 py-2 text-left font-medium">
                Reason
              </th>
            </tr>
          </thead>
          <tbody>
            {(lines ?? []).map((line, i) => {
              const item = nameById.get(line.item_id);
              const diffG =
                line.counted_qty_g != null
                  ? line.counted_qty_g - line.system_qty_g
                  : null;
              return (
                <tr key={i} className="border-b last:border-0">
                  <td className="px-3 py-2 whitespace-nowrap">
                    {item?.name ?? "Unknown item"}
                    {item?.code && (
                      <span className="text-muted-foreground">
                        {" "}
                        · {item.code}
                      </span>
                    )}
                  </td>
                  <td className="font-qty px-3 py-2 text-right whitespace-nowrap">
                    {formatGrams(line.system_qty_g)}
                  </td>
                  <td className="font-qty px-3 py-2 text-right whitespace-nowrap">
                    {line.counted_qty_g != null
                      ? formatGrams(line.counted_qty_g)
                      : "—"}
                  </td>
                  <td className="font-qty px-3 py-2 text-right whitespace-nowrap">
                    {diffG == null
                      ? "—"
                      : `${diffG > 0 ? "+" : ""}${formatGrams(diffG)}`}
                  </td>
                  <td className="px-3 py-2">{line.reason ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
