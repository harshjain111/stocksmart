import type { UserRole } from "@/lib/auth/session";

export type RequisitionsTab = {
  label: string;
  href: string;
  roles: UserRole[];
};

// "Mine" is an HOD raising their own asks — admin included for
// testing/oversight. "To approve"/"All" match requisitions:approve scope
// (branch_manager, store_manager) plus admin.
export const REQUISITIONS_TABS: RequisitionsTab[] = [
  { label: "Mine", href: "/requisitions", roles: ["admin", "hod"] },
  {
    label: "To approve",
    href: "/requisitions/approve",
    roles: ["admin", "branch_manager", "store_manager"],
  },
  {
    label: "All",
    href: "/requisitions/all",
    roles: ["admin", "branch_manager", "store_manager"],
  },
];

export function canAccessRequisitionsTab(
  role: UserRole,
  href: string,
): boolean {
  const tab = REQUISITIONS_TABS.find((t) => t.href === href);
  return tab ? tab.roles.includes(role) : false;
}
