// Sends queued email / WhatsApp messages from message_outbox.
// Providers: Resend (email) and Meta WhatsApp Cloud API. Channels without a
// configured provider are marked "skipped" so the queue never backs up.
import { createClient } from "npm:@supabase/supabase-js@2";
import { render, VENDOR_TEMPLATES, type OutboxMessage } from "../_shared/templates.ts";
import { sha256Hex } from "../_shared/signature.ts";
import { authorizeDispatch } from "../_shared/auth.ts";

const env = (k: string) => Deno.env.get(k) ?? "";
const supabase = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
let APP_URL = env("APP_URL") || "http://localhost:3000";
const MAX_ATTEMPTS = 5;

interface Row extends OutboxMessage { id: number; org_id: string; recipient: string; attempts: number }

async function vendorPortalLink(row: Row): Promise<string | undefined> {
  const p = row.payload as Record<string, string>;
  let vendorId = p.vendor_id;
  if (!vendorId && p.po_id) vendorId = (await supabase.from("purchase_orders").select("vendor_id").eq("id", p.po_id).single()).data?.vendor_id;
  if (!vendorId && p.work_order_id) vendorId = (await supabase.from("work_orders").select("vendor_id").eq("id", p.work_order_id).single()).data?.vendor_id;
  if (!vendorId) return undefined;
  const token = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const { error } = await supabase.from("vendor_portal_tokens").insert({
    org_id: row.org_id, vendor_id: vendorId, email: row.recipient, purpose: "portal", token_hash: await sha256Hex(token),
    expires_at: new Date(Date.now() + 7 * 86400_000).toISOString(),
  });
  return error ? undefined : `${APP_URL}/vendor-portal?token=${token}`;
}

async function sendEmail(to: string, subject: string, html: string, text: string) {
  const key = env("RESEND_API_KEY");
  if (!key) return "skipped" as const;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ from: env("EMAIL_FROM") || "Campus Ops <no-reply@example.com>", to: [to], subject, html, text }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return "sent" as const;
}

async function sendWhatsApp(to: string, tpl: { name: string; params: string[] } | undefined, text: string) {
  const token = env("WHATSAPP_TOKEN"), phoneId = env("WHATSAPP_PHONE_NUMBER_ID");
  if (!token || !phoneId) return "skipped" as const;
  const number = to.replace(/[^0-9]/g, "").replace(/^0/, "91");
  const message = tpl
    ? { type: "template", template: { name: tpl.name, language: { code: env("WHATSAPP_LANG") || "en" }, components: [{ type: "body", parameters: tpl.params.map((t) => ({ type: "text", text: t })) }] } }
    : { type: "text", text: { body: text } };
  const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to: number, ...message }),
  });
  if (!res.ok) throw new Error(`WhatsApp ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return "sent" as const;
}

Deno.serve(async (req) => {
  const config = await authorizeDispatch(req, supabase);
  if (!config) return new Response("Unauthorized", { status: 401 });
  if (config.app_url) APP_URL = config.app_url.replace(/\/$/, "");
  const { data: due, error } = await supabase
    .from("message_outbox").select("*").eq("status", "pending").lte("send_after", new Date().toISOString()).order("id").limit(100);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const stats = { sent: 0, skipped: 0, failed: 0 };
  const orgNames = new Map<string, string>();
  for (const row of (due ?? []) as Row[]) {
    // claim: only one dispatcher run gets each row
    const { data: claimed } = await supabase.from("message_outbox").update({ status: "sending", attempts: row.attempts + 1 }).eq("id", row.id).eq("status", "pending").select("id");
    if (!claimed?.length) continue;
    try {
      if (!orgNames.has(row.org_id)) orgNames.set(row.org_id, (await supabase.from("organisations").select("name").eq("id", row.org_id).single()).data?.name ?? "Campus Ops");
      const portalLink = VENDOR_TEMPLATES.has(row.template) ? await vendorPortalLink(row) : undefined;
      const r = render(row, { appUrl: APP_URL, org: orgNames.get(row.org_id)!, portalLink });
      const result = row.channel === "email" ? await sendEmail(row.recipient, r.subject, r.html, r.text)
        : row.channel === "whatsapp" ? await sendWhatsApp(row.recipient, r.whatsapp, r.text) : "skipped";
      await supabase.from("message_outbox").update({ status: result, sent_at: result === "sent" ? new Date().toISOString() : null, last_error: null }).eq("id", row.id);
      stats[result]++;
    } catch (e) {
      const final = row.attempts + 1 >= MAX_ATTEMPTS;
      await supabase.from("message_outbox").update({
        status: final ? "failed" : "pending", last_error: String((e as Error).message ?? e).slice(0, 500),
        send_after: new Date(Date.now() + 2 ** row.attempts * 60_000).toISOString(),
      }).eq("id", row.id);
      stats.failed++;
    }
  }
  return Response.json(stats);
});
