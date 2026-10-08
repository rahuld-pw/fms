import "server-only";
import webpush from "web-push";
import { publicEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/server";
import { isPushEndpoint } from "./endpoint";

export { isPushEndpoint };

type Keys = { public_key: string; private_key: string };
let keys: Promise<Keys> | null = null;

/** This deployment's VAPID keys: created once and kept in the database. */
export function vapidKeys(): Promise<Keys> {
  keys ??= (async () => {
    const db = createAdminClient();
    const { data, error } = await db.rpc("push_vapid_keys", {});
    if (error) throw error;
    if (data) return data as Keys;
    const fresh = webpush.generateVAPIDKeys();
    // insert-if-absent: if two servers race, both read back the same pair
    const { data: saved, error: e2 } = await db.rpc("push_vapid_keys", { p_public: fresh.publicKey, p_private: fresh.privateKey });
    if (e2 || !saved) throw e2 ?? new Error("Could not create push keys");
    return saved as Keys;
  })().catch((e) => {
    keys = null;
    throw e;
  });
  return keys;
}

export interface PushMessage {
  title: string;
  body?: string | null;
  link?: string | null;
  tag?: string;
}

/** Sends a push to every device of a user. Expired subscriptions are removed. */
export async function sendPushToUser(userId: string, msg: PushMessage): Promise<"sent" | "skipped"> {
  const db = createAdminClient();
  const { data: subs, error } = await db.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("user_id", userId);
  if (error) throw error;
  const targets = (subs ?? []).filter((s) => isPushEndpoint(s.endpoint));
  if (!targets.length) return "skipped";
  const k = await vapidKeys();
  const url = msg.link ? (msg.link.startsWith("http") ? msg.link : `${publicEnv.appUrl}${msg.link}`) : publicEnv.appUrl;
  const payload = JSON.stringify({ title: msg.title, body: msg.body ?? "", url, tag: msg.tag });
  let sent = 0;
  const failures: string[] = [];
  await Promise.all(
    targets.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
          TTL: 60 * 60 * 24,
          urgency: "normal",
          vapidDetails: { subject: publicEnv.appUrl.startsWith("https") ? publicEnv.appUrl : "mailto:noreply@example.com", publicKey: k.public_key, privateKey: k.private_key },
        });
        sent++;
        await db.from("push_subscriptions").update({ last_success_at: new Date().toISOString() }).eq("id", s.id);
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        // 404 / 410: the browser dropped this subscription
        if (status === 404 || status === 410) await db.from("push_subscriptions").delete().eq("id", s.id);
        else failures.push(`${status ?? ""} ${(e as Error).message}`.trim());
      }
    }),
  );
  if (sent === 0 && failures.length) throw new Error(`Push failed: ${failures[0]}`);
  return sent ? "sent" : "skipped";
}
