"use client";

import { useRouter } from "next/navigation";
import { useSession } from "@/lib/auth/session-context";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

/* Placeholder home — the real to-do-list Home screen is built in prompt 4.13,
   nav shell in 1.5. This just proves the session-aware layout works. */
export default function HomePage() {
  const session = useSession();
  const router = useRouter();

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-2xl font-semibold">Welcome, {session.fullName}</h1>
      <p className="text-muted-foreground text-sm">
        {session.role} · {session.branchName ?? "No branch"}
      </p>
      {session.departments.length > 0 && (
        <p className="text-muted-foreground text-sm">
          Departments: {session.departments.map((d) => d.name).join(", ")}
        </p>
      )}
      <Button variant="outline" onClick={signOut}>
        Sign out
      </Button>
    </div>
  );
}
