import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { InTransitView } from "@/components/send-receive/in-transit-view";
import { getInTransitTransfers } from "@/app/(app)/send-receive/in-transit/actions";

export default async function InTransitPage() {
  const session = await getSession();
  if (
    !session ||
    !["admin", "branch_manager", "store_manager"].includes(session.role)
  ) {
    redirect("/");
  }

  const result = await getInTransitTransfers();

  return <InTransitView transfers={result.success ? result.data : []} />;
}
