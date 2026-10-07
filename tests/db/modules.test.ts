import { afterAll, describe, expect, it } from "vitest";
import { pool, withSession, type Session } from "./helpers";

afterAll(() => pool.end());

async function procurementOrg(s: Session) {
  const owner = await s.user(`owner-${Math.random()}@po.test`);
  const buyer = await s.user(`buyer-${Math.random()}@po.test`);
  const hod = await s.user(`hod-${Math.random()}@po.test`);
  const fin = await s.user(`fin-${Math.random()}@po.test`);
  const o = await s.org(owner);
  await s.member(o.orgId, buyer, "procurement_officer");
  await s.member(o.orgId, hod, "department_head", { departmentId: o.deptA1 });
  await s.member(o.orgId, fin, "finance_manager");
  await s.asAdmin();
  await s.q("update campuses set gstin = '29ABCDE1234F1Z5' where id = $1", [o.campusA]);
  const vendor = await s.val<string>(
    "insert into vendors (org_id, name, status, gstin) values ($1, 'Lab Supplies Co', 'approved', '29PQRSX6789K1Z2') returning id",
    [o.orgId],
  );
  const category = await s.val<string>(
    "insert into expense_categories (org_id, name, code) values ($1, 'Lab equipment', 'LAB') returning id",
    [o.orgId],
  );
  const fy = await s.val<string>("select app.fiscal_year_for($1, current_date)", [o.orgId]);
  const budget = await s.val<string>(
    `insert into budgets (org_id, fiscal_year_id, campus_id, department_id, category_id, allocated_amount, control_mode)
     values ($1, $2, $3, $4, $5, 200000, 'hard') returning id`,
    [o.orgId, fy, o.campusA, o.deptA1, category],
  );
  return { ...o, owner, buyer, hod, fin, vendor, category, budget };
}

