import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { PageHeader } from "@/components/shared/page-header";
import { SetupTabs } from "@/components/setup/setup-tabs";
import { canAccessSetup } from "@/lib/setup-tabs";

export default async function SetupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  // Nav already hides the link for roles with no Setup tab at all — this is
  // the actual enforcement (rule 8: UI hiding a screen isn't access control).
  // Individual tab pages additionally guard themselves, since Setup tabs
  // aren't all visible to the same roles (e.g. Suppliers vs. People).
  if (!session || !canAccessSetup(session.role)) redirect("/");

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader title="Setup" />
      <SetupTabs />
      {children}
    </div>
  );
}
