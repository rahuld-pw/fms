import { afterAll, describe, expect, it } from "vitest";
import { pool, withSession } from "./helpers";

afterAll(() => pool.end());

const rnd = () => Math.random().toString(36).slice(2, 8);

describe("anonymous issue reporting", () => {
  it("hides the reporter from everyone but organisation admins; the reporter keeps their rights", () =>
    withSession(async (s) => {
      const owner = await s.user(`o-${rnd()}@x.test`, "Owner");
      const o = await s.org(owner);
      const reporter = await s.user(`r-${rnd()}@x.test`, "Ravi Reporter");
      const manager = await s.user(`m-${rnd()}@x.test`, "Meena Manager");
      const colleague = await s.user(`c-${rnd()}@x.test`, "Chetan Colleague");
      await s.member(o.orgId, reporter, "staff");
      await s.member(o.orgId, manager, "facility_manager");
      await s.member(o.orgId, colleague, "staff");

      // reporting anonymously as yourself; the row comes back (INSERT ... RETURNING)
      await s.as(reporter);
      const issue = await s.val<string>(
        "insert into issues (org_id, campus_id, title, number, priority, reporter_id, is_anonymous) values ($1, $2, 'Harassment near the staff room', '', 'high', $3, true) returning id",
        [o.orgId, o.campusA, reporter],
      );
      const mine = await s.one<{ reporter_id: string | null; created_by: string | null; me: boolean }>(
        "select i.reporter_id, i.created_by, public.reported_by_me(i) as me from issues i where id = $1", [issue]);
      expect(mine).toEqual({ reporter_id: null, created_by: null, me: true });
      expect(await s.q("select user_id from issue_reporter_identities where issue_id = $1", [issue])).toHaveLength(1);
      // can't report anonymously "for" someone else's token or switch it to named
      expect(await s.error("update issues set is_anonymous = false where id = $1", [issue])).toMatch(/anonymous|not allowed/);

      // a comment from the reporter carries no name
      await s.q("insert into comments (org_id, entity_type, entity_id, body, author_id) values ($1, 'issue', $2, 'It happened again today', $3)", [o.orgId, issue, reporter]);

      // the facility manager handles the issue without knowing who reported it
      await s.as(manager);
      const seen = await s.one<{ reporter_id: string | null; created_by: string | null; updated_by: string | null; me: boolean }>(
        "select i.reporter_id, i.created_by, i.updated_by, public.reported_by_me(i) as me from issues i where id = $1", [issue]);
      expect(seen).toEqual({ reporter_id: null, created_by: null, updated_by: null, me: false });
      expect(await s.q("select * from issue_reporter_identities where issue_id = $1", [issue])).toHaveLength(0);
      const comment = await s.one<{ author_id: string | null; author_label: string }>("select author_id, author_label from comments where entity_id = $1", [issue]);
      expect(comment).toEqual({ author_id: null, author_label: "Anonymous reporter" });
      const actors = await s.q<{ actor_id: string | null }>("select actor_id from activity_log where entity_id = $1", [issue]);
      expect(actors.length).toBeGreaterThan(0);
      expect(actors.some((a) => a.actor_id === reporter)).toBe(false);
      await s.q("update issues set status = 'resolved', resolution_notes = 'Spoke to the people involved' where id = $1", [issue]);

      // other staff can't see it at all
      await s.as(colleague);
      expect(await s.q("select id from issues where id = $1", [issue])).toHaveLength(0);

      // the reporter was told, and can close and rate it — still without their name
      await s.as(reporter);
      expect(await s.val("select count(*)::int from notifications where user_id = $1 and type = 'issue.status_changed'", [reporter])).toBe(1);
      await s.q("update issues set status = 'closed', rating = 4, feedback = 'Thank you' where id = $1", [issue]);
      await s.asAdmin();
      const after = await s.one<{ updated_by: string | null; rating: number }>("select updated_by, rating from issues where id = $1", [issue]);
      expect(after).toEqual({ updated_by: null, rating: 4 });

      // organisation admins (owner) see who reported it
      await s.as(owner);
      const who = await s.q<{ user_id: string }>("select user_id from issue_reporter_identities where issue_id = $1", [issue]);
      expect(who).toEqual([{ user_id: reporter }]);
    }));

  it("the token key is server-only", () =>
    withSession(async (s) => {
      const u = await s.user(`k-${rnd()}@x.test`);
      await s.as(u);
      expect(await s.error("select * from app.confidential_keys")).toMatch(/permission denied/);
      expect(await s.error("select app.reporter_token(gen_random_uuid(), gen_random_uuid())")).toMatch(/permission denied/);
    }));
});
