import type { UserRole } from "@/lib/auth/session";

export type BuyTab = {
  label: string;
  href: string;
  roles: UserRole[];
};

export const BUY_TABS: BuyTab[] = [
  {
    label: "What to buy",
    href: "/buy",
    roles: ["admin", "branch_manager", "purchase_manager"],
  },
  {
    label: "Orders",
    href: "/buy/orders",
    roles: ["admin", "branch_manager", "purchase_manager"],
  },
];

export function canAccessBuyTab(role: UserRole, href: string): boolean {
  const tab = BUY_TABS.find((t) => t.href === href);
  return tab ? tab.roles.includes(role) : false;
}
