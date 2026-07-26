import type { UserRole } from "@/lib/auth/session";

export type MixTab = {
  label: string;
  href: string;
  roles: UserRole[];
};

// mixer isn't listed on any tab — they get an entirely separate,
// tab-less queue view (2.9), never the admin/senior_mixer screens below.
export const MIX_TABS: MixTab[] = [
  { label: "Make a batch", href: "/mix", roles: ["admin", "senior_mixer"] },
  {
    label: "Past batches",
    href: "/mix/past-batches",
    roles: ["admin", "senior_mixer"],
  },
];

export function canAccessMixTab(role: UserRole, href: string): boolean {
  const tab = MIX_TABS.find((t) => t.href === href);
  return tab ? tab.roles.includes(role) : false;
}
