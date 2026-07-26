// Monday-start week bucketing in IST, for aggregating anything dated (rule:
// dates as timestamptz, always displayed in IST).

export function weekKeyIst(dateStr: string): string {
  return weekStartIst(dateStr).toISOString().slice(0, 10);
}

export function weekLabelIst(dateStr: string): string {
  const monday = weekStartIst(dateStr);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-IN", { month: "short", day: "numeric" });
  return `${fmt(monday)} – ${fmt(sunday)}, ${monday.getFullYear()}`;
}

function weekStartIst(dateStr: string): Date {
  const ist = new Date(
    new Date(dateStr).toLocaleString("en-US", { timeZone: "Asia/Kolkata" }),
  );
  const dayOfWeek = ist.getDay(); // 0=Sun..6=Sat
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  const monday = new Date(ist);
  monday.setDate(ist.getDate() - daysSinceMonday);
  monday.setHours(0, 0, 0, 0);
  return monday;
}
