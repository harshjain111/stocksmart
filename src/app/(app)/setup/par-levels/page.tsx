import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { canAccessSetupTab } from "@/lib/setup-tabs";
import { ParLevelsView } from "@/components/setup/par-levels-view";

export default async function ParLevelsPage() {
  const session = await getSession();
  if (!session || !canAccessSetupTab(session.role, "/setup/par-levels")) {
    redirect("/setup");
  }

  const admin = createAdminClient();

  const [
    { data: departments },
    { data: rawMaterials },
    { data: flavours },
    { data: balances },
    { data: parLevels },
  ] = await Promise.all([
    admin
      .from("departments")
      .select("id, name, holds_raw, holds_mixed, branches(name)")
      .eq("is_active", true)
      .order("name"),
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
    admin
      .from("stock_balances")
      .select("department_id, item_type, item_id, qty_g"),
    admin
      .from("par_levels")
      .select("department_id, item_type, item_id, par_qty_g"),
  ]);

  return (
    <ParLevelsView
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
      balances={balances ?? []}
      parLevels={parLevels ?? []}
    />
  );
}
