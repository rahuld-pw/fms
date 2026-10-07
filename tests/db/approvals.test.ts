import { afterAll, describe, expect, it } from "vitest";
import { pool, withSession, type Session } from "./helpers";

afterAll(() => pool.end());

/** Org with: teacher (reports to hod), hod (dept head of Science/A), finance manager. */
async function setup(s: Session) {
  const owner = await s.user(`owner-${Math.random()}@ap.test`);
  const teacher = await s.user(`teacher-${Math.random()}@ap.test`);
  const hod = await s.user(`hod-${Math.random()}@ap.test`);
  const fin = await s.user(`fin-${Math.random()}@ap.test`);
  const o = await s.org(owner);
  await s.member(o.orgId, hod, "department_head", { departmentId: o.deptA1 });
  await s.member(o.orgId, teacher, "staff", {}, { managerId: hod, departmentId: o.deptA1 });
  await s.member(o.orgId, fin, "finance_manager");
  await s.asAdmin();
  const category = await s.val<string>(
    "insert into expense_categories (org_id, name, code) values ($1, 'Travel', 'TRV') returning id",
    [o.orgId],
  );
  return { ...o, owner, teacher, hod, fin, category };
}

async function draftClaim(s: Session, ctx: Awaited<ReturnType<typeof setup>>, amount: number) {
  await s.as(ctx.teacher);
  const claim = await s.val<string>(
    `insert into expense_claims (org_id, campus_id, department_id, claimant_id, title, number)
     values ($1, $2, $3, $4, 'Conference travel', '') returning id`,
    [ctx.orgId, ctx.campusA, ctx.deptA1, ctx.teacher],
  );
  await s.q(
    `insert into expense_items (org_id, claim_id, category_id, expense_date, description, amount, receipt_attachment_id)
     values ($1, $2, $3, current_date, 'Train tickets', $4, null)`,
    [ctx.orgId, claim, ctx.category, amount],
  );
  // satisfy the receipt rule with a claim-level attachment
  await s.q(
    `insert into attachments (org_id, entity_type, entity_id, path, file_name, uploaded_by)
     values ($1, 'expense_claim', $2, $3, 'receipt.pdf', $4)`,
    [ctx.orgId, claim, `${ctx.orgId}/expense_claim/${claim}/receipt.pdf`, ctx.teacher],
  );
  return claim;
}

const claimStatus = (s: Session, id: string) =>
  s.asAdmin().then(() => s.val<string>("select status from expense_claims where id = $1", [id]));

