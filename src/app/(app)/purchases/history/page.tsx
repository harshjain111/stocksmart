import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { canAccessPurchasesTab } from "@/lib/purchases-tabs";
import {
  getHistoryFilterOptions,
  getPurchaseHistory,
} from "@/app/(app)/purchases/history/actions";
import { PurchaseHistoryView } from "@/components/purchases/purchase-history-view";

export default async function PurchaseHistoryPage() {
  const session = await getSession();
  if (!session || !canAccessPurchasesTab(session.role, "/purchases/history")) {
    redirect("/");
  }

  const [options, history] = await Promise.all([
    getHistoryFilterOptions(),
    getPurchaseHistory({}),
  ]);

  return (
    <PurchaseHistoryView
      suppliers={options.success ? options.data.suppliers : []}
      rawMaterials={options.success ? options.data.rawMaterials : []}
      initialData={
        history.success
          ? history.data
          : { bySupplier: [], byMaterial: [], records: [] }
      }
    />
  );
}
