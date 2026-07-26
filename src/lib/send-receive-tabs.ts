import type { UserRole } from "@/lib/auth/session";

export type SendReceiveTab = {
  label: string;
  href: string;
  roles: UserRole[];
};

// In transit (4.8) and Receive (4.10) get added here as they're built —
// dispatching is a store-management action, so Send out stays scoped to
// admin/branch_manager/store_manager (the roles with requisitions:approve).
export const SEND_RECEIVE_TABS: SendReceiveTab[] = [
  {
    label: "Send out",
    href: "/send-receive",
    roles: ["admin", "branch_manager", "store_manager"],
  },
];

export function canAccessSendReceiveTab(role: UserRole, href: string): boolean {
  const tab = SEND_RECEIVE_TABS.find((t) => t.href === href);
  return tab ? tab.roles.includes(role) : false;
}
