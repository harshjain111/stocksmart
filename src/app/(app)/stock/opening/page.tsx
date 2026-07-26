import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { canAccessStockTab } from "@/lib/stock-tabs";
import { OpeningStockView } from "@/components/stock/opening-stock-view";

export default async function OpeningStockPage() {
  const session = await getSession();
  if (!session || !canAccessStockTab(session.role, "/stock/opening")) {
    redirect("/stock");
  }

  const admin = createAdminClient();

  let departmentsQuery = admin
    .from("departments")
    .select("id, name, holds_raw, holds_mixed, branches(name)")
    .eq("is_active", true);
  if (session.role !== "admin" && session.branchId) {
    departmentsQuery = departmentsQuery.eq("branch_id", session.branchId);
  }

  const [{ data: departments }, { data: rawMaterials }, { data: flavours }] =
    await Promise.all([
      departmentsQuery.order("name"),
      admin
        .from("raw_materials")
        .select("id, code, name")
        .eq("is_active", true)
        .order("name"),
      admin
        .from("flavours")
        .select("id, code, name")
        .eq("is_active", true)
        .order("name"),
    ]);

  return (
    <OpeningStockView
      departments={(departments ?? []).map((d) => ({
        id: d.id,
        name: d.name,
        branchName:
          (d.branches as unknown as { name: string } | null)?.name ?? "",
        holdsRaw: d.holds_raw,
        holdsMixed: d.holds_mixed,
      }))}
      rawMaterials={rawMaterials ?? []}
      flavours={flavours ?? []}
      isAdmin={session.role === "admin"}
    />
  );
}
