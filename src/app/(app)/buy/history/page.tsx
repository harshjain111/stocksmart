import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { canAccessBuyTab } from "@/lib/buy-tabs";
import {
  getHistoryFilterOptions,
  getPurchaseHistory,
} from "@/app/(app)/buy/history/actions";
import { PurchaseHistoryView } from "@/components/buy/purchase-history-view";

export default async function PurchaseHistoryPage() {
  const session = await getSession();
  if (!session || !canAccessBuyTab(session.role, "/buy/history")) {
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
