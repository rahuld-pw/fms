import "server-only";
import { z } from "zod";
import { ApiError, unwrap } from "@/lib/api/errors";
import { publicRoute, type RouteDef } from "@/lib/api/router";
import { getSessionContext, getSessionUser, MODULES } from "@/lib/auth/context";
import { publicEnv } from "@/lib/env";
import { createAdminClient, createUserClient } from "@/lib/supabase/server";
import { verifyCaptcha } from "./public";

// Platform (super admin) and product-feedback endpoints. They are not scoped
// to an organisation, so they authenticate with the session themselves
// instead of going through the organisation-scoped API context.

async function platformAdmin() {
  const user = await getSessionUser();
  if (!user) throw new ApiError("unauthorized", "Authentication required");
  const db = await createUserClient();
  if (!unwrap(await db.rpc("am_platform_admin"))) throw new ApiError("forbidden", "Platform administrators only");
  return { user, db };
}

const slug = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,47}$/, "lowercase letters, numbers and dashes");
const modules = z.array(z.enum(MODULES)).min(1);

async function queueOwnerInvite(orgId: string, orgName: string, email: string, name: string | null | undefined, token: string) {
  const link = `${publicEnv.appUrl}/invite/${token}`;
  unwrap(
    await createAdminClient().from("message_outbox").insert({
      org_id: orgId, channel: "email", recipient: email, template: "invitation",
      subject: `You're invited to set up ${orgName} on Campus Ops`, payload: { link, org: orgName, name: name ?? null },
    }),
  );
  return link;
}

const ADMIN = { tags: ["platform"], rateLimit: { name: "platform", limit: 120 } };

