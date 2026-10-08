import { afterAll, describe, expect, it } from "vitest";
import { pool, withSession } from "./helpers";

afterAll(() => pool.end());

const rnd = () => Math.random().toString(36).slice(2, 8);

describe("push notifications", () => {
  it("devices are private to their user; notifications are pushed only to users with a device", () =>
    withSession(async (s) => {
      const owner = await s.user(`o-${rnd()}@x.test`, "Owner");
      const o = await s.org(owner);
      const a = await s.user(`a-${rnd()}@x.test`, "A");
      const b = await s.user(`b-${rnd()}@x.test`, "B");
      await s.member(o.orgId, a, "staff");
      await s.member(o.orgId, b, "staff");

      await s.as(a);
      await s.q("insert into push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, $2, 'k', 'x')", [a, `https://push.test/${rnd()}`]);
      // can't register a device for someone else, or see theirs
      expect(await s.error("insert into push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, 'https://push.test/b', 'k', 'x')", [b])).toMatch(/row-level security/);
      await s.as(b);
      expect(await s.q("select id from push_subscriptions")).toHaveLength(0);

      await s.asAdmin();
      await s.q("select app.notify($1, $2, 'task.assigned', 'Task for A')", [o.orgId, a]);
      await s.q("select app.notify($1, $2, 'task.assigned', 'Task for B')", [o.orgId, b]);
      const pushes = await s.q<{ recipient: string; subject: string }>("select recipient, subject from message_outbox where org_id = $1 and channel = 'push'", [o.orgId]);
      expect(pushes).toEqual([{ recipient: a, subject: "Task for A" }]);

      // in-app off for a type: no push either
      await s.as(a);
      await s.q("insert into notification_preferences (user_id, org_id, type, in_app, email) values ($1, $2, 'task.assigned', false, false)", [a, o.orgId]);
      await s.asAdmin();
      await s.q("select app.notify($1, $2, 'task.assigned', 'Muted')", [o.orgId, a]);
      expect(await s.val("select count(*)::int from message_outbox where org_id = $1 and channel = 'push'", [o.orgId])).toBe(1);
    }));

  it("the push keys are for the server only", () =>
    withSession(async (s) => {
      const u = await s.user(`k-${rnd()}@x.test`);
      await s.as(u);
      expect(await s.error("select public.push_vapid_keys()")).toMatch(/permission denied/);
      expect(await s.error("select * from app.push_keys")).toMatch(/permission denied/);
      await s.as(null, "service_role");
      const first = await s.val<{ public_key: string }>("select public.push_vapid_keys('pub1', 'priv1')");
      const again = await s.val<{ public_key: string }>("select public.push_vapid_keys('pub2', 'priv2')");
      expect(again.public_key).toBe(first.public_key);
    }));
});
