import "server-only";
import { z } from "zod";
import { crudRoutes } from "@/lib/api/crud";
import { ApiError, unwrap } from "@/lib/api/errors";
import { route, type RouteDef } from "@/lib/api/router";
import { code, customFields, isoDate, money, name, optUuid } from "@/lib/schemas/common";
import { getResource, type ResourceSpec } from "@/lib/services/resource";
import { toCsv } from "@/lib/utils/csv";

const M = "expense" as const;

const categorySchema = z.object({
  name,
  code,
  parent_id: optUuid,
  gl_code: z.string().max(40).nullable().optional(),
  description: z.string().max(500).nullable().optional(),
  per_claim_limit: money.positive().nullable().optional(),
  limit_mode: z.enum(["soft", "hard"]).default("soft"),
  receipt_required_above: money.nullable().optional(),
  applies_to: z.array(z.enum(["expense", "po"])).default(["expense", "po"]),
  active: z.boolean().default(true),
});
export const expenseCategories: ResourceSpec = {
  name: "expense-categories",
  memberRead: true,
  entityType: "expense_category",
  table: "expense_categories",
  module: M,
  permission: "budget",
  readPermission: "expense:submit",
  createPermission: "budget:manage",
  updatePermission: "budget:manage",
  deletePermission: "budget:manage",
  filters: { active: "bool", applies_to: "contains" },
  sortable: ["name", "code"],
  defaultSort: "name",
  search: ["name", "code", "gl_code"],
  createSchema: categorySchema,
  updateSchema: categorySchema.partial(),
};

const budgetSchema = z.object({
  fiscal_year_id: z.uuid(),
  campus_id: optUuid,
  department_id: optUuid,
  category_id: z.uuid(),
  allocated_amount: money,
  control_mode: z.enum(["none", "soft", "hard"]).default("soft"),
  warning_threshold_pct: z.number().min(1).max(100).default(90),
  allow_carry_forward: z.boolean().default(false),
  status: z.enum(["draft", "active", "frozen", "closed"]).default("active"),
  notes: z.string().max(1000).nullable().optional(),
});
export const budgets: ResourceSpec = {
  name: "budgets",
  entityType: "budget",
  table: "budgets",
  module: M,
  permission: "budget",
  campusColumn: "campus_id",
  departmentColumn: "department_id",
  select:
    "*, category:expense_categories(id, name, code), campus:campuses(id, name, code), department:departments(id, name, code), fiscal_year:fiscal_years(id, label)",
  filters: { fiscal_year_id: "eq", campus_id: "eq", department_id: "eq", category_id: "eq", status: "in", control_mode: "in" },
  sortable: ["created_at", "allocated_amount"],
  defaultSort: "-allocated_amount",
  createSchema: budgetSchema,
  updateSchema: budgetSchema.omit({ fiscal_year_id: true, category_id: true }).partial(),
};

