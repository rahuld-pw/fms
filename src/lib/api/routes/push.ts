import "server-only";
import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import { route, type RouteDef } from "@/lib/api/router";
import { isPushEndpoint, sendPushToUser, vapidKeys } from "@/lib/push/web-push";
import { createAdminClient } from "@/lib/supabase/server";

// Push notifications on this device (installed app or desktop browser).

const subscription = z.object({
  endpoint: z.url().max(2000).refine(isPushEndpoint, "Not a browser push service address"),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});

export const pushRoutes: RouteDef[] = [
  route({
    method: "GET",
    path: "/push/key",
    summary: "Public key browsers need to subscribe to push notifications",
    tags: ["notifications"],
    handler: async () => ({ public_key: (await vapidKeys()).public_key }),
  }),
  route({
    method: "POST",
    path: "/me/push-subscriptions",
    summary: "Turn on push notifications for this device",
    tags: ["notifications"],
    body: subscription,
    status: 201,
    handler: async ({ ctx, body, req }) => {
      if (ctx.kind !== "user") throw new ApiError("bad_request", "Available to signed-in users only");
      // a device belongs to whoever subscribed last (shared phones / re-login)
      const db = createAdminClient();
      await db.from("push_subscriptions").delete().eq("endpoint", body.endpoint);
      const { error } = await db.from("push_subscriptions").insert({
        user_id: ctx.userId,
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
        user_agent: req.headers.get("user-agent")?.slice(0, 300) ?? null,
      });
      if (error) throw error;
      return { ok: true };
    },
  }),
  route({
    method: "POST",
    path: "/me/push-subscriptions/remove",
    summary: "Turn off push notifications for this device",
    tags: ["notifications"],
    body: z.object({ endpoint: z.url().max(2000) }),
    response: "none",
    handler: async ({ ctx, body }) => {
      await ctx.db.from("push_subscriptions").delete().eq("endpoint", body.endpoint).eq("user_id", ctx.userId);
    },
  }),
  route({
    method: "POST",
    path: "/me/push-test",
    summary: "Send a test push notification to my devices",
    tags: ["notifications"],
    handler: async ({ ctx }) => {
      if (ctx.kind !== "user") throw new ApiError("bad_request", "Available to signed-in users only");
      return { result: await sendPushToUser(ctx.userId, { title: "Campus Ops", body: "Notifications are working on this device.", link: "/notifications", tag: "test" }) };
    },
  }),
];
