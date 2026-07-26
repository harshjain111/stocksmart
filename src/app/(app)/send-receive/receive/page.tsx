import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { ReceiveView } from "@/components/send-receive/receive-view";
import {
  getInboundTransfers,
  getInboundOrders,
} from "@/app/(app)/send-receive/receive/actions";

export default async function ReceivePage() {
  const session = await getSession();
  if (
    !session ||
    ![
      "admin",
      "branch_manager",
      "store_manager",
      "purchase_manager",
      "hod",
    ].includes(session.role)
  ) {
    redirect("/");
  }

  const [transfersResult, ordersResult] = await Promise.all([
    getInboundTransfers(),
    getInboundOrders(),
  ]);

  return (
    <ReceiveView
      transfers={transfersResult.success ? transfersResult.data : []}
      orders={ordersResult.success ? ordersResult.data : []}
    />
  );
}
