import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { getClubStock } from "@/app/(app)/stock/club/actions";
import { ClubStockView } from "@/components/stock/club-stock-view";

export default async function ClubStockPage() {
  const session = await getSession();
  if (!session || !can(session.role, "stock:club")) {
    redirect("/");
  }

  const data = await getClubStock();

  return (
    // useSearchParams (the ?status= deep link from the Overview alerts)
    // needs a Suspense boundary to prerender.
    <Suspense fallback={null}>
      <ClubStockView data={data} />
    </Suspense>
  );
}