describe("purchase orders", () => {
  it("full lifecycle: PO > approval > commitment > GRN (partial) > invoice 3-way match > payment > close", () =>
    withSession(async (s) => {
      const c = await procurementOrg(s);
      await s.as(c.buyer);
      const po = await s.val<string>(
        `insert into purchase_orders (org_id, number, campus_id, department_id, category_id, vendor_id)
         values ($1, '', $2, $3, $4, $5) returning id`,
        [c.orgId, c.campusA, c.deptA1, c.category, c.vendor],
      );
      const header = await s.one<{ number: string; tax_type: string; status: string }>(
        "select number, tax_type, status from purchase_orders where id = $1",
        [po],
      );
      expect(header.number).toMatch(/^PO\/A\/\d{2}-\d{2}\/00001$/);
      expect(header.tax_type).toBe("cgst_sgst"); // same state (29)
      expect(header.status).toBe("draft");

      const line = await s.val<string>(
        `insert into po_lines (org_id, po_id, line_no, description, quantity, unit_price, tax_rate, is_asset)
         values ($1, $2, 0, 'Microscope', 10, 5000, 18, true) returning id`,
        [c.orgId, po],
      );
      const totals = await s.one<{ subtotal: string; tax_total: string; total: string }>(
        "select subtotal, tax_total, total from purchase_orders where id = $1",
        [po],
      );
      expect(Number(totals.subtotal)).toBe(50000);
      expect(Number(totals.tax_total)).toBe(9000);
      expect(Number(totals.total)).toBe(59000);

      // status cannot be forced directly
      expect(await s.error("update purchase_orders set status = 'approved' where id = $1", [po])).toMatch(/PO actions/);

      await s.q("select po_submit($1)", [po]);
      await s.asAdmin();
      const reqId = await s.val<string>("select id from approval_requests where entity_id = $1", [po]);
      await s.as(c.hod);
      expect(await s.val("select approval_act($1, 'approve')", [reqId])).toBe("approved"); // < 1,00,000: one step
      await s.asAdmin();
      let summary = await s.one<{ committed_amount: string; actual_amount: string }>(
        "select committed_amount, actual_amount from budget_summary where budget_id = $1",
        [c.budget],
      );
      expect(Number(summary.committed_amount)).toBe(59000);

      // lines are locked after approval
      await s.as(c.buyer);
      expect(await s.error("update po_lines set quantity = 20 where id = $1", [line])).toMatch(/draft/);

      await s.q("select po_send($1)", [po]);
      // receive 6 of 10
      const grn = await s.val<string>(
        "insert into grns (org_id, number, po_id, campus_id) values ($1, '', $2, $3) returning id",
        [c.orgId, po, c.campusA],
      );
      await s.q("insert into grn_lines (org_id, grn_id, po_line_id, received_qty, accepted_qty) values ($1, $2, $3, 7, 6)", [
        c.orgId,
        grn,
        line,
      ]);
      const posted = await s.val<{ po_status: string; asset_candidates: unknown[] }>("select grn_post($1)", [grn]);
      expect(posted.po_status).toBe("partially_received");
      expect(posted.asset_candidates).toHaveLength(1);
      const gl = await s.val<string>("select id from grn_lines where grn_id = $1", [grn]);
      expect(await s.val("select grn_create_assets($1)", [gl])).toBe(6);
      expect(await s.val("select count(*)::int from assets where grn_id = $1", [grn])).toBe(6);

      // invoice for 8 units: more than received -> qty mismatch
      await s.asAdmin();
      await s.member(c.orgId, c.buyer, "finance_manager");
      await s.as(c.buyer);
      const inv = await s.val<string>(
        `insert into vendor_invoices (org_id, number, vendor_invoice_number, vendor_id, po_id, campus_id, invoice_date)
         values ($1, '', 'LS/1001', $2, $3, $4, current_date) returning id`,
        [c.orgId, c.vendor, po, c.campusA],
      );
      await s.q(
        "insert into vendor_invoice_lines (org_id, invoice_id, po_line_id, quantity, unit_price, tax_amount) values ($1, $2, $3, 8, 5000, 7200)",
        [c.orgId, inv, line],
      );
      const match = await s.val<{ match_status: string }>("select invoice_three_way_match($1)", [inv]);
      expect(match.match_status).toBe("qty_mismatch");
      expect(await s.error("select invoice_approve($1)", [inv])).toMatch(/3-way match failed/);

      // fix the invoice to the received quantity, but overcharge the price
      await s.q("update vendor_invoice_lines set quantity = 6, unit_price = 5200, tax_amount = 5616 where invoice_id = $1", [inv]);
      expect((await s.val<{ match_status: string }>("select invoice_three_way_match($1)", [inv])).match_status).toBe(
        "price_mismatch",
      );
      await s.q("update vendor_invoice_lines set unit_price = 5000, tax_amount = 5400 where invoice_id = $1", [inv]);
      const approved = await s.val<{ status: string }>("select invoice_approve($1)", [inv]);
      expect(approved.status).toBe("approved");

      await s.asAdmin();
      summary = await s.one("select committed_amount, actual_amount from budget_summary where budget_id = $1", [c.budget]);
      expect(Number(summary.actual_amount)).toBe(35400);
      expect(Number(summary.committed_amount)).toBe(23600); // 4 of 10 units still open

      await s.as(c.buyer);
      expect(await s.error("select invoice_record_payment($1, 40000, 'neft')", [inv])).toMatch(/exceeds/);
      await s.q("select invoice_record_payment($1, 35400, 'neft', 'UTR123')", [inv]);
      await s.asAdmin();
      expect(await s.val("select status from vendor_invoices where id = $1", [inv])).toBe("paid");

      // close the PO early: remaining commitment is released, vendor rated
      await s.as(c.buyer);
      await s.q("select po_close($1, 4::smallint, 'Good quality')", [po]);
      await s.asAdmin();
      summary = await s.one("select committed_amount, actual_amount from budget_summary where budget_id = $1", [c.budget]);
      expect(Number(summary.committed_amount)).toBe(0);
      expect(Number(summary.actual_amount)).toBe(35400);
      expect(Number(await s.val("select rating_avg from vendors where id = $1", [c.vendor]))).toBe(4);
    }));

  it("hard budget blocks PO submission; IGST for inter-state vendors; amendments version the PO", () =>
    withSession(async (s) => {
      const c = await procurementOrg(s);
      await s.asAdmin();
      await s.q("update vendors set gstin = '27PQRSX6789K1Z2' where id = $1", [c.vendor]);
      await s.as(c.buyer);
      const po = await s.val<string>(
        `insert into purchase_orders (org_id, number, campus_id, department_id, category_id, vendor_id)
         values ($1, '', $2, $3, $4, $5) returning id`,
        [c.orgId, c.campusA, c.deptA1, c.category, c.vendor],
      );
      expect(await s.val("select tax_type from purchase_orders where id = $1", [po])).toBe("igst");
      await s.q(
        "insert into po_lines (org_id, po_id, line_no, description, quantity, unit_price, tax_rate) values ($1, $2, 0, 'Fume hood', 1, 250000, 18)",
        [c.orgId, po],
      );
      expect(Number(await s.val("select igst_amount from po_lines where po_id = $1", [po]))).toBe(45000);
      expect(await s.error("select po_submit($1)", [po])).toMatch(/Budget check failed/);

      await s.q("update po_lines set unit_price = 100000 where po_id = $1", [po]);
      await s.q("select po_submit($1)", [po]);
      await s.asAdmin();
      const reqId = await s.val<string>("select id from approval_requests where entity_id = $1", [po]);
      // >= 1,00,000 needs department head then finance
      await s.as(c.hod);
      expect(await s.val("select approval_act($1, 'approve')", [reqId])).toBe("pending");
      await s.as(c.fin);
      expect(await s.val("select approval_act($1, 'approve')", [reqId])).toBe("approved");

      await s.as(c.buyer);
      expect(await s.val("select po_amend($1, 'Add installation')", [po])).toBe(2);
      await s.asAdmin();
      expect(await s.val("select count(*)::int from po_versions where po_id = $1", [po])).toBe(1);
      expect(await s.val("select status from purchase_orders where id = $1", [po])).toBe("draft");
      // commitment stays reserved while the amendment is pending
      expect(Number(await s.val("select committed_amount from budget_summary where budget_id = $1", [c.budget]))).toBe(118000);
    }));

  it("RFQ to award creates a draft PO from the winning quote", () =>
    withSession(async (s) => {
      const c = await procurementOrg(s);
      await s.asAdmin();
      const vendor2 = await s.val<string>(
        "insert into vendors (org_id, name, status) values ($1, 'Cheaper Labs', 'approved') returning id",
        [c.orgId],
      );
      await s.as(c.buyer);
      const req = await s.val<string>(
        `insert into requisitions (org_id, number, campus_id, department_id, category_id, requested_by, title)
         values ($1, '', $2, $3, $4, $5, 'Microscopes for lab') returning id`,
        [c.orgId, c.campusA, c.deptA1, c.category, c.buyer],
      );
      const rl = await s.val<string>(
        "insert into requisition_lines (org_id, requisition_id, description, quantity, estimated_unit_price) values ($1, $2, 'Microscope', 5, 6000) returning id",
        [c.orgId, req],
      );
      await s.q("select requisition_submit($1)", [req]);
      await s.asAdmin();
      const reqApproval = await s.val<string>("select id from approval_requests where entity_id = $1", [req]);
      await s.as(c.hod);
      await s.q("select approval_act($1, 'approve')", [reqApproval]);
      await s.as(c.buyer);
      const rfq = await s.val<string>("select rfq_create_from_requisition($1, $2::uuid[])", [req, [c.vendor, vendor2]]);
      const q1 = await s.val<string>("insert into quotes (org_id, rfq_id, vendor_id) values ($1, $2, $3) returning id", [
        c.orgId,
        rfq,
        c.vendor,
      ]);
      const q2 = await s.val<string>("insert into quotes (org_id, rfq_id, vendor_id) values ($1, $2, $3) returning id", [
        c.orgId,
        rfq,
        vendor2,
      ]);
      await s.q(
        "insert into quote_lines (org_id, quote_id, requisition_line_id, description, quantity, unit_price) values ($1, $2, $3, 'Microscope', 5, 5800), ($1, $4, $3, 'Microscope', 5, 5500)",
        [c.orgId, q1, rl, q2],
      );
      const cmp = await s.q<{ vendor_id: string; is_lowest_total: boolean }>(
        "select vendor_id, is_lowest_total from rfq_quote_comparison where rfq_id = $1",
        [rfq],
      );
      expect(cmp.find((r) => r.vendor_id === vendor2)?.is_lowest_total).toBe(true);
      const po = await s.val<string>("select rfq_award($1)", [q2]);
      const p = await s.one<{ vendor_id: string; total: string; status: string }>(
        "select vendor_id, total, status from purchase_orders where id = $1",
        [po],
      );
      expect(p.vendor_id).toBe(vendor2);
      expect(Number(p.total)).toBe(32450);
      expect(p.status).toBe("draft");
      await s.asAdmin();
      expect(await s.val("select status from quotes where id = $1", [q1])).toBe("rejected");
    }));
});

