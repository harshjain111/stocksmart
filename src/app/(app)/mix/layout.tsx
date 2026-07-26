import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { MixTabs } from "@/components/mix/mix-tabs";

export default async function MixLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session || !["admin", "senior_mixer", "mixer"].includes(session.role)) {
    redirect("/");
  }

  // mixer has no tabs at all — an entirely separate, tab-less queue view
  // (2.9), never the admin/senior_mixer screens the tabs switch between.
  if (session.role === "mixer") return <>{children}</>;

  return (
    <div className="flex flex-col gap-4">
      <div className="px-6 pt-6">
        <MixTabs />
      </div>
      {children}
    </div>
  );
}
