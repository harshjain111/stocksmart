import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { getParties, getPartyLocations } from "@/app/(app)/stock/party/actions";
import { PartyStockView } from "@/components/stock/party-stock-view";

export default async function PartyStockPage() {
  const session = await getSession();
  if (!session || !can(session.role, "stock:party")) {
    redirect("/");
  }

  const [parties, locations] = await Promise.all([
    getParties(),
    getPartyLocations(),
  ]);

  const assigned = session.departments.find((d) =>
    locations.some((l) => l.id === d.id),
  );

  return (
    <PartyStockView
      parties={parties}
      locations={locations}
      defaultLocationId={assigned?.id ?? locations[0]?.id ?? null}
      // The gate man sees the parties and the two buttons he needs, with
      // no search chrome or cross-location browsing around them (§25).
      minimal={session.role === "gate_man"}
    />
  );
}
