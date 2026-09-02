import Link from "next/link";
import { FileText, Plus } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusTag } from "@/components/shared/status-tag";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
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
  const columns: DataTableColumn<GrnRow>[] = [
    {
      key: "grnNo",
      header: "GRN Number",
      cardRole: "title",
      render: (g) => <span className="font-medium">{g.grnNo}</span>,
    },
    {
      key: "status",
      header: "Status",
      cardRole: "badge",
      render: (g) => <StatusTag status={g.status} />,
    },
    { key: "poNo", header: "PO Number", render: (g) => g.poNo },
    {
      key: "date",
      header: "Date",
      className: "whitespace-nowrap",
      render: (g) => fmtDate(g.date),
    },
    ...(isAdmin
      ? [
          {
            key: "branch",
            header: "Branch",
            render: (g: GrnRow) => g.branchName,
          },
        ]
      : []),
    { key: "items", header: "Items", render: (g) => g.itemCount },
    {
      key: "transport",
      header: "Transport Cost",
      numeric: true,
      className: "whitespace-nowrap",
      render: (g) =>
        g.transportCost != null ? formatRupees(g.transportCost) : "—",
    },
    {
      key: "value",
      header: "Value",
      numeric: true,
      className: "whitespace-nowrap",
      render: (g) => formatRupees(g.valueRupees),
    },
  ];

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

      <DataTable
        columns={columns}
        data={grns}
        getRowKey={(g) => g.id}
        emptyState={
          <EmptyState
            icon={FileText}
            title="No goods received yet"
            description="Receive against a sent purchase order from Send & receive — it shows up here once posted."
          />
        }
      />
    </div>
  );
}
