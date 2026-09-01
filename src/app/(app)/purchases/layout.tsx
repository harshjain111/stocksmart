import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { PurchasesNav, CreatePoButton } from "@/components/purchases/purchases-nav";
import { PageHeader } from "@/components/shared/page-header";

export default async function PurchasesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session || !can(session.role, "nav:purchases")) {
    redirect("/");
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <PageHeader
        title="Purchases"
        description="Manage purchase orders, goods received and supplier performance."
        action={can(session.role, "purchase:manage") && <CreatePoButton />}
      />
      <PurchasesNav />
      {children}
    </div>
  );
}
