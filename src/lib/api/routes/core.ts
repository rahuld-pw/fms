import "server-only";
import { cookies } from "next/headers";
import { z } from "zod";
import { crudRoutes } from "@/lib/api/crud";
import { ApiError, unwrap } from "@/lib/api/errors";
import { route, type RouteDef } from "@/lib/api/router";
import { MODULES, ORG_COOKIE } from "@/lib/auth/context";
import { code, commentInput, name, approvalActionInput } from "@/lib/schemas/common";
import {
  actOnApproval,
  addComment,
  apiKeySchema,
  approvalForEntity,
  approvalInbox,
  assignRole,
  attachmentUrl,
  createApiKey,
  createUpload,
  entityRef,
  getApproval,
  getMe,
  invitationSchema,
  inviteMember,
  listActivity,
  listAttachments,
  listComments,
  listMembers,
  memberUpdateSchema,
  orgUpdateSchema,
  removeRoleAssignment,
  roleAssignmentSchema,
  roleSchema,
  setModule,
  updateMember,
  updateOrg,
  upsertRole,
  uploadRequestSchema,
  webhookSchema,
} from "@/lib/services/core";
import type { ResourceSpec } from "@/lib/services/resource";

// ---------------------------------------------------------------------------
// Settings resources (generic CRUD)
// ---------------------------------------------------------------------------
const campusSchema = z.object({
  name,
  code,
  address: z.string().max(500).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  state: z.string().max(100).nullable().optional(),
  pincode: z.string().max(10).nullable().optional(),
  gstin: z.string().max(15).nullable().optional(),
  timezone: z.string().max(64).nullable().optional(),
});
export const campuses: ResourceSpec = {
  name: "campuses",
  memberRead: true,
  entityType: "campus",
  table: "campuses",
  permission: "org",
  readPermission: "user:read",
  createPermission: "org:manage",
  updatePermission: "org:manage",
  deletePermission: "org:manage",
  strict: true,
  sortable: ["name", "code", "created_at"],
  defaultSort: "name",
  search: ["name", "code", "city"],
  softDelete: true,
  createSchema: campusSchema,
  updateSchema: campusSchema.partial(),
};

const departmentSchema = z.object({
  campus_id: z.uuid().nullable().optional(),
  parent_id: z.uuid().nullable().optional(),
  name,
  code,
  head_user_id: z.uuid().nullable().optional(),
});
export const departments: ResourceSpec = {
  name: "departments",
  memberRead: true,
  entityType: "department",
  table: "departments",
  permission: "org",
  readPermission: "user:read",
  createPermission: "org:manage",
  updatePermission: "org:manage",
  deletePermission: "org:manage",
  campusColumn: "campus_id",
  select: "*, campus:campuses(id, name, code), head:profiles!departments_head_fk(id, full_name)",
  filters: { campus_id: "eq" },
  sortable: ["name", "code", "created_at"],
  defaultSort: "name",
  search: ["name", "code"],
  softDelete: true,
  createSchema: departmentSchema,
  updateSchema: departmentSchema.partial(),
};

export const fiscalYears: ResourceSpec = {
  name: "fiscal-years",
  memberRead: true,
  entityType: "fiscal_year",
  table: "fiscal_years",
  permission: "settings",
  readPermission: "budget:read",
  createPermission: "settings:manage",
  updatePermission: "settings:manage",
  deletePermission: "settings:manage",
  strict: true,
  sortable: ["start_date"],
  defaultSort: "-start_date",
  createSchema: z.object({ label: z.string().min(2).max(40), start_date: z.iso.date(), end_date: z.iso.date() }),
  updateSchema: z.object({ label: z.string().min(2).max(40), is_locked: z.boolean() }).partial(),
};

export const numberSeries: ResourceSpec = {
  name: "number-series",
  entityType: "number_series",
  table: "number_series",
  permission: "settings",
  readPermission: "settings:manage",
  createPermission: "settings:manage",
  updatePermission: "settings:manage",
  deletePermission: "settings:manage",
  strict: true,
  select: "*, campus:campuses(id, code)",
  filters: { entity_type: "eq", campus_id: "eq" },
  sortable: ["entity_type", "updated_at"],
  defaultSort: "entity_type",
  createSchema: z.object({
    entity_type: z.enum([
      "issue", "work_order", "asset", "expense_claim", "advance", "requisition", "rfq", "purchase_order", "grn", "invoice", "payment",
    ]),
    prefix: z.string().regex(/^[A-Z0-9/-]{1,12}$/),
    format: z.string().max(60).refine((f) => f.includes("{seq}"), "format must contain {seq}").default("{prefix}-{seq}"),
    padding: z.number().int().min(1).max(12).default(5),
    reset_each_fy: z.boolean().default(true),
    per_campus: z.boolean().default(false),
  }),
  updateSchema: z
    .object({
      prefix: z.string().regex(/^[A-Z0-9/-]{1,12}$/),
      format: z.string().max(60).refine((f) => f.includes("{seq}"), "format must contain {seq}"),
      padding: z.number().int().min(1).max(12),
      reset_each_fy: z.boolean(),
      per_campus: z.boolean(),
      next_value: z.number().int().min(1),
    })
    .partial(),
};

