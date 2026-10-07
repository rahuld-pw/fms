import { afterAll, describe, expect, it } from "vitest";
import { pool, withSession, type Session } from "./helpers";

afterAll(() => pool.end());

const rnd = () => Math.random().toString(36).slice(2, 8);

async function platformAdmin(s: Session) {
  await s.asAdmin();
  const email = `root-${rnd()}@platform.test`;
  await s.q("insert into platform_admin_emails (email) values ($1)", [email]);
  return s.user(email);
}

describe("platform admins", () => {
  it("an allow-listed email becomes platform admin on sign-up; others do not", () =>
    withSession(async (s) => {
      const admin = await platformAdmin(s);
      const other = await s.user(`someone-${rnd()}@x.test`);
      await s.as(admin);
      expect(await s.val("select public.am_platform_admin()")).toBe(true);
      await s.as(other);
      expect(await s.val("select public.am_platform_admin()")).toBe(false);
    }));

  it("only platform admins create organisations; self-service creation is closed", () =>
    withSession(async (s) => {
      const admin = await platformAdmin(s);
      const user = await s.user(`u-${rnd()}@x.test`);
      await s.as(user);
      expect(await s.error("select public.create_organisation('Rogue School', 'rogue-" + rnd() + "')")).toMatch(/platform administrator/);
      expect(await s.error("select public.admin_create_organisation('X', 'x-" + rnd() + "', 'a@x.test')")).toMatch(/platform admin only/);

      await s.as(admin);
      const res = await s.val<{ org_id: string; invite_token: string }>(
        "select public.admin_create_organisation('Sunrise School', $1, 'principal@sunrise.test', 'Principal', array['facility','tasks','po'])",
        [`sunrise-${rnd()}`],
      );
      expect(res.invite_token.length).toBeGreaterThan(20);
      await s.asAdmin();
      const org = await s.one<{ licensed_modules: string[]; kind: string }>("select licensed_modules, kind from organisations where id = $1", [res.org_id]);
      expect(org.kind).toBe("organisation");
      expect(org.licensed_modules.sort()).toEqual(["expense", "facility", "po", "tasks"]); // PO pulls in Expenses
      // platform admin is not a member and cannot read tenant rows
      await s.as(admin);
      expect(await s.q("select id from campuses where org_id = $1", [res.org_id])).toHaveLength(0);
      const listed = await s.q<{ id: string; pending_invites: number }>("select * from public.admin_list_organisations()");
      expect(Number(listed.find((o) => o.id === res.org_id)?.pending_invites)).toBe(1);

      // the invited first admin becomes owner of the organisation
      const principal = await s.user("principal@sunrise.test");
      await s.as(principal);
      expect(await s.val("select public.accept_invitation($1)", [res.invite_token])).toBe(res.org_id);
      expect(await s.val("select public.accept_invitation($1)", [res.invite_token])).toBe(res.org_id); // idempotent
      await s.asAdmin();
      expect(await s.val("select is_owner from org_members where org_id = $1 and user_id = $2", [res.org_id, principal])).toBe(true);
      await s.as(principal);
      expect(await s.val("select app.has_permission(auth.uid(), 'role:manage', $1)", [res.org_id])).toBe(true);
    }));
});

