import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { BarChart3 } from "lucide-react";

export type ReportsData = {
  monthlySpend: {
    label: string;
    spendRupees: number;
    transportRupees: number;
    onwardFreightRupees: number;
  }[];
  itemWise: { name: string; type: "raw" | "flavour"; qtyG: number; valueRupees: number }[];
  branchWise: { name: string; valueRupees: number }[];
};

function formatRupees(value: number): string {
  if (value >= 100000) return `₹${(value / 100000).toFixed(2)}L`;
  if (value >= 1000) return `₹${(value / 1000).toFixed(1)}K`;
  return `₹${Math.round(value)}`;
}

function formatKg(grams: number): string {
  return `${(grams / 1000).toFixed(0)} kg`;
}

export function ReportsView({ data }: { data: ReportsData }) {
  const { monthlySpend, itemWise, branchWise } = data;
  const hasAnyData = monthlySpend.some(
    (m) => m.spendRupees > 0 || m.transportRupees > 0 || m.onwardFreightRupees > 0,
  );
  const maxSpend = Math.max(...monthlySpend.map((m) => m.spendRupees), 1);

  const totalGoods = monthlySpend.reduce((s, m) => s + m.spendRupees, 0);
  const totalInbound = monthlySpend.reduce((s, m) => s + m.transportRupees, 0);
  const totalOnward = monthlySpend.reduce(
    (s, m) => s + m.onwardFreightRupees,
    0,
  );
  const totalLanded = totalGoods + totalInbound + totalOnward;

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Reports"
        description="Purchase spend, transportation cost and item/branch breakdowns for the last six months."
      />

      {!hasAnyData ? (
        <EmptyState
          icon={BarChart3}
          title="Nothing to report yet"
          description="Reports fill in once purchase orders are received through posted GRNs."
        />
      ) : (
        <>
          <div className="bg-card rounded-lg border p-4">
            <p className="mb-3 text-sm font-medium">
              Landed Cost (last six months)
            </p>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {[
                { label: "Goods", value: totalGoods },
                { label: "Inbound freight", value: totalInbound },
                { label: "Onward freight", value: totalOnward },
              ].map((cell) => (
                <div key={cell.label} className="bg-muted/40 rounded-md p-3">
                  <p className="font-qty text-lg leading-none">
                    {formatRupees(cell.value)}
                  </p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {cell.label}
                  </p>
                </div>
              ))}
              <div className="bg-primary/10 rounded-md p-3">
                <p className="font-qty text-primary text-lg leading-none">
                  {formatRupees(totalLanded)}
                </p>
                <p className="text-muted-foreground mt-1 text-xs">
                  Total landed cost
                </p>
              </div>
            </div>
            <p className="text-muted-foreground mt-3 text-xs">
              Onward freight is what it cost to move goods on from the
              receiving godown — counted once, never re-purchased.
            </p>
          </div>

          <div className="bg-card rounded-lg border p-4">
            <p className="mb-4 text-sm font-medium">Monthly Purchase Spend</p>
            <div className="flex items-end gap-4" style={{ height: 160 }}>
              {monthlySpend.map((m) => (
                <div key={m.label} className="flex flex-1 flex-col items-center gap-1.5">
                  <span className="font-qty text-xs">
                    {m.spendRupees > 0 ? formatRupees(m.spendRupees) : ""}
                  </span>
                  <div className="flex w-full flex-1 items-end">
                    <div
                      className="bg-primary w-full rounded-t-md transition-all"
                      style={{
                        height: `${Math.max(4, (m.spendRupees / maxSpend) * 100)}%`,
                      }}
                    />
                  </div>
                  <span className="text-muted-foreground text-xs">{m.label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="bg-card rounded-lg border">
              <div className="border-b p-4">
                <p className="text-sm font-medium">Item-wise Purchase</p>
              </div>
              {itemWise.length === 0 ? (
                <p className="text-muted-foreground p-4 text-sm">No purchases in this window.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-muted-foreground border-b text-left text-xs">
                      <th className="px-4 py-2 font-medium">Item</th>
                      <th className="px-4 py-2 font-medium">Type</th>
                      <th className="px-4 py-2 text-right font-medium">Quantity</th>
                      <th className="px-4 py-2 text-right font-medium">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {itemWise.map((item) => (
                      <tr key={item.name + item.type} className="border-b last:border-0">
                        <td className="px-4 py-2">{item.name}</td>
                        <td className="text-muted-foreground px-4 py-2 capitalize">
                          {item.type === "raw" ? "Raw Material" : "Flavour"}
                        </td>
                        <td className="font-qty px-4 py-2 text-right whitespace-nowrap">
                          {formatKg(item.qtyG)}
                        </td>
                        <td className="font-qty px-4 py-2 text-right whitespace-nowrap">
                          {formatRupees(item.valueRupees)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="bg-card rounded-lg border">
              <div className="border-b p-4">
                <p className="text-sm font-medium">Branch-wise Purchase</p>
              </div>
              {branchWise.length === 0 ? (
                <p className="text-muted-foreground p-4 text-sm">No purchases in this window.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-muted-foreground border-b text-left text-xs">
                      <th className="px-4 py-2 font-medium">Branch</th>
                      <th className="px-4 py-2 text-right font-medium">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {branchWise.map((b) => (
                      <tr key={b.name} className="border-b last:border-0">
                        <td className="px-4 py-2">{b.name}</td>
                        <td className="font-qty px-4 py-2 text-right whitespace-nowrap">
                          {formatRupees(b.valueRupees)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
