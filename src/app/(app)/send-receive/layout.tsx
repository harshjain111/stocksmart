import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { SendReceiveTabs } from "@/components/send-receive/send-receive-tabs";

export default async function SendReceiveLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session || !can(session.role, "nav:send-receive")) {
    redirect("/");
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="px-6 pt-6">
        <SendReceiveTabs />
      </div>
      {children}
    </div>
  );
}
