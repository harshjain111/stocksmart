import type { UserRole } from "@/lib/auth/session";

export type StockTab = {
  label: string;
  href: string;
  roles: UserRole[];
};

export const STOCK_TABS: StockTab[] = [
  {
    label: "What we have",
    href: "/stock",
    roles: ["admin", "branch_manager", "store_manager", "hod"],
  },
  {
    label: "Opening stock",
    href: "/stock/opening",
    roles: ["admin", "store_manager"],
  },
  {
    label: "Count stock",
    href: "/stock/count",
    roles: ["admin", "branch_manager", "store_manager", "hod"],
  },
];

export function canAccessStockTab(role: UserRole, href: string): boolean {
  const tab = STOCK_TABS.find((t) => t.href === href);
  return tab ? tab.roles.includes(role) : false;
}
