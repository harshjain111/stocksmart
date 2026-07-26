import type { UserRole } from "@/lib/auth/session";

export type SendReceiveTab = {
  label: string;
  href: string;
  roles: UserRole[];
};

// Receive (4.10) gets added here once it's built — dispatching and
// watching transit are store-management actions, so both tabs below
// stay scoped to admin/branch_manager/store_manager (the roles with
// requisitions:approve).
export const SEND_RECEIVE_TABS: SendReceiveTab[] = [
  {
    label: "Send out",
    href: "/send-receive",
    roles: ["admin", "branch_manager", "store_manager"],
  },
  {
    label: "In transit",
    href: "/send-receive/in-transit",
    roles: ["admin", "branch_manager", "store_manager"],
  },
];

export function canAccessSendReceiveTab(role: UserRole, href: string): boolean {
  const tab = SEND_RECEIVE_TABS.find((t) => t.href === href);
  return tab ? tab.roles.includes(role) : false;
}
