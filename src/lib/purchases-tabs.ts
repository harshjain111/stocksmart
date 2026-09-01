import type { UserRole } from "@/lib/auth/session";

export type PurchasesTab = {
  label: string;
  href: string;
  roles: UserRole[];
};

// "What to buy" isn't a tab — it's the Create PO flow, reached from the
// "+ Create PO" button, not the internal Purchases navigation.
export const PURCHASES_TABS: PurchasesTab[] = [
  {
    label: "Overview",
    href: "/purchases",
    roles: ["admin", "branch_manager", "purchase_manager"],
  },
  {
    label: "Purchase Orders",
    href: "/purchases/orders",
    roles: ["admin", "branch_manager", "purchase_manager"],
  },
  {
    label: "Goods Received",
    href: "/purchases/grn",
    roles: ["admin", "purchase_manager"],
  },
  {
    label: "Purchase History",
    href: "/purchases/history",
    roles: ["admin", "purchase_manager"],
  },
  {
    label: "Reports",
    href: "/purchases/reports",
    roles: ["admin", "purchase_manager"],
  },
  {
    label: "Supplier Performance",
    href: "/purchases/suppliers",
    roles: ["admin", "purchase_manager"],
  },
];

export function canAccessPurchasesTab(role: UserRole, href: string): boolean {
  const tab = PURCHASES_TABS.find((t) => t.href === href);
  return tab ? tab.roles.includes(role) : false;
}
