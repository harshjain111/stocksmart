import Link from "next/link";
import {
  CheckCircle2,
  ClipboardCheck,
  PackageCheck,
  TrendingDown,
  Clock,
  Star,
  ArrowRight,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { StatCard } from "@/components/shared/stat-card";
import { cn } from "@/lib/utils";

export type HomeSection = {
  key: string;
  title: string;
  href: string;
  items: { id: string; label: string; detail: string }[];
};

const SECTION_ICON: Record<string, LucideIcon> = {
  approvals: ClipboardCheck,
  receive: PackageCheck,
  "below-par": TrendingDown,
  "ageing-transit": Clock,
  "rate-batches": Star,
};

export function HomeView({
  fullName,
  sections,
}: {
  fullName: string;
  sections: HomeSection[];
}) {
  const firstName = fullName.split(" ")[0];
  const activeSections = sections.filter((s) => s.items.length > 0);
  const totalItems = activeSections.reduce((sum, s) => sum + s.items.length, 0);

  if (totalItems === 0) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <PageHeader
          title={`Hi ${firstName}`}
          description="Nothing waiting on you right now."
        />
        <div className="gradient-accent shadow-card flex items-center gap-3 rounded-2xl p-8 text-sm">
          <CheckCircle2 className="size-6" />
          <span className="font-medium">You&apos;re all caught up.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 p-6">
      <PageHeader
        title={`Hi ${firstName}`}
        description="What needs your attention — everything links straight to the action."
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <StatCard
          label="Needs your attention"
          value={String(totalItems)}
          detail={`across ${activeSections.length} area${activeSections.length === 1 ? "" : "s"}`}
          icon={Sparkles}
          tone="primary"
          className="col-span-2 sm:col-span-1"
        />
        {activeSections.slice(0, 3).map((section) => {
          const Icon = SECTION_ICON[section.key] ?? ClipboardCheck;
          return (
            <StatCard
              key={section.key}
              label={section.title}
              value={String(section.items.length)}
              icon={Icon}
            />
          );
        })}
      </div>

      {activeSections.map((section) => {
        const Icon = SECTION_ICON[section.key] ?? ClipboardCheck;
        return (
          <div key={section.key} className="grid gap-3">
            <div className="flex items-baseline justify-between">
              <h2 className="font-heading flex items-center gap-2 text-lg font-semibold tracking-tight">
                <span className="bg-primary/10 flex size-7 items-center justify-center rounded-full">
                  <Icon className="text-primary size-4" />
                </span>
                {section.title}
              </h2>
              <Link
                href={section.href}
                className="text-primary flex items-center gap-1 text-sm font-medium hover:underline"
              >
                View all
                <ArrowRight className="size-3.5" />
              </Link>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {section.items.map((item) => (
                <Link key={item.id} href={section.href} className="block">
                  <Card
                    className={cn(
                      "h-full transition-all hover:-translate-y-0.5 hover:shadow-lg",
                    )}
                  >
                    <CardContent className="flex flex-col gap-1">
                      <span className="text-sm font-semibold">
                        {item.label}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {item.detail}
                      </span>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
