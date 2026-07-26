import type { UserRole } from "@/lib/auth/session";

export type SendReceiveTab = {
  label: string;
  href: string;
  roles: UserRole[];
};

// Dispatching and watching transit are store-management actions, so
// those two tabs stay scoped to admin/branch_manager/store_manager.
// Receive is broader — an HOD receives goods at their own department
// too, matching "everything inbound to the user's departments".
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
  {
    label: "Receive",
    href: "/send-receive/receive",
    roles: [
      "admin",
      "branch_manager",
      "store_manager",
      "purchase_manager",
      "hod",
    ],
  },
  {
    label: "Transit variance",
    href: "/send-receive/variance",
    roles: ["admin", "branch_manager", "store_manager"],
  },
];

export function canAccessSendReceiveTab(role: UserRole, href: string): boolean {
  const tab = SEND_RECEIVE_TABS.find((t) => t.href === href);
  return tab ? tab.roles.includes(role) : false;
}