describe("facility", () => {
  it("anonymous QR issues store no reporter identity and can be tracked by token", () =>
    withSession(async (s) => {
      const owner = await s.user(`owner-${Math.random()}@fac.test`);
      const o = await s.org(owner);
      await s.asAdmin();
      const building = await s.val<string>(
        "insert into locations (org_id, campus_id, type, name) values ($1, $2, 'building', 'Block A') returning id",
        [o.orgId, o.campusA],
      );
      const floor = await s.val<string>(
        "insert into locations (org_id, campus_id, parent_id, type, name) values ($1, $2, $3, 'floor', 'First') returning id",
        [o.orgId, o.campusA, building],
      );
      const room = await s.one<{ id: string; qr_token: string; path_names: string[] }>(
        "insert into locations (org_id, campus_id, parent_id, type, name) values ($1, $2, $3, 'room', 'Chem Lab') returning id, qr_token, path_names",
        [o.orgId, o.campusA, floor],
      );
      expect(room.path_names).toEqual(["Block A", "First"]);
      expect(
        await s.error("insert into locations (org_id, campus_id, parent_id, type, name) values ($1, $2, $3, 'building', 'x')", [
          o.orgId,
          o.campusA,
          room.id,
        ]),
      ).toMatch(/cannot be placed/);

      // anon/authenticated callers cannot use the service-only RPC
      await s.as(owner);
      expect(await s.error("select * from submit_public_issue($1, 'Gas smell', null)", [room.qr_token])).toMatch(
        /permission denied|forbidden/,
      );

      await s.as(null, "service_role");
      const created = await s.one<{ issue_id: string; issue_number: string; tracking_token: string }>(
        "select * from submit_public_issue($1, 'Gas smell near burner', 'Strong smell', null, 'critical')",
        [room.qr_token],
      );
      expect(created.issue_number).toMatch(/^ISS-\d{5}$/);
      await s.asAdmin();
      const issue = await s.one<Record<string, unknown>>("select * from issues where id = $1", [created.issue_id]);
      expect(issue.is_anonymous).toBe(true);
      expect(issue.reporter_id).toBeNull();
      expect(issue.created_by).toBeNull();
      expect(issue.location_id).toBe(room.id);
      expect(issue.source).toBe("qr");
      expect(issue.tracking_token_hash).not.toBe(created.tracking_token);
      // critical SLA: 30 min response
      const minutes = await s.val<number>(
        "select extract(epoch from (response_due_at - created_at))::int / 60 from issues where id = $1",
        [created.issue_id],
      );
      expect(minutes).toBe(30);

      await s.as(null, "service_role");
      const status = await s.val<{ status: string; location: string }>("select public_issue_status($1)", [
        created.tracking_token,
      ]);
      expect(status.status).toBe("open");
      expect(status.location).toBe("Block A / First / Chem Lab");
      expect(await s.val("select public_issue_status('nope')")).toBeNull();
      expect(await s.error("select public_issue_feedback($1, 'rate', 5::smallint)", [created.tracking_token])).toMatch(
        /not resolved/,
      );
    }));

  it("escalates breached issues and auto-creates work orders by category", () =>
    withSession(async (s) => {
      const owner = await s.user(`owner-${Math.random()}@esc.test`);
      const fm = await s.user(`fm-${Math.random()}@esc.test`);
      const tech = await s.user(`tech-${Math.random()}@esc.test`);
      const o = await s.org(owner);
      await s.member(o.orgId, fm, "facility_manager", { campusId: o.campusA });
      await s.member(o.orgId, tech, "technician", { campusId: o.campusA });
      await s.asAdmin();
      const cat = await s.val<string>(
        "insert into issue_categories (org_id, name, default_priority, auto_create, default_assignee_id) values ($1, 'Plumbing', 'high', 'work_order', $2) returning id",
        [o.orgId, tech],
      );
      const id = await s.val<string>(
        "insert into issues (org_id, campus_id, category_id, title, number, priority, created_at) values ($1, $2, $3, 'Pipe burst', '', null, now() - interval '3 days') returning id",
        [o.orgId, o.campusA, cat],
      );
      const issue = await s.one<{ priority: string; status: string; assignee_id: string; work_order_id: string }>(
        "select priority, status, assignee_id, work_order_id from issues where id = $1",
        [id],
      );
      expect(issue.priority).toBe("high");
      expect(issue.status).toBe("assigned");
      expect(issue.assignee_id).toBe(tech);
      expect(issue.work_order_id).not.toBeNull();

      expect(await s.val("select app.escalate_issues()")).toBeGreaterThanOrEqual(1);
      expect(await s.val("select escalation_level from issues where id = $1", [id])).toBe(3);
      expect(
        await s.val("select count(*)::int from notifications where user_id = $1 and type = 'issue.escalated'", [fm]),
      ).toBe(0); // level 3 goes to org-scoped managers only
      // org-scoped holders of issue:escalation (incl. superusers) get level 3
      expect(
        await s.val("select count(*)::int from notifications where user_id = $1 and type = 'issue.escalated'", [owner]),
      ).toBe(1);

      // completing the work order resolves the issue
      await s.as(tech);
      await s.q("update work_orders set status = 'in_progress' where id = $1", [issue.work_order_id]);
      await s.q("update work_orders set status = 'completed', completion_notes = 'Replaced pipe' where id = $1", [
        issue.work_order_id,
      ]);
      await s.asAdmin();
      expect(await s.val("select status from issues where id = $1", [id])).toBe("resolved");
    }));

  it("generates preventive work orders once per due date and advances the schedule", () =>
    withSession(async (s) => {
      const owner = await s.user(`owner-${Math.random()}@pm.test`);
      const o = await s.org(owner);
      await s.asAdmin();
      const asset = await s.val<string>(
        "insert into assets (org_id, campus_id, name, asset_tag, usage_meter) values ($1, $2, 'DG Set', '', 0) returning id",
        [o.orgId, o.campusA],
      );
      await s.q(
        `insert into pm_schedules (org_id, campus_id, asset_id, title, trigger_type, frequency, next_due_date, lead_days)
         values ($1, $2, $3, 'Monthly DG service', 'time', 'monthly', current_date + 2, 3)`,
        [o.orgId, o.campusA, asset],
      );
      await s.q(
        `insert into pm_schedules (org_id, campus_id, asset_id, title, trigger_type, usage_interval)
         values ($1, $2, $3, 'Oil change every 250h', 'usage', 250)`,
        [o.orgId, o.campusA, asset],
      );
      const woCount = () =>
        s.val<number>("select count(*)::int from work_orders where asset_id = $1 and type = 'preventive'", [asset]);
      await s.q("select app.generate_pm_work_orders()");
      expect(await woCount()).toBe(1);
      await s.q("select app.generate_pm_work_orders()");
      expect(await woCount()).toBe(1);
      expect(
        await s.val("select next_due_date = (current_date + 2 + interval '1 month')::date from pm_schedules where trigger_type = 'time' and asset_id = $1", [asset]),
      ).toBe(true);
      await s.q("update assets set usage_meter = 260 where id = $1", [asset]);
      await s.q("select app.generate_pm_work_orders()");
      expect(await s.val("select count(*)::int from work_orders where asset_id = $1 and type = 'preventive'", [asset])).toBe(2);
    }));

  it("asset tags, depreciation and transfers", () =>
    withSession(async (s) => {
      const owner = await s.user(`owner-${Math.random()}@ast.test`);
      const o = await s.org(owner);
      await s.asAdmin();
      const cat = await s.val<string>(
        "insert into asset_categories (org_id, name, code, depreciation_method, useful_life_months, salvage_percent) values ($1, 'IT', 'IT', 'slm', 36, 10) returning id",
        [o.orgId],
      );
      await s.as(owner);
      const asset = await s.one<{ id: string; asset_tag: string; salvage_value: string }>(
        `insert into assets (org_id, campus_id, category_id, name, asset_tag, purchase_date, purchase_cost)
         values ($1, $2, $3, 'Laptop', '', current_date - interval '18 months', 90000) returning id, asset_tag, salvage_value`,
        [o.orgId, o.campusA, cat],
      );
      expect(asset.asset_tag).toMatch(/^IT-AST-\d{5}$/);
      expect(Number(asset.salvage_value)).toBe(9000);
      expect(Number(await s.val("select asset_book_value($1)", [asset.id]))).toBe(49500);

      await s.q(
        "insert into asset_transfers (org_id, asset_id, from_campus_id, to_campus_id, requested_by) values ($1, $2, $3, $4, $5)",
        [o.orgId, asset.id, o.campusA, o.campusB, owner],
      );
      await s.q("update asset_transfers set status = 'completed' where asset_id = $1", [asset.id]);
      expect(await s.val("select campus_id from assets where id = $1", [asset.id])).toBe(o.campusB);
      expect(await s.error("update asset_transfers set status = 'rejected' where asset_id = $1", [asset.id])).toMatch(
        /already completed/,
      );
    }));
});

