import { Skeleton } from "@/components/ui/skeleton";

// Shown instantly on every navigation under the app shell while the
// destination page's server component fetches its data — the sidebar
// and top bar stay put (this file lives inside the (app) layout), only
// the content area shows this, so switching screens feels immediate
// instead of a blank flash.
export default function Loading() {
  return (
    <div className="grid gap-6 p-6">
      <div className="grid gap-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-80" />
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-64 w-full rounded-2xl" />
    </div>
  );
}
