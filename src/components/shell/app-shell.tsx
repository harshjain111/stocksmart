import { FlaskConical } from "lucide-react";
import { TopBar } from "@/components/shell/top-bar";
import { SidebarNav } from "@/components/shell/sidebar-nav";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside className="bg-sidebar text-sidebar-foreground border-sidebar-border hidden w-56 shrink-0 border-r p-3 lg:block print:hidden">
        <p className="mb-4 flex items-center gap-2 px-3 text-sm font-semibold text-white">
          <FlaskConical className="text-sidebar-primary size-4" />
          Smokzy Inventory
        </p>
        <SidebarNav />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="print:hidden">
          <TopBar />
        </div>
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
