import { redirect } from "next/navigation";

// Variance history moved into Count & Variance (§27, §31) — the two were
// always halves of one job. Kept as a redirect so existing links and
// bookmarks still land somewhere useful.
export default function CountVarianceRedirect() {
  redirect("/stock/count");
}
