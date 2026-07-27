import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type StatCardProps = {
  label: string;
  value: string;
  detail?: string;
  icon?: LucideIcon;
  tone?: "default" | "primary" | "accent";
  className?: string;
};

// The big-number KPI tile used on dashboard-style screens (Home, Buy
// summaries). `tone` swaps in one of the two gradient hero treatments —
// used sparingly, one or two per screen, so it stays a highlight.
export function StatCard({
  label,
  value,
  detail,
  icon: Icon,
  tone = "default",
  className,
}: StatCardProps) {
  const isGradient = tone !== "default";

  return (
    <div
      className={cn(
        "shadow-card flex flex-col gap-3 rounded-2xl p-5",
        isGradient
          ? tone === "primary"
            ? "gradient-primary"
            : "gradient-accent"
          : "bg-card ring-foreground/5 ring-1",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p
          className={cn(
            "text-sm font-medium",
            isGradient ? "text-primary-foreground/80" : "text-muted-foreground",
          )}
        >
          {label}
        </p>
        {Icon && (
          <span
            className={cn(
              "flex size-8 items-center justify-center rounded-full",
              isGradient ? "bg-white/15" : "bg-primary/10",
            )}
          >
            <Icon
              className={cn(
                "size-4",
                isGradient ? "text-primary-foreground" : "text-primary",
              )}
            />
          </span>
        )}
      </div>
      <p
        className={cn(
          "font-heading text-3xl font-semibold tracking-tight tabular-nums",
          isGradient ? "text-primary-foreground" : "text-foreground",
        )}
      >
        {value}
      </p>
      {detail && (
        <p
          className={cn(
            "text-xs",
            isGradient ? "text-primary-foreground/70" : "text-muted-foreground",
          )}
        >
          {detail}
        </p>
      )}
    </div>
  );
}
