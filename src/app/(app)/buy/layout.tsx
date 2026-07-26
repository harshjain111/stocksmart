import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { BuyTabs } from "@/components/buy/buy-tabs";

export default async function BuyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session || !can(session.role, "nav:buy")) {
    redirect("/");
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="px-6 pt-6">
        <BuyTabs />
      </div>
      {children}
    </div>
  );
}
