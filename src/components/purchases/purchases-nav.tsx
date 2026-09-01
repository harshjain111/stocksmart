"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSession } from "@/lib/auth/session-context";
import { PURCHASES_TABS } from "@/lib/purchases-tabs";
import { buttonVariants } from "@/components/ui/button";

// Hidden on the Create PO page itself — clicking "+ Create PO" while
// already there would just reload the same page.
export function CreatePoButton() {
  const pathname = usePathname();
  if (pathname === "/purchases/create") return null;
  return (
    <Link href="/purchases/create" className={buttonVariants()}>
      <Plus /> Create PO
    </Link>
  );
}

export function PurchasesNav() {
  const pathname = usePathname();
  const session = useSession();
  const visibleTabs = PURCHASES_TABS.filter((tab) =>
    tab.roles.includes(session.role),
  );

  // The Create PO flow isn't one of these tabs — it's reached via the
  // header's "+ Create PO" button, and showing a tab bar with nothing
  // active there would look broken.
  if (visibleTabs.length <= 1 || pathname === "/purchases/create") return null;

  return (
    <nav className="flex gap-1 overflow-x-auto border-b">
      {visibleTabs.map((tab) => {
        const active = pathname === tab.href;
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
