import "server-only";
import { z } from "zod";
import { crudRoutes } from "@/lib/api/crud";
import { ApiError, unwrap } from "@/lib/api/errors";
import { route, type RouteDef } from "@/lib/api/router";
import { isoDate, money, name, optUuid, quantity } from "@/lib/schemas/common";
import { renderPoPdf, type PoPdfData } from "@/lib/services/po-pdf";
import { getResource, type ResourceSpec } from "@/lib/services/resource";
import type { RequestContext } from "@/lib/auth/context";

const M = "po" as const;
const db = (ctx: RequestContext) => (ctx.kind === "api_key" ? ctx.admin() : ctx.db);
const gstRate = z.union([z.literal(0), z.literal(0.1), z.literal(0.25), z.literal(1.5), z.literal(3), z.literal(5), z.literal(12), z.literal(18), z.literal(28)]);

// ---------------------------------------------------------------------------
// Items catalogue
// ---------------------------------------------------------------------------
const itemSchema = z.object({
  name,
  sku: z.string().max(60).nullable().optional(),
  description: z.string().max(1000).nullable().optional(),
  unit: z.string().max(20).default("nos"),
  hsn_sac: z.string().regex(/^[0-9]{4,8}$/).nullable().optional(),
  gst_rate: gstRate.default(18),
  expense_category_id: optUuid,
  is_asset: z.boolean().default(false),
  asset_category_id: optUuid,
  last_price: money.nullable().optional(),
  active: z.boolean().default(true),
});
export const items: ResourceSpec = {
  name: "items",
  memberRead: true,
  entityType: "item",
  table: "items",
  module: M,
  permission: "po",
  readPermission: "requisition:submit",
  createPermission: "po:create",
  updatePermission: "po:create",
  deletePermission: "po:create",
  filters: { active: "bool", is_asset: "bool", expense_category_id: "eq" },
  sortable: ["name", "sku", "created_at"],
  defaultSort: "name",
  search: ["name", "sku", "hsn_sac"],
  createSchema: itemSchema,
  updateSchema: itemSchema.partial(),
};

// ---------------------------------------------------------------------------
// Requisitions
// ---------------------------------------------------------------------------
const reqLine = z.object({
  item_id: optUuid,
  description: z.string().trim().min(1).max(500),
  quantity,
  unit: z.string().max(20).default("nos"),
  estimated_unit_price: money.default(0),
  position: z.number().int().optional(),
});
const requisitionSchema = z.object({
  campus_id: z.uuid(),
  department_id: optUuid,
  category_id: optUuid,
  requested_by: optUuid,
  title: z.string().trim().min(3).max(200),
  justification: z.string().max(5000).nullable().optional(),
  needed_by: isoDate.nullable().optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  lines: z.array(reqLine).max(200).optional(),
});
export const requisitions: ResourceSpec = {
  name: "requisitions",
  ownerColumns: ["requested_by", "created_by"],
  ownerCanUpdate: true,
  ownCreate: { permission: "requisition:submit", column: "requested_by" },
  entityType: "requisition",
  table: "requisitions",
  module: M,
  permission: "requisition",
  campusColumn: "campus_id",
  departmentColumn: "department_id",
  select:
    "*, requester:profiles!requisitions_requested_by_fkey(id, full_name), campus:campuses(id, name, code), department:departments(id, name), category:expense_categories(id, name)",
  detailSelect:
    "*, requester:profiles!requisitions_requested_by_fkey(id, full_name, email), campus:campuses(id, name, code), department:departments(id, name), category:expense_categories(id, name), lines:requisition_lines(*, item:items(id, name, sku))",
  filters: { status: "in", campus_id: "eq", department_id: "eq", requested_by: "user", priority: "in", created_at: "range" },
  sortable: ["created_at", "needed_by", "estimated_total", "number"],
  defaultSort: "-created_at",
  search: ["title", "number"],
  softDelete: true,
  placeholders: { number: "" },
  createSchema: requisitionSchema,
  updateSchema: requisitionSchema.omit({ lines: true, requested_by: true }).partial(),
  prepareCreate: async (ctx, input) => {
    const { lines: _l, ...rest } = input; // eslint-disable-line @typescript-eslint/no-unused-vars
    if (input.requested_by && input.requested_by !== ctx.userId) await ctx.require("requisition:create", { campusId: input.campus_id });
    return { ...rest, requested_by: input.requested_by ?? ctx.userId };
  },
  afterCreate: async (ctx, row, input) => {
    const lines = (input.lines ?? []) as z.infer<typeof reqLine>[];
    if (lines.length)
      unwrap(await db(ctx).from("requisition_lines").insert(lines.map((l, i) => ({ ...l, position: l.position ?? i, org_id: ctx.orgId, requisition_id: row.id }))));
  },
  csvColumns: [["number", "Number"], ["title", "Title"], ["status", "Status"], ["requester.full_name", "Requested by"], ["campus.name", "Campus"],
    ["department.name", "Department"], ["estimated_total", "Estimated"], ["needed_by", "Needed by"], ["created_at", "Created"]],
};