describe("approval engine", () => {
  it("auto-approves below the threshold", () =>
    withSession(async (s) => {
      const ctx = await setup(s);
      const claim = await draftClaim(s, ctx, 1500);
      const res = await s.val<{ status: string }>("select expense_claim_submit($1)", [claim]);
      expect(res.status).toBe("approved");
      await s.asAdmin();
      const req = await s.one<{ status: string; auto_approved: boolean }>(
        "select status, auto_approved from approval_requests where entity_id = $1",
        [claim],
      );
      expect(req).toEqual({ status: "approved", auto_approved: true });
    }));

  it("routes through the reporting manager only for mid-sized claims", () =>
    withSession(async (s) => {
      const ctx = await setup(s);
      const claim = await draftClaim(s, ctx, 5000);
      await s.q("select expense_claim_submit($1)", [claim]);
      expect(await claimStatus(s, claim)).toBe("pending_approval");

      const reqId = await s.val<string>("select id from approval_requests where entity_id = $1", [claim]);
      const steps = await s.q<{ step_order: number; status: string }>(
        "select step_order, status from approval_request_steps where request_id = $1 order by step_order",
        [reqId],
      );
      expect(steps).toEqual([
        { step_order: 1, status: "pending" },
        { step_order: 2, status: "waiting" },
      ]);

      // finance is not the approver of step 1
      await s.as(ctx.fin);
      expect(await s.error("select approval_act($1, 'approve')", [reqId])).toMatch(/not an approver/);
      // approver sees it in their inbox and approves
      await s.as(ctx.hod);
      expect(await s.q("select id from approval_inbox($1)", [ctx.orgId])).toHaveLength(1);
      expect(await s.val("select approval_act($1, 'approve', 'ok')", [reqId])).toBe("approved");
      expect(await claimStatus(s, claim)).toBe("approved");
      // the finance step was skipped because the amount is below 25,000
      await s.asAdmin();
      expect(
        await s.val("select status from approval_request_steps where request_id = $1 and step_order = 2", [reqId]),
      ).toBe("skipped");
      // the claimant was notified
      expect(
        await s.val("select count(*)::int from notifications where user_id = $1 and type = 'approval.approved'", [
          ctx.teacher,
        ]),
      ).toBe(1);
    }));

  it("requires both levels for large claims, in order", () =>
    withSession(async (s) => {
      const ctx = await setup(s);
      const claim = await draftClaim(s, ctx, 30000);
      await s.q("select expense_claim_submit($1)", [claim]);
      const reqId = await s.val<string>("select id from approval_requests where entity_id = $1", [claim]);
      await s.as(ctx.hod);
      expect(await s.val("select approval_act($1, 'approve')", [reqId])).toBe("pending");
      expect(await claimStatus(s, claim)).toBe("pending_approval");
      // hod cannot approve the finance step
      await s.as(ctx.hod);
      expect(await s.error("select approval_act($1, 'approve')", [reqId])).toMatch(/not an approver/);
      await s.as(ctx.fin);
      expect(await s.val("select approval_act($1, 'approve')", [reqId])).toBe("approved");
      expect(await claimStatus(s, claim)).toBe("approved");
      // approval posted the actual spend into the budget ledger only if a budget exists (none here)
      await s.asAdmin();
      expect(await s.val("select count(*)::int from budget_ledger where source_id = $1", [claim])).toBe(0);
    }));

  it("prevents self-approval and requires a comment to reject", () =>
    withSession(async (s) => {
      const ctx = await setup(s);
      // the hod files a claim; hod has expense:approve for their department via the fallback
      await s.asAdmin();
      await s.q("update org_members set manager_id = $2 where user_id = $1 and org_id = $3", [ctx.hod, ctx.hod, ctx.orgId]);
      await s.as(ctx.hod);
      const claim = await s.val<string>(
        `insert into expense_claims (org_id, campus_id, department_id, claimant_id, title, number)
         values ($1, $2, $3, $4, 'Books', '') returning id`,
        [ctx.orgId, ctx.campusA, ctx.deptA1, ctx.hod],
      );
      await s.q(
        `insert into expense_items (org_id, claim_id, category_id, expense_date, description, amount)
         values ($1, $2, $3, current_date, 'Books', 1999)`,
        [ctx.orgId, claim, ctx.category],
      );
      await s.q(
        `insert into attachments (org_id, entity_type, entity_id, path, file_name, uploaded_by)
         values ($1, 'expense_claim', $2, $3, 'r.pdf', $4)`,
        [ctx.orgId, claim, `${ctx.orgId}/x/r.pdf`, ctx.hod],
      );
      await s.asAdmin();
      // force the non-auto policy for this test
      await s.q("update approval_policies set active = false where org_id = $1 and auto_approve", [ctx.orgId]);
      await s.as(ctx.hod);
      await s.q("select expense_claim_submit($1)", [claim]);
      const reqId = await s.val<string>("select id from approval_requests where entity_id = $1", [claim]);
      expect(await s.error("select approval_act($1, 'approve')", [reqId])).toMatch(/own request/);
      await s.as(ctx.fin);
      // finance is not the reporting manager either
      expect(await s.error("select approval_act($1, 'reject')", [reqId])).toMatch(/comment is required|not an approver/);
    }));

  it("rejection ends the request and the claim can be resubmitted", () =>
    withSession(async (s) => {
      const ctx = await setup(s);
      const claim = await draftClaim(s, ctx, 5000);
      await s.q("select expense_claim_submit($1)", [claim]);
      const reqId = await s.val<string>("select id from approval_requests where entity_id = $1", [claim]);
      await s.as(ctx.hod);
      expect(await s.error("select approval_act($1, 'reject')", [reqId])).toMatch(/comment is required/);
      expect(await s.val("select approval_act($1, 'reject', 'Missing boarding pass')", [reqId])).toBe("rejected");
      expect(await claimStatus(s, claim)).toBe("rejected");
      await s.as(ctx.teacher);
      const res = await s.val<{ status: string }>("select expense_claim_submit($1)", [claim]);
      expect(res.status).toBe("pending_approval");
      await s.asAdmin();
      expect(await s.val("select count(*)::int from approval_requests where entity_id = $1", [claim])).toBe(2);
    }));

  it("supports delegation", () =>
    withSession(async (s) => {
      const ctx = await setup(s);
      const deputy = await s.user(`deputy-${Math.random()}@ap.test`);
      await s.member(ctx.orgId, deputy, "staff");
      await s.as(ctx.hod);
      await s.q(
        `insert into approval_delegations (org_id, delegator_id, delegate_id, ends_at, reason)
         values ($1, $2, $3, now() + interval '7 days', 'On leave')`,
        [ctx.orgId, ctx.hod, deputy],
      );
      const claim = await draftClaim(s, ctx, 5000);
      await s.q("select expense_claim_submit($1)", [claim]);
      const reqId = await s.val<string>("select id from approval_requests where entity_id = $1", [claim]);
      await s.as(deputy);
      expect(await s.q("select id from approval_inbox($1)", [ctx.orgId])).toHaveLength(1);
      expect(await s.val("select approval_act($1, 'approve')", [reqId])).toBe("approved");
      await s.asAdmin();
      const action = await s.one<{ actor_id: string; on_behalf_of: string }>(
        "select actor_id, on_behalf_of from approval_actions where request_id = $1 and action = 'approve'",
        [reqId],
      );
      expect(action).toEqual({ actor_id: deputy, on_behalf_of: ctx.hod });
    }));

  it("falls back to permission holders when no approver resolves, and supports N-of-M steps", () =>
    withSession(async (s) => {
      const ctx = await setup(s);
      const fin2 = await s.user(`fin2-${Math.random()}@ap.test`);
      await s.member(ctx.orgId, fin2, "finance_manager");
      await s.asAdmin();
      // teacher without a manager
      await s.q("update org_members set manager_id = null where user_id = $1", [ctx.teacher]);
      // second step requires two finance approvals
      await s.q(
        `update approval_policy_steps set required_approvals = 2, conditions = '{}'
         where step_order = 2 and policy_id in (select id from approval_policies where org_id = $1 and name = 'Expense claims')`,
        [ctx.orgId],
      );
      const claim = await draftClaim(s, ctx, 5000);
      await s.q("select expense_claim_submit($1)", [claim]);
      const reqId = await s.val<string>("select id from approval_requests where entity_id = $1", [claim]);
      await s.asAdmin();
      const step1 = await s.one<{ approver_type: string; permission_key: string }>(
        "select approver_type, permission_key from approval_request_steps where request_id = $1 and step_order = 1",
        [reqId],
      );
      expect(step1).toEqual({ approver_type: "permission", permission_key: "expense:approve" });
      // hod holds expense:approve for the claim's department
      await s.as(ctx.hod);
      expect(await s.val("select approval_act($1, 'approve')", [reqId])).toBe("pending");
      await s.as(ctx.fin);
      expect(await s.val("select approval_act($1, 'approve')", [reqId])).toBe("pending");
      expect(await s.error("select approval_act($1, 'approve')", [reqId])).toMatch(/already acted/);
      await s.as(fin2);
      expect(await s.val("select approval_act($1, 'approve')", [reqId])).toBe("approved");
    }));

  it("requester can cancel; outsiders cannot see the request", () =>
    withSession(async (s) => {
      const ctx = await setup(s);
      const outsider = await s.user(`out-${Math.random()}@ap.test`);
      await s.member(ctx.orgId, outsider, "staff");
      const claim = await draftClaim(s, ctx, 5000);
      await s.q("select expense_claim_submit($1)", [claim]);
      const reqId = await s.val<string>("select id from approval_requests where entity_id = $1", [claim]);
      await s.as(outsider);
      expect(await s.q("select * from approval_requests where id = $1", [reqId])).toHaveLength(0);
      expect(await s.error("select approval_cancel($1)", [reqId])).toMatch(/only the requester/);
      await s.as(ctx.teacher);
      expect(await s.q("select * from approval_requests where id = $1", [reqId])).toHaveLength(1);
      expect(await s.error("select approval_cancel($1, 'wrong amount')", [reqId])).toBeNull();
      expect(await claimStatus(s, claim)).toBe("draft");
    }));
});

