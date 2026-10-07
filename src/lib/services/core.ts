import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { ApiError, unwrap, unwrapMaybe } from "@/lib/api/errors";
import { MODULES, type Module, type RequestContext } from "@/lib/auth/context";
import { createAdminClient } from "@/lib/supabase/server";
import { publicEnv } from "@/lib/env";
import type { Json, TablesUpdate } from "@/lib/supabase/database.types";

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

// ---------------------------------------------------------------------------
// Me / org
// ---------------------------------------------------------------------------
export async function getMe(ctx: RequestContext) {
  const [profile, memberships, modules, grants] = await Promise.all([
    unwrap(await ctx.db.from("profiles").select("id, email, full_name, phone, avatar_path, default_org_id").eq("id", ctx.userId).single()),
    unwrap(
      await ctx.db
        .from("org_members")
        .select("org_id, is_owner, title, organisation:organisations(id, name, slug, logo_path)")
        .eq("user_id", ctx.userId)
        .eq("status", "active"),
    ),
    ctx.modules(),
    ctx.grants(),
  ]);
  return {
    user: profile,
    org: ctx.org,
    orgs: memberships.map((m) => m.organisation).filter(Boolean),
    modules: [...modules],
    permissions: grants,
    auth: ctx.kind,
  };
}

export const orgUpdateSchema = z.object({
  name: z.string().trim().min(2).max(200).optional(),
  timezone: z.string().max(64).optional(),
  currency: z.string().length(3).toUpperCase().optional(),
  locale: z.string().max(16).optional(),
  fy_start_month: z.number().int().min(1).max(12).optional(),
  academic_year_start_month: z.number().int().min(1).max(12).optional(),
  logo_path: z.string().max(500).nullable().optional(),
  settings: z
    .object({
      three_way_match_price_tolerance_pct: z.number().min(0).max(25).optional(),
      three_way_match_qty_tolerance_pct: z.number().min(0).max(25).optional(),
      over_receipt_tolerance_pct: z.number().min(0).max(25).optional(),
      public_issue_reporting: z.boolean().optional(),
      require_captcha: z.boolean().optional(),
      date_format: z.string().max(20).optional(),
    })
    .partial()
    .optional(),
});

export async function updateOrg(ctx: RequestContext, input: z.infer<typeof orgUpdateSchema>) {
  await ctx.require("org:manage", {}, "strict");
  const { settings, ...rest } = input;
  const patch: TablesUpdate<"organisations"> = { ...rest };
  if (settings) patch.settings = { ...ctx.org.settings, ...settings } as Json;
  unwrap(await ctx.db.from("organisations").update(patch).eq("id", ctx.orgId));
  return unwrap(await ctx.db.from("organisations").select("*").eq("id", ctx.orgId).single());
}

export async function setModule(ctx: RequestContext, module: Module, enabled: boolean, settings?: Record<string, unknown>) {
  await ctx.require("org:manage", {}, "strict");
  if (!MODULES.includes(module)) throw new ApiError("bad_request", "Unknown module");
  const row: { org_id: string; module: string; enabled: boolean; settings?: never } = { org_id: ctx.orgId, module, enabled };
  if (settings) row.settings = settings as never;
  unwrap(await ctx.db.from("org_modules").upsert(row));
  return unwrap(await ctx.db.from("org_modules").select("*").eq("org_id", ctx.orgId));
}

// ---------------------------------------------------------------------------
// Members, roles, invitations
// ---------------------------------------------------------------------------
export async function listMembers(ctx: RequestContext, q?: string) {
  let query = ctx.db
    .from("org_members")
    .select(
      "id, user_id, status, is_owner, title, employee_code, campus_id, department_id, manager_id, joined_at, profile:profiles!org_members_user_id_fkey(id, email, full_name, phone, avatar_path)",
    )
    .eq("org_id", ctx.orgId)
    .order("joined_at");
  if (q) query = query.or(`title.ilike.%${q.replace(/[,()]/g, "")}%`);
  const members = unwrap(await query);
  const canSeeRoles = await ctx.can("user:read", {}, "anywhere");
  const assignments = canSeeRoles
    ? unwrap(
        await ctx.db
          .from("user_role_assignments")
          .select("id, user_id, role_id, scope_type, campus_id, department_id, expires_at, role:roles(key, name)")
          .eq("org_id", ctx.orgId),
      )
    : [];
  return members.map((m) => ({ ...m, roles: assignments.filter((a) => a.user_id === m.user_id) }));
}

export const memberUpdateSchema = z.object({
  status: z.enum(["active", "suspended"]).optional(),
  title: z.string().max(120).nullable().optional(),
  employee_code: z.string().max(40).nullable().optional(),
  campus_id: z.uuid().nullable().optional(),
  department_id: z.uuid().nullable().optional(),
  manager_id: z.uuid().nullable().optional(),
});

