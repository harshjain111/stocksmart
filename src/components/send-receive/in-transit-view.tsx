import { Truck } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { StatusTag } from "@/components/shared/status-tag";
import { cn } from "@/lib/utils";
import type { InTransitTransfer } from "@/app/(app)/send-receive/in-transit/actions";

const AGEING_THRESHOLD_DAYS = 3;

export function InTransitView({
  transfers,
}: {
  transfers: InTransitTransfer[];
}) {
  if (transfers.length === 0) {
    return (
      <div className="grid gap-6 p-6">
        <PageHeader
          title="In transit"
          description="Everything dispatched and not yet received."
        />
        <EmptyState
          icon={Truck}
          title="Nothing in transit"
          description="Dispatched transfers waiting to be received will show up here, grouped by route."
        />
      </div>
    );
  }

  const routes = new Map<string, InTransitTransfer[]>();
  for (const t of transfers) {
    const key = `${t.fromDepartmentName} → ${t.toDepartmentName}`;
    routes.set(key, [...(routes.get(key) ?? []), t]);
  }

  return (
    <div className="grid gap-6 p-6">
      <PageHeader
        title="In transit"
        description="Everything dispatched and not yet received, grouped by route — ageing past 3 days is flagged."
      />

      <div className="grid gap-6">
        {Array.from(routes.entries()).map(([route, routeTransfers]) => (
          <div key={route} className="grid gap-3">
            <h2 className="text-sm font-semibold tracking-tight">{route}</h2>
            <div className="grid gap-2">
              {routeTransfers.map((t) => {
                const ageing = t.ageDays > AGEING_THRESHOLD_DAYS;
                return (
                  <Card
                    key={t.id}
                    className={cn(ageing && "border-destructive/40")}
                  >
                    <CardContent className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="grid gap-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{t.transferNo}</span>
                          {t.requisitionReqNo && (
                            <span className="text-muted-foreground text-xs">
                              from {t.requisitionReqNo}
                            </span>
                          )}
                        </div>
                        <span className="text-muted-foreground text-xs">
                          {t.lineCount} item{t.lineCount === 1 ? "" : "s"}
                          {t.courier ? ` · ${t.courier}` : ""}
                          {t.docketNo ? ` · ${t.docketNo}` : ""}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          Dispatched{" "}
                          {new Date(t.dispatchedAt).toLocaleDateString(
                            "en-IN",
                            { dateStyle: "medium" },
                          )}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {ageing ? (
                          <StatusTag
                            status={`${t.ageDays} days`}
                            tone="destructive"
                          />
                        ) : (
                          <StatusTag
                            status={`${t.ageDays} day${t.ageDays === 1 ? "" : "s"}`}
                            tone="muted"
                          />
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