export const slaPolicies: ResourceSpec = {
  name: "sla-policies",
  memberRead: true,
  entityType: "sla_policy",
  table: "sla_policies",
  module: "facility",
  permission: "settings",
  readPermission: "issue:read",
  createPermission: "settings:manage",
  updatePermission: "settings:manage",
  deletePermission: "settings:manage",
  strict: true,
  sortable: ["priority"],
  defaultSort: "priority",
  createSchema: z.object({
    priority: z.enum(["low", "medium", "high", "critical"]),
    response_minutes: z.number().int().positive(),
    resolution_minutes: z.number().int().positive(),
  }),
  updateSchema: z.object({ response_minutes: z.number().int().positive(), resolution_minutes: z.number().int().positive() }).partial(),
};

export const customFieldDefinitions: ResourceSpec = {
  name: "custom-fields",
  memberRead: true,
  entityType: "custom_field_definition",
  table: "custom_field_definitions",
  permission: "settings",
  readPermission: "user:read",
  createPermission: "settings:manage",
  updatePermission: "settings:manage",
  deletePermission: "settings:manage",
  strict: true,
  filters: { entity_type: "eq", scope_id: "eq", active: "bool" },
  sortable: ["position", "label"],
  defaultSort: "position",
  createSchema: z.object({
    entity_type: z.string().regex(/^[a-z_]+$/),
    scope_id: z.uuid().nullable().optional(),
    key: z.string().regex(/^[a-z][a-z0-9_]{0,47}$/),
    label: z.string().trim().min(1).max(80),
    field_type: z.enum(["text", "number", "date", "boolean", "select", "multiselect", "user", "currency"]),
    options: z.array(z.union([z.string(), z.object({ value: z.string(), label: z.string() })])).default([]),
    required: z.boolean().default(false),
    position: z.number().int().default(0),
  }),
  updateSchema: z
    .object({
      label: z.string().trim().min(1).max(80),
      options: z.array(z.union([z.string(), z.object({ value: z.string(), label: z.string() })])),
      required: z.boolean(),
      position: z.number().int(),
      active: z.boolean(),
    })
    .partial(),
};

const policyConditions = z
  .object({
    amount_min: z.number().nonnegative(),
    amount_max: z.number().positive(),
    category_ids: z.array(z.uuid()),
    department_ids: z.array(z.uuid()),
    campus_ids: z.array(z.uuid()),
  })
  .partial();
export const approvalPolicies: ResourceSpec = {
  name: "approval-policies",
  entityType: "approval_policy",
  table: "approval_policies",
  permission: "approval",
  readPermission: "approval:manage",
  createPermission: "approval:manage",
  updatePermission: "approval:manage",
  deletePermission: "approval:manage",
  strict: true,
  select: "*, steps:approval_policy_steps(*, role:roles(id, name))",
  filters: { module: "eq", entity_type: "eq", active: "bool" },
  sortable: ["priority", "name", "created_at"],
  defaultSort: "priority",
  softDelete: true,
  createSchema: z.object({
    name: z.string().trim().min(2).max(120),
    description: z.string().max(500).nullable().optional(),
    module: z.enum(["facility", "expense", "tasks", "po"]),
    entity_type: z.enum(["expense_claim", "expense_advance", "budget_amendment", "requisition", "purchase_order", "vendor"]),
    priority: z.number().int().min(0).max(10000).default(100),
    conditions: policyConditions.default({}),
    auto_approve: z.boolean().default(false),
    allow_self_approval: z.boolean().default(false),
    active: z.boolean().default(true),
  }),
  updateSchema: z
    .object({
      name: z.string().trim().min(2).max(120),
      description: z.string().max(500).nullable(),
      priority: z.number().int().min(0).max(10000),
      conditions: policyConditions,
      auto_approve: z.boolean(),
      allow_self_approval: z.boolean(),
      active: z.boolean(),
    })
    .partial(),
};