const itemSchema = z.object({
  category_id: z.uuid(),
  expense_date: isoDate,
  description: z.string().trim().min(1).max(500),
  merchant: z.string().max(200).nullable().optional(),
  amount: money.positive(),
  tax_amount: money.default(0),
  receipt_attachment_id: optUuid,
});
const claimCreate = z.object({
  campus_id: z.uuid(),
  department_id: optUuid,
  claimant_id: optUuid,
  claim_type: z.enum(["reimbursement", "advance_settlement", "petty_cash_replenishment", "vendor_direct"]).default("reimbursement"),
  advance_id: optUuid,
  vendor_id: optUuid,
  title: z.string().trim().min(3).max(200),
  description: z.string().max(2000).nullable().optional(),
  items: z.array(itemSchema).max(100).optional(),
  custom_fields: customFields,
});
export const expenseClaims: ResourceSpec = {
  name: "expense-claims",
  ownerColumns: ["claimant_id", "created_by"],
  ownerCanUpdate: true,
  ownCreate: { permission: "expense:submit", column: "claimant_id" },
  entityType: "expense_claim",
  table: "expense_claims",
  module: M,
  permission: "expense",
  campusColumn: "campus_id",
  departmentColumn: "department_id",
  select:
    "*, claimant:profiles!expense_claims_claimant_id_fkey(id, full_name), campus:campuses(id, name, code), department:departments(id, name)",
  detailSelect:
    "*, claimant:profiles!expense_claims_claimant_id_fkey(id, full_name, email), campus:campuses(id, name, code), department:departments(id, name), vendor:vendors(id, name), advance:expense_advances(id, number, amount, settled_amount), items:expense_items(*, category:expense_categories(id, name, code))",
  filters: {
    status: "in",
    claim_type: "in",
    claimant_id: "user",
    campus_id: "eq",
    department_id: "eq",
    fiscal_year_id: "eq",
    submitted_at: "range",
    created_at: "range",
  },
  sortable: ["created_at", "submitted_at", "total_amount", "number"],
  defaultSort: "-created_at",
  search: ["title", "number"],
  softDelete: true,
  customFields: true,
  placeholders: { number: "" },
  createSchema: claimCreate,
  updateSchema: claimCreate.omit({ claimant_id: true, items: true }).partial(),
  prepareCreate: async (ctx, input) => {
    if (input.claimant_id && input.claimant_id !== ctx.userId) await ctx.require("expense:create", { campusId: input.campus_id, departmentId: input.department_id });
    const { items: _items, ...rest } = input; // eslint-disable-line @typescript-eslint/no-unused-vars
    return { ...rest, claimant_id: input.claimant_id ?? ctx.userId };
  },
  afterCreate: async (ctx, row, input) => {
    const items = (input.items ?? []) as z.infer<typeof itemSchema>[];
    if (items.length === 0) return;
    const db = ctx.kind === "api_key" ? ctx.admin() : ctx.db;
    unwrap(await db.from("expense_items").insert(items.map((i) => ({ ...i, org_id: ctx.orgId, claim_id: row.id }))));
  },
  csvColumns: [
    ["number", "Number"], ["title", "Title"], ["claim_type", "Type"], ["status", "Status"], ["claimant.full_name", "Claimant"],
    ["campus.name", "Campus"], ["department.name", "Department"], ["total_amount", "Amount"], ["submitted_at", "Submitted"],
    ["approved_at", "Approved"], ["paid_at", "Paid"], ["payment_reference", "Payment ref"],
  ],
};

const advanceSchema = z.object({
  campus_id: z.uuid(),
  department_id: optUuid,
  category_id: optUuid,
  user_id: optUuid,
  purpose: z.string().trim().min(3).max(500),
  amount: money.positive(),
  needed_by: isoDate.nullable().optional(),
});
export const advances: ResourceSpec = {
  name: "expense-advances",
  ownerColumns: ["user_id", "created_by"],
  ownerCanUpdate: true,
  ownCreate: { permission: "expense:submit", column: "user_id" },
  entityType: "expense_advance",
  table: "expense_advances",
  module: M,
  permission: "expense",
  campusColumn: "campus_id",
  departmentColumn: "department_id",
  select: "*, user:profiles!expense_advances_user_id_fkey(id, full_name), campus:campuses(id, name)",
  filters: { status: "in", user_id: "user", campus_id: "eq", department_id: "eq" },
  sortable: ["created_at", "amount", "needed_by"],
  defaultSort: "-created_at",
  search: ["purpose", "number"],
  softDelete: true,
  placeholders: { number: "" },
  createSchema: advanceSchema,
  updateSchema: advanceSchema.omit({ user_id: true }).partial(),
  prepareCreate: async (ctx, input) => {
    if (input.user_id && input.user_id !== ctx.userId) await ctx.require("expense:create", { campusId: input.campus_id });
    return { ...input, user_id: input.user_id ?? ctx.userId };
  },
};

