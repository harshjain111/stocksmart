import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { RequisitionsAllView } from "@/components/requisitions/requisitions-all-view";
import {
  getAllRequisitions,
  getBranchesAndDepartments,
} from "@/app/(app)/requisitions/all/actions";

export default async function RequisitionsAllPage() {
  const session = await getSession();
  if (
    !session ||
    !["admin", "branch_manager", "store_manager"].includes(session.role)
  ) {
    redirect("/");
  }

  const [requisitionsResult, scopeResult] = await Promise.all([
    getAllRequisitions({}),
    getBranchesAndDepartments(),
  ]);

  return (
    <RequisitionsAllView
      requisitions={requisitionsResult.success ? requisitionsResult.data : []}
      branches={scopeResult.success ? scopeResult.data.branches : []}
      departments={scopeResult.success ? scopeResult.data.departments : []}
      isAdmin={session.role === "admin"}
    />
  );
}
