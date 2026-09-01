import type { UserRole } from "@/lib/auth/session";

// Screen-level and domain permissions. Extend this as later phases add
// finer-grained checks (e.g. requisitions:approve gates a line decision,
// not just nav visibility).
export type Permission =
  | "nav:home"
  | "nav:requisitions"
  | "nav:send-receive"
  | "nav:purchases"
  | "nav:mix"
  | "nav:stock"
  | "nav:recipes"
  | "nav:setup"
  | "recipes:read"
  | "requisitions:approve"
  | "purchase:manage"
  | "purchase:history"
  | "setup:manage";

// admin = "Everything, all branches" (CLAUDE.md) — no exceptions, so it
// short-circuits in can() below rather than being duplicated per-permission.
const ROLE_PERMISSIONS: Record<Exclude<UserRole, "admin">, Permission[]> = {
  branch_manager: [
    "nav:home",
    "nav:requisitions",
    "nav:send-receive",
    "nav:purchases",
    "nav:stock",
    "requisitions:approve",
    "purchase:manage",
  ],
  store_manager: [
    "nav:home",
    "nav:requisitions",
    "nav:send-receive",
    "nav:stock",
    "requisitions:approve",
  ],
  purchase_manager: [
    "nav:home",
    "nav:send-receive",
    "nav:purchases",
    "purchase:manage",
    "purchase:history",
  ],
  hod: ["nav:home", "nav:requisitions", "nav:send-receive", "nav:stock"],
  senior_mixer: ["nav:home", "nav:mix", "nav:recipes", "recipes:read"],
  mixer: ["nav:home", "nav:mix"],
};

/** Server-side permission check. Client code must never decide access on its own. */
export function can(role: UserRole, permission: Permission): boolean {
  if (role === "admin") return true;
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}