const fundSchema = z.object({
  campus_id: z.uuid(),
  department_id: optUuid,
  name,
  custodian_id: z.uuid(),
  float_amount: money,
  low_balance_threshold: money.default(0),
  active: z.boolean().default(true),
});
export const pettyCashFunds: ResourceSpec = {
  name: "petty-cash-funds",
  ownerColumns: ["custodian_id"],
  entityType: "petty_cash_fund",
  table: "petty_cash_funds",
  module: M,
  permission: "petty_cash",
  campusColumn: "campus_id",
  departmentColumn: "department_id",
  select: "*, custodian:profiles!petty_cash_funds_custodian_id_fkey(id, full_name), campus:campuses(id, name)",
  filters: { campus_id: "eq", custodian_id: "user", active: "bool" },
  sortable: ["name", "balance", "created_at"],
  defaultSort: "name",
  createSchema: fundSchema,
  updateSchema: fundSchema.omit({ campus_id: true }).partial(),
};

const recurringSchema = z.object({
  campus_id: z.uuid(),
  department_id: optUuid,
  category_id: z.uuid(),
  vendor_id: optUuid,
  owner_id: optUuid,
  title: z.string().trim().min(3).max(200),
  description: z.string().max(1000).nullable().optional(),
  amount: money.positive(),
  frequency: z.enum(["weekly", "monthly", "quarterly", "half_yearly", "yearly"]),
  next_run_date: isoDate,
  end_date: isoDate.nullable().optional(),
  auto_submit: z.boolean().default(false),
  active: z.boolean().default(true),
});
export const recurringExpenses: ResourceSpec = {
  name: "recurring-expenses",
  ownerColumns: ["owner_id"],
  ownerCanUpdate: true,
  ownCreate: { permission: "expense:submit", column: "owner_id" },
  entityType: "recurring_expense",
  table: "recurring_expenses",
  module: M,
  permission: "expense",
  readPermission: "expense:read",
  createPermission: "expense:submit",
  updatePermission: "expense:update",
  deletePermission: "expense:delete",
  campusColumn: "campus_id",
  departmentColumn: "department_id",
  select: "*, category:expense_categories(id, name), vendor:vendors(id, name), owner:profiles!recurring_expenses_owner_id_fkey(id, full_name)",
  filters: { active: "bool", owner_id: "user", campus_id: "eq", frequency: "in" },
  sortable: ["next_run_date", "amount", "title"],
  defaultSort: "next_run_date",
  search: ["title"],
  createSchema: recurringSchema,
  updateSchema: recurringSchema.partial(),
  prepareCreate: (ctx, input) => ({ ...input, owner_id: input.owner_id ?? ctx.userId }),
};

async function claimForUpdate(ctx: Parameters<typeof getResource>[0], id: string) {
  const claim = await getResource(ctx, expenseClaims, id);
  if (!["draft", "rejected"].includes(claim.status)) throw new ApiError("conflict", "Items can only be changed while the claim is a draft");
  return claim;
}