describe("tasks", () => {
  it("visibility by project membership, recurrence and dependency cycles", () =>
    withSession(async (s) => {
      const owner = await s.user(`owner-${Math.random()}@t.test`);
      const alice = await s.user(`alice-${Math.random()}@t.test`);
      const bob = await s.user(`bob-${Math.random()}@t.test`);
      const o = await s.org(owner);
      await s.member(o.orgId, alice, "staff");
      await s.member(o.orgId, bob, "staff");
      await s.as(alice);
      const project = await s.val<string>(
        "insert into projects (org_id, name, visibility, created_by) values ($1, 'Annual Day', 'private', $2) returning id",
        [o.orgId, alice],
      );
      await s.q("insert into project_members (project_id, user_id, org_id, role) values ($1, $2, $3, 'admin')", [
        project,
        alice,
        o.orgId,
      ]);
      const t1 = await s.val<string>(
        `insert into tasks (org_id, project_id, title, due_date, recurrence, created_by)
         values ($1, $2, 'Weekly rehearsal', current_date, '{"freq":"weekly","interval":1}', $3) returning id`,
        [o.orgId, project, alice],
      );
      const t2 = await s.val<string>(
        "insert into tasks (org_id, project_id, title, created_by) values ($1, $2, 'Book auditorium', $3) returning id",
        [o.orgId, project, alice],
      );
      await s.q("insert into task_dependencies (task_id, depends_on_task_id, org_id) values ($1, $2, $3)", [t1, t2, o.orgId]);
      expect(
        await s.error("insert into task_dependencies (task_id, depends_on_task_id, org_id) values ($1, $2, $3)", [
          t2,
          t1,
          o.orgId,
        ]),
      ).toMatch(/cycle/);

      await s.as(bob);
      expect(await s.q("select * from tasks where project_id = $1", [project])).toHaveLength(0);
      await s.as(alice);
      await s.q("insert into task_assignees (task_id, user_id, org_id) values ($1, $2, $3)", [t1, bob, o.orgId]);
      await s.as(bob);
      // assignee sees the task (but not the private project's other tasks)
      expect((await s.q<{ id: string }>("select id from tasks")).map((r) => r.id)).toEqual([t1]);
      await s.q("update tasks set status = 'done' where id = $1", [t1]);
      await s.as(alice);
      const next = await s.q<{ due_date: Date }>(
        "select due_date from tasks where recurrence_source_id = $1 and status = 'todo'",
        [t1],
      );
      expect(next).toHaveLength(1);
      const progress = await s.one<{ total_tasks: string; completed_tasks: string }>(
        "select total_tasks, completed_tasks from project_progress where project_id = $1",
        [project],
      );
      expect(Number(progress.total_tasks)).toBe(3);
      expect(Number(progress.completed_tasks)).toBe(1);
    }));
});

