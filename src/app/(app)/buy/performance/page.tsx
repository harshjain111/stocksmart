import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { canAccessBuyTab } from "@/lib/buy-tabs";
import { getSupplierPerformance } from "@/app/(app)/buy/performance/actions";
import { SupplierPerformanceView } from "@/components/buy/supplier-performance-view";

export default async function SupplierPerformancePage() {
  const session = await getSession();
  if (!session || !canAccessBuyTab(session.role, "/buy/performance")) {
    redirect("/");
  }

  const result = await getSupplierPerformance();

  return (
    <SupplierPerformanceView
      suppliers={result.success ? result.data.suppliers : []}
      onTimeDays={result.success ? result.data.onTimeDays : 7}
    />
  );
}
