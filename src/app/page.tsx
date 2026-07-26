import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();
  const { error } = await supabase.auth.getSession();

  const connected = !error;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-2xl font-semibold">Smooxy Inventory</h1>
      <p className="text-muted-foreground text-sm">
        Supabase connection:{" "}
        <span className={connected ? "text-green-600" : "text-red-600"}>
          {connected ? "reachable" : `error — ${error?.message}`}
        </span>
      </p>
    </div>
  );
}
