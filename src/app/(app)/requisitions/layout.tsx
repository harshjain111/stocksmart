import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { RequisitionsTabs } from "@/components/requisitions/requisitions-tabs";

export default async function RequisitionsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (
    !session ||
    !["admin", "branch_manager", "store_manager", "hod"].includes(session.role)
  ) {
    redirect("/");
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="px-6 pt-6">
        <RequisitionsTabs />
      </div>
      {children}
    </div>
  );
}
