"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useSession } from "@/lib/auth/session-context";
import { visibleStockTabs } from "@/lib/stock-tabs";

export function StockNav() {
  const pathname = usePathname();
  const session = useSession();
  const tabs = visibleStockTabs(session.role);

  // A gate man has exactly one stock page, so a tab bar of one is just
  // noise (§72 — show nothing that isn't needed).
  if (tabs.length <= 1) return null;

  return (
    <nav className="flex gap-1 overflow-x-auto border-b">
      {tabs.map((tab) => {
        // "/stock" is a prefix of every nested stock route, so the Overview
        // tab matches exactly while the rest match their own subtree —
        // otherwise /stock/party would light up Overview as well.
        const active =
          tab.href === "/stock"
            ? pathname === "/stock"
            : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
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
