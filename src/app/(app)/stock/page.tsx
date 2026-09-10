import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { stockLandingHref } from "@/lib/stock-tabs";
import { getStockOverview } from "@/lib/stock/overview";
import { StockOverviewView } from "@/components/stock/stock-overview-view";

export default async function StockPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  // A gate man has no business on the overview, but he does have a stock
  // page — send him there rather than to a home screen he also cannot use
  // (§72). Enforced here on the server, not by hiding the link (§47).
  if (!can(session.role, "nav:stock")) {
    const landing = stockLandingHref(session.role);
    redirect(landing && landing !== "/stock" ? landing : "/");
  }

  const data = await getStockOverview(session);

  return <StockOverviewView data={data} />;
}
