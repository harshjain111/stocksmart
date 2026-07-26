"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useSession } from "@/lib/auth/session-context";
import { SETUP_TABS } from "@/lib/setup-tabs";

export function SetupTabs() {
  const pathname = usePathname();
  const session = useSession();
  const visibleTabs = SETUP_TABS.filter((tab) =>
    tab.roles.includes(session.role),
  );

  return (
    <nav className="flex gap-1 border-b">
      {visibleTabs.map((tab) => {
        const active = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "border-primary text-foreground"
                : "text-muted-foreground hover:text-foreground border-transparent",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
