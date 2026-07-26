import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { RequisitionsApproveView } from "@/components/requisitions/requisitions-approve-view";
import { getRequisitionsToApprove } from "@/app/(app)/requisitions/approve/actions";

export default async function RequisitionsApprovePage() {
  const session = await getSession();
  if (
    !session ||
    !["admin", "branch_manager", "store_manager"].includes(session.role)
  ) {
    redirect("/");
  }

  const result = await getRequisitionsToApprove();

  return (
    <RequisitionsApproveView requisitions={result.success ? result.data : []} />
  );
}
