import { afterAll, describe, expect, it } from "vitest";
import { pool, withSession } from "./helpers";

afterAll(() => pool.end());

const rnd = () => Math.random().toString(36).slice(2, 8);
type Analytics = {
  scope: { level: string; campuses: string[]; departments: string[]; direct_reports: number };
  facility?: { issues_opened: number };
  people: { user_id: string }[];
  modules: string[];
};

describe("analytics", () => {
  it("scope follows the caller's roles and RLS limits the numbers", () =>
    withSession(async (s) => {
      const owner = await s.user(`o-${rnd()}@x.test`);
      const fm = await s.user(`fm-${rnd()}@x.test`);
      const tech = await s.user(`t-${rnd()}@x.test`);
      const staff = await s.user(`s-${rnd()}@x.test`);
      const o = await s.org(owner);
      await s.member(o.orgId, fm, "facility_manager", { campusId: o.campusA });
      await s.member(o.orgId, tech, "technician", {}, { managerId: fm });
      await s.member(o.orgId, staff, "staff");
      await s.asAdmin();
      for (const campus of [o.campusA, o.campusB])
        await s.q(
          "insert into issues (org_id, campus_id, title, priority, reporter_id, assignee_id) values ($1, $2, 'Leak', 'high', $3, $4)",
          [o.orgId, campus, owner, tech],
        );

      const get = async (who: string) => {
        await s.as(who);
        return s.val<Analytics>("select public.org_analytics($1, 30)", [o.orgId]);
      };
      const own = await get(owner);
      expect(own.scope.level).toBe("organisation");
      expect(own.facility?.issues_opened).toBe(2);
      expect(own.people.map((p) => p.user_id)).toContain(tech);

      const mgr = await get(fm);
      expect(mgr.scope.level).toBe("campus");
      expect(mgr.scope.direct_reports).toBe(1);
      expect(mgr.facility?.issues_opened).toBe(1); // only their campus

      const me = await get(staff);
      expect(me.scope.level).toBe("personal");
      expect(me.people.every((p) => p.user_id === staff)).toBe(true);
    }));

  it("is limited to members; platform analytics to platform admins", () =>
    withSession(async (s) => {
      const owner = await s.user(`o-${rnd()}@x.test`);
      const o = await s.org(owner);
      await s.asAdmin();
      const rootEmail = `root-${rnd()}@platform.test`;
      await s.q("insert into platform_admin_emails (email) values ($1)", [rootEmail]);
      const root = await s.user(rootEmail);

      await s.as(root);
      expect(await s.error("select public.org_analytics($1)", [o.orgId])).toMatch(/forbidden/);
      const p = await s.val<{ organisations: number; users: number }>("select public.platform_analytics(30)");
      expect(Number(p.organisations)).toBeGreaterThanOrEqual(1);

      await s.as(owner);
      expect(await s.error("select public.platform_analytics(30)")).toMatch(/platform admin only/);
    }));
});
