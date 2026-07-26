import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { SETUP_TABS } from "@/lib/setup-tabs";

export default async function SetupIndexPage() {
  const session = await getSession();
  const firstTab = session
    ? SETUP_TABS.find((tab) => tab.roles.includes(session.role))
    : undefined;

  redirect(firstTab?.href ?? "/");
}
