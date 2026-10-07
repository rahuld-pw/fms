import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { serverEnv } from "@/lib/env";
import type { Database } from "./database.types";

export type DB = SupabaseClient<Database>;

/** Supabase client acting as the signed-in user (RLS applies). */
export async function createUserClient(): Promise<DB> {
  const env = serverEnv();
  const cookieStore = await cookies();
  return createServerClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) cookieStore.set(name, value, options);
        } catch {
          // called from a Server Component: cookies are refreshed by the proxy instead
        }
      },
    },
  });
}

/**
 * Service-role client (bypasses RLS). Only for trusted server code: API-key
 * requests (which must authorize explicitly), public endpoints, cron. The
 * actor headers are read by the database (app.actor_id()) for audit trails
 * and in-database permission checks.
 */
export function createAdminClient(actor?: { userId?: string | null; apiKeyId?: string | null }): DB {
  const env = serverEnv();
  const headers: Record<string, string> = {};
  if (actor?.userId) headers["x-actor-user-id"] = actor.userId;
  if (actor?.apiKeyId) headers["x-actor-api-key-id"] = actor.apiKeyId;
  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers },
  });
}