describe("licensing and module access", () => {
  it("org admins cannot enable unlicensed modules or change the licence", () =>
    withSession(async (s) => {
      const owner = await s.user(`o-${rnd()}@x.test`);
      const o = await s.org(owner);
      await s.asAdmin();
      await s.q("update organisations set licensed_modules = array['tasks','facility'] where id = $1", [o.orgId]);
      expect(await s.val("select enabled from org_modules where org_id = $1 and module = 'po'", [o.orgId])).toBe(false);
      await s.as(owner);
      expect(await s.error("update org_modules set enabled = true where org_id = $1 and module = 'po'", [o.orgId])).toMatch(/not included/);
      expect(await s.error("update organisations set licensed_modules = array['tasks','facility','po','expense'] where id = $1", [o.orgId])).toMatch(/platform admin/);
      expect(await s.val("select app.has_permission(auth.uid(), 'po:read', $1)", [o.orgId])).toBe(false);
      expect(await s.val("select app.has_permission(auth.uid(), 'issue:read', $1)", [o.orgId])).toBe(true);
    }));

  it("enabling Purchasing switches Expenses on; disabling Expenses switches Purchasing off", () =>
    withSession(async (s) => {
      const owner = await s.user(`o-${rnd()}@x.test`);
      const o = await s.org(owner);
      await s.asAdmin();
      await s.q("update org_modules set enabled = false where org_id = $1 and module in ('po','expense')", [o.orgId]);
      await s.q("update org_modules set enabled = true where org_id = $1 and module = 'po'", [o.orgId]);
      expect(await s.val("select enabled from org_modules where org_id = $1 and module = 'expense'", [o.orgId])).toBe(true);
      await s.q("update org_modules set enabled = false where org_id = $1 and module = 'expense'", [o.orgId]);
      expect(await s.val("select enabled from org_modules where org_id = $1 and module = 'po'", [o.orgId])).toBe(false);
    }));

  it("per-member module access limits permissions, the module list and RLS", () =>
    withSession(async (s) => {
      const owner = await s.user(`o-${rnd()}@x.test`);
      const fm = await s.user(`fm-${rnd()}@x.test`);
      const o = await s.org(owner);
      await s.member(o.orgId, fm, "facility_manager");
      await s.as(fm);
      expect(await s.val("select app.has_permission(auth.uid(), 'issue:read', $1)", [o.orgId])).toBe(true);
      await s.asAdmin();
      await s.q("update org_members set module_access = array['tasks'] where org_id = $1 and user_id = $2", [o.orgId, fm]);
      await s.as(fm);
      expect(await s.val("select app.has_permission(auth.uid(), 'issue:read', $1)", [o.orgId])).toBe(false);
      expect(await s.val("select public.member_modules($1)", [o.orgId])).toEqual(["tasks"]);
      expect(await s.q("select * from public.my_permissions($1) where permission_key like 'issue:%'", [o.orgId])).toHaveLength(0);
      // checks made on behalf of another user use that user's access, not the caller's
      await s.as(owner);
      expect(await s.val("select app.has_permission($2, 'issue:read', $1)", [o.orgId, fm])).toBe(false);
      expect(await s.val("select app.has_permission(auth.uid(), 'issue:read', $1)", [o.orgId])).toBe(true);
    }));

  it("suspended organisations disappear for their members", () =>
    withSession(async (s) => {
      const admin = await platformAdmin(s);
      const owner = await s.user(`o-${rnd()}@x.test`);
      const o = await s.org(owner);
      await s.as(owner);
      expect(await s.q("select id from campuses where org_id = $1", [o.orgId])).toHaveLength(2);
      await s.as(admin);
      await s.q("select public.admin_update_organisation($1, p_status => 'suspended')", [o.orgId]);
      await s.as(owner);
      expect(await s.q("select id from campuses where org_id = $1", [o.orgId])).toHaveLength(0);
      expect(await s.val("select app.has_permission(auth.uid(), 'issue:read', $1)", [o.orgId])).toBe(false);
    }));
});

describe("public sign-ups", () => {
  it("get a personal workspace with Tasks only, idempotently", () =>
    withSession(async (s) => {
      const user = await s.user(`public-${rnd()}@gmail.test`, "Asha");
      await s.as(user);
      const ws = await s.val<string>("select public.create_personal_workspace()");
      expect(await s.val("select public.create_personal_workspace()")).toBe(ws);
      expect(await s.val("select public.member_modules($1)", [ws])).toEqual(["tasks"]);
      expect(await s.val("select app.has_permission(auth.uid(), 'task:create', $1)", [ws])).toBe(true);
      expect(await s.val("select app.has_permission(auth.uid(), 'issue:create', $1)", [ws])).toBe(false);
      expect(await s.error("update org_modules set enabled = true where org_id = $1 and module = 'facility'", [ws])).toMatch(/not included/);
      await s.asAdmin();
      expect(await s.one("select name, kind from organisations where id = $1", [ws])).toEqual({ name: "Asha's workspace", kind: "personal" });
      // no setup noise: no approval policies for other modules, empty activity feed
      expect(await s.q("select id from approval_policies where org_id = $1 and module <> 'tasks'", [ws])).toHaveLength(0);
      expect(await s.q("select id from activity_log where org_id = $1", [ws])).toHaveLength(0);
    }));
});

describe("feedback", () => {
  it("submitters see their own reports; platform admins see and triage all", () =>
    withSession(async (s) => {
      const admin = await platformAdmin(s);
      const a = await s.user(`a-${rnd()}@x.test`);
      const b = await s.user(`b-${rnd()}@x.test`);
      await s.asAdmin();
      const id = await s.val<string>("insert into feedback (kind, title, description, user_id) values ('bug', 'Broken button', 'Steps...', $1) returning id", [a]);
      await s.as(b);
      expect(await s.q("select id from feedback where id = $1", [id])).toHaveLength(0);
      await s.as(a);
      expect(await s.q("select id from feedback where id = $1", [id])).toHaveLength(1);
      expect(await s.q("update feedback set status = 'done' where id = $1 returning id", [id])).toHaveLength(0);
      await s.as(admin);
      expect(await s.q("update feedback set status = 'planned' where id = $1 returning id", [id])).toHaveLength(1);
    }));
});
