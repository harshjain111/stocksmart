import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { getBuyFormOptions } from "@/app/(app)/purchases/actions";
import { CreatePoView } from "@/components/purchases/create-po-view";

export default async function CreatePoPage() {
  const session = await getSession();
  if (!session || !can(session.role, "purchase:manage")) {
    redirect("/purchases");
  }

  const options = await getBuyFormOptions();

  return (
    <CreatePoView
      branches={options.success ? options.data.branches : []}
      rawMaterials={options.success ? options.data.rawMaterials : []}
      flavours={options.success ? options.data.flavours : []}
      suppliers={options.success ? options.data.suppliers : []}
      canCreateOrders={can(session.role, "purchase:manage")}
    />
  );
}