export async function updateMember(ctx: RequestContext, memberId: string, input: z.infer<typeof memberUpdateSchema>) {
  await ctx.require("user:manage", {}, "strict");
  const m = unwrapMaybe(await ctx.db.from("org_members").select("*").eq("id", memberId).eq("org_id", ctx.orgId).maybeSingle());
  if (!m) throw ApiError.notFound("Member");
  if (m.is_owner && input.status === "suspended") throw new ApiError("conflict", "The owner cannot be suspended");
  if (input.manager_id === m.user_id) throw new ApiError("unprocessable", "A member cannot be their own manager");
  unwrap(await ctx.db.from("org_members").update(input).eq("id", memberId));
  return unwrap(await ctx.db.from("org_members").select("*").eq("id", memberId).single());
}

export const roleAssignmentSchema = z
  .object({
    user_id: z.uuid(),
    role_id: z.uuid(),
    scope_type: z.enum(["org", "campus", "department"]).default("org"),
    campus_id: z.uuid().nullable().optional(),
    department_id: z.uuid().nullable().optional(),
    expires_at: z.iso.datetime({ offset: true }).nullable().optional(),
  })
  .refine((v) => v.scope_type !== "campus" || v.campus_id, { message: "campus_id required for campus scope", path: ["campus_id"] })
  .refine((v) => v.scope_type !== "department" || v.department_id, {
    message: "department_id required for department scope",
    path: ["department_id"],
  });

export async function assignRole(ctx: RequestContext, input: z.infer<typeof roleAssignmentSchema>) {
  await ctx.require("user:manage", {}, "strict");
  return unwrap(
    await ctx.db
      .from("user_role_assignments")
      .insert({
        org_id: ctx.orgId,
        user_id: input.user_id,
        role_id: input.role_id,
        scope_type: input.scope_type,
        campus_id: input.scope_type === "campus" ? input.campus_id : null,
        department_id: input.scope_type === "department" ? input.department_id : null,
        expires_at: input.expires_at ?? null,
        created_by: ctx.userId,
      })
      .select("*")
      .single(),
  );
}

export async function removeRoleAssignment(ctx: RequestContext, id: string) {
  await ctx.require("user:manage", {}, "strict");
  const a = unwrapMaybe(
    await ctx.db.from("user_role_assignments").select("*, role:roles(key)").eq("id", id).eq("org_id", ctx.orgId).maybeSingle(),
  );
  if (!a) throw ApiError.notFound("Role assignment");
  if ((a.role as { key: string } | null)?.key === "owner") {
    const owners = unwrap(
      await ctx.db.from("user_role_assignments").select("id, role:roles!inner(key)").eq("org_id", ctx.orgId).eq("role.key", "owner"),
    );
    if (owners.length <= 1) throw new ApiError("conflict", "An organisation needs at least one owner");
  }
  unwrap(await ctx.db.from("user_role_assignments").delete().eq("id", id));
}

export const roleSchema = z.object({
  key: z.string().regex(/^[a-z0-9_]{2,48}$/),
  name: z.string().trim().min(2).max(80),
  description: z.string().max(500).nullable().optional(),
  permissions: z.array(z.string().regex(/^[a-z_]+:[a-z_]+$/)).default([]),
});

export async function upsertRole(ctx: RequestContext, input: z.infer<typeof roleSchema>, roleId?: string) {
  await ctx.require("role:manage", {}, "strict");
  let id = roleId;
  if (id) {
    const existing = unwrapMaybe(await ctx.db.from("roles").select("*").eq("id", id).eq("org_id", ctx.orgId).maybeSingle());
    if (!existing) throw ApiError.notFound("Role");
    if (existing.is_system) throw new ApiError("conflict", "System roles cannot be edited");
    unwrap(await ctx.db.from("roles").update({ name: input.name, description: input.description ?? null }).eq("id", id));
    unwrap(await ctx.db.from("role_permissions").delete().eq("role_id", id));
  } else {
    id = unwrap(
      await ctx.db
        .from("roles")
        .insert({ org_id: ctx.orgId, key: input.key, name: input.name, description: input.description ?? null })
        .select("id")
        .single(),
    ).id;
  }
  if (input.permissions.length) {
    unwrap(await ctx.db.from("role_permissions").insert(input.permissions.map((p) => ({ role_id: id!, permission_key: p }))));
  }
  return unwrap(await ctx.db.from("roles").select("*, role_permissions(permission_key)").eq("id", id).single());
}

