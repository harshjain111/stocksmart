import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";

export type HomeSection = {
  key: string;
  title: string;
  href: string;
  items: { id: string; label: string; detail: string }[];
};

export function HomeView({
  fullName,
  sections,
}: {
  fullName: string;
  sections: HomeSection[];
}) {
  const firstName = fullName.split(" ")[0];
  const totalItems = sections.reduce((sum, s) => sum + s.items.length, 0);

  if (totalItems === 0) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <PageHeader
          title={`Hi ${firstName}`}
          description="Nothing waiting on you right now."
        />
        <div className="text-muted-foreground flex items-center gap-2 rounded-lg border border-dashed p-8 text-sm">
          <CheckCircle2 className="size-5" />
          You&apos;re all caught up.
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

      {sections
        .filter((s) => s.items.length > 0)
        .map((section) => (
          <div key={section.key} className="grid gap-3">
            <div className="flex items-baseline justify-between">
              <h2 className="text-lg font-semibold tracking-tight">
                {section.title}
              </h2>
              <Link
                href={section.href}
                className="text-primary text-sm hover:underline"
              >
                View all
              </Link>
            </div>
            <div className="grid gap-2">
              {section.items.map((item) => (
                <Link key={item.id} href={section.href}>
                  <Card className="hover:bg-muted transition-colors">
                    <CardContent className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium">{item.label}</span>
                      <span className="text-muted-foreground text-xs">
                        {item.detail}
                      </span>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        ))}
    </div>
  );
}
