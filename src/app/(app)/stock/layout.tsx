import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { visibleStockTabs } from "@/lib/stock-tabs";
import { StockNav } from "@/components/stock/stock-nav";
import { PageHeader } from "@/components/shared/page-header";

export default async function StockLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  // The section is open to anyone with at least one stock tab. Each page
  // then guards its own permission — this only decides whether the shell
  // exists at all, and is never the only check (§47).
  if (!session || visibleStockTabs(session.role).length === 0) {
    redirect("/");
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <PageHeader
        title="Stock"
        description="Track and manage stock across godowns, offices and clubs. Club stock is fetched from the Club app."
      />
      <StockNav />
      {children}
    </div>
  );
}
