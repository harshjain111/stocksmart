import {
  ArrowLeftRight,
  BookOpen,
  ClipboardList,
  FlaskConical,
  Home,
  Package,
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
    label: "Buy",
    href: "/buy",
    icon: ShoppingCart,
    permission: "nav:buy",
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
  return NAV_ITEMS.filter((item) => can(role, item.permission));
}