export const platformRoutes: RouteDef[] = [
  publicRoute({
    ...ADMIN,
    public: true,
    method: "GET",
    path: "/admin/organisations",
    summary: "Platform admin: list organisations with licence, status and counts",
    handler: async ({ query }) => {
      const { db } = await platformAdmin();
      return unwrap(await db.rpc("admin_list_organisations", { p_kind: query.get("kind") ?? undefined }));
    },
  }),
  publicRoute({
    ...ADMIN,
    public: true,
    method: "POST",
    path: "/admin/organisations",
    summary: "Platform admin: create an organisation and invite its first admin",
    body: z.object({
      name: z.string().trim().min(2).max(200),
      slug,
      admin_email: z.email().trim().toLowerCase(),
      admin_name: z.string().trim().max(120).optional(),
      modules: modules.default([...MODULES]),
      timezone: z.string().max(64).default("Asia/Kolkata"),
      currency: z.string().length(3).toUpperCase().default("INR"),
      campus_name: z.string().trim().min(2).max(120).default("Main Campus"),
      campus_code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,8}$/).default("MAIN"),
      plan: z.string().trim().max(40).default("standard"),
    }),
    status: 201,
    handler: async ({ body }) => {
      const { db } = await platformAdmin();
      const res = unwrap(
        await db.rpc("admin_create_organisation", {
          p_name: body.name, p_slug: body.slug, p_admin_email: body.admin_email, p_admin_name: body.admin_name,
          p_modules: body.modules, p_timezone: body.timezone, p_currency: body.currency,
          p_campus_name: body.campus_name, p_campus_code: body.campus_code, p_plan: body.plan,
        }),
      ) as { org_id: string; invite_token: string };
      const invite_link = await queueOwnerInvite(res.org_id, body.name, body.admin_email, body.admin_name, res.invite_token);
      return { org_id: res.org_id, invite_link };
    },
  }),
  publicRoute({
    ...ADMIN,
    public: true,
    method: "PATCH",
    path: "/admin/organisations/:id",
    summary: "Platform admin: rename, suspend/reactivate or change the licensed modules",
    body: z.object({
      name: z.string().trim().min(2).max(200).optional(),
      status: z.enum(["active", "suspended"]).optional(),
      licensed_modules: modules.optional(),
      plan: z.string().trim().max(40).optional(),
      notes: z.string().max(2000).optional(),
    }),
    handler: async ({ params, body }) => {
      const { db } = await platformAdmin();
      unwrap(
        await db.rpc("admin_update_organisation", {
          p_org: params.id, p_name: body.name, p_status: body.status, p_licensed_modules: body.licensed_modules,
          p_plan: body.plan, p_notes: body.notes,
        }),
      );
      return { updated: true };
    },
  }),
  publicRoute({
    ...ADMIN,
    public: true,
    method: "POST",
    path: "/admin/organisations/:id/owner-invitations",
    summary: "Platform admin: invite another organisation admin (owner)",
    body: z.object({ email: z.email().trim().toLowerCase(), name: z.string().trim().max(120).optional() }),
    status: 201,
    handler: async ({ params, body }) => {
      const { db } = await platformAdmin();
      const token = unwrap(await db.rpc("admin_invite_owner", { p_org: params.id, p_email: body.email, p_name: body.name })) as string;
      const org = unwrap(await createAdminClient().from("organisations").select("name").eq("id", params.id).single());
      return { invite_link: await queueOwnerInvite(params.id, org.name, body.email, body.name, token) };
    },
  }),
  publicRoute({
    ...ADMIN,
    public: true,
    method: "GET",
    path: "/admin/platform-admins",
    summary: "Platform admin: list platform administrators",
    handler: async () => {
      const { db } = await platformAdmin();
      return unwrap(await db.rpc("admin_list_platform_admins"));
    },
  }),
  publicRoute({
    ...ADMIN,
    public: true,
    method: "POST",
    path: "/admin/platform-admins",
    summary: "Platform admin: grant platform admin by email (applies on sign-up if no account yet)",
    body: z.object({ email: z.email().trim().toLowerCase() }),
    status: 201,
    handler: async ({ body }) => {
      const { db } = await platformAdmin();
      unwrap(await db.rpc("admin_add_platform_admin", { p_email: body.email }));
      return { added: true };
    },
  }),
  publicRoute({
    ...ADMIN,
    public: true,
    method: "DELETE",
    path: "/admin/platform-admins/:email",
    summary: "Platform admin: revoke platform admin",
    response: "none",
    handler: async ({ params }) => {
      const { db } = await platformAdmin();
      unwrap(await db.rpc("admin_remove_platform_admin", { p_email: params.email }));
    },
  }),
  publicRoute({
    ...ADMIN,
    public: true,
    method: "GET",
    path: "/admin/feedback",
    summary: "Platform admin: bug reports and feature requests",
    query: z.object({ status: z.string().optional(), kind: z.enum(["bug", "feature", "other"]).optional() }),
    handler: async ({ query }) => {
      const { db } = await platformAdmin();
      let q = db
        .from("feedback")
        .select("*, user:profiles!feedback_user_id_fkey(full_name, email), organisation:organisations(name)")
        .order("created_at", { ascending: false })
        .limit(500);
      const status = query.get("status");
      if (status) q = q.in("status", status.split(","));
      if (query.get("kind")) q = q.eq("kind", query.get("kind")!);
      return unwrap(await q);
    },
  }),
  publicRoute({
    ...ADMIN,
    public: true,
    method: "PATCH",
    path: "/admin/feedback/:id",
    summary: "Platform admin: triage a report",
    body: z.object({
      status: z.enum(["new", "triaged", "planned", "in_progress", "done", "wont_fix", "duplicate"]).optional(),
      admin_notes: z.string().max(5000).nullable().optional(),
    }),
    handler: async ({ params, body }) => {
      const { db } = await platformAdmin();
      return unwrap(await db.from("feedback").update(body).eq("id", params.id).select("*").single());
    },
  }),

  // Feedback from anyone: signed-in users are identified by their session;
  // anonymous visitors give an email and pass the captcha.
  publicRoute({
    public: true,
    method: "POST",
    path: "/feedback",
    summary: "Report a bug or suggest a feature",
    tags: ["feedback"],
    rateLimit: { name: "feedback", limit: 5, windowSeconds: 600 },
    body: z.object({
      kind: z.enum(["bug", "feature", "other"]),
      title: z.string().trim().min(3).max(200),
      description: z.string().trim().min(10).max(5000),
      page_url: z.string().max(500).optional(),
      email: z.email().trim().toLowerCase().optional(),
      captcha_token: z.string().max(4096).optional(),
      website: z.string().max(0).optional(), // honeypot
    }),
    status: 201,
    handler: async ({ req, body, ip }) => {
      const user = await getSessionUser();
      if (!user) {
        if (!body.email) throw new ApiError("validation_failed", "Please give an email so we can follow up", [{ path: "email", message: "Required" }]);
        await verifyCaptcha(body.captcha_token, ip);
      }
      const ctx = user ? await getSessionContext().catch(() => null) : null;
      const row = unwrap(
        await createAdminClient()
          .from("feedback")
          .insert({
            kind: body.kind, title: body.title, description: body.description, page_url: body.page_url ?? null,
            user_agent: req.headers.get("user-agent")?.slice(0, 300) ?? null,
            email: user?.email ?? body.email ?? null, user_id: user?.id ?? null, org_id: ctx?.orgId ?? null,
          })
          .select("id")
          .single(),
      );
      return { id: row.id, message: "Thanks! Your report has been received." };
    },
  }),
];
