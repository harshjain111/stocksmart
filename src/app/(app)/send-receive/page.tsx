import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { SendOutView } from "@/components/send-receive/send-out-view";
import {
  getDraftTransfers,
  getSendOutDepartments,
} from "@/app/(app)/send-receive/actions";

export default async function SendOutPage() {
  const session = await getSession();
  if (
    !session ||
    !["admin", "branch_manager", "store_manager"].includes(session.role)
  ) {
    redirect("/");
  }

  const [transfersResult, departmentsResult] = await Promise.all([
    getDraftTransfers(),
    getSendOutDepartments(),
  ]);

  return (
    <SendOutView
      transfers={transfersResult.success ? transfersResult.data : []}
      departments={departmentsResult.success ? departmentsResult.data : []}
    />
  );
}