// ---------------------------------------------------------------------------
// RFQs
// ---------------------------------------------------------------------------
export const rfqs: ResourceSpec = {
  name: "rfqs",
  entityType: "rfq",
  table: "rfqs",
  module: M,
  permission: "rfq",
  campusColumn: "campus_id",
  departmentColumn: "department_id",
  select: "*, requisition:requisitions(id, number, title), vendors:rfq_vendors(vendor_id, responded_at, declined, vendor:vendors(id, name))",
  detailSelect:
    "*, requisition:requisitions(id, number, title, lines:requisition_lines(*)), vendors:rfq_vendors(vendor_id, invited_at, responded_at, declined, vendor:vendors(id, name, email, rating_avg)), quotes:quotes!quotes_rfq_id_fkey(*, vendor:vendors(id, name), lines:quote_lines(*))",
  filters: { status: "in", campus_id: "eq", requisition_id: "eq" },
  sortable: ["created_at", "due_date", "number"],
  defaultSort: "-created_at",
  search: ["title", "number"],
  softDelete: true,
  updateSchema: z.object({ title: name, terms: z.string().max(5000).nullable(), due_date: isoDate.nullable(), status: z.enum(["sent", "closed", "cancelled"]) }).partial(),
};

// ---------------------------------------------------------------------------
// Purchase orders
// ---------------------------------------------------------------------------
const poLine = z.object({
  item_id: optUuid,
  requisition_line_id: optUuid,
  description: z.string().trim().min(1).max(500),
  hsn_sac: z.string().regex(/^[0-9]{4,8}$/).nullable().optional(),
  quantity,
  unit: z.string().max(20).default("nos"),
  unit_price: money,
  discount_pct: z.number().min(0).max(100).default(0),
  tax_rate: gstRate.default(18),
  is_asset: z.boolean().default(false),
  asset_category_id: optUuid,
});
const poSchema = z.object({
  campus_id: z.uuid(),
  department_id: optUuid,
  category_id: optUuid,
  vendor_id: z.uuid(),
  requisition_id: optUuid,
  order_date: isoDate.optional(),
  expected_delivery: isoDate.nullable().optional(),
  delivery_location_id: optUuid,
  billing_address: z.string().max(1000).nullable().optional(),
  shipping_address: z.string().max(1000).nullable().optional(),
  payment_terms: z.string().max(500).nullable().optional(),
  terms_and_conditions: z.string().max(10000).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  lines: z.array(poLine).max(500).optional(),
});
export const purchaseOrders: ResourceSpec = {
  name: "purchase-orders",
  ownerColumns: ["created_by"],
  entityType: "purchase_order",
  table: "purchase_orders",
  module: M,
  permission: "po",
  campusColumn: "campus_id",
  departmentColumn: "department_id",
  select:
    "*, vendor:vendors(id, name), campus:campuses(id, name, code), department:departments(id, name), creator:profiles!purchase_orders_created_by_fkey(id, full_name)",
  detailSelect:
    "*, vendor:vendors(id, name, legal_name, email, phone, gstin, address, city, state), campus:campuses(id, name, code, address, city, state, pincode, gstin), department:departments(id, name), category:expense_categories(id, name), requisition:requisitions(id, number, title), lines:po_lines(*), versions:po_versions(id, version, change_reason, created_at), creator:profiles!purchase_orders_created_by_fkey(id, full_name)",
  filters: {
    status: "in",
    vendor_id: "eq",
    campus_id: "eq",
    department_id: "eq",
    category_id: "eq",
    requisition_id: "eq",
    fiscal_year_id: "eq",
    order_date: "range",
    created_by: "user",
  },
  sortable: ["created_at", "order_date", "total", "number", "expected_delivery"],
  defaultSort: "-created_at",
  search: ["number"],
  softDelete: true,
  placeholders: { number: "" },
  createSchema: poSchema,
  updateSchema: poSchema.omit({ lines: true, campus_id: true }).partial(),
  prepareCreate: (ctx, input) => {
    const { lines: _l, ...rest } = input; // eslint-disable-line @typescript-eslint/no-unused-vars
    return { ...rest, created_by: ctx.userId };
  },
  afterCreate: async (ctx, row, input) => {
    const lines = (input.lines ?? []) as z.infer<typeof poLine>[];
    if (lines.length) unwrap(await db(ctx).from("po_lines").insert(lines.map((l, i) => ({ ...l, line_no: i + 1, org_id: ctx.orgId, po_id: row.id }))));
  },
  csvColumns: [
    ["number", "PO number"], ["version", "Version"], ["status", "Status"], ["vendor.name", "Vendor"], ["campus.name", "Campus"],
    ["department.name", "Department"], ["order_date", "Order date"], ["expected_delivery", "Expected"], ["subtotal", "Subtotal"],
    ["tax_total", "Tax"], ["total", "Total"],
  ],
};

