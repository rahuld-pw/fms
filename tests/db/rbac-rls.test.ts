import { afterAll, describe, expect, it } from "vitest";
import { pool, withSession } from "./helpers";

afterAll(() => pool.end());

describe("has_permission scope semantics", () => {
  it("org, campus and department scoped assignments", () =>
    withSession(async (s) => {
      const owner = await s.user("owner@a.test");
      const fm = await s.user("fm@a.test");
      const hod = await s.user("hod@a.test");
      const o = await s.org(owner);
      await s.member(o.orgId, fm, "facility_manager", { campusId: o.campusA });
      await s.member(o.orgId, hod, "department_head", { departmentId: o.deptA1 });

      const check = (u: string, p: string, c: string | null, d: string | null) =>
        s.val<boolean>("select app.has_permission($1, $2, $3, $4, $5)", [u, p, o.orgId, c, d]);

      // campus-scoped: own campus and its departments, not the other campus, not org-level
      expect(await check(fm, "issue:update", o.campusA, null)).toBe(true);
      expect(await check(fm, "issue:update", null, o.deptA2)).toBe(true);
      expect(await check(fm, "issue:update", o.campusB, null)).toBe(false);
      expect(await check(fm, "issue:update", null, null)).toBe(false);
      expect(await s.val("select app.has_permission_anywhere($1, 'issue:update', $2)", [fm, o.orgId])).toBe(true);

      // department-scoped: only that department
      expect(await check(hod, "expense:approve", o.campusA, o.deptA1)).toBe(true);
      expect(await check(hod, "expense:approve", o.campusA, o.deptA2)).toBe(false);
      expect(await check(hod, "expense:approve", o.campusA, null)).toBe(false);

      // superuser owner: everything
      expect(await check(owner, "po:approve", o.campusB, o.deptB1)).toBe(true);
      expect(await check(owner, "po:approve", null, null)).toBe(true);

      // permission not in role
      expect(await check(fm, "expense:pay", o.campusA, null)).toBe(false);
    }));

  it("disabled module removes its permissions, even for superusers", () =>
    withSession(async (s) => {
      const owner = await s.user("owner@b.test");
      const o = await s.org(owner);
      await s.q("update org_modules set enabled = false where org_id = $1 and module = 'po'", [o.orgId]);
      expect(await s.val("select app.has_permission($1, 'po:approve', $2)", [owner, o.orgId])).toBe(false);
      expect(await s.val("select app.has_permission($1, 'issue:read', $2)", [owner, o.orgId])).toBe(true);
      // core permissions are unaffected
      expect(await s.val("select app.has_permission($1, 'user:manage', $2)", [owner, o.orgId])).toBe(true);
    }));

  it("suspended members and expired assignments lose access", () =>
    withSession(async (s) => {
      const owner = await s.user("owner@c.test");
      const fm = await s.user("fm@c.test");
      const o = await s.org(owner);
      await s.member(o.orgId, fm, "facility_manager");
      expect(await s.val("select app.has_permission($1, 'issue:read', $2)", [fm, o.orgId])).toBe(true);
      await s.q("update org_members set status = 'suspended' where user_id = $1", [fm]);
      expect(await s.val("select app.has_permission($1, 'issue:read', $2)", [fm, o.orgId])).toBe(false);
      await s.q("update org_members set status = 'active' where user_id = $1", [fm]);
      await s.q("update user_role_assignments set expires_at = now() - interval '1 minute' where user_id = $1", [fm]);
      expect(await s.val("select app.has_permission($1, 'issue:read', $2)", [fm, o.orgId])).toBe(false);
    }));

  it("my_permissions lists scoped grants for the current user", () =>
    withSession(async (s) => {
      const owner = await s.user("owner@d.test");
      const fm = await s.user("fm@d.test");
      const o = await s.org(owner);
      await s.member(o.orgId, fm, "facility_manager", { campusId: o.campusA });
      await s.as(fm);
      const rows = await s.q<{ permission_key: string; scope_type: string; campus_id: string }>(
        "select * from my_permissions($1) where permission_key = 'issue:update'",
        [o.orgId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].scope_type).toBe("campus");
      expect(rows[0].campus_id).toBe(o.campusA);
    }));
});