describe("teams", () => {
  it("team membership is readable without RLS recursion and leads can manage members", () =>
    withSession(async (s) => {
      const owner = await s.user(`owner-${Math.random()}@tm.test`);
      const lead = await s.user(`lead-${Math.random()}@tm.test`);
      const member = await s.user(`member-${Math.random()}@tm.test`);
      const o = await s.org(owner);
      await s.member(o.orgId, lead, "staff");
      await s.member(o.orgId, member, "staff");
      await s.asAdmin();
      const team = await s.val<string>("insert into teams (org_id, name) values ($1, 'Ops') returning id", [o.orgId]);
      await s.q("insert into team_members (team_id, user_id, org_id, role) values ($1, $2, $3, 'lead')", [team, lead, o.orgId]);
      await s.as(member);
      expect(await s.q("select * from team_members where team_id = $1", [team])).toHaveLength(1);
      expect(await s.error("insert into team_members (team_id, user_id, org_id) values ($1, $2, $3)", [team, member, o.orgId])).toMatch(/row-level security/);
      await s.as(lead);
      expect(await s.error("insert into team_members (team_id, user_id, org_id) values ($1, $2, $3)", [team, member, o.orgId])).toBeNull();
      expect(await s.q("select t.*, m.user_id from teams t join team_members m on m.team_id = t.id")).toHaveLength(2);
    }));
});

