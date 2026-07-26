import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { canAccessSetupTab } from "@/lib/setup-tabs";
import { MaterialsView } from "@/components/setup/materials-view";

export default async function SetupMaterialsPage() {
  const session = await getSession();
  if (!session || !canAccessSetupTab(session.role, "/setup/materials")) {
    redirect("/setup");
  }

  const supabase = await createClient();
  const [{ data: materials }, { data: suppliers }, { data: rates }] =
    await Promise.all([
      supabase
        .from("raw_materials")
        .select("id, code, name, default_supplier_id, is_active")
        .order("code"),
      supabase
        .from("suppliers")
        .select("id, name")
        .eq("is_active", true)
        .order("name"),
      supabase
        .from("supplier_rates")
        .select("id, raw_material_id, supplier_id, rate, source, created_at")
        .order("created_at", { ascending: false }),
    ]);

  return (
    <MaterialsView
      materials={materials ?? []}
      suppliers={suppliers ?? []}
      rates={rates ?? []}
    />
  );
}
