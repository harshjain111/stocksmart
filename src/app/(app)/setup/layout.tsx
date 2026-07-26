import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { PageHeader } from "@/components/shared/page-header";
import { SetupTabs } from "@/components/setup/setup-tabs";

export default async function SetupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  // Setup is admin-only. Nav already hides the link for everyone else —
  // this is the actual enforcement (rule 8: UI hiding a screen isn't access control).
  if (!session || session.role !== "admin") redirect("/");

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader title="Setup" />
      <SetupTabs />
      {children}
    </div>
  );
}
