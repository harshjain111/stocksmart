import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { canAccessPurchasesTab } from "@/lib/purchases-tabs";
import { can } from "@/lib/auth/permissions";
import {
  getOrderFilterOptions,
  getOrders,
  getRawMaterialsWithLastRate,
} from "@/app/(app)/purchases/orders/actions";
import { OrdersView } from "@/components/purchases/orders-view";

export default async function OrdersPage() {
  const session = await getSession();
  if (!session || !canAccessPurchasesTab(session.role, "/purchases/orders")) {
    redirect("/");
  }

  const [filterOptions, orders, rawMaterials] = await Promise.all([
    getOrderFilterOptions(),
    getOrders({}),
    getRawMaterialsWithLastRate(),
  ]);

  return (
    <OrdersView
      suppliers={filterOptions.success ? filterOptions.data.suppliers : []}
      branches={filterOptions.success ? filterOptions.data.branches : []}
      rawMaterials={rawMaterials.success ? rawMaterials.data : []}
      initialOrders={orders.success ? orders.data : []}
      isAdmin={session.role === "admin"}
      canCreateOrders={can(session.role, "purchase:manage")}
    />
  );
}
