import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { getUpdatableLocations } from "@/app/(app)/stock/update/actions";
import { UpdateStockView } from "@/components/stock/update-stock-view";

export default async function UpdateStockPage() {
  const session = await getSession();
  if (!session || !can(session.role, "stock:update")) {
    redirect("/");
  }

  const locations = await getUpdatableLocations();

  // Someone who only looks after one location should never have to pick it
  // (§13). Their own assigned department wins over the first alphabetically.
  const assigned = session.departments.find((d) =>
    locations.some((l) => l.id === d.id),
  );

  return (
    <UpdateStockView
      locations={locations}
      defaultLocationId={assigned?.id ?? locations[0]?.id ?? null}
    />
  );
}