describe("budgets", () => {
  it("hard budget blocks submission; soft budget warns; approval posts actuals", () =>
    withSession(async (s) => {
      const ctx = await setup(s);
      await s.asAdmin();
      const fy = await s.val<string>("select app.fiscal_year_for($1, current_date)", [ctx.orgId]);
      const budget = await s.val<string>(
        `insert into budgets (org_id, fiscal_year_id, campus_id, department_id, category_id, allocated_amount, control_mode)
         values ($1, $2, $3, $4, $5, 10000, 'hard') returning id`,
        [ctx.orgId, fy, ctx.campusA, ctx.deptA1, ctx.category],
      );
      const big = await draftClaim(s, ctx, 12000);
      expect(await s.error("select expense_claim_submit($1)", [big])).toMatch(/Budget check failed/);

      await s.asAdmin();
      await s.q("update budgets set control_mode = 'soft' where id = $1", [budget]);
      await s.as(ctx.teacher);
      const res = await s.val<{ status: string; budget_checks: { result: string }[] }>(
        "select expense_claim_submit($1)",
        [big],
      );
      expect(res.budget_checks[0].result).toBe("warning");

      const reqId = await s.val<string>("select id from approval_requests where entity_id = $1 and status = 'pending'", [big]);
      await s.as(ctx.hod);
      await s.q("select approval_act($1, 'approve')", [reqId]);
      await s.asAdmin();
      const summary = await s.one<{ actual_amount: string; available_amount: string }>(
        "select actual_amount, available_amount from budget_summary where budget_id = $1",
        [budget],
      );
      expect(Number(summary.actual_amount)).toBe(12000);
      expect(Number(summary.available_amount)).toBe(-2000);
    }));

  it("budget amendments are approved through the engine and change the total", () =>
    withSession(async (s) => {
      const ctx = await setup(s);
      await s.asAdmin();
      const fy = await s.val<string>("select app.fiscal_year_for($1, current_date)", [ctx.orgId]);
      const budget = await s.val<string>(
        `insert into budgets (org_id, fiscal_year_id, campus_id, department_id, category_id, allocated_amount)
         values ($1, $2, $3, $4, $5, 10000) returning id`,
        [ctx.orgId, fy, ctx.campusA, ctx.deptA1, ctx.category],
      );
      await s.as(ctx.hod);
      const amendment = await s.val<string>("select budget_amendment_request($1, 5000, 'Extra workshop')", [budget]);
      await s.asAdmin();
      const reqId = await s.val<string>("select id from approval_requests where entity_id = $1", [amendment]);
      await s.as(ctx.fin);
      expect(await s.val("select approval_act($1, 'approve')", [reqId])).toBe("approved");
      await s.asAdmin();
      expect(Number(await s.val("select total_budget from budget_summary where budget_id = $1", [budget]))).toBe(15000);
    }));
});
