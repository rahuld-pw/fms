import "server-only";
import { z } from "zod";
import { ApiError, unwrap } from "@/lib/api/errors";
import { publicRoute, type RouteDef } from "@/lib/api/router";
import { sendSmtpEmail } from "@/lib/email/smtp";
import { sendPushToUser } from "@/lib/push/web-push";
import { createAdminClient } from "@/lib/supabase/server";

// Called by the dispatch-messages Edge Function (not by browsers): it relays
// rendered emails here when no email API key is configured, so they go out
// through this app's SMTP settings. Authenticated with the dispatcher's token,
// which the database verifies against the Vault secret.
async function requireDispatcher(req: Request) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const ok = token ? unwrap(await createAdminClient().rpc("dispatch_config", { p_token: token })) : null;
  if (!ok) throw new ApiError("unauthorized", "Invalid dispatcher token");
}

export const internalRoutes: RouteDef[] = [
  publicRoute({
    public: true,
    method: "POST",
    path: "/internal/email",
    summary: "Internal: send an email from the outbox through SMTP (dispatcher only)",
    tags: ["internal"],
    rateLimit: { name: "internal-email", limit: 600 },
    body: z.object({
      to: z.email(),
      subject: z.string().min(1).max(300),
      html: z.string().max(200_000),
      text: z.string().max(100_000),
    }),
    handler: async ({ req, body }) => {
      await requireDispatcher(req);
      return { result: await sendSmtpEmail(body) };
    },
  }),
  publicRoute({
    public: true,
    method: "POST",
    path: "/internal/push",
    summary: "Internal: send a push notification from the outbox to a user's devices (dispatcher only)",
    tags: ["internal"],
    rateLimit: { name: "internal-push", limit: 600 },
    body: z.object({
      user_id: z.uuid(),
      title: z.string().min(1).max(300),
      body: z.string().max(2000).nullable().optional(),
      link: z.string().max(2000).nullable().optional(),
      tag: z.string().max(100).optional(),
    }),
    handler: async ({ req, body }) => {
      await requireDispatcher(req);
      return { result: await sendPushToUser(body.user_id, body) };
    },
  }),
];