export const grns: ResourceSpec = {
  name: "grns",
  entityType: "grn",
  table: "grns",
  module: M,
  permission: "grn",
  campusColumn: "campus_id",
  select: "*, po:purchase_orders(id, number, vendor:vendors(id, name)), receiver:profiles!grns_received_by_fkey(id, full_name)",
  detailSelect:
    "*, po:purchase_orders(id, number, status, vendor:vendors(id, name)), receiver:profiles!grns_received_by_fkey(id, full_name), lines:grn_lines(*, po_line:po_lines(id, line_no, description, quantity, received_qty, unit, is_asset, asset_category_id))",
  filters: { po_id: "eq", status: "in", campus_id: "eq", received_date: "range" },
  sortable: ["received_date", "created_at", "number"],
  defaultSort: "-received_date",
  search: ["number", "delivery_note_number"],
  placeholders: { number: "" },
  createSchema: z.object({
    po_id: z.uuid(),
    received_date: isoDate.optional(),
    delivery_note_number: z.string().max(60).nullable().optional(),
    vehicle_number: z.string().max(20).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
    lines: z
      .array(z.object({ po_line_id: z.uuid(), received_qty: z.number().min(0), accepted_qty: z.number().min(0), remarks: z.string().max(500).optional() }))
      .min(1)
      .max(500),
  }),
  updateSchema: z.object({ delivery_note_number: z.string().max(60).nullable(), vehicle_number: z.string().max(20).nullable(), notes: z.string().max(2000).nullable() }).partial(),
  prepareCreate: async (ctx, input) => {
    const po = await getResource(ctx, purchaseOrders, input.po_id);
    const { lines: _l, ...rest } = input; // eslint-disable-line @typescript-eslint/no-unused-vars
    return { ...rest, campus_id: po.campus_id, received_by: ctx.userId, created_by: ctx.userId };
  },
  afterCreate: async (ctx, row, input) => {
    unwrap(
      await db(ctx)
        .from("grn_lines")
        .insert(
          (input.lines as { po_line_id: string; received_qty: number; accepted_qty: number; remarks?: string }[]).map((l) => ({
            ...l,
            org_id: ctx.orgId,
            grn_id: row.id,
          })),
        ),
    );
  },
};

