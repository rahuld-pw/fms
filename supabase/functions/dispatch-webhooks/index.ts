// Delivers queued webhook events (events_outbox -> webhook_deliveries) to
// customer endpoints with HMAC signatures, retries and delivery logs.
// Invoked every minute by pg_cron (see 20261007000800_platform.sql) or manually.
import { createClient } from "npm:@supabase/supabase-js@2";
import { signPayload } from "../_shared/signature.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const TIMEOUT_MS = 10_000;
const CONCURRENCY = 8;

interface Claimed {
  delivery_id: number; endpoint_id: string; url: string; secret: string; attempt_count: number;
  event_id: string; event_type: string; org_id: string; payload: unknown; created_at: string;
}

async function deliver(d: Claimed) {
  const body = JSON.stringify({ id: d.event_id, type: d.event_type, created_at: d.created_at, org_id: d.org_id, data: d.payload });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(d.url, {
      method: "POST",
      signal: ctrl.signal,
      redirect: "manual",
      headers: {
        "content-type": "application/json",
        "user-agent": "CampusOps-Webhooks/1.0",
        "x-campusops-event": d.event_type,
        "x-campusops-event-id": d.event_id,
        "x-campusops-delivery": String(d.delivery_id),
        "x-campusops-attempt": String(d.attempt_count),
        "x-campusops-signature": await signPayload(d.secret, body),
      },
      body,
    });
    const excerpt = (await res.text().catch(() => "")).slice(0, 1000);
    const ok = res.status >= 200 && res.status < 300;
    await supabase.rpc("complete_webhook_delivery", {
      p_delivery_id: d.delivery_id, p_success: ok, p_status_code: res.status, p_error: ok ? null : `HTTP ${res.status}`, p_response_excerpt: excerpt,
    });
    return ok;
  } catch (e) {
    await supabase.rpc("complete_webhook_delivery", {
      p_delivery_id: d.delivery_id, p_success: false, p_status_code: null,
      p_error: (e as Error).name === "AbortError" ? `Timed out after ${TIMEOUT_MS / 1000}s` : String((e as Error).message ?? e).slice(0, 500), p_response_excerpt: null,
    });
    return false;
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req) => {
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`) return new Response("Unauthorized", { status: 401 });
  let sent = 0, failed = 0;
  for (let round = 0; round < 5; round++) {
    const { data, error } = await supabase.rpc("claim_webhook_deliveries", { p_limit: 50 });
    if (error) return Response.json({ error: error.message }, { status: 500 });
    const batch = (data ?? []) as Claimed[];
    if (!batch.length) break;
    for (let i = 0; i < batch.length; i += CONCURRENCY) {
      const results = await Promise.all(batch.slice(i, i + CONCURRENCY).map(deliver));
      for (const ok of results) {
        if (ok) sent++;
        else failed++;
      }
    }
  }
  return Response.json({ sent, failed });
});
