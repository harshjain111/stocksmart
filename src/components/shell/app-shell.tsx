import { TopBar } from "@/components/shell/top-bar";
import { SidebarNav } from "@/components/shell/sidebar-nav";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside className="bg-card hidden w-56 shrink-0 border-r p-3 lg:block print:hidden">
        <p className="mb-4 px-3 text-sm font-semibold">Smokzy Inventory</p>
        <SidebarNav />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="print:hidden">
          <TopBar />
        </div>
        <main className="animate-in fade-in-0 slide-in-from-bottom-1 flex-1 duration-300">
          {children}
        </main>
      </div>
    </div>
  );
}