export const invoices: ResourceSpec = {
  name: "invoices",
  entityType: "vendor_invoice",
  table: "vendor_invoices",
  module: M,
  permission: "invoice",
  campusColumn: "campus_id",
  select: "*, vendor:vendors(id, name), po:purchase_orders(id, number)",
  detailSelect:
    "*, vendor:vendors(id, name, gstin), po:purchase_orders(id, number, total, status), lines:vendor_invoice_lines(*, po_line:po_lines(id, line_no, description, quantity, unit_price, discount_pct, received_qty, invoiced_qty)), payments(*), approver:profiles!vendor_invoices_approved_by_fkey(id, full_name)",
  filters: { status: "in", match_status: "in", vendor_id: "eq", po_id: "eq", campus_id: "eq", due_date: "range", invoice_date: "range" },
  sortable: ["invoice_date", "due_date", "total", "created_at"],
  defaultSort: "-invoice_date",
  search: ["vendor_invoice_number", "number"],
  placeholders: { number: "" },
  createSchema: z.object({
    po_id: z.uuid(),
    vendor_invoice_number: z.string().trim().min(1).max(60),
    invoice_date: isoDate,
    due_date: isoDate.nullable().optional(),
    attachment_id: optUuid,
    lines: z
      .array(z.object({ po_line_id: z.uuid(), quantity, unit_price: money, tax_amount: money.default(0) }))
      .min(1)
      .max(500),
  }),
  updateSchema: z.object({ vendor_invoice_number: z.string().trim().min(1).max(60), invoice_date: isoDate, due_date: isoDate.nullable(), attachment_id: optUuid }).partial(),
  prepareCreate: async (ctx, input) => {
    const po = await getResource(ctx, purchaseOrders, input.po_id);
    const { lines: _l, ...rest } = input; // eslint-disable-line @typescript-eslint/no-unused-vars
    return { ...rest, vendor_id: po.vendor_id, campus_id: po.campus_id, created_by: ctx.userId };
  },
  afterCreate: async (ctx, row, input) => {
    unwrap(
      await db(ctx)
        .from("vendor_invoice_lines")
        .insert(
          (input.lines as { po_line_id: string; quantity: number; unit_price: number; tax_amount: number }[]).map((l) => ({
            ...l,
            org_id: ctx.orgId,
            invoice_id: row.id,
          })),
        ),
    );
    unwrap(await db(ctx).rpc("invoice_three_way_match", { p_invoice_id: row.id }));
  },
  csvColumns: [
    ["number", "Ref"], ["vendor_invoice_number", "Vendor invoice #"], ["vendor.name", "Vendor"], ["po.number", "PO"], ["invoice_date", "Date"],
    ["due_date", "Due"], ["total", "Total"], ["amount_paid", "Paid"], ["status", "Status"], ["match_status", "3-way match"],
  ],
};

