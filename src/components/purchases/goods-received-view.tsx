import Link from "next/link";
import { FileText, Plus } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusTag } from "@/components/shared/status-tag";
import { buttonVariants } from "@/components/ui/button";

export type GrnRow = {
  id: string;
  grnNo: string;
  poNo: string;
  branchName: string;
  status: string;
  date: string | null;
  itemCount: number;
  transportCost: number | null;
  valueRupees: number;
};

function formatRupees(value: number): string {
  if (value >= 100000) return `₹${(value / 100000).toFixed(2)}L`;
  if (value >= 1000) return `₹${(value / 1000).toFixed(1)}K`;
  return `₹${Math.round(value)}`;
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function GoodsReceivedView({
  grns,
  isAdmin,
}: {
  grns: GrnRow[];
  isAdmin: boolean;
}) {
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Goods Received"
        description="Every GRN raised against a purchase order, across every branch you can see."
        action={
          <Link href="/send-receive/receive" className={buttonVariants({ size: "sm" })}>
            <Plus className="size-4" /> Create GRN
          </Link>
        }
      />

      {grns.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No goods received yet"
          description="Receive against a sent purchase order from Send & receive — it shows up here once posted."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40 border-b text-left text-xs">
                <th className="px-4 py-2.5 font-medium text-muted-foreground">GRN Number</th>
                <th className="px-4 py-2.5 font-medium text-muted-foreground">PO Number</th>
                <th className="px-4 py-2.5 font-medium text-muted-foreground">Date</th>
                {isAdmin && (
                  <th className="px-4 py-2.5 font-medium text-muted-foreground">Branch</th>
                )}
                <th className="px-4 py-2.5 font-medium text-muted-foreground">Items</th>
                <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">
                  Transport Cost
                </th>
                <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Value</th>
                <th className="px-4 py-2.5 font-medium text-muted-foreground">Status</th>
              </tr>
            </thead>
            <tbody>
              {grns.map((g) => (
                <tr key={g.id} className="border-b last:border-0">
                  <td className="px-4 py-2.5 font-medium">{g.grnNo}</td>
                  <td className="px-4 py-2.5">{g.poNo}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap">{fmtDate(g.date)}</td>
                  {isAdmin && <td className="px-4 py-2.5">{g.branchName}</td>}
                  <td className="px-4 py-2.5">{g.itemCount}</td>
                  <td className="font-qty px-4 py-2.5 text-right whitespace-nowrap">
                    {g.transportCost != null ? formatRupees(g.transportCost) : "—"}
                  </td>
                  <td className="font-qty px-4 py-2.5 text-right whitespace-nowrap">
                    {formatRupees(g.valueRupees)}
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusTag status={g.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
