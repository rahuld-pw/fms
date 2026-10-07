// Dispatcher authentication: pg_cron sends "Bearer <dispatch_token>" (a random
// Vault secret). The database verifies it and returns deployment settings, so
// no long-lived key has to be copied into function secrets. DISPATCH_TOKEN can
// be set as a function secret instead (local testing).
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export interface DispatchConfig { app_url: string | null }

export async function authorizeDispatch(req: Request, supabase: SupabaseClient): Promise<DispatchConfig | null> {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const local = Deno.env.get("DISPATCH_TOKEN");
  if (local) return token === local ? { app_url: Deno.env.get("APP_URL") ?? null } : null;
  const { data, error } = await supabase.rpc("dispatch_config", { p_token: token });
  if (error || !data) return null;
  return data as DispatchConfig;
}