export const invitationSchema = z.object({
  email: z.email().trim().toLowerCase(),
  full_name: z.string().trim().max(120).optional(),
  role_id: z.uuid().optional(),
  scope_type: z.enum(["org", "campus", "department"]).default("org"),
  campus_id: z.uuid().nullable().optional(),
  department_id: z.uuid().nullable().optional(),
});

export async function inviteMember(ctx: RequestContext, input: z.infer<typeof invitationSchema>) {
  await ctx.require("user:manage", {}, "strict");
  const token = randomBytes(24).toString("base64url");
  const invite = unwrap(
    await ctx.db
      .from("org_invitations")
      .insert({
        org_id: ctx.orgId,
        email: input.email,
        full_name: input.full_name ?? null,
        role_id: input.role_id ?? null,
        scope_type: input.scope_type,
        campus_id: input.campus_id ?? null,
        department_id: input.department_id ?? null,
        token_hash: sha256(token),
        invited_by: ctx.userId,
      })
      .select("id, email, expires_at")
      .single(),
  );
  const link = `${publicEnv.appUrl}/invite/${token}`;
  unwrap(
    await createAdminClient().from("message_outbox").insert({
      org_id: ctx.orgId,
      channel: "email",
      recipient: input.email,
      template: "invitation",
      subject: `You're invited to ${ctx.org.name} on Campus Ops`,
      payload: { link, org: ctx.org.name, name: input.full_name ?? null },
    }),
  );
  return { ...invite, invite_link: link };
}

// ---------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------
const approvalSelect =
  "*, requester:profiles!approval_requests_requested_by_fkey(id, full_name, email), steps:approval_request_steps(*), actions:approval_actions(*, actor:profiles!approval_actions_actor_id_fkey(id, full_name))";

export async function approvalInbox(ctx: RequestContext) {
  const rows = unwrap(await ctx.db.rpc("approval_inbox", { p_org: ctx.orgId }));
  if (rows.length === 0) return [];
  return unwrap(
    await ctx.db
      .from("approval_requests")
      .select(approvalSelect)
      .in(
        "id",
        rows.map((r) => r.id),
      )
      .order("submitted_at"),
  );
}

export async function getApproval(ctx: RequestContext, id: string) {
  const r = unwrapMaybe(await ctx.db.from("approval_requests").select(approvalSelect).eq("id", id).eq("org_id", ctx.orgId).maybeSingle());
  if (!r) throw ApiError.notFound("Approval request");
  return r;
}

export async function actOnApproval(ctx: RequestContext, id: string, action: "approve" | "reject", comment?: string) {
  const status = unwrap(await ctx.db.rpc("approval_act", { p_request_id: id, p_action: action, p_comment: comment }));
  return { status, request: await getApproval(ctx, id) };
}

export async function approvalForEntity(ctx: RequestContext, entityType: string, entityId: string) {
  return unwrap(
    await ctx.db
      .from("approval_requests")
      .select(approvalSelect)
      .eq("org_id", ctx.orgId)
      .eq("entity_type", entityType)
      .eq("entity_id", entityId)
      .order("submitted_at", { ascending: false }),
  );
}

// ---------------------------------------------------------------------------
// Comments, attachments, activity
// ---------------------------------------------------------------------------
export const entityRef = z.object({
  entity_type: z.string().regex(/^[a-z_]+$/),
  entity_id: z.uuid(),
});

export async function listComments(ctx: RequestContext, entityType: string, entityId: string) {
  return unwrap(
    await ctx.db
      .from("comments")
      .select("*, author:profiles!comments_author_id_fkey(id, full_name, avatar_path)")
      .eq("org_id", ctx.orgId)
      .eq("entity_type", entityType)
      .eq("entity_id", entityId)
      .is("deleted_at", null)
      .order("created_at"),
  );
}

export async function addComment(
  ctx: RequestContext,
  input: { entity_type: string; entity_id: string; body: string; mentions: string[]; is_internal: boolean; parent_id?: string },
) {
  const db = ctx.kind === "api_key" ? ctx.admin() : ctx.db;
  return unwrap(
    await db
      .from("comments")
      .insert({ ...input, org_id: ctx.orgId, author_id: ctx.userId })
      .select("*, author:profiles!comments_author_id_fkey(id, full_name, avatar_path)")
      .single(),
  );
}

const ALLOWED_MIME = /^(image\/(png|jpe?g|webp|gif|heic|heif)|application\/pdf|text\/(plain|csv)|application\/(msword|vnd\.openxmlformats-officedocument\.[a-z.]+|vnd\.ms-excel))$/;

export const uploadRequestSchema = entityRef.extend({
  file_name: z.string().trim().min(1).max(200),
  mime_type: z.string().regex(ALLOWED_MIME, "File type not allowed"),
  size_bytes: z.number().int().positive().max(25 * 1024 * 1024, "Max 25 MB"),
  kind: z.string().max(40).optional(),
});

