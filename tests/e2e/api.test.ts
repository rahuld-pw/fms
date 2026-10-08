/**
 * End-to-end API tests against a running app + database (see README:
 * "End-to-end tests"). They use API keys created directly in the database
 * for seeded users, so they exercise the real HTTP layer, PostgREST and RLS /
 * in-database permission checks.
 */
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

const BASE = process.env.API_BASE ?? "http://localhost:3000/api/v1";
const DB = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/campus_ops_test";
const ORG = "00000000-0000-4000-8000-000000000001";
const USERS = {
  owner: "00000000-0000-4000-8000-000000000101",
  fm: "00000000-0000-4000-8000-000000000102",
  fin: "00000000-0000-4000-8000-000000000104",
  proc: "00000000-0000-4000-8000-000000000105",
  hod: "00000000-0000-4000-8000-000000000106",
  teacher: "00000000-0000-4000-8000-000000000107",
};
const MAIN = "00000000-0000-4000-8000-000000000011";
const CITY = "00000000-0000-4000-8000-000000000012";

const pool = new pg.Pool({ connectionString: DB });
const keys: Record<string, string> = {};

async function makeKey(user: keyof typeof USERS, scopes = ["*"]) {
  const key = `co_live_e2e${user.padEnd(8, "0").slice(0, 8)}_${Math.random().toString(36).slice(2)}${Date.now()}`;
  await pool.query(
    `insert into api_keys (org_id, name, prefix, key_hash, scopes, rate_limit_per_minute, created_by)
     values ($1, $2, $3, $4, $5, 10000, $6)`,
    [ORG, `e2e ${user}`, key.slice(8, 22), createHash("sha256").update(key).digest("hex"), scopes, USERS[user]],
  );
  return key;
}

