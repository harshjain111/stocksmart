import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { canAccessSetupTab } from "@/lib/setup-tabs";
import { MaterialsFlavoursTabs } from "@/components/setup/materials-flavours-tabs";

export default async function SetupMaterialsPage() {
  const session = await getSession();
  if (!session || !canAccessSetupTab(session.role, "/setup/materials")) {
    redirect("/setup");
  }

  const supabase = await createClient();
  const [
    { data: materials },
    { data: suppliers },
    { data: rates },
    { data: flavours },
  ] = await Promise.all([
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
    supabase
      .from("flavours")
      .select("id, code, name, current_version_id, is_active")
      .order("code"),
  ]);

  return (
    <MaterialsFlavoursTabs
      materials={materials ?? []}
      suppliers={suppliers ?? []}
      rates={rates ?? []}
      flavours={flavours ?? []}
    />
  );
}