async function poPdf(ctx: RequestContext, id: string) {
  const po = await getResource(ctx, purchaseOrders, id);
  const data: PoPdfData = {
    org: { name: ctx.org.name, currency: ctx.org.currency, locale: ctx.org.locale },
    campus: po.campus,
    vendor: po.vendor,
    po: po as PoPdfData["po"],
    lines: [...po.lines].sort((a: { line_no: number }, b: { line_no: number }) => a.line_no - b.line_no),
  };
  return new Response(Buffer.from(await renderPoPdf(data)), {
    headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${po.number.replace(/\//g, "-")}.pdf"` },
  });
}

export const poRoutes: RouteDef[] = [
  route({
    method: "GET",
    path: "/po/dashboard",
    summary: "Procurement KPIs: pipeline, open value, invoices pending, top vendors",
    tags: ["purchase-orders"],
    module: M,
    permission: "po:read",
    handler: async ({ ctx }) => unwrap(await ctx.db.rpc("po_dashboard", { p_org: ctx.orgId })),
  }),
  ...crudRoutes(items, { tag: "items", ops: ["list", "get", "create", "update", "delete", "export"] }),

  ...crudRoutes(requisitions),
  route({
    method: "POST",
    path: "/requisitions/:id/lines",
    summary: "Add a line to a draft requisition",
    tags: ["requisitions"],
    module: M,
    body: reqLine,
    handler: async ({ ctx, params, body }) =>
      unwrap(await db(ctx).from("requisition_lines").insert({ ...body, org_id: ctx.orgId, requisition_id: params.id }).select("*").single()),
  }),
  route({
    method: "PATCH",
    path: "/requisitions/:id/lines/:lineId",
    summary: "Update a requisition line",
    tags: ["requisitions"],
    module: M,
    body: reqLine.partial(),
    handler: async ({ ctx, params, body }) =>
      unwrap(await db(ctx).from("requisition_lines").update(body).eq("id", params.lineId).eq("requisition_id", params.id).select("*").single()),
  }),
  route({
    method: "DELETE",
    path: "/requisitions/:id/lines/:lineId",
    summary: "Remove a requisition line",
    tags: ["requisitions"],
    module: M,
    response: "none",
    handler: async ({ ctx, params }) => {
      unwrap(await db(ctx).from("requisition_lines").delete().eq("id", params.lineId).eq("requisition_id", params.id));
    },
  }),
  route({
    method: "POST",
    path: "/requisitions/:id/submit",
    summary: "Submit a requisition for approval (budget is checked)",
    tags: ["requisitions"],
    module: M,
    status: 200,
    handler: async ({ ctx, params }) => unwrap(await ctx.db.rpc("requisition_submit", { p_requisition_id: params.id })),
  }),
  route({
    method: "POST",
    path: "/requisitions/:id/rfq",
    summary: "Create and send an RFQ to selected vendors",
    tags: ["requisitions"],
    module: M,
    body: z.object({ vendor_ids: z.array(z.uuid()).min(1).max(20), due_date: isoDate.optional(), terms: z.string().max(5000).optional() }),
    handler: async ({ ctx, params, body }) => {
      const id = unwrap(
        await ctx.db.rpc("rfq_create_from_requisition", {
          p_requisition_id: params.id, p_vendor_ids: body.vendor_ids, p_due_date: body.due_date, p_terms: body.terms,
        }),
      );
      return getResource(ctx, rfqs, id);
    },
  }),
  route({
    method: "POST",
    path: "/requisitions/:id/purchase-order",
    summary: "Create a draft PO directly from an approved requisition (single vendor, no RFQ)",
    tags: ["requisitions"],
    module: M,
    body: z.object({ vendor_id: z.uuid(), expected_delivery: isoDate.optional() }),
    handler: async ({ ctx, params, body }) => {
      const req = await getResource(ctx, requisitions, params.id);
      if (!["approved", "rfq"].includes(req.status)) throw new ApiError("conflict", "Requisition must be approved");
      await ctx.require("po:create", { campusId: req.campus_id, departmentId: req.department_id });
      const d = db(ctx);
      const po = unwrap(
        await d
          .from("purchase_orders")
          .insert({
            org_id: ctx.orgId, number: "", campus_id: req.campus_id, department_id: req.department_id, category_id: req.category_id,
            vendor_id: body.vendor_id, requisition_id: req.id, expected_delivery: body.expected_delivery ?? req.needed_by, created_by: ctx.userId,
          })
          .select("id")
          .single(),
      );
      const lines = req.lines as { id: string; item_id: string | null; description: string; quantity: number; unit: string; estimated_unit_price: number }[];
      if (lines.length)
        unwrap(
          await d.from("po_lines").insert(
            lines.map((l, i) => ({
              org_id: ctx.orgId, po_id: po.id, line_no: i + 1, item_id: l.item_id, requisition_line_id: l.id, description: l.description,
              quantity: l.quantity, unit: l.unit, unit_price: l.estimated_unit_price,
            })),
          ),
        );
      return getResource(ctx, purchaseOrders, po.id);
    },
  }),

  ...crudRoutes(rfqs, { ops: ["list", "get", "update", "export"] }),
  route({
    method: "GET",
    path: "/rfqs/:id/comparison",
    summary: "Quote comparison matrix (lowest per line and overall)",
    tags: ["rfqs"],
    module: M,
    handler: async ({ ctx, params }) => {
      await getResource(ctx, rfqs, params.id);
      return unwrap(await ctx.db.from("rfq_quote_comparison").select("*").eq("rfq_id", params.id));
    },
  }),
  route({
    method: "POST",
    path: "/rfqs/:id/quotes",
    summary: "Record a vendor quote",
    tags: ["rfqs"],
    module: M,
    body: z.object({
      vendor_id: z.uuid(),
      quote_reference: z.string().max(60).optional(),
      valid_until: isoDate.optional(),
      delivery_days: z.number().int().min(0).max(365).optional(),
      payment_terms: z.string().max(500).optional(),
      notes: z.string().max(2000).optional(),
      lines: z
        .array(z.object({ requisition_line_id: optUuid, description: z.string().min(1).max(500), quantity, unit_price: money, tax_rate: gstRate.default(18) }))
        .min(1)
        .max(500),
    }),
    handler: async ({ ctx, params, body }) => {
      const rfq = await getResource(ctx, rfqs, params.id);
      await ctx.require("rfq:update", { campusId: rfq.campus_id, departmentId: rfq.department_id });
      const { lines, ...header } = body;
      const d = db(ctx);
      const quote = unwrap(
        await d.from("quotes").upsert({ ...header, org_id: ctx.orgId, rfq_id: params.id, created_by: ctx.userId }, { onConflict: "rfq_id,vendor_id" }).select("*").single(),
      );
      unwrap(await d.from("quote_lines").delete().eq("quote_id", quote.id));
      unwrap(await d.from("quote_lines").insert(lines.map((l) => ({ ...l, org_id: ctx.orgId, quote_id: quote.id }))));
      unwrap(await d.from("rfq_vendors").update({ responded_at: new Date().toISOString() }).eq("rfq_id", params.id).eq("vendor_id", body.vendor_id));
      return unwrap(await ctx.db.from("quotes").select("*, lines:quote_lines(*)").eq("id", quote.id).single());
    },
  }),
  route({
    method: "POST",
    path: "/quotes/:id/award",
    summary: "Award a quote: other quotes are rejected and a draft PO is created",
    tags: ["rfqs"],
    module: M,
    body: z.object({ category_id: optUuid }),
    handler: async ({ ctx, params, body }) => {
      const id = unwrap(await ctx.db.rpc("rfq_award", { p_quote_id: params.id, p_category_id: body.category_id ?? undefined }));
      return getResource(ctx, purchaseOrders, id);
    },
  }),

  ...crudRoutes(purchaseOrders),
  route({
    method: "POST",
    path: "/purchase-orders/:id/lines",
    summary: "Add a line to a draft PO",
    tags: ["purchase-orders"],
    module: M,
    body: poLine,
    handler: async ({ ctx, params, body }) =>
      unwrap(await db(ctx).from("po_lines").insert({ ...body, line_no: 0, org_id: ctx.orgId, po_id: params.id }).select("*").single()),
  }),
  route({
    method: "PATCH",
    path: "/purchase-orders/:id/lines/:lineId",
    summary: "Update a draft PO line",
    tags: ["purchase-orders"],
    module: M,
    body: poLine.partial(),
    handler: async ({ ctx, params, body }) =>
      unwrap(await db(ctx).from("po_lines").update(body).eq("id", params.lineId).eq("po_id", params.id).select("*").single()),
  }),
  route({
    method: "DELETE",
    path: "/purchase-orders/:id/lines/:lineId",
    summary: "Remove a draft PO line",
    tags: ["purchase-orders"],
    module: M,
    response: "none",
    handler: async ({ ctx, params }) => {
      unwrap(await db(ctx).from("po_lines").delete().eq("id", params.lineId).eq("po_id", params.id));
    },
  }),
  ...(
    [
      ["submit", "Submit for approval (budget check; hard limits block)", "po_submit", null],
      ["send", "Send the approved PO to the vendor", "po_send", null],
    ] as const
  ).map(([action, summary, fn]) =>
    route({
      method: "POST",
      path: `/purchase-orders/:id/${action}`,
      summary,
      tags: ["purchase-orders"],
      module: M,
      status: 200,
      handler: async ({ ctx, params }) => {
        const result = unwrap(await ctx.db.rpc(fn, { p_po_id: params.id }));
        return { result, purchase_order: await getResource(ctx, purchaseOrders, params.id) };
      },
    }),
  ),
  route({
    method: "POST",
    path: "/purchase-orders/:id/amend",
    summary: "Amend an approved PO: snapshots the current version and returns it to draft",
    tags: ["purchase-orders"],
    module: M,
    status: 200,
    body: z.object({ reason: z.string().trim().min(3).max(1000) }),
    handler: async ({ ctx, params, body }) => {
      const version = unwrap(await ctx.db.rpc("po_amend", { p_po_id: params.id, p_reason: body.reason }));
      return { version, purchase_order: await getResource(ctx, purchaseOrders, params.id) };
    },
  }),
  route({
    method: "POST",
    path: "/purchase-orders/:id/cancel",
    summary: "Cancel a PO (releases its budget commitment)",
    tags: ["purchase-orders"],
    module: M,
    status: 200,
    body: z.object({ reason: z.string().trim().min(3).max(1000) }),
    handler: async ({ ctx, params, body }) => {
      unwrap(await ctx.db.rpc("po_cancel", { p_po_id: params.id, p_reason: body.reason }));
      return getResource(ctx, purchaseOrders, params.id);
    },
  }),
  route({
    method: "POST",
    path: "/purchase-orders/:id/close",
    summary: "Close a PO (releases remaining commitment) with optional vendor feedback",
    tags: ["purchase-orders"],
    module: M,
    status: 200,
    body: z.object({ rating: z.number().int().min(1).max(5).optional(), comment: z.string().max(2000).optional() }),
    handler: async ({ ctx, params, body }) => {
      unwrap(await ctx.db.rpc("po_close", { p_po_id: params.id, p_rating: body.rating, p_comment: body.comment }));
      return getResource(ctx, purchaseOrders, params.id);
    },
  }),
  route({
    method: "GET",
    path: "/purchase-orders/:id/timeline",
    summary: "Status timeline: activity, approvals, receipts, invoices, payments",
    tags: ["purchase-orders"],
    module: M,
    handler: async ({ ctx, params }) => {
      await getResource(ctx, purchaseOrders, params.id);
      return unwrap(await ctx.db.rpc("po_timeline", { p_po_id: params.id }));
    },
  }),
  route({
    method: "GET",
    path: "/purchase-orders/:id/versions/:version",
    summary: "Snapshot of a previous PO version",
    tags: ["purchase-orders"],
    module: M,
    handler: async ({ ctx, params }) => {
      await getResource(ctx, purchaseOrders, params.id);
      return unwrap(await ctx.db.from("po_versions").select("*").eq("po_id", params.id).eq("version", Number(params.version)).single());
    },
  }),
  route({ method: "GET", path: "/purchase-orders/:id/pdf", summary: "PO as PDF", tags: ["purchase-orders"], module: M, response: "pdf", handler: ({ ctx, params }) => poPdf(ctx, params.id) }),

  ...crudRoutes(grns, { ops: ["list", "get", "create", "update", "export"] }),
  route({
    method: "POST",
    path: "/grns/:id/post",
    summary: "Post a GRN: updates received quantities and returns asset candidates",
    tags: ["grns"],
    module: M,
    status: 200,
    handler: async ({ ctx, params }) => unwrap(await ctx.db.rpc("grn_post", { p_grn_id: params.id })),
  }),
  route({
    method: "POST",
    path: "/grns/lines/:lineId/assets",
    summary: "Create assets (one per accepted unit) from a posted GRN line",
    tags: ["grns"],
    module: M,
    body: z.object({ location_id: optUuid, category_id: optUuid, custodian_id: optUuid }),
    handler: async ({ ctx, params, body }) => ({
      created: unwrap(
        await ctx.db.rpc("grn_create_assets", {
          p_grn_line_id: params.lineId, p_location_id: body.location_id ?? undefined, p_category_id: body.category_id ?? undefined,
          p_custodian_id: body.custodian_id ?? undefined,
        }),
      ),
    }),
  }),

  ...crudRoutes(invoices, { ops: ["list", "get", "create", "update", "export"] }),
  route({
    method: "POST",
    path: "/invoices/:id/match",
    summary: "Run the 3-way match (PO price / GRN quantity / invoice)",
    tags: ["invoices"],
    module: M,
    status: 200,
    handler: async ({ ctx, params }) => unwrap(await ctx.db.rpc("invoice_three_way_match", { p_invoice_id: params.id })),
  }),
  route({
    method: "POST",
    path: "/invoices/:id/approve",
    summary: "Approve for payment (requires a match or an override reason)",
    tags: ["invoices"],
    module: M,
    status: 200,
    body: z.object({ override_reason: z.string().trim().min(5).max(1000).optional() }),
    handler: async ({ ctx, params, body }) => unwrap(await ctx.db.rpc("invoice_approve", { p_invoice_id: params.id, p_override_reason: body.override_reason })),
  }),
  route({
    method: "POST",
    path: "/invoices/:id/payments",
    summary: "Record a payment against an approved invoice",
    tags: ["invoices"],
    module: M,
    body: z.object({
      amount: money.positive(),
      tds_amount: money.default(0),
      method: z.enum(["neft", "rtgs", "imps", "upi", "cheque", "cash", "other"]),
      reference: z.string().max(100).optional(),
      paid_on: isoDate.optional(),
    }),
    handler: async ({ ctx, params, body }) => ({
      payment_id: unwrap(
        await ctx.db.rpc("invoice_record_payment", {
          p_invoice_id: params.id, p_amount: body.amount, p_method: body.method, p_reference: body.reference, p_paid_on: body.paid_on, p_tds: body.tds_amount,
        }),
      ),
    }),
  }),
  route({
    method: "GET",
    path: "/payments",
    summary: "Payments ledger",
    tags: ["invoices"],
    module: M,
    query: z.object({ vendor_id: z.uuid().optional(), from: isoDate.optional(), to: isoDate.optional() }),
    handler: async ({ ctx, query }) => {
      let q = ctx.db
        .from("payments")
        .select("*, vendor:vendors(id, name), invoice:vendor_invoices(id, number, vendor_invoice_number, po_id)")
        .eq("org_id", ctx.orgId)
        .order("paid_on", { ascending: false })
        .limit(500);
      if (query.get("vendor_id")) q = q.eq("vendor_id", query.get("vendor_id")!);
      if (query.get("from")) q = q.gte("paid_on", query.get("from")!);
      if (query.get("to")) q = q.lte("paid_on", query.get("to")!);
      return unwrap(await q);
    },
  }),
];
