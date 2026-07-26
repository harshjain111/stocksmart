import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { canAccessBuyTab } from "@/lib/buy-tabs";
import { can } from "@/lib/auth/permissions";
import { getBuyFormOptions } from "@/app/(app)/buy/actions";
import { WhatToBuyView } from "@/components/buy/what-to-buy-view";

export default async function WhatToBuyPage() {
  const session = await getSession();
  if (!session || !canAccessBuyTab(session.role, "/buy")) {
    redirect("/");
  }

  const options = await getBuyFormOptions();

  return (
    <WhatToBuyView
      branches={options.success ? options.data.branches : []}
      rawMaterials={options.success ? options.data.rawMaterials : []}
      flavours={options.success ? options.data.flavours : []}
      suppliers={options.success ? options.data.suppliers : []}
      canCreateOrders={can(session.role, "purchase:manage")}
    />
  );
}