const stepSchema = z.object({
  step_order: z.number().int().min(1).max(50),
  name: z.string().trim().min(1).max(80),
  approver_type: z.enum(["role", "user", "permission", "reporting_manager", "department_head"]),
  role_id: z.uuid().nullable().optional(),
  user_id: z.uuid().nullable().optional(),
  permission_key: z.string().nullable().optional(),
  scope_mode: z.enum(["entity", "org"]).default("entity"),
  required_approvals: z.number().int().min(1).max(20).default(1),
  conditions: policyConditions.default({}),
  sla_hours: z.number().int().positive().nullable().optional(),
});

export const delegations: ResourceSpec = {
  name: "approval-delegations",
  entityType: "approval_delegation",
  table: "approval_delegations",
  permission: "approval",
  readPermission: "user:read",
  createPermission: "approval:manage",
  updatePermission: "approval:manage",
  deletePermission: "approval:manage",
  select:
    "*, delegator:profiles!approval_delegations_delegator_id_fkey(id, full_name), delegate:profiles!approval_delegations_delegate_id_fkey(id, full_name)",
  filters: { delegator_id: "user", delegate_id: "user" },
  sortable: ["starts_at", "ends_at", "created_at"],
  defaultSort: "-created_at",
  createSchema: z.object({
    delegator_id: z.uuid().optional(),
    delegate_id: z.uuid(),
    module: z.enum(["facility", "expense", "tasks", "po"]).nullable().optional(),
    starts_at: z.iso.datetime({ offset: true }).optional(),
    ends_at: z.iso.datetime({ offset: true }),
    reason: z.string().max(300).nullable().optional(),
  }),
  updateSchema: z.object({ ends_at: z.iso.datetime({ offset: true }), revoked_at: z.iso.datetime({ offset: true }).nullable() }).partial(),
  prepareCreate: (ctx, input) => ({ ...input, delegator_id: input.delegator_id ?? ctx.userId }),
};

export const webhooks: ResourceSpec = {
  name: "webhooks",
  entityType: "webhook_endpoint",
  table: "webhook_endpoints",
  permission: "webhook",
  readPermission: "webhook:manage",
  createPermission: "webhook:manage",
  updatePermission: "webhook:manage",
  deletePermission: "webhook:manage",
  strict: true,
  select: "id, org_id, url, description, events, active, consecutive_failures, disabled_reason, created_at, updated_at",
  detailSelect: "*",
  sortable: ["created_at"],
  defaultSort: "-created_at",
  createSchema: webhookSchema,
  updateSchema: webhookSchema.partial(),
};

export const apiKeys: ResourceSpec = {
  name: "api-keys",
  entityType: "api_key",
  table: "api_keys",
  permission: "api_key",
  readPermission: "api_key:manage",
  updatePermission: "api_key:manage",
  deletePermission: "api_key:manage",
  strict: true,
  select: "id, org_id, name, prefix, scopes, rate_limit_per_minute, last_used_at, expires_at, revoked_at, created_at, created_by",
  sortable: ["created_at", "name"],
  defaultSort: "-created_at",
  updateSchema: z
    .object({
      name: z.string().trim().min(2).max(80),
      rate_limit_per_minute: z.number().int().min(1).max(10000),
      revoked: z.literal(true),
    })
    .partial()
    .transform(({ revoked, ...rest }) => (revoked ? { ...rest, revoked_at: new Date().toISOString() } : rest)),
};

export const tags: ResourceSpec = {
  name: "tags",
  memberRead: true,
  entityType: "tag",
  table: "tags",
  permission: "tag",
  readPermission: "user:read",
  sortable: ["name"],
  defaultSort: "name",
  search: ["name"],
  createSchema: z.object({ name: z.string().trim().min(1).max(48), color: z.string().max(20).default("gray") }),
  updateSchema: z.object({ name: z.string().trim().min(1).max(48), color: z.string().max(20) }).partial(),
};