describe("row level security", () => {
  it("isolates tenants", () =>
    withSession(async (s) => {
      const ownerA = await s.user("a@tenant.test");
      const ownerB = await s.user("b@tenant.test");
      const a = await s.org(ownerA);
      const b = await s.org(ownerB);
      await s.asAdmin();
      await s.q("insert into issues (org_id, campus_id, title, number, priority) values ($1, $2, 'Leaking tap', '', 'low')", [
        a.orgId,
        a.campusA,
      ]);
      await s.as(ownerB);
      expect(await s.q("select * from issues")).toHaveLength(0);
      expect(await s.q("select * from organisations where id = $1", [a.orgId])).toHaveLength(0);
      expect(await s.q("select * from campuses where org_id = $1", [a.orgId])).toHaveLength(0);
      const err = await s.error(
        "insert into issues (org_id, campus_id, title, number, priority) values ($1, $2, 'Sneaky', '', 'low')",
        [a.orgId, a.campusA],
      );
      expect(err).toMatch(/row-level security/);
      await s.as(ownerA);
      expect(await s.q("select * from issues")).toHaveLength(1);
    }));

  it("campus-scoped managers only see their campus; reporters see their own", () =>
    withSession(async (s) => {
      const owner = await s.user("owner@e.test");
      const fm = await s.user("fm@e.test");
      const teacher = await s.user("teacher@e.test");
      const o = await s.org(owner);
      await s.member(o.orgId, fm, "facility_manager", { campusId: o.campusA });
      await s.member(o.orgId, teacher, "staff");

      await s.as(teacher);
      await s.q(
        "insert into issues (org_id, campus_id, title, number, reporter_id, priority) values ($1, $2, 'Projector broken in B', '', $3, null)",
        [o.orgId, o.campusB, teacher],
      );
      await s.asAdmin();
      await s.q("insert into issues (org_id, campus_id, title, number, priority) values ($1, $2, 'Fan noisy in A', '', 'low')", [
        o.orgId,
        o.campusA,
      ]);

      await s.as(fm);
      const fmSees = await s.q<{ title: string }>("select title from issues order by title");
      expect(fmSees.map((r) => r.title)).toEqual(["Fan noisy in A"]);

      await s.as(teacher);
      const teacherSees = await s.q<{ title: string }>("select title from issues");
      expect(teacherSees.map((r) => r.title)).toEqual(["Projector broken in B"]);

      // staff cannot report on behalf of someone else
      const err = await s.error(
        "insert into issues (org_id, campus_id, title, number, reporter_id, priority) values ($1, $2, 'Spoof', '', $3, 'low')",
        [o.orgId, o.campusA, fm],
      );
      expect(err).toMatch(/row-level security/);
    }));

  it("assignees can progress issues but not change other fields; reporters can only close/reopen", () =>
    withSession(async (s) => {
      const owner = await s.user("owner@f.test");
      const tech = await s.user("tech@f.test");
      const teacher = await s.user("teacher@f.test");
      const o = await s.org(owner);
      await s.member(o.orgId, tech, "technician", { campusId: o.campusA });
      await s.member(o.orgId, teacher, "staff");
      await s.asAdmin();
      const id = await s.val<string>(
        "insert into issues (org_id, campus_id, title, number, reporter_id, assignee_id, priority) values ($1, $2, 'AC not cooling', '', $3, $4, 'high') returning id",
        [o.orgId, o.campusA, teacher, tech],
      );
      expect(await s.val("select status from issues where id = $1", [id])).toBe("assigned");

      await s.as(tech);
      expect(await s.error("update issues set status = 'in_progress' where id = $1", [id])).toBeNull();
      expect(await s.error("update issues set priority = 'low' where id = $1", [id])).toMatch(/not allowed to change/);
      expect(await s.error("update issues set status = 'closed' where id = $1", [id])).toMatch(/cannot move|only acknowledge/);
      expect(await s.error("update issues set status = 'resolved', resolution_notes = 'Gas refilled' where id = $1", [id])).toBeNull();

      await s.as(teacher);
      expect(await s.error("update issues set status = 'cancelled' where id = $1", [id])).toMatch(/cannot move|only close/);
      expect(await s.error("update issues set rating = 5, status = 'closed' where id = $1", [id])).toBeNull();
      expect(await s.error("update issues set status = 'reopened' where id = $1", [id])).toBeNull();
      await s.asAdmin();
      const row = await s.one<{ status: string; reopened_count: number; first_response_at: string | null }>(
        "select status, reopened_count, first_response_at from issues where id = $1",
        [id],
      );
      expect(row.status).toBe("reopened");
      expect(row.reopened_count).toBe(1);
      expect(row.first_response_at).not.toBeNull();
    }));

  it("expense claims: own claims visible, department head sees department, finance sees all", () =>
    withSession(async (s) => {
      const owner = await s.user("owner@g.test");
      const teacher = await s.user("teacher@g.test");
      const other = await s.user("other@g.test");
      const hod = await s.user("hod@g.test");
      const fin = await s.user("fin@g.test");
      const o = await s.org(owner);
      await s.member(o.orgId, teacher, "staff");
      await s.member(o.orgId, other, "staff");
      await s.member(o.orgId, hod, "department_head", { departmentId: o.deptA1 });
      await s.member(o.orgId, fin, "finance_manager");

      await s.as(teacher);
      await s.q(
        "insert into expense_claims (org_id, campus_id, department_id, claimant_id, title, number) values ($1, $2, $3, $4, 'Lab chemicals', '')",
        [o.orgId, o.campusA, o.deptA1, teacher],
      );
      await s.as(other);
      expect(await s.q("select * from expense_claims")).toHaveLength(0);
      await s.as(hod);
      expect(await s.q("select * from expense_claims")).toHaveLength(1);
      await s.as(fin);
      expect(await s.q("select * from expense_claims")).toHaveLength(1);
      // staff cannot file a claim for someone else
      await s.as(other);
      expect(
        await s.error(
          "insert into expense_claims (org_id, campus_id, claimant_id, title, number) values ($1, $2, $3, 'x', '')",
          [o.orgId, o.campusA, teacher],
        ),
      ).toMatch(/row-level security/);
    }));

  it("prevents privilege escalation via role assignment", () =>
    withSession(async (s) => {
      const owner = await s.user("owner@h.test");
      const admin = await s.user("admin@h.test");
      const campusAdmin = await s.user("cadmin@h.test");
      const victim = await s.user("victim@h.test");
      const o = await s.org(owner);
      await s.member(o.orgId, admin, "admin");
      await s.member(o.orgId, victim, "staff");
      // a custom role with user:manage held only at campus scope
      await s.asAdmin();
      const roleId = await s.val<string>(
        "insert into roles (org_id, key, name) values ($1, 'campus_admin', 'Campus Admin') returning id",
        [o.orgId],
      );
      await s.q("insert into role_permissions values ($1, 'user:manage')", [roleId]);
      await s.member(o.orgId, campusAdmin, "campus_admin", { campusId: o.campusA });

      const superRole = await s.val<string>("select id from roles where org_id = $1 and key = 'admin'", [o.orgId]);
      const fmRole = await s.val<string>("select id from roles where org_id = $1 and key = 'facility_manager'", [o.orgId]);

      await s.as(campusAdmin);
      expect(
        await s.error(
          "insert into user_role_assignments (org_id, user_id, role_id, scope_type) values ($1, $2, $3, 'org')",
          [o.orgId, victim, fmRole],
        ),
      ).toMatch(/row-level security/);

      // a non-owner admin can assign normal roles but not superuser roles
      await s.as(admin);
      expect(
        await s.error(
          "insert into user_role_assignments (org_id, user_id, role_id, scope_type) values ($1, $2, $3, 'org')",
          [o.orgId, victim, fmRole],
        ),
      ).toBeNull();
      expect(
        await s.error(
          "insert into user_role_assignments (org_id, user_id, role_id, scope_type) values ($1, $2, $3, 'org')",
          [o.orgId, victim, superRole],
        ),
      ).toMatch(/row-level security/);
      // system roles cannot be edited
      expect(await s.error("update roles set name = 'x' where id = $1", [superRole])).toBeNull();
      expect(await s.val("select name from roles where id = $1", [superRole])).toBe("Administrator");

      await s.as(owner);
      expect(
        await s.error(
          "insert into user_role_assignments (org_id, user_id, role_id, scope_type) values ($1, $2, $3, 'org')",
          [o.orgId, victim, superRole],
        ),
      ).toBeNull();
    }));

  it("disabling a module hides its rows", () =>
    withSession(async (s) => {
      const owner = await s.user("owner@i.test");
      const fin = await s.user("fin@i.test");
      const o = await s.org(owner);
      await s.member(o.orgId, fin, "finance_manager");
      await s.asAdmin();
      const vendor = await s.val<string>(
        "insert into vendors (org_id, name, status) values ($1, 'Acme', 'approved') returning id",
        [o.orgId],
      );
      await s.as(fin);
      expect(await s.q("select id from vendors where id = $1", [vendor])).toHaveLength(1);
      await s.asAdmin();
      await s.q("update org_modules set enabled = false where org_id = $1 and module = 'facility'", [o.orgId]);
      await s.as(fin);
      expect(await s.q("select id from vendors where id = $1", [vendor])).toHaveLength(0);
    }));

  it("comments and attachments follow the parent entity's visibility", () =>
    withSession(async (s) => {
      const owner = await s.user("owner@j.test");
      const teacher = await s.user("teacher@j.test");
      const other = await s.user("other@j.test");
      const o = await s.org(owner);
      await s.member(o.orgId, teacher, "staff");
      await s.member(o.orgId, other, "staff");
      await s.as(teacher);
      const claim = await s.val<string>(
        "insert into expense_claims (org_id, campus_id, claimant_id, title, number) values ($1, $2, $3, 'Taxi', '') returning id",
        [o.orgId, o.campusA, teacher],
      );
      await s.q(
        "insert into comments (org_id, entity_type, entity_id, body, author_id) values ($1, 'expense_claim', $2, 'Receipt attached', $3)",
        [o.orgId, claim, teacher],
      );
      expect(await s.q("select * from comments")).toHaveLength(1);
      await s.as(other);
      expect(await s.q("select * from comments")).toHaveLength(0);
      expect(
        await s.error(
          "insert into comments (org_id, entity_type, entity_id, body, author_id) values ($1, 'expense_claim', $2, 'hi', $3)",
          [o.orgId, claim, other],
        ),
      ).toMatch(/row-level security/);
      expect(
        await s.error(
          "insert into attachments (org_id, entity_type, entity_id, path, file_name, uploaded_by) values ($1, 'expense_claim', $2, $3, 'x.pdf', $4)",
          [o.orgId, claim, `${o.orgId}/expense_claim/${claim}/x.pdf`, other],
        ),
      ).toMatch(/row-level security/);
    }));

  it("audit trail records changes with the acting user", () =>
    withSession(async (s) => {
      const owner = await s.user("owner@k.test");
      const o = await s.org(owner);
      await s.as(owner);
      const id = await s.val<string>(
        "insert into vendors (org_id, name, status) values ($1, 'Audit Co', 'draft') returning id",
        [o.orgId],
      );
      await s.q("update vendors set phone = '9999999999' where id = $1", [id]);
      await s.asAdmin();
      const rows = await s.q<{ action: string; actor_id: string; changes: Record<string, unknown> | null }>(
        "select action, actor_id, changes from activity_log where entity_id = $1 order by id",
        [id],
      );
      expect(rows.map((r) => r.action)).toEqual(["created", "updated"]);
      expect(rows[1].actor_id).toBe(owner);
      expect(rows[1].changes).toEqual({ phone: [null, "9999999999"] });
      // and an event was queued for webhooks
      expect(await s.val("select count(*)::int from events_outbox where entity_id = $1", [id])).toBe(2);
    }));
});
