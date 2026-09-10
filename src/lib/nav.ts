import {
  ArrowLeftRight,
  BookOpen,
  ClipboardList,
  FlaskConical,
  Home,
  Package,
  PartyPopper,
  Settings,
  ShoppingCart,
  type LucideIcon,
} from "lucide-react";
import type { UserRole } from "@/lib/auth/session";
import { can, type Permission } from "@/lib/auth/permissions";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  permission: Permission;
};

export const NAV_ITEMS: NavItem[] = [
  { label: "Home", href: "/", icon: Home, permission: "nav:home" },
  {
    label: "Requisitions",
    href: "/requisitions",
    icon: ClipboardList,
    permission: "nav:requisitions",
  },
  {
    label: "Send & receive",
    href: "/send-receive",
    icon: ArrowLeftRight,
    permission: "nav:send-receive",
  },
  {
    label: "Purchases",
    href: "/purchases",
    icon: ShoppingCart,
    permission: "nav:purchases",
  },
  {
    label: "Mix",
    href: "/mix",
    icon: FlaskConical,
    permission: "nav:mix",
  },
  {
    label: "Stock",
    href: "/stock",
    icon: Package,
    permission: "nav:stock",
  },
  // The gate man's only screen. It is its own top-level entry rather than
  // living under Stock because he has no access to the Stock section at
  // all — a "Stock" link that opened straight into one sub-page would
  // misrepresent what he can reach (§25, §46).
  {
    label: "Party Stock",
    href: "/stock/party",
    icon: PartyPopper,
    permission: "stock:party",
  },
  {
    label: "Recipes",
    href: "/recipes",
    icon: BookOpen,
    permission: "nav:recipes",
  },
  {
    label: "Setup",
    href: "/setup",
    icon: Settings,
    permission: "nav:setup",
  },
];

export function getVisibleNavItems(role: UserRole): NavItem[] {
  const items = NAV_ITEMS.filter((item) => can(role, item.permission));
  // Anyone who can open the Stock section reaches Party Stock through its
  // internal tabs, so the standalone entry would be a duplicate for them.
  return can(role, "nav:stock")
    ? items.filter((item) => item.href !== "/stock/party")
    : items;
}
