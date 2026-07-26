import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { canAccessBuyTab } from "@/lib/buy-tabs";
import { can } from "@/lib/auth/permissions";
import {
  getOrderFilterOptions,
  getOrders,
  getRawMaterialsWithLastRate,
} from "@/app/(app)/buy/orders/actions";
import { OrdersView } from "@/components/buy/orders-view";

export default async function OrdersPage() {
  const session = await getSession();
  if (!session || !canAccessBuyTab(session.role, "/buy/orders")) {
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
