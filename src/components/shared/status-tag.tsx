import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "primary" | "warning" | "destructive" | "muted";

// Covers the status enums across every document lifecycle in CLAUDE.md.
const STATUS_TONE: Record<string, Tone> = {
  draft: "muted",
  submitted: "warning",
  approved: "primary",
  fulfilling: "warning",
  closed: "neutral",
  rejected: "destructive",
  dispatched: "warning",
  received: "primary",
  short_closed: "destructive",
  sent: "warning",
  partially_received: "warning",
  posted: "primary",
  confirmed: "primary",
  current: "primary",
  archived: "muted",
};

const TONE_CLASSES: Record<Tone, string> = {
  neutral: "bg-secondary text-secondary-foreground border-transparent",
  primary: "bg-primary/15 text-primary border-primary/20",
  warning: "bg-warning/25 text-warning-foreground border-warning/40",
  destructive: "bg-destructive/15 text-destructive border-destructive/20",
  muted: "bg-muted text-muted-foreground border-transparent",
};

type StatusTagProps = {
  status: string;
  label?: string;
  tone?: Tone;
  className?: string;
};

export function StatusTag({ status, label, tone, className }: StatusTagProps) {
  const resolvedTone = tone ?? STATUS_TONE[status] ?? "neutral";
  const text = label ?? status.replace(/_/g, " ");

  return (
    <Badge
      variant="outline"
      className={cn(
        "font-medium capitalize",
        TONE_CLASSES[resolvedTone],
        className,
      )}
    >
      {text}
    </Badge>
  );
}
