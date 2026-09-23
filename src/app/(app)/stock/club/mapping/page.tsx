import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { getClubFlavourMapping } from "@/app/(app)/stock/club/mapping/actions";
import { ClubFlavourMappingView } from "@/components/stock/club-flavour-mapping-view";

export default async function ClubFlavourMappingPage() {
  const session = await getSession();
  if (!session || !can(session.role, "stock:club")) {
    redirect("/");
  }

  const data = await getClubFlavourMapping();

  return <ClubFlavourMappingView data={data} />;
}