export const expenseRoutes: RouteDef[] = [
  ...crudRoutes(expenseCategories, { tag: "expense-setup", ops: ["list", "get", "create", "update", "delete"] }),
  ...crudRoutes(budgets, { tag: "budgets" }),
  route({
    method: "GET",
    path: "/budget-summary",
    summary: "Budget lines with total, committed, actual and available amounts",
    tags: ["budgets"],
    module: M,
    query: z.object({ fiscal_year_id: z.uuid().optional(), campus_id: z.uuid().optional(), department_id: z.uuid().optional() }),
    handler: async ({ ctx, query }) => {
      let q = ctx.db
        .from("budget_summary")
        .select("*")
        .eq("org_id", ctx.orgId)
        .order("total_budget", { ascending: false })
        .limit(1000);
      for (const k of ["fiscal_year_id", "campus_id", "department_id", "category_id"] as const) {
        const v = query.get(k);
        if (v) q = q.eq(k, v);
      }
      const rows = unwrap(await q);
      if (ctx.kind !== "api_key") return rows;
      const out = [];
      for (const r of rows) if (await ctx.can("budget:read", { campusId: r.campus_id, departmentId: r.department_id })) out.push(r);
      return out;
    },
  }),
  route({
    method: "GET",
    path: "/budget-summary/export",
    summary: "Export budget vs committed vs actual as CSV",
    tags: ["budgets"],
    module: M,
    response: "csv",
    handler: async ({ ctx, query }) => {
      const fy = query.get("fiscal_year_id");
      let q = ctx.db
        .from("budget_summary")
        .select("*")
        .eq("org_id", ctx.orgId);
      if (fy) q = q.eq("fiscal_year_id", fy);
      const rows = unwrap(await q);
      const [cats, camps, depts] = await Promise.all([
        ctx.db.from("expense_categories").select("id, name").eq("org_id", ctx.orgId),
        ctx.db.from("campuses").select("id, name").eq("org_id", ctx.orgId),
        ctx.db.from("departments").select("id, name").eq("org_id", ctx.orgId),
      ]);
      const nameOf = (list: { id: string; name: string }[], id: string | null) => list.find((x) => x.id === id)?.name ?? "";
      const out = rows.map((r) => ({
        ...r,
        category: nameOf(unwrap(cats), r.category_id),
        campus: nameOf(unwrap(camps), r.campus_id),
        department: nameOf(unwrap(depts), r.department_id),
      }));
      const csv = toCsv(out, [
        ["campus", "Campus"], ["department", "Department"], ["category", "Category"], ["allocated_amount", "Allocated"],
        ["amendments_amount", "Amendments"], ["carried_forward_amount", "Carried forward"], ["total_budget", "Total budget"],
        ["committed_amount", "Committed"], ["actual_amount", "Actual"], ["available_amount", "Available"], ["utilisation_pct", "Utilisation %"],
      ]);
      return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="budget-vs-actual.csv"' } });
    },
  }),
  route({
    method: "GET",
    path: "/expense/dashboard",
    summary: "Budget vs committed vs actual grouped by department/category/campus, plus monthly trend",
    tags: ["budgets"],
    module: M,
    permission: "budget:read",
    query: z.object({ fiscal_year_id: z.uuid(), group_by: z.enum(["department", "category", "campus"]).optional() }),
    handler: async ({ ctx, query }) => {
      const fy = query.get("fiscal_year_id")!;
      const [groups, monthly] = await Promise.all([
        ctx.db.rpc("budget_dashboard", { p_org: ctx.orgId, p_fiscal_year: fy, p_group_by: query.get("group_by") ?? "department" }),
        ctx.db.rpc("budget_monthly", { p_org: ctx.orgId, p_fiscal_year: fy }),
      ]);
      return { groups: unwrap(groups), monthly: unwrap(monthly) };
    },
  }),
  route({
    method: "POST",
    path: "/budgets/check",
    summary: "Check a prospective spend against the budget",
    tags: ["budgets"],
    module: M,
    status: 200,
    body: z.object({ date: isoDate, campus_id: z.uuid(), department_id: optUuid, category_id: z.uuid(), amount: money }),
    handler: async ({ ctx, body }) =>
      unwrap(
        await ctx.db.rpc("budget_check_for_user", {
          p_org: ctx.orgId, p_date: body.date, p_campus: body.campus_id, p_department: body.department_id ?? (null as unknown as string),
          p_category: body.category_id, p_amount: body.amount,
        }),
      ),
  }),
  route({
    method: "GET",
    path: "/budgets/:id/amendments",
    summary: "Amendments for a budget line",
    tags: ["budgets"],
    module: M,
    handler: async ({ ctx, params }) =>
      unwrap(await ctx.db.from("budget_amendments").select("*").eq("budget_id", params.id).order("created_at", { ascending: false })),
  }),
  route({
    method: "POST",
    path: "/budgets/:id/amendments",
    summary: "Request a budget amendment (goes through approval)",
    tags: ["budgets"],
    module: M,
    body: z.object({ amount_delta: z.number().refine((n) => n !== 0, "must not be zero"), reason: z.string().trim().min(3).max(1000) }),
    handler: async ({ ctx, params, body }) => ({
      amendment_id: unwrap(await ctx.db.rpc("budget_amendment_request", { p_budget_id: params.id, p_delta: body.amount_delta, p_reason: body.reason })),
    }),
  }),
  route({
    method: "POST",
    path: "/budgets/carry-forward",
    summary: "Carry forward unused budget into the next fiscal year",
    tags: ["budgets"],
    module: M,
    status: 200,
    body: z.object({ from_fiscal_year_id: z.uuid(), to_fiscal_year_id: z.uuid(), percent: z.number().min(0).max(100).default(100) }),
    handler: async ({ ctx, body }) => ({
      lines: unwrap(
        await ctx.db.rpc("budget_carry_forward", { p_from_fy: body.from_fiscal_year_id, p_to_fy: body.to_fiscal_year_id, p_percent: body.percent }),
      ),
    }),
  }),
  route({
    method: "GET",
    path: "/budgets/:id/ledger",
    summary: "Commitment and actual ledger entries for a budget line",
    tags: ["budgets"],
    module: M,
    handler: async ({ ctx, params }) =>
      unwrap(await ctx.db.from("budget_ledger").select("*").eq("budget_id", params.id).order("created_at", { ascending: false }).limit(500)),
  }),

  ...crudRoutes(expenseClaims, { tag: "expense-claims" }),
  route({
    method: "POST",
    path: "/expense-claims/:id/items",
    summary: "Add an item to a draft claim",
    tags: ["expense-claims"],
    module: M,
    body: itemSchema,
    handler: async ({ ctx, params, body }) => {
      await claimForUpdate(ctx, params.id);
      const db = ctx.kind === "api_key" ? ctx.admin() : ctx.db;
      return unwrap(await db.from("expense_items").insert({ ...body, org_id: ctx.orgId, claim_id: params.id }).select("*").single());
    },
  }),
  route({
    method: "PATCH",
    path: "/expense-claims/:id/items/:itemId",
    summary: "Update an item on a draft claim",
    tags: ["expense-claims"],
    module: M,
    body: itemSchema.partial(),
    handler: async ({ ctx, params, body }) => {
      await claimForUpdate(ctx, params.id);
      const db = ctx.kind === "api_key" ? ctx.admin() : ctx.db;
      return unwrap(await db.from("expense_items").update(body).eq("id", params.itemId).eq("claim_id", params.id).select("*").single());
    },
  }),
  route({
    method: "DELETE",
    path: "/expense-claims/:id/items/:itemId",
    summary: "Remove an item from a draft claim",
    tags: ["expense-claims"],
    module: M,
    response: "none",
    handler: async ({ ctx, params }) => {
      await claimForUpdate(ctx, params.id);
      const db = ctx.kind === "api_key" ? ctx.admin() : ctx.db;
      unwrap(await db.from("expense_items").delete().eq("id", params.itemId).eq("claim_id", params.id));
    },
  }),
  route({
    method: "POST",
    path: "/expense-claims/:id/submit",
    summary: "Submit a claim: validates receipts, limits and budgets, then routes for approval",
    tags: ["expense-claims"],
    module: M,
    status: 200,
    handler: async ({ ctx, params }) => unwrap(await ctx.db.rpc("expense_claim_submit", { p_claim_id: params.id })),
  }),
  route({
    method: "POST",
    path: "/expense-claims/:id/pay",
    summary: "Mark an approved claim as reimbursed",
    tags: ["expense-claims"],
    module: M,
    status: 200,
    body: z.object({ reference: z.string().trim().min(1).max(100), method: z.enum(["bank_transfer", "upi", "cheque", "cash", "payroll"]).default("bank_transfer") }),
    handler: async ({ ctx, params, body }) => {
      unwrap(await ctx.db.rpc("expense_claim_mark_paid", { p_claim_id: params.id, p_reference: body.reference, p_method: body.method }));
      return getResource(ctx, expenseClaims, params.id);
    },
  }),
  route({
    method: "POST",
    path: "/expense-claims/:id/cancel",
    summary: "Cancel a draft or rejected claim",
    tags: ["expense-claims"],
    module: M,
    status: 200,
    handler: async ({ ctx, params }) => {
      await claimForUpdate(ctx, params.id);
      const db = ctx.kind === "api_key" ? ctx.admin() : ctx.db;
      unwrap(await db.from("expense_claims").update({ status: "cancelled" }).eq("id", params.id).eq("org_id", ctx.orgId));
      return getResource(ctx, expenseClaims, params.id);
    },
  }),

  ...crudRoutes(advances, { tag: "expense-advances" }),
  route({
    method: "POST",
    path: "/expense-advances/:id/submit",
    summary: "Submit an advance request for approval",
    tags: ["expense-advances"],
    module: M,
    status: 200,
    handler: async ({ ctx, params }) => unwrap(await ctx.db.rpc("expense_advance_submit", { p_advance_id: params.id })),
  }),
  route({
    method: "POST",
    path: "/expense-advances/:id/disburse",
    summary: "Record disbursement of an approved advance",
    tags: ["expense-advances"],
    module: M,
    status: 200,
    body: z.object({ reference: z.string().trim().min(1).max(100) }),
    handler: async ({ ctx, params, body }) => {
      unwrap(await ctx.db.rpc("expense_advance_disburse", { p_advance_id: params.id, p_reference: body.reference }));
      return getResource(ctx, advances, params.id);
    },
  }),

  ...crudRoutes(pettyCashFunds, { tag: "petty-cash", ops: ["list", "get", "create", "update"] }),
  route({
    method: "GET",
    path: "/petty-cash-funds/:id/transactions",
    summary: "Petty cash transactions",
    tags: ["petty-cash"],
    module: M,
    handler: async ({ ctx, params }) => {
      await getResource(ctx, pettyCashFunds, params.id);
      return unwrap(
        await ctx.db
          .from("petty_cash_transactions")
          .select("*, category:expense_categories(id, name), creator:profiles!petty_cash_transactions_created_by_fkey(full_name)")
          .eq("fund_id", params.id)
          .order("txn_date", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(500),
      );
    },
  }),
  route({
    method: "POST",
    path: "/petty-cash-funds/:id/transactions",
    summary: "Record a petty cash expense, top-up or adjustment",
    tags: ["petty-cash"],
    module: M,
    body: z.object({
      txn_type: z.enum(["topup", "expense", "adjustment"]),
      amount: money.positive(),
      direction: z.union([z.literal(1), z.literal(-1)]).optional(),
      category_id: optUuid,
      description: z.string().trim().min(2).max(500),
      txn_date: isoDate.optional(),
      receipt_attachment_id: optUuid,
    }),
    handler: async ({ ctx, params, body }) => {
      const fund = await getResource(ctx, pettyCashFunds, params.id);
      if (body.txn_type !== "expense") await ctx.require("petty_cash:update", { campusId: fund.campus_id, departmentId: fund.department_id });
      else if (fund.custodian_id !== ctx.userId) await ctx.require("petty_cash:update", { campusId: fund.campus_id, departmentId: fund.department_id });
      if (body.txn_type === "expense" && !body.category_id) throw new ApiError("validation_failed", "category_id is required for expenses");
      const db = ctx.kind === "api_key" ? ctx.admin() : ctx.db;
      return unwrap(
        await db
          .from("petty_cash_transactions")
          .insert({ ...body, direction: body.direction ?? -1, org_id: ctx.orgId, fund_id: params.id, created_by: ctx.userId })
          .select("*")
          .single(),
      );
    },
  }),
  ...crudRoutes(recurringExpenses, { tag: "expense-claims", ops: ["list", "get", "create", "update", "delete"] }),
];