describe("platform", () => {
  it("number series per campus and financial year", () =>
    withSession(async (s) => {
      const owner = await s.user(`owner-${Math.random()}@ns.test`);
      const o = await s.org(owner);
      await s.asAdmin();
      const a1 = await s.val<string>("select app.next_number($1, 'purchase_order', $2, '2026-05-01')", [o.orgId, o.campusA]);
      const a2 = await s.val<string>("select app.next_number($1, 'purchase_order', $2, '2026-06-01')", [o.orgId, o.campusA]);
      const b1 = await s.val<string>("select app.next_number($1, 'purchase_order', $2, '2026-06-01')", [o.orgId, o.campusB]);
      const next = await s.val<string>("select app.next_number($1, 'purchase_order', $2, '2027-04-02')", [o.orgId, o.campusA]);
      expect([a1, a2, b1, next]).toEqual(["PO/A/26-27/00001", "PO/A/26-27/00002", "PO/B/26-27/00001", "PO/A/27-28/00001"]);
      // custom template
      await s.q(
        "update number_series set prefix = 'WRK', format = '{prefix}{seq}', padding = 3 where org_id = $1 and entity_type = 'purchase_order' and campus_id is null and fy_code is null",
        [o.orgId],
      );
      // existing counters keep their own format; new FY/campus counters use the template
      expect(await s.val("select app.next_number($1, 'purchase_order', $2, '2028-04-02')", [o.orgId, o.campusB])).toBe("WRK001");
      expect(await s.val("select app.next_number($1, 'issue', null)", [o.orgId])).toBe("ISS-00001");
    }));

  it("events fan out to subscribed webhooks; claiming and backoff", () =>
    withSession(async (s) => {
      const owner = await s.user(`owner-${Math.random()}@wh.test`);
      const o = await s.org(owner);
      await s.asAdmin();
      const all = await s.val<string>(
        "insert into webhook_endpoints (org_id, url, events) values ($1, 'https://example.com/a', '{*}') returning id",
        [o.orgId],
      );
      await s.q("insert into webhook_endpoints (org_id, url, events) values ($1, 'https://example.com/b', '{issue.*}')", [
        o.orgId,
      ]);
      await s.q("insert into webhook_endpoints (org_id, url, events) values ($1, 'https://example.com/c', '{po.approved}')", [
        o.orgId,
      ]);
      await s.q("insert into issues (org_id, campus_id, title, number, priority) values ($1, $2, 'Bulb fused', '', 'low')", [
        o.orgId,
        o.campusA,
      ]);
      expect(await s.val("select count(*)::int from webhook_deliveries where org_id = $1", [o.orgId])).toBe(2);
      await s.as(null, "service_role");
      const claimed = await s.q<{ delivery_id: number; endpoint_id: string; event_type: string }>(
        "select * from claim_webhook_deliveries(10)",
      );
      expect(claimed.map((c) => c.event_type)).toEqual(["issue.created", "issue.created"]);
      // a second claim gets nothing while locked
      expect(await s.q("select * from claim_webhook_deliveries(10)")).toHaveLength(0);
      const first = claimed.find((c) => c.endpoint_id === all)!;
      await s.q("select complete_webhook_delivery($1, false, 500, 'boom')", [first.delivery_id]);
      await s.asAdmin();
      const d = await s.one<{ status: string; attempt_count: number; future: boolean }>(
        "select status, attempt_count, next_attempt_at > now() as future from webhook_deliveries where id = $1",
        [first.delivery_id],
      );
      expect(d).toEqual({ status: "failed", attempt_count: 1, future: true });
    }));

  it("global search respects RLS", () =>
    withSession(async (s) => {
      const owner = await s.user(`owner-${Math.random()}@gs.test`);
      const teacher = await s.user(`teacher-${Math.random()}@gs.test`);
      const o = await s.org(owner);
      await s.member(o.orgId, teacher, "staff");
      await s.asAdmin();
      await s.q("insert into issues (org_id, campus_id, title, number, priority) values ($1, $2, 'Projector flicker', '', 'low')", [
        o.orgId,
        o.campusA,
      ]);
      await s.q("insert into vendors (org_id, name, status) values ($1, 'Projector Doctors', 'approved')", [o.orgId]);
      await s.as(owner);
      expect(await s.q("select * from global_search($1, 'projector')", [o.orgId])).toHaveLength(2);
      await s.as(teacher);
      // staff can read vendors but not other people's issues
      const rows = await s.q<{ entity_type: string }>("select * from global_search($1, 'projector')", [o.orgId]);
      expect(rows.map((r) => r.entity_type)).toEqual(["vendor"]);
    }));

  it("invitations: accept with matching email only", () =>
    withSession(async (s) => {
      const owner = await s.user(`owner-${Math.random()}@inv.test`);
      const invitee = await s.user("new.teacher@inv.test");
      const stranger = await s.user("stranger@inv.test");
      const o = await s.org(owner);
      await s.asAdmin();
      const fmRole = await s.val<string>("select id from roles where org_id = $1 and key = 'facility_manager'", [o.orgId]);
      await s.q(
        "insert into org_invitations (org_id, email, role_id, scope_type, campus_id, token_hash, invited_by) values ($1, 'New.Teacher@inv.test', $2, 'campus', $3, app.sha256('tok123'), $4)",
        [o.orgId, fmRole, o.campusA, owner],
      );
      await s.as(stranger);
      expect(await s.error("select accept_invitation('tok123')")).toMatch(/different email/);
      await s.as(invitee);
      expect(await s.val("select accept_invitation('tok123')")).toBe(o.orgId);
      expect(await s.val("select app.has_permission($1, 'issue:update', $2, $3)", [invitee, o.orgId, o.campusA])).toBe(true);
      expect(await s.val("select app.has_permission($1, 'issue:update', $2, $3)", [invitee, o.orgId, o.campusB])).toBe(false);
      expect(await s.val("select accept_invitation('tok123')")).toBe(o.orgId); // reopening the link is harmless
      await s.as(stranger);
      expect(await s.error("select accept_invitation('tok123')")).toMatch(/invalid or has expired/);
    }));
});
