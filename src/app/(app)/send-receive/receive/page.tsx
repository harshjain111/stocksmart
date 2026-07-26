import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { ReceiveView } from "@/components/send-receive/receive-view";
import { getInboundTransfers } from "@/app/(app)/send-receive/receive/actions";

export default async function ReceivePage() {
  const session = await getSession();
  if (
    !session ||
    !["admin", "branch_manager", "store_manager", "hod"].includes(session.role)
  ) {
    redirect("/");
  }

  const result = await getInboundTransfers();

  return <ReceiveView transfers={result.success ? result.data : []} />;
}
