import { afterAll, describe, expect, it } from "vitest";
import { pool, withSession } from "./helpers";

afterAll(() => pool.end());

const rnd = () => Math.random().toString(36).slice(2, 8);

describe("feedback & NPS", () => {
  it("members answer once (re-answering updates), NPS is promoters minus detractors, anonymous hides names", () =>
    withSession(async (s) => {
      const owner = await s.user(`o-${rnd()}@x.test`, "Owner");
      const o = await s.org(owner);
      const staff = await Promise.all([1, 2, 3, 4].map((n) => s.user(`s${n}-${rnd()}@x.test`, `Staff ${n}`)));
      for (const u of staff) await s.member(o.orgId, u, "staff");
      await s.asAdmin();
      expect(await s.val("select 'surveys' = any (licensed_modules) from organisations where id = $1", [o.orgId])).toBe(true);

      await s.as(owner);
      const survey = await s.val<string>(
        "insert into surveys (org_id, title, question, status, anonymous) values ($1, 'Staff pulse', 'How likely are you to recommend us?', 'active', true) returning id",
        [o.orgId],
      );
      // staff can't create surveys or read results
      await s.as(staff[0]);
      expect(await s.error("insert into surveys (org_id, title, question) values ($1, 'x', 'Is this allowed?')", [o.orgId])).toMatch(/row-level security/);
      expect(await s.q("select * from public.my_pending_surveys($1)", [o.orgId])).toHaveLength(1);
      expect(await s.error("select public.survey_results($1)", [survey])).toMatch(/not found/);

      const scores = [10, 9, 7, 3];
      for (const [i, u] of staff.entries()) {
        await s.as(u);
        await s.q("select public.survey_respond($1, $2::smallint, $3)", [survey, scores[i] === 9 ? 2 : scores[i], `comment ${i}`]);
      }
      // staff 2 changes their mind: 2 -> 9
      await s.as(staff[1]);
      await s.q("select public.survey_respond($1, 9::smallint, 'better now')", [survey]);
      expect(await s.q("select * from public.my_pending_surveys($1)", [o.orgId])).toHaveLength(0);
      expect(await s.q("select id from survey_responses where survey_id = $1", [survey])).toHaveLength(1); // only their own

      await s.as(owner);
      const r = await s.val<{ responses: number; promoters: number; detractors: number; nps: number; comments: { name: string | null }[] }>(
        "select public.survey_results($1)",
        [survey],
      );
      expect(r.responses).toBe(4);
      expect([r.promoters, r.detractors]).toEqual([2, 1]);
      expect(Number(r.nps)).toBe(25); // (2 - 1) / 4
      expect(r.comments.every((c) => c.name === null)).toBe(true); // anonymous survey
      const list = await s.q<{ responses: string; score: string }>("select * from public.survey_overview($1)", [o.orgId]);
      expect(Number(list[0].score)).toBe(25);
    }));

  it("CSAT scores are 1-5; public answers need the service role; closed surveys take no answers", () =>
    withSession(async (s) => {
      const owner = await s.user(`o-${rnd()}@x.test`);
      const o = await s.org(owner);
      await s.as(owner);
      const csat = await s.val<string>(
        "insert into surveys (org_id, title, kind, question, status, audience) values ($1, 'Canteen', 'csat', 'How was the food today?', 'active', 'both') returning id",
        [o.orgId],
      );
      expect(await s.error("select public.survey_respond($1, 8::smallint)", [csat])).toMatch(/between 1 and 5/);
      const token = await s.val<string>("select public_token from surveys where id = $1", [csat]);
      expect(await s.error("select public.public_survey_respond($1, 4::smallint)", [token])).toMatch(/forbidden|permission denied/);
      await s.asAdmin();
      await s.q("set local request.jwt.claims = '{\"role\":\"service_role\"}'");
      await s.q("select public.public_survey_respond($1, 5::smallint, 'Tasty', 'parent', 'A Parent', 'p@x.test')", [token]);
      await s.q("update surveys set status = 'closed' where id = $1", [csat]);
      expect(await s.error("select public.public_survey_respond($1, 4::smallint)", [token])).toMatch(/not open/);
      expect(await s.val("select public.public_survey($1)", [token])).toBeNull();
    }));

  it("credits the resolver and reports ratings per resolver", () =>
    withSession(async (s) => {
      const owner = await s.user(`o-${rnd()}@x.test`);
      const tech = await s.user(`t-${rnd()}@x.test`, "Tech One");
      const o = await s.org(owner);
      await s.member(o.orgId, tech, "technician");
      await s.asAdmin();
      const issue = await s.val<string>(
        "insert into issues (org_id, campus_id, title, priority, reporter_id, assignee_id) values ($1, $2, 'Fan broken', 'medium', $3, $4) returning id",
        [o.orgId, o.campusA, owner, tech],
      );
      await s.q("update issues set status = 'resolved', resolved_at = now() where id = $1", [issue]);
      expect(await s.val("select resolved_by from issues where id = $1", [issue])).toBe(tech);
      await s.as(owner);
      await s.q("update issues set rating = 4, feedback = 'Quick fix', status = 'closed' where id = $1", [issue]);
      const fb = await s.val<{ rated: number; average: string; resolvers: { name: string; average: string }[] }>(
        "select public.resolution_feedback($1, 30)",
        [o.orgId],
      );
      expect(fb.rated).toBe(1);
      expect(fb.resolvers[0]).toMatchObject({ name: "Tech One" });
      expect(Number(fb.resolvers[0].average)).toBe(4);
      await s.as(tech);
      const a = await s.val<{ me: { rating_avg: string; rating_count: number } }>("select public.org_analytics($1, 30)", [o.orgId]);
      expect(Number(a.me.rating_avg)).toBe(4);
    }));

  it("personal workspaces don't get the module", () =>
    withSession(async (s) => {
      const u = await s.user(`p-${rnd()}@x.test`, "Pat");
      await s.as(u);
      const ws = await s.val<string>("select public.create_personal_workspace()");
      expect(await s.val("select public.member_modules($1)", [ws])).toEqual(["tasks"]);
    }));
});
