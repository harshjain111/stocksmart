import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Service-role client — bypasses RLS entirely. Server-only, never sent to
 * the browser. Use only inside Server Actions that have already verified
 * the caller's role themselves (e.g. admin-only mutations on profiles,
 * or the auth.admin.* invite APIs which have no other entry point).
 */
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
