import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { RequisitionsMineView } from "@/components/requisitions/requisitions-mine-view";
import { getMyRequisitions } from "@/app/(app)/requisitions/actions";

export default async function RequisitionsMinePage() {
  const session = await getSession();
  if (!session || !["admin", "hod"].includes(session.role)) {
    redirect("/");
  }

  const result = await getMyRequisitions();

  return (
    <RequisitionsMineView
      departments={session.departments}
      requisitions={result.success ? result.data : []}
    />
  );
}
