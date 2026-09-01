import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { canAccessPurchasesTab } from "@/lib/purchases-tabs";
import { getSupplierPerformance } from "@/app/(app)/purchases/suppliers/actions";
import { SupplierPerformanceView } from "@/components/purchases/supplier-performance-view";

export default async function SupplierPerformancePage() {
  const session = await getSession();
  if (!session || !canAccessPurchasesTab(session.role, "/purchases/suppliers")) {
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