/**
 * Registers an attachment (RLS ensures the caller can see the parent entity)
 * and returns a signed upload URL for the file under <org>/<entity>/<id>/.
 */
export async function createUpload(ctx: RequestContext, input: z.infer<typeof uploadRequestSchema>) {
  const safe = input.file_name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-120);
  const path = `${ctx.orgId}/${input.entity_type}/${input.entity_id}/${randomUUID()}-${safe}`;
  const db = ctx.kind === "api_key" ? ctx.admin() : ctx.db;
  const attachment = unwrap(
    await db
      .from("attachments")
      .insert({
        org_id: ctx.orgId,
        entity_type: input.entity_type,
        entity_id: input.entity_id,
        path,
        file_name: input.file_name,
        mime_type: input.mime_type,
        size_bytes: input.size_bytes,
        kind: input.kind ?? null,
        uploaded_by: ctx.userId,
      })
      .select("*")
      .single(),
  );
  const { data, error } = await createAdminClient().storage.from("attachments").createSignedUploadUrl(path);
  if (error || !data) throw new ApiError("internal_error", "Could not create upload URL");
  return { attachment, upload: { url: data.signedUrl, token: data.token, path } };
}

export async function attachmentUrl(ctx: RequestContext, id: string, download = false) {
  const a = unwrapMaybe(
    await ctx.db.from("attachments").select("*").eq("id", id).eq("org_id", ctx.orgId).is("deleted_at", null).maybeSingle(),
  );
  if (!a) throw ApiError.notFound("Attachment");
  const { data, error } = await createAdminClient()
    .storage.from(a.bucket)
    .createSignedUrl(a.path, 300, download ? { download: a.file_name } : undefined);
  if (error || !data) throw new ApiError("internal_error", "Could not sign URL");
  return { url: data.signedUrl, expires_in: 300, attachment: a };
}

export async function listAttachments(ctx: RequestContext, entityType: string, entityId: string) {
  return unwrap(
    await ctx.db
      .from("attachments")
      .select("*")
      .eq("org_id", ctx.orgId)
      .eq("entity_type", entityType)
      .eq("entity_id", entityId)
      .is("deleted_at", null)
      .order("created_at"),
  );
}

export async function listActivity(ctx: RequestContext, entityType?: string, entityId?: string, limit = 50, before?: number) {
  let q = ctx.db
    .from("activity_log")
    .select("*, actor:profiles!activity_log_actor_id_fkey(id, full_name)")
    .eq("org_id", ctx.orgId)
    .order("id", { ascending: false })
    .limit(Math.min(limit, 200));
  if (entityType) q = q.eq("entity_type", entityType);
  if (entityId) q = q.eq("entity_id", entityId);
  if (before) q = q.lt("id", before);
  return unwrap(await q);
}

// ---------------------------------------------------------------------------
// API keys & webhooks
// ---------------------------------------------------------------------------
export const apiKeySchema = z.object({
  name: z.string().trim().min(2).max(80),
  scopes: z.array(z.string().regex(/^(\*|[a-z_]+:(\*|[a-z_]+))$/)).min(1),
  rate_limit_per_minute: z.number().int().min(1).max(10000).default(120),
  expires_at: z.iso.datetime({ offset: true }).nullable().optional(),
});

export async function createApiKey(ctx: RequestContext, input: z.infer<typeof apiKeySchema>) {
  await ctx.require("api_key:manage", {}, "strict");
  if (ctx.kind === "api_key") throw new ApiError("forbidden", "API keys cannot create API keys");
  const prefix = randomBytes(6).toString("hex");
  const secret = randomBytes(24).toString("base64url");
  const key = `co_live_${prefix}_${secret}`;
  const row = unwrap(
    await ctx.db
      .from("api_keys")
      .insert({
        org_id: ctx.orgId,
        name: input.name,
        prefix,
        key_hash: sha256(key),
        scopes: input.scopes,
        rate_limit_per_minute: input.rate_limit_per_minute,
        expires_at: input.expires_at ?? null,
        created_by: ctx.userId,
      })
      .select("id, name, prefix, scopes, rate_limit_per_minute, expires_at, created_at")
      .single(),
  );
  return { ...row, key, note: "Store this key now; it will not be shown again." };
}

export const webhookSchema = z.object({
  url: z.url().refine((u) => u.startsWith("https://") || process.env.NODE_ENV !== "production", "HTTPS required"),
  description: z.string().max(200).nullable().optional(),
  events: z.array(z.string().regex(/^(\*|[a-z_]+\.(\*|[a-z_]+))$/)).min(1).default(["*"]),
  active: z.boolean().default(true),
});