async function api(who: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(who ? { authorization: `Bearer ${keys[who] ?? who}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const ct = res.headers.get("content-type") ?? "";
  const json = ct.includes("json") ? await res.json() : null;
  return { status: res.status, json, res };
}

let up = false;
beforeAll(async () => {
  up = await fetch(`${BASE}/health`).then((r) => r.ok).catch(() => false);
  if (!up) return;
  for (const u of Object.keys(USERS) as (keyof typeof USERS)[]) keys[u] = await makeKey(u);
  keys.readonly = await makeKey("owner", ["issue:read"]);
});
afterAll(async () => {
  await pool.query("delete from api_keys where name like 'e2e %'");
  await pool.end();
});

describe.runIf(process.env.E2E === "1")("API end-to-end", () => {
  it("is up", () => expect(up).toBe(true));

  it("issues: create, workflow, comments, activity, CSV export", async () => {
    const created = await api("teacher", "POST", "/issues", { location_id: (await firstLocation()).id, title: "Window latch broken", priority: "low" });
    expect(created.status).toBe(201);
    const issue = created.json.data;
    expect(issue.number).toMatch(/^ISS-\d{5}$/);
    expect(issue.reporter_id).toBe(USERS.teacher);
    expect(issue.campus_id).toBe(MAIN);

    // the teacher cannot triage (API keys use explicit permission checks)
    expect((await api("teacher", "POST", `/issues/${issue.id}/assign`, { assignee_id: USERS.fm })).status).toBe(403);
    const assigned = await api("fm", "POST", `/issues/${issue.id}/assign`, { assignee_id: USERS.fm });
    expect(assigned.json.data.status).toBe("assigned");
    const progressed = await api("fm", "POST", `/issues/${issue.id}/transition`, { status: "in_progress", note: "On it" });
    expect(progressed.json.data.status).toBe("in_progress");
    const bad = await api("fm", "POST", `/issues/${issue.id}/transition`, { status: "closed" });
    expect(bad.status).toBe(422);
    expect(bad.json.error.message).toMatch(/cannot move/);

    const comments = await api("fm", "GET", `/comments?entity_type=issue&entity_id=${issue.id}`);
    expect(comments.json.data.map((c: { body: string }) => c.body)).toContain("On it");
    const activity = await api("owner", "GET", `/activity?entity_type=issue&entity_id=${issue.id}`);
    expect(activity.json.data.map((a: { action: string }) => a.action)).toEqual(expect.arrayContaining(["created", "status_changed"]));

    const csv = await fetch(`${BASE}/issues/export?status=in_progress`, { headers: { authorization: `Bearer ${keys.fm}` } });
    expect(csv.headers.get("content-type")).toContain("text/csv");
    expect(await csv.text()).toContain("Window latch broken");
  });

  it("API key scopes and campus scope are enforced", async () => {
    const ro = await api("readonly", "GET", "/issues?limit=1");
    expect(ro.status).toBe(200);
    expect((await api("readonly", "GET", "/assets")).json.data).toEqual([]);
    expect((await api("readonly", "POST", "/issues", { campus_id: MAIN, title: "nope nope" })).status).toBe(403);
    // the facility manager is scoped to the main campus
    // ...except issues they are personally assigned to or reported (owner rule, as in RLS)
    const fmCity = await api("fm", "GET", `/issues?campus_id=${CITY}`);
    for (const i of fmCity.json.data) expect([i.assignee_id, i.reporter_id]).toContain(USERS.fm);
    const fmCityWos = await api("fm", "GET", `/work-orders?campus_id=${CITY}`);
    expect(fmCityWos.json.data).toEqual([]);
    const ownerCity = await api("owner", "GET", `/issues?campus_id=${CITY}`);
    expect(ownerCity.json.data.length).toBeGreaterThan(0);
    expect((await api("", "GET", "/issues")).status).toBe(401);
    expect((await api("co_live_bogus_key", "GET", "/issues")).status).toBe(401);
  });

  it("idempotency keys replay and reject mismatched reuse", async () => {
    const key = `idem-${Date.now()}`;
    const body = { campus_id: MAIN, title: "Idempotent issue" };
    const a = await api("owner", "POST", "/issues", body, { "idempotency-key": key });
    const b = await api("owner", "POST", "/issues", body, { "idempotency-key": key });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.res.headers.get("idempotent-replayed")).toBe("true");
    expect(b.json.data.id).toBe(a.json.data.id);
    const c = await api("owner", "POST", "/issues", { ...body, title: "Different" }, { "idempotency-key": key });
    expect(c.status).toBe(409);
    expect(c.json.error.code).toBe("idempotency_conflict");
  });

  it("cursor pagination walks all rows without duplicates", async () => {
    const seen = new Set<string>();
    let cursor: string | null = null;
    let pages = 0;
    do {
      const r = await api("owner", "GET", `/assets?limit=4&sort=-created_at${cursor ? `&cursor=${cursor}` : ""}`);
      for (const a of r.json.data) {
        expect(seen.has(a.id)).toBe(false);
        seen.add(a.id);
      }
      cursor = r.json.meta.next_cursor;
      pages++;
    } while (cursor && pages < 50);
    const total = await api("owner", "GET", "/assets?page=1&limit=1");
    expect(seen.size).toBe(total.json.meta.total);
  });

  it("assets: CSV import (dry run + commit), depreciation, QR and labels", async () => {
    const csv = "name,campus_code,category_code,purchase_date,purchase_cost\nE2E Printer,MAIN,IT,2025-04-01,24000\nBad row,NOPE,IT,,\n";
    const dry = await api("fm", "POST", "/assets/import", { csv, dry_run: true });
    expect(dry.json.data.errors).toHaveLength(1);
    const fixed = csv.replace("Bad row,NOPE", "Shelf,MAIN").replace(",IT,,", ",FUR,,");
    const done = await api("fm", "POST", "/assets/import", { csv: fixed, dry_run: false });
    expect(done.json.data.created).toBe(2);
    const printer = (await api("fm", "GET", "/assets?q=E2E%20Printer")).json.data[0];
    expect(printer.asset_tag).toMatch(/^IT-AST-/);
    const dep = await api("fm", "GET", `/assets/${printer.id}/depreciation`);
    expect(dep.json.data.rows.length).toBe(3);
    const svg = await fetch(`${BASE}/qr/${printer.qr_token}/svg`, { headers: { authorization: `Bearer ${keys.fm}` } });
    expect(await svg.text()).toContain("<svg");
    const pdf = await fetch(`${BASE}/qr/labels`, {
      method: "POST",
      headers: { authorization: `Bearer ${keys.fm}`, "content-type": "application/json" },
      body: JSON.stringify({ kind: "asset", ids: [printer.id] }),
    });
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString()).toBe("%PDF");
  });

  it("expense claim with inline items: submit, approve by reporting manager, pay", async () => {
    const cats = (await api("teacher", "GET", "/expense-categories")).json.data;
    const travel = cats.find((c: { code: string }) => c.code === "TRV");
    const created = await api("teacher", "POST", "/expense-claims", {
      campus_id: MAIN,
      department_id: (await scienceDept()).id,
      title: "Field trip bus fare",
      items: [{ category_id: travel.id, expense_date: new Date().toISOString().slice(0, 10), description: "Bus", amount: 400 }],
    });
    expect(created.status).toBe(201);
    const claim = (await api("teacher", "GET", `/expense-claims/${created.json.data.id}`)).json.data;
    expect(Number(claim.total_amount)).toBe(400);
    expect(claim.items).toHaveLength(1);
    const submitted = await api("teacher", "POST", `/expense-claims/${claim.id}/submit`);
    expect(submitted.json.data.status).toBe("approved"); // below the auto-approve threshold
    const paid = await api("fin", "POST", `/expense-claims/${claim.id}/pay`, { reference: "NEFT123" });
    expect(paid.json.data.status).toBe("paid");
    expect((await api("teacher", "POST", `/expense-claims/${claim.id}/pay`, { reference: "x" })).status).toBe(403);

    // a larger claim needs the HOD
    const big = await api("teacher", "POST", "/expense-claims", {
      campus_id: MAIN,
      department_id: (await scienceDept()).id,
      title: "Conference travel",
      items: [{ category_id: travel.id, expense_date: new Date().toISOString().slice(0, 10), description: "Flight", amount: 6000 }],
    });
    // receipts are required above 500 for travel
    const noReceipt = await api("teacher", "POST", `/expense-claims/${big.json.data.id}/submit`);
    expect(noReceipt.status).toBe(422);
    const up = await api("teacher", "POST", "/attachments", {
      entity_type: "expense_claim", entity_id: big.json.data.id, file_name: "ticket.pdf", mime_type: "application/pdf", size_bytes: 1000,
    });
    expect(up.status).toBe(201);
    expect(up.json.data.upload.url).toBeTruthy();
    const ok = await api("teacher", "POST", `/expense-claims/${big.json.data.id}/submit`);
    expect(ok.json.data.status).toBe("pending_approval");
    const inbox = await api("hod", "GET", "/approvals/inbox");
    const req = inbox.json.data.find((r: { entity_id: string }) => r.entity_id === big.json.data.id);
    expect(req).toBeTruthy();
    expect((await api("fin", "POST", `/approvals/${req.id}/act`, { action: "approve" })).status).toBe(403);
    const acted = await api("hod", "POST", `/approvals/${req.id}/act`, { action: "approve", comment: "OK" });
    expect(acted.json.data.status).toBe("approved");
  });

  it("procurement: PO > approval > send > GRN > invoice (3-way) > payment > close > PDF", async () => {
    const vendors = (await api("proc", "GET", "/vendors?status=approved")).json.data;
    const spark = vendors.find((v: { name: string }) => v.name === "Spark Electricals");
    const cats = (await api("proc", "GET", "/expense-categories")).json.data;
    const rnm = cats.find((c: { code: string }) => c.code === "RNM");
    const fac = (await api("owner", "GET", "/departments?q=Facilities")).json.data[0];
    const created = await api("proc", "POST", "/purchase-orders", {
      campus_id: MAIN, department_id: fac.id, category_id: rnm.id, vendor_id: spark.id, payment_terms: "15 days",
      lines: [
        { description: "LED panel 2x2", quantity: 20, unit_price: 1800, tax_rate: 18, hsn_sac: "94054090" },
        { description: "Installation", quantity: 1, unit_price: 5000, tax_rate: 18 },
      ],
    });
    expect(created.status).toBe(201);
    const po = (await api("proc", "GET", `/purchase-orders/${created.json.data.id}`)).json.data;
    expect(po.number).toMatch(/^PO\/MAIN\//);
    expect(Number(po.total)).toBe(48380);
    expect(po.lines).toHaveLength(2);

    const sub = await api("proc", "POST", `/purchase-orders/${po.id}/submit`);
    expect(sub.json.data.purchase_order.status).toBe("pending_approval");
    // approvers: anyone with po:approve covering the Facilities department -> finance manager (org)
    const inbox = await api("fin", "GET", "/approvals/inbox");
    const req = inbox.json.data.find((r: { entity_id: string }) => r.entity_id === po.id);
    expect((await api("fin", "POST", `/approvals/${req.id}/act`, { action: "approve" })).json.data.status).toBe("approved");

    const budget = (await api("fin", "GET", `/budget-summary?department_id=${fac.id}`)).json.data.find(
      (b: { category_id: string }) => b.category_id === rnm.id,
    );
    expect(Number(budget.committed_amount)).toBe(48380);

    await api("proc", "POST", `/purchase-orders/${po.id}/send`);
    const lineLed = po.lines.find((l: { description: string }) => l.description.startsWith("LED"));
    const lineInst = po.lines.find((l: { description: string }) => l.description === "Installation");
    const grn = await api("proc", "POST", "/grns", {
      po_id: po.id,
      lines: [
        { po_line_id: lineLed.id, received_qty: 20, accepted_qty: 18 },
        { po_line_id: lineInst.id, received_qty: 1, accepted_qty: 1 },
      ],
    });
    expect(grn.status).toBe(201);
    const posted = await api("proc", "POST", `/grns/${grn.json.data.id}/post`);
    expect(posted.json.data.po_status).toBe("partially_received");

    const inv = await api("proc", "POST", "/invoices", {
      po_id: po.id, vendor_invoice_number: `SP-${Date.now()}`, invoice_date: new Date().toISOString().slice(0, 10),
      lines: [
        { po_line_id: lineLed.id, quantity: 20, unit_price: 1800, tax_amount: 6480 },
        { po_line_id: lineInst.id, quantity: 1, unit_price: 5000, tax_amount: 900 },
      ],
    });
    expect(inv.status).toBe(201);
    const invoice = (await api("fin", "GET", `/invoices/${inv.json.data.id}`)).json.data;
    expect(invoice.match_status).toBe("qty_mismatch"); // billed 20, accepted 18
    const approveFail = await api("fin", "POST", `/invoices/${invoice.id}/approve`, {});
    expect(approveFail.status).toBe(422);
    const approved = await api("fin", "POST", `/invoices/${invoice.id}/approve`, { override_reason: "2 replacements agreed on site" });
    expect(approved.json.data.status).toBe("approved");
    const pay = await api("fin", "POST", `/invoices/${invoice.id}/payments`, { amount: Number(invoice.total), method: "neft", reference: "UTR9" });
    expect(pay.status).toBe(201);
    const closed = await api("proc", "POST", `/purchase-orders/${po.id}/close`, { rating: 5 });
    expect(closed.json.data.status).toBe("closed");
    const after = (await api("fin", "GET", `/budget-summary?department_id=${fac.id}`)).json.data.find(
      (b: { category_id: string }) => b.category_id === rnm.id,
    );
    expect(Number(after.committed_amount)).toBe(0);
    expect(Number(after.actual_amount)).toBeGreaterThanOrEqual(Number(invoice.total));

    const timeline = await api("proc", "GET", `/purchase-orders/${po.id}/timeline`);
    expect(timeline.json.data.map((t: { kind: string }) => t.kind)).toEqual(expect.arrayContaining(["approval", "grn", "invoice", "payment"]));
    const pdf = await fetch(`${BASE}/purchase-orders/${po.id}/pdf`, { headers: { authorization: `Bearer ${keys.proc}` } });
    expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString()).toBe("%PDF");
  });

  it("sourcing: requisition > approval > RFQ > quotes > comparison > award > draft PO", async () => {
    const sci = (await api("owner", "GET", "/departments?q=Science")).json.data[0];
    const req = await api("teacher", "POST", "/requisitions", {
      campus_id: MAIN, department_id: sci.id, title: "Digital thermometers",
      lines: [{ description: "Digital thermometer", quantity: 10, estimated_unit_price: 400 }, { description: "Spare probes", quantity: 20, estimated_unit_price: 50 }],
    });
    expect(req.status).toBe(201);
    expect(Number(req.json.data.estimated_total)).toBe(5000); // fresh row after lines were added
    expect((await api("teacher", "POST", `/requisitions/${req.json.data.id}/submit`)).json.data.status).toBe("pending_approval");
    let decided = false;
    for (const who of ["hod", "fin", "owner"]) {
      const r = (await api(who, "GET", "/approvals/inbox")).json.data.find((x: { entity_id: string }) => x.entity_id === req.json.data.id);
      if (r) { await api(who, "POST", `/approvals/${r.id}/act`, { action: "approve" }); decided = true; break; }
    }
    expect(decided).toBe(true);

    const vendors = (await api("proc", "GET", "/vendors?status=approved")).json.data.slice(0, 2);
    const rfq = await api("proc", "POST", `/requisitions/${req.json.data.id}/rfq`, { vendor_ids: vendors.map((v: { id: string }) => v.id) });
    expect(rfq.status).toBe(201);
    const detail = await api("proc", "GET", `/rfqs/${rfq.json.data.id}`);
    expect(detail.status).toBe(200); // regression: ambiguous quotes embed
    const reqLines = detail.json.data.requisition.lines;
    for (const [i, v] of vendors.entries()) {
      const q = await api("proc", "POST", `/rfqs/${rfq.json.data.id}/quotes`, {
        vendor_id: v.id, delivery_days: 5 + i,
        lines: reqLines.map((l: { id: string; description: string; quantity: number }) => ({ requisition_line_id: l.id, description: l.description, quantity: Number(l.quantity), unit_price: i === 0 ? 380 : 350, tax_rate: 18 })),
      });
      expect(q.status).toBe(201);
    }
    const comp = (await api("proc", "GET", `/rfqs/${rfq.json.data.id}/comparison`)).json.data;
    const lowest = comp.find((c: { is_lowest_total: boolean }) => c.is_lowest_total);
    expect(lowest.vendor_id).toBe(vendors[1].id);
    const award = await api("proc", "POST", `/quotes/${lowest.quote_id}/award`, {});
    expect(award.status).toBe(201);
    expect(award.json.data.status).toBe("draft");
    expect(award.json.data.vendor_id).toBe(vendors[1].id);
    expect(award.json.data.lines.map((l: { unit_price: string }) => Number(l.unit_price))).toEqual([350, 350]);
    expect((await api("proc", "GET", `/rfqs/${rfq.json.data.id}`)).json.data.status).toBe("awarded");
  });

  it("disabled modules return 403 module_disabled", async () => {
    await pool.query("update org_modules set enabled = false where org_id = $1 and module = 'tasks'", [ORG]);
    try {
      const r = await api("owner", "GET", "/projects");
      expect(r.status).toBe(403);
      expect(r.json.error.code).toBe("module_disabled");
      expect((await api("owner", "GET", "/issues")).status).toBe(200);
    } finally {
      await pool.query("update org_modules set enabled = true where org_id = $1 and module = 'tasks'", [ORG]);
    }
  });

  it("tasks: project with default sections, task with assignees, board, my tasks, move", async () => {
    const proj = await api("teacher", "POST", "/projects", { name: "Science exhibition", visibility: "private" });
    expect(proj.status).toBe(201);
    const board = await api("teacher", "GET", `/projects/${proj.json.data.id}/board`);
    expect(board.json.data.sections.map((s: { name: string }) => s.name)).toEqual(["To do", "In progress", "Done"]);
    const t = await api("teacher", "POST", "/tasks", {
      project_id: proj.json.data.id, section_id: board.json.data.sections[0].id, title: "Prepare models",
      due_date: new Date().toISOString().slice(0, 10), assignee_ids: [USERS.teacher, USERS.hod],
    });
    expect(t.status).toBe(201);
    const mine = await api("hod", "GET", "/tasks/mine");
    expect(mine.json.data.map((x: { id: string }) => x.id)).toContain(t.json.data.id);
    const moved = await api("teacher", "POST", `/tasks/${t.json.data.id}/move`, { section_id: board.json.data.sections[2].id, position: 5000, status: "done" });
    expect(moved.json.data.status).toBe("done");
    const rollup = await api("teacher", "GET", "/tasks/rollup");
    expect(rollup.json.data.some((r: { level: string }) => r.level === "org")).toBe(true);
  });

  it("public QR reporting: anonymous issue + tracking token", async () => {
    const qr = await api("", "GET", "/public/qr/demo-chem-lab");
    expect(qr.json.data.name).toBe("Chemistry Lab");
    expect(qr.json.data.categories.length).toBeGreaterThan(0);
    const bot = await api("", "POST", "/public/issues", { qr_token: "demo-chem-lab", title: "spam", website: "http://spam" });
    expect(bot.status).toBe(422);
    const r = await api("", "POST", "/public/issues", {
      qr_token: "demo-chem-lab", title: "Eye-wash station empty", category_id: qr.json.data.categories[0].id,
      photos: [{ file_name: "photo.jpg", mime_type: "image/jpeg", size_bytes: 2000 }],
    });
    expect(r.status).toBe(201);
    expect(r.json.data.uploads).toHaveLength(1);
    const status = await api("", "GET", `/public/issues/status?token=${r.json.data.tracking_token}`);
    expect(status.json.data.status).toBe("assigned");
    const { rows } = await pool.query("select reporter_id, created_by, is_anonymous from issues where number = $1", [r.json.data.number]);
    expect(rows[0]).toEqual({ reporter_id: null, created_by: null, is_anonymous: true });
  });

  it("vendor onboarding through the portal and approval engine", async () => {
    const invite = await api("fm", "POST", "/vendors/invite", { name: "QuickFix Plumbing", email: `qf${Date.now()}@example.test` });
    expect(invite.status).toBe(201);
    const token = new URL(invite.json.data.invite.link).searchParams.get("token")!;
    const portal = (path: string, method = "GET", body?: unknown) => api("", method, path, body, { authorization: `VendorToken ${token}` });
    const me = await portal("/portal/me");
    expect(me.json.data.vendor.status).toBe("invited");
    expect(me.json.data.can_edit_profile).toBe(true);
    expect((await portal("/portal/submit", "POST")).status).toBe(422);
    await portal("/portal/profile", "PATCH", { pan: "ABCDE1234F", bank_account_number: "123456789012", bank_ifsc: "HDFC0001234", gstin: "29ABCDE1234F1Z5" });
    for (const doc_type of ["pan_card", "cancelled_cheque"]) {
      const d = await portal("/portal/documents", "POST", { doc_type, file_name: `${doc_type}.pdf`, mime_type: "application/pdf", size_bytes: 1000 });
      expect(d.status).toBe(201);
    }
    expect((await portal("/portal/submit", "POST")).json.data.status).toBe("submitted");

    const vendorId = invite.json.data.vendor.id;
    const tooEarly = await api("fm", "POST", `/vendors/${vendorId}/submit-for-approval`);
    expect(tooEarly.status).toBe(422); // documents not verified yet
    const docs = (await api("fm", "GET", `/vendors/${vendorId}/documents`)).json.data;
    for (const d of docs) await api("fm", "POST", `/vendors/${vendorId}/documents/${d.id}/verify`, { verification_status: "verified" });
    const submitted = await api("fm", "POST", `/vendors/${vendorId}/submit-for-approval`);
    expect(submitted.json.data.status).toBe("pending_approval");
    const inbox = await api("fin", "GET", "/approvals/inbox");
    const req = inbox.json.data.find((r: { entity_id: string }) => r.entity_id === vendorId);
    await api("fin", "POST", `/approvals/${req.id}/act`, { action: "approve" });
    const vendor = (await api("fm", "GET", `/vendors/${vendorId}`)).json.data;
    expect(vendor.status).toBe("approved");
    expect(vendor.vendor_code).toMatch(/^VEN-/);
    expect((await portal("/portal/profile", "PATCH", { name: "Changed" })).status).toBe(409);
  });

  it("platform admin endpoints need a platform admin session; feedback is open with an email", async () => {
    expect((await api("", "GET", "/admin/organisations")).status).toBe(401);
    expect((await api("owner", "GET", "/admin/organisations")).status).toBe(401); // API keys never reach the console
    expect((await api("owner", "GET", "/analytics")).status).toBe(400); // analytics are for signed-in users
    const report = { kind: "bug", title: "E2E: button does nothing", description: "Clicking save on the e2e page does nothing." };
    const noEmail = await api("", "POST", "/feedback", report, { "x-forwarded-for": "203.0.113.77" });
    expect(noEmail.status).toBe(422);
    const ok = await api("", "POST", "/feedback", { ...report, email: "visitor@example.test" }, { "x-forwarded-for": "203.0.113.77" });
    expect(ok.status).toBe(201);
    const { rows } = await pool.query("select kind, email, user_id from feedback where id = $1", [ok.json.data.id]);
    expect(rows[0]).toEqual({ kind: "bug", email: "visitor@example.test", user_id: null });
    await pool.query("delete from feedback where id = $1", [ok.json.data.id]);
  });

  it("OpenAPI spec is generated from the route table", async () => {
    const spec = (await fetch(`${BASE}/openapi.json`).then((r) => r.json())) as { openapi: string; paths: Record<string, unknown> };
    expect(spec.openapi).toBe("3.1.0");
    expect(Object.keys(spec.paths).length).toBeGreaterThan(150);
    expect(spec.paths["/purchase-orders/{id}/submit"]).toBeTruthy();
  });
});

async function firstLocation() {
  const { rows } = await pool.query("select id from locations where qr_token = 'demo-room-101'");
  return rows[0];
}
async function scienceDept() {
  const { rows } = await pool.query("select id from departments where org_id = $1 and code = 'SCI' and campus_id = $2", [ORG, MAIN]);
  return rows[0];
}
