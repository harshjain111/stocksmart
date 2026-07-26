"use client";

import * as React from "react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusTag } from "@/components/shared/status-tag";
import { QtyInput } from "@/components/shared/qty-input";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import {
  DataTable,
  type DataTableColumn,
} from "@/components/shared/data-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Package } from "lucide-react";

type Row = { id: string; material: string; department: string; qty: number };

const rows: Row[] = [
  { id: "1", material: "Pan syrup", department: "Main Godown", qty: 12500 },
  {
    id: "2",
    material: "Kiwi concentrate",
    department: "Kolkata Store",
    qty: 3200,
  },
  { id: "3", material: "Mint extract", department: "Club Nexa", qty: 800 },
];

const columns: DataTableColumn<Row>[] = [
  { key: "material", header: "Material", render: (r) => r.material },
  { key: "department", header: "Department", render: (r) => r.department },
  {
    key: "qty",
    header: "Quantity",
    numeric: true,
    render: (r) => `${r.qty.toLocaleString("en-IN")} g`,
  },
];

/* Internal reference page — not part of app navigation. */
export default function StyleGuidePage() {
  const [qty, setQty] = React.useState<number | null>(1500);
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-10 p-8">
      <PageHeader
        title="Style guide"
        description="Palette and shared primitives — internal reference, not a product screen."
        action={<Button>Primary action</Button>}
      />

      <section className="grid gap-3">
        <h2 className="text-sm font-medium">Palette</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="bg-background grid gap-2 rounded-lg border p-4">
            <div className="h-10 rounded border bg-[oklch(0.975_0.006_85)]" />
            <p className="text-xs">Mineral paper</p>
          </div>
          <div className="grid gap-2 rounded-lg border p-4">
            <div className="bg-primary h-10 rounded" />
            <p className="text-xs">Bottle green (primary)</p>
          </div>
          <div className="grid gap-2 rounded-lg border p-4">
            <div className="bg-destructive h-10 rounded" />
            <p className="text-xs">Ember (alerts)</p>
          </div>
          <div className="grid gap-2 rounded-lg border p-4">
            <div className="bg-warning h-10 rounded" />
            <p className="text-xs">Gold (warnings)</p>
          </div>
        </div>
      </section>

      <section className="grid gap-3">
        <h2 className="text-sm font-medium">
          Type scale &amp; tabular figures
        </h2>
        <Card>
          <CardContent className="grid gap-2">
            <p className="text-3xl font-semibold">Requisition REQ-0001</p>
            <p className="text-lg">Pan Kiwi — 10,482 g requested</p>
            <p className="font-qty text-lg">10,482 g</p>
            <p className="text-muted-foreground text-sm">
              Tabular figures keep digits fixed-width in the line above.
            </p>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-3">
        <h2 className="text-sm font-medium">StatusTag</h2>
        <div className="flex flex-wrap gap-2">
          {[
            "draft",
            "submitted",
            "approved",
            "fulfilling",
            "closed",
            "rejected",
            "dispatched",
            "short_closed",
            "current",
            "archived",
          ].map((s) => (
            <StatusTag key={s} status={s} />
          ))}
        </div>
      </section>

      <section className="grid gap-3">
        <h2 className="text-sm font-medium">QtyInput</h2>
        <div className="max-w-xs">
          <QtyInput
            id="demo-qty"
            label="Output quantity"
            value={qty}
            onChange={setQty}
            required
          />
        </div>
      </section>

      <section className="grid gap-3">
        <h2 className="text-sm font-medium">DataTable (resize under 820px)</h2>
        <DataTable columns={columns} data={rows} getRowKey={(r) => r.id} />
      </section>

      <section className="grid gap-3">
        <h2 className="text-sm font-medium">EmptyState</h2>
        <EmptyState
          icon={Package}
          title="No requisitions yet"
          description="Raise a requisition to request raw materials or flavours for your department."
          actionLabel="New requisition"
          onAction={() => {}}
        />
      </section>

      <section className="grid gap-3">
        <h2 className="text-sm font-medium">ConfirmDialog</h2>
        <Card>
          <CardHeader>
            <CardTitle>Archive department</CardTitle>
          </CardHeader>
          <CardContent>
            <Button variant="destructive" onClick={() => setConfirmOpen(true)}>
              Archive Club Mirage
            </Button>
          </CardContent>
        </Card>
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title="Archive Club Mirage"
          description="This department will no longer accept new stock. This cannot be undone from the UI."
          confirmPhrase="Club Mirage"
          confirmLabel="Archive department"
          onConfirm={() => {}}
        />
      </section>
    </div>
  );
}
