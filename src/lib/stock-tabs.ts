import type { UserRole } from "@/lib/auth/session";
import { can, type Permission } from "@/lib/auth/permissions";

export type StockTab = {
  label: string;
  href: string;
  permission: Permission;
};

// Ordered as the spec's information architecture (§5, §74): the daily work
// first, then reconciliation, then the read-only external view, and
// Opening Stock deliberately last because it is one-time setup rather than
// anything anyone does twice.
export const STOCK_TABS: StockTab[] = [
  { label: "Overview", href: "/stock", permission: "nav:stock" },
  { label: "Update Stock", href: "/stock/update", permission: "stock:update" },
  { label: "Party Stock", href: "/stock/party", permission: "stock:party" },
  {
    label: "Count & Variance",
    href: "/stock/count",
    permission: "stock:count",
  },
  { label: "Club Stock", href: "/stock/club", permission: "stock:club" },
  { label: "Opening Stock", href: "/stock/opening", permission: "stock:opening" },
];

export function canAccessStockTab(role: UserRole, href: string): boolean {
  const tab = STOCK_TABS.find((t) => t.href === href);
  return tab ? can(role, tab.permission) : false;
}

export function visibleStockTabs(role: UserRole): StockTab[] {
  return STOCK_TABS.filter((tab) => can(role, tab.permission));
}

/**
 * Where to send someone who lands on /stock without permission to see the
 * Overview. A gate man has exactly one stock page, and bouncing him to the
 * home screen he also cannot use would be a dead end (§72).
 */
export function stockLandingHref(role: UserRole): string | null {
  const tabs = visibleStockTabs(role);
  return tabs[0]?.href ?? null;
}