export const notifications: ResourceSpec = {
  name: "notifications",
  ownerColumns: ["user_id"],
  entityType: "notification",
  table: "notifications",
  permission: "notification",
  filters: { type: "eq", read_at: "is_null" },
  sortable: ["created_at"],
  defaultSort: "-created_at",
};

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
export const coreRoutes: RouteDef[] = [
  route({
    method: "GET",
    path: "/me",
    summary: "Current user, organisation, enabled modules and permissions",
    tags: ["auth"],
    handler: ({ ctx }) => getMe(ctx),
  }),
  route({
    method: "POST",
    path: "/me/org",
    summary: "Switch the active organisation (session only)",
    tags: ["auth"],
    body: z.object({ org_id: z.uuid() }),
    status: 200,
    handler: async ({ ctx, body }) => {
      if (ctx.kind !== "user") throw new ApiError("bad_request", "Only for browser sessions");
      const rows = unwrap(await ctx.db.from("org_members").select("org_id").eq("user_id", ctx.userId).eq("org_id", body.org_id).eq("status", "active"));
      if (rows.length === 0) throw ApiError.forbidden("Not a member of that organisation");
      (await cookies()).set(ORG_COOKIE, body.org_id, { httpOnly: true, sameSite: "lax", path: "/", secure: true, maxAge: 60 * 60 * 24 * 365 });
      unwrap(await ctx.db.from("profiles").update({ default_org_id: body.org_id }).eq("id", ctx.userId));
      return { org_id: body.org_id };
    },
  }),
  route({
    method: "PATCH",
    path: "/me",
    summary: "Update my profile",
    tags: ["auth"],
    body: z.object({ full_name: z.string().trim().min(1).max(120), phone: z.string().max(20).nullable(), avatar_path: z.string().max(500).nullable() }).partial(),
    handler: async ({ ctx, body }) => unwrap(await ctx.db.from("profiles").update(body).eq("id", ctx.userId).select("*").single()),
  }),

  // Organisation & modules
  route({ method: "GET", path: "/org", summary: "Get the current organisation", tags: ["organisation"], handler: async ({ ctx }) => ctx.org }),
  route({
    method: "PATCH",
    path: "/org",
    summary: "Update organisation settings",
    tags: ["organisation"],
    body: orgUpdateSchema,
    handler: ({ ctx, body }) => updateOrg(ctx, body),
  }),
  route({
    method: "GET",
    path: "/org/modules",
    summary: "List modules and whether they are enabled",
    tags: ["organisation"],
    handler: async ({ ctx }) => unwrap(await ctx.db.from("org_modules").select("*").eq("org_id", ctx.orgId)),
  }),
  route({
    method: "PUT",
    path: "/org/modules/:module",
    summary: "Enable or disable a module",
    tags: ["organisation"],
    body: z.object({ enabled: z.boolean(), settings: z.record(z.string(), z.unknown()).optional() }),
    handler: ({ ctx, params, body }) => {
      const m = z.enum(MODULES).parse(params.module);
      return setModule(ctx, m, body.enabled, body.settings);
    },
  }),
  ...crudRoutes(campuses, { tag: "organisation" }),
  ...crudRoutes(departments, { tag: "organisation" }),
  ...crudRoutes(fiscalYears, { tag: "organisation", ops: ["list", "get", "create", "update"] }),
  route({
    method: "GET",
    path: "/academic-years",
    summary: "List academic years",
    tags: ["organisation"],
    handler: async ({ ctx }) => unwrap(await ctx.db.from("academic_years").select("*").eq("org_id", ctx.orgId).order("start_date", { ascending: false })),
  }),
  route({
    method: "POST",
    path: "/academic-years",
    summary: "Create an academic year",
    tags: ["organisation"],
    body: z.object({ label: z.string().min(2).max(40), start_date: z.iso.date(), end_date: z.iso.date() }),
    handler: async ({ ctx, body }) => {
      await ctx.require("settings:manage", {}, "strict");
      return unwrap(await ctx.db.from("academic_years").insert({ ...body, org_id: ctx.orgId }).select("*").single());
    },
  }),

  // Users, roles & invitations
  route({
    method: "GET",
    path: "/members",
    summary: "List organisation members with their role assignments",
    tags: ["users"],
    handler: ({ ctx, query }) => listMembers(ctx, query.get("q") ?? undefined),
  }),
  route({
    method: "PATCH",
    path: "/members/:id",
    summary: "Update a member (status, title, manager, home campus/department)",
    tags: ["users"],
    body: memberUpdateSchema,
    handler: ({ ctx, params, body }) => updateMember(ctx, params.id, body),
  }),
  route({
    method: "GET",
    path: "/users/lookup",
    summary: "Search members for pickers (name or email)",
    tags: ["users"],
    handler: async ({ ctx, query }) => {
      const q = (query.get("q") ?? "").replace(/[,()%]/g, "").slice(0, 60);
      let sel = ctx.db
        .from("org_members")
        .select("user_id, title, profile:profiles!org_members_user_id_fkey!inner(id, full_name, email, avatar_path)")
        .eq("org_id", ctx.orgId)
        .eq("status", "active")
        .limit(20);
      if (q) sel = sel.or(`full_name.ilike.%${q}%,email.ilike.%${q}%`, { referencedTable: "profile" });
      return unwrap(await sel).map((m) => ({ ...m.profile, title: m.title }));
    },
  }),
  route({
    method: "GET",
    path: "/roles",
    summary: "List roles with their permissions",
    tags: ["users"],
    handler: async ({ ctx }) =>
      unwrap(await ctx.db.from("roles").select("*, role_permissions(permission_key)").eq("org_id", ctx.orgId).order("name")),
  }),
  route({ method: "POST", path: "/roles", summary: "Create a custom role", tags: ["users"], body: roleSchema, handler: ({ ctx, body }) => upsertRole(ctx, body) }),
  route({
    method: "PUT",
    path: "/roles/:id",
    summary: "Replace a custom role's name and permissions",
    tags: ["users"],
    body: roleSchema,
    handler: ({ ctx, params, body }) => upsertRole(ctx, body, params.id),
  }),
  route({
    method: "DELETE",
    path: "/roles/:id",
    summary: "Delete a custom role",
    tags: ["users"],
    response: "none",
    handler: async ({ ctx, params }) => {
      await ctx.require("role:manage", {}, "strict");
      const res = unwrap(await ctx.db.from("roles").delete().eq("id", params.id).eq("org_id", ctx.orgId).eq("is_system", false).select("id"));
      if (res.length === 0) throw new ApiError("conflict", "Role not found or is a system role");
    },
  }),
  route({
    method: "GET",
    path: "/permissions",
    summary: "Permission catalogue",
    tags: ["users"],
    handler: async ({ ctx }) => unwrap(await ctx.db.from("permissions").select("*").order("key")),
  }),
  route({
    method: "POST",
    path: "/role-assignments",
    summary: "Assign a role to a user at org, campus or department scope",
    tags: ["users"],
    body: roleAssignmentSchema,
    handler: ({ ctx, body }) => assignRole(ctx, body),
  }),
  route({
    method: "DELETE",
    path: "/role-assignments/:id",
    summary: "Remove a role assignment",
    tags: ["users"],
    response: "none",
    handler: ({ ctx, params }) => removeRoleAssignment(ctx, params.id),
  }),
  route({
    method: "GET",
    path: "/invitations",
    summary: "List pending invitations",
    tags: ["users"],
    handler: async ({ ctx }) => {
      await ctx.require("user:manage", {}, "strict");
      return unwrap(
        await ctx.db
          .from("org_invitations")
          .select("id, email, full_name, role_id, scope_type, campus_id, department_id, expires_at, accepted_at, revoked_at, created_at")
          .eq("org_id", ctx.orgId)
          .order("created_at", { ascending: false }),
      );
    },
  }),
  route({ method: "POST", path: "/invitations", summary: "Invite a user by email", tags: ["users"], body: invitationSchema, handler: ({ ctx, body }) => inviteMember(ctx, body) }),
  route({
    method: "DELETE",
    path: "/invitations/:id",
    summary: "Revoke an invitation",
    tags: ["users"],
    response: "none",
    handler: async ({ ctx, params }) => {
      await ctx.require("user:manage", {}, "strict");
      unwrap(await ctx.db.from("org_invitations").update({ revoked_at: new Date().toISOString() }).eq("id", params.id).eq("org_id", ctx.orgId));
    },
  }),

  // Approvals
  route({ method: "GET", path: "/approvals/inbox", summary: "Approval requests awaiting my action", tags: ["approvals"], handler: ({ ctx }) => approvalInbox(ctx) }),
  route({
    method: "GET",
    path: "/approvals",
    summary: "List approval requests visible to me",
    tags: ["approvals"],
    query: z.object({ status: z.string().optional(), entity_type: z.string().optional(), mine: z.enum(["true", "false"]).optional() }),
    handler: async ({ ctx, query }) => {
      let q = ctx.db
        .from("approval_requests")
        .select("*, requester:profiles!approval_requests_requested_by_fkey(id, full_name)")
        .eq("org_id", ctx.orgId)
        .order("submitted_at", { ascending: false })
        .limit(100);
      if (query.get("status")) q = q.in("status", query.get("status")!.split(","));
      if (query.get("entity_type")) q = q.eq("entity_type", query.get("entity_type")!);
      if (query.get("mine") === "true") q = q.eq("requested_by", ctx.userId);
      return unwrap(await q);
    },
  }),
  route({
    method: "GET",
    path: "/approvals/for/:entity_type/:entity_id",
    summary: "Approval history for an entity",
    tags: ["approvals"],
    handler: ({ ctx, params }) => approvalForEntity(ctx, params.entity_type, params.entity_id),
  }),
  route({ method: "GET", path: "/approvals/:id", summary: "Get an approval request with steps and actions", tags: ["approvals"], handler: ({ ctx, params }) => getApproval(ctx, params.id) }),
  route({
    method: "POST",
    path: "/approvals/:id/act",
    summary: "Approve or reject the current step",
    tags: ["approvals"],
    body: approvalActionInput,
    status: 200,
    handler: ({ ctx, params, body }) => actOnApproval(ctx, params.id, body.action, body.comment),
  }),
  route({
    method: "POST",
    path: "/approvals/:id/cancel",
    summary: "Cancel a pending request (requester)",
    tags: ["approvals"],
    body: z.object({ comment: z.string().max(2000).optional() }),
    status: 200,
    handler: async ({ ctx, params, body }) => {
      unwrap(await ctx.db.rpc("approval_cancel", { p_request_id: params.id, p_comment: body.comment }));
      return getApproval(ctx, params.id);
    },
  }),
  route({
    method: "POST",
    path: "/approvals/:id/comments",
    summary: "Comment on an approval request",
    tags: ["approvals"],
    body: z.object({ comment: z.string().trim().min(1).max(2000) }),
    handler: async ({ ctx, params, body }) => {
      unwrap(await ctx.db.rpc("approval_comment", { p_request_id: params.id, p_comment: body.comment }));
      return getApproval(ctx, params.id);
    },
  }),
  ...crudRoutes(approvalPolicies, { tag: "approvals" }),
  route({
    method: "PUT",
    path: "/approval-policies/:id/steps",
    summary: "Replace the ordered steps of a policy",
    tags: ["approvals"],
    body: z.object({ steps: z.array(stepSchema).max(20) }),
    status: 200,
    handler: async ({ ctx, params, body }) => {
      await ctx.require("approval:manage", {}, "strict");
      const orders = body.steps.map((s) => s.step_order);
      if (new Set(orders).size !== orders.length) throw new ApiError("validation_failed", "step_order values must be unique");
      unwrap(await ctx.db.from("approval_policy_steps").delete().eq("policy_id", params.id).eq("org_id", ctx.orgId));
      if (body.steps.length) {
        unwrap(
          await ctx.db
            .from("approval_policy_steps")
            .insert(body.steps.map((s) => ({ ...s, org_id: ctx.orgId, policy_id: params.id }))),
        );
      }
      return unwrap(await ctx.db.from("approval_policy_steps").select("*").eq("policy_id", params.id).order("step_order"));
    },
  }),
  ...crudRoutes(delegations, { tag: "approvals", ops: ["list", "get", "create", "update", "delete"] }),

  // Comments / attachments / activity / tags
  route({
    method: "GET",
    path: "/comments",
    summary: "List comments on an entity",
    tags: ["collaboration"],
    query: entityRef,
    handler: ({ ctx, query }) => listComments(ctx, query.get("entity_type")!, query.get("entity_id")!),
  }),
  route({
    method: "POST",
    path: "/comments",
    summary: "Comment on an entity (supports @mentions)",
    tags: ["collaboration"],
    body: entityRef.extend(commentInput.shape),
    handler: ({ ctx, body }) => addComment(ctx, body),
  }),
  route({
    method: "PATCH",
    path: "/comments/:id",
    summary: "Edit my comment",
    tags: ["collaboration"],
    body: z.object({ body: z.string().trim().min(1).max(20000) }),
    handler: async ({ ctx, params, body }) =>
      unwrap(await ctx.db.from("comments").update({ body: body.body }).eq("id", params.id).eq("author_id", ctx.userId).select("*").single()),
  }),
  route({
    method: "DELETE",
    path: "/comments/:id",
    summary: "Delete my comment",
    tags: ["collaboration"],
    response: "none",
    handler: async ({ ctx, params }) => {
      unwrap(await ctx.db.from("comments").update({ deleted_at: new Date().toISOString() }).eq("id", params.id).eq("author_id", ctx.userId));
    },
  }),
  route({
    method: "GET",
    path: "/attachments",
    summary: "List attachments on an entity",
    tags: ["collaboration"],
    query: entityRef,
    handler: ({ ctx, query }) => listAttachments(ctx, query.get("entity_type")!, query.get("entity_id")!),
  }),
  route({
    method: "POST",
    path: "/attachments",
    summary: "Register an attachment and get a signed upload URL",
    description: "Upload the file with a PUT to `upload.url` (or supabase-js `uploadToSignedUrl`) within 2 hours.",
    tags: ["collaboration"],
    body: uploadRequestSchema,
    handler: ({ ctx, body }) => createUpload(ctx, body),
  }),
  route({
    method: "GET",
    path: "/attachments/:id/url",
    summary: "Short-lived signed URL to view or download an attachment",
    tags: ["collaboration"],
    handler: ({ ctx, params, query }) => attachmentUrl(ctx, params.id, query.get("download") === "true"),
  }),
  route({
    method: "DELETE",
    path: "/attachments/:id",
    summary: "Remove an attachment",
    tags: ["collaboration"],
    response: "none",
    handler: async ({ ctx, params }) => {
      const res = unwrap(
        await ctx.db.from("attachments").update({ deleted_at: new Date().toISOString() }).eq("id", params.id).eq("org_id", ctx.orgId).select("id"),
      );
      if (res.length === 0) throw ApiError.forbidden();
    },
  }),
  route({
    method: "GET",
    path: "/activity",
    summary: "Activity feed / audit trail (optionally for one entity)",
    tags: ["collaboration"],
    query: z.object({ entity_type: z.string().optional(), entity_id: z.uuid().optional(), limit: z.coerce.number().max(200).optional(), before: z.coerce.number().optional() }),
    handler: ({ ctx, query }) =>
      listActivity(
        ctx,
        query.get("entity_type") ?? undefined,
        query.get("entity_id") ?? undefined,
        Number(query.get("limit") ?? 50),
        query.get("before") ? Number(query.get("before")) : undefined,
      ),
  }),
  ...crudRoutes(tags, { tag: "collaboration", ops: ["list", "create", "update", "delete"] }),
  route({
    method: "PUT",
    path: "/tags/for/:entity_type/:entity_id",
    summary: "Replace the tags on an entity",
    tags: ["collaboration"],
    body: z.object({ tag_ids: z.array(z.uuid()).max(30) }),
    status: 200,
    handler: async ({ ctx, params, body }) => {
      unwrap(await ctx.db.from("taggings").delete().eq("entity_type", params.entity_type).eq("entity_id", params.entity_id).eq("org_id", ctx.orgId));
      if (body.tag_ids.length)
        unwrap(
          await ctx.db
            .from("taggings")
            .insert(body.tag_ids.map((t) => ({ tag_id: t, org_id: ctx.orgId, entity_type: params.entity_type, entity_id: params.entity_id }))),
        );
      return body.tag_ids;
    },
  }),
  ...crudRoutes(customFieldDefinitions, { tag: "settings" }),

  // Notifications & search
  ...crudRoutes(notifications, { tag: "notifications", ops: ["list"] }),
  route({
    method: "POST",
    path: "/notifications/read",
    summary: "Mark notifications as read (all when ids omitted)",
    tags: ["notifications"],
    body: z.object({ ids: z.array(z.uuid()).max(500).optional() }),
    status: 200,
    handler: async ({ ctx, body }) => ({ updated: unwrap(await ctx.db.rpc("mark_notifications_read", { p_ids: body.ids })) }),
  }),
  route({
    method: "GET",
    path: "/notifications/preferences",
    summary: "My notification preferences",
    tags: ["notifications"],
    handler: async ({ ctx }) =>
      unwrap(await ctx.db.from("notification_preferences").select("*").eq("user_id", ctx.userId).eq("org_id", ctx.orgId)),
  }),
  route({
    method: "PUT",
    path: "/notifications/preferences",
    summary: "Set notification preferences per type ('*' for default)",
    tags: ["notifications"],
    body: z.object({ preferences: z.array(z.object({ type: z.string().max(60), in_app: z.boolean(), email: z.boolean() })).max(100) }),
    status: 200,
    handler: async ({ ctx, body }) =>
      unwrap(
        await ctx.db
          .from("notification_preferences")
          .upsert(body.preferences.map((p) => ({ ...p, user_id: ctx.userId, org_id: ctx.orgId })))
          .select("*"),
      ),
  }),
  route({
    method: "GET",
    path: "/search",
    summary: "Global search across modules (respects permissions)",
    tags: ["search"],
    query: z.object({ q: z.string().min(2).max(200), limit: z.coerce.number().int().max(50).optional() }),
    handler: async ({ ctx, query }) => {
      // search relies on RLS to decide visibility, which API keys bypass
      if (ctx.kind === "api_key") throw new ApiError("bad_request", "Global search is available to signed-in users only");
      const modules = await ctx.modules();
      const rows = unwrap(await ctx.db.rpc("global_search", { p_org: ctx.orgId, p_query: query.get("q")!, p_limit: Number(query.get("limit") ?? 20) }));
      const moduleOf: Record<string, string> = {
        issue: "facility", asset: "facility", vendor: "facility", location: "facility", work_order: "facility",
        expense_claim: "expense", purchase_order: "po", requisition: "po", task: "tasks", project: "tasks",
      };
      return rows.filter((r) => modules.has(moduleOf[r.entity_type] as never));
    },
  }),
  route({
    method: "GET",
    path: "/dashboard/home",
    summary: "My dashboard counters (signed-in users)",
    tags: ["dashboards"],
    handler: async ({ ctx }) => {
      if (ctx.kind === "api_key") throw new ApiError("bad_request", "Available to signed-in users only");
      return unwrap(await ctx.db.rpc("home_dashboard", { p_org: ctx.orgId }));
    },
  }),

  // Settings: number series, SLAs, API keys, webhooks
  ...crudRoutes(numberSeries, { tag: "settings", ops: ["list", "get", "create", "update"] }),
  ...crudRoutes(slaPolicies, { tag: "settings", ops: ["list", "create", "update"] }),
  ...crudRoutes(apiKeys, { tag: "settings", ops: ["list", "get", "update"] }),
  route({ method: "POST", path: "/api-keys", summary: "Create an API key (returned once)", tags: ["settings"], body: apiKeySchema, handler: ({ ctx, body }) => createApiKey(ctx, body) }),
  ...crudRoutes(webhooks, { tag: "settings", ops: ["list", "get", "create", "update", "delete"] }),
  route({
    method: "POST",
    path: "/webhooks/:id/rotate-secret",
    summary: "Rotate a webhook signing secret",
    tags: ["settings"],
    status: 200,
    handler: async ({ ctx, params }) => {
      await ctx.require("webhook:manage", {}, "strict");
      const secret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
      return unwrap(await ctx.db.from("webhook_endpoints").update({ secret }).eq("id", params.id).eq("org_id", ctx.orgId).select("id, secret").single());
    },
  }),
  route({
    method: "POST",
    path: "/webhooks/:id/test",
    summary: "Send a test event to a webhook",
    tags: ["settings"],
    status: 202,
    handler: async ({ ctx, params }) => {
      await ctx.require("webhook:manage", {}, "strict");
      const admin = ctx.admin();
      const ep = unwrap(await admin.from("webhook_endpoints").select("id").eq("id", params.id).eq("org_id", ctx.orgId).single());
      const ev = unwrap(
        await admin.from("events_outbox").insert({ org_id: ctx.orgId, event_type: "webhook.test", payload: { message: "Hello from Campus Ops" } }).select("id").single(),
      );
      unwrap(await admin.from("webhook_deliveries").insert({ org_id: ctx.orgId, endpoint_id: ep.id, event_id: ev.id }));
      return { queued: true };
    },
  }),
  route({
    method: "GET",
    path: "/webhooks/:id/deliveries",
    summary: "Recent delivery attempts for a webhook",
    tags: ["settings"],
    handler: async ({ ctx, params }) =>
      unwrap(
        await ctx.db
          .from("webhook_deliveries")
          .select("*, event:events_outbox(event_id, event_type, created_at)")
          .eq("endpoint_id", params.id)
          .eq("org_id", ctx.orgId)
          .order("created_at", { ascending: false })
          .limit(100),
      ),
  }),
  route({
    method: "POST",
    path: "/webhooks/deliveries/:id/retry",
    summary: "Retry a failed or dead delivery now",
    tags: ["settings"],
    status: 202,
    handler: async ({ ctx, params }) => {
      await ctx.require("webhook:manage", {}, "strict");
      unwrap(
        await ctx
          .admin()
          .from("webhook_deliveries")
          .update({ status: "pending", next_attempt_at: new Date().toISOString(), max_attempts: 8, attempt_count: 0 })
          .eq("id", Number(params.id))
          .eq("org_id", ctx.orgId),
      );
      return { queued: true };
    },
  }),
];
