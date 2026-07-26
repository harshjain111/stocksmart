import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { canAccessSetupTab } from "@/lib/setup-tabs";
import { SuppliersView } from "@/components/setup/suppliers-view";

export default async function SetupSuppliersPage() {
  const session = await getSession();
  if (!session || !canAccessSetupTab(session.role, "/setup/suppliers")) {
    redirect("/setup");
  }

  const supabase = await createClient();
  const { data: suppliers } = await supabase
    .from("suppliers")
    .select("id, name, area, contact_person, phone, gstin, notes, is_active")
    .order("name");

  return <SuppliersView suppliers={suppliers ?? []} />;
}
