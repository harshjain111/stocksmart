import type { UserRole } from "@/lib/auth/session";

export type SetupTab = {
  label: string;
  href: string;
  roles: UserRole[];
};

export const SETUP_TABS: SetupTab[] = [
  {
    label: "Branches & departments",
    href: "/setup/branches",
    roles: ["admin"],
  },
  { label: "People", href: "/setup/people", roles: ["admin"] },
  {
    label: "Suppliers",
    href: "/setup/suppliers",
    roles: ["admin", "purchase_manager"],
  },
  {
    label: "Materials & flavours",
    href: "/setup/materials",
    roles: ["admin", "purchase_manager"],
  },
  {
    label: "Recipe access",
    href: "/setup/recipe-access",
    roles: ["admin"],
  },
  {
    label: "Par levels",
    href: "/setup/par-levels",
    roles: ["admin"],
  },
];

/** True if the role can reach at least one Setup tab. */
export function canAccessSetup(role: UserRole): boolean {
  return SETUP_TABS.some((tab) => tab.roles.includes(role));
}

export function canAccessSetupTab(role: UserRole, href: string): boolean {
  const tab = SETUP_TABS.find((t) => t.href === href);
  return tab ? tab.roles.includes(role) : false;
}
