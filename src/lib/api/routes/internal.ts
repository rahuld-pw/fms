import "server-only";
import { z } from "zod";
import { ApiError, unwrap } from "@/lib/api/errors";
import { publicRoute, type RouteDef } from "@/lib/api/router";
import { sendSmtpEmail } from "@/lib/email/smtp";
import { createAdminClient } from "@/lib/supabase/server";

// Called by the dispatch-messages Edge Function (not by browsers): it relays
// rendered emails here when no email API key is configured, so they go out
// through this app's SMTP settings. Authenticated with the dispatcher's token,
// which the database verifies against the Vault secret.
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
      const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
      const ok = token ? unwrap(await createAdminClient().rpc("dispatch_config", { p_token: token })) : null;
      if (!ok) throw new ApiError("unauthorized", "Invalid dispatcher token");
      return { result: await sendSmtpEmail(body) };
    },
  }),
];
