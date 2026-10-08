import "server-only";
import QRCode from "qrcode";
import { z } from "zod";
import { ApiError, unwrap } from "@/lib/api/errors";
import { publicRoute, route, type RouteDef } from "@/lib/api/router";
import type { RequestContext } from "@/lib/auth/context";
import { publicEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/server";
import { verifyCaptcha } from "./public";

// Feedback & NPS: surveys for members (answered in the app) and the public
// (link / QR code), their results, and feedback on resolved issues.

const M = "surveys" as const;
const SEGMENTS = ["staff", "parent", "student", "alumni", "visitor", "other"] as const;

const surveyBody = z.object({
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  kind: z.enum(["nps", "csat"]).default("nps"),
  question: z.string().trim().min(5).max(500),
  follow_up: z.string().trim().max(500).nullable().optional(),
  audience: z.enum(["members", "public", "both"]).default("members"),
  status: z.enum(["draft", "active", "closed"]).default("draft"),
  anonymous: z.boolean().default(false),
  campus_id: z.uuid().nullable().optional(),
  closes_at: z.iso.datetime({ offset: true }).nullable().optional(),
});

const surveyLink = (token: string) => `${publicEnv.appUrl}/s/${token}`;

/** Results and the full list are for people who can read or manage surveys. */
async function requireSurveyAccess(ctx: RequestContext) {
  if (!(await ctx.can("survey:read")) && !(await ctx.can("survey:manage"))) throw new ApiError("forbidden", "Missing permission survey:read");
}

export const surveyRoutes: RouteDef[] = [
  route({
    method: "GET",
    path: "/surveys",
    summary: "Surveys with response counts and their NPS (or CSAT average)",
    tags: ["surveys"],
    module: M,
    handler: async ({ ctx }) => {
      if (!(await ctx.can("survey:read")) && !(await ctx.can("survey:manage"))) return [];
      return unwrap(await ctx.db.rpc("survey_overview", { p_org: ctx.orgId }));
    },
  }),
  route({
    method: "GET",
    path: "/surveys/pending",
    summary: "Open surveys the signed-in member hasn't answered yet",
    tags: ["surveys"],
    module: M,
    handler: async ({ ctx }) => {
      if (ctx.kind === "api_key") return [];
      return unwrap(await ctx.db.rpc("my_pending_surveys", { p_org: ctx.orgId }));
    },
  }),
  route({
    method: "POST",
    path: "/surveys",
    summary: "Create a survey",
    tags: ["surveys"],
    module: M,
    permission: "survey:manage",
    body: surveyBody,
    status: 201,
    handler: async ({ ctx, body }) =>
      unwrap(
        await ctx.db
          .from("surveys")
          .insert({ ...body, org_id: ctx.orgId, created_by: ctx.userId, updated_by: ctx.userId })
          .select("*")
          .single(),
      ),
  }),
  route({
    method: "PATCH",
    path: "/surveys/:id",
    summary: "Edit, open or close a survey",
    tags: ["surveys"],
    module: M,
    permission: "survey:manage",
    body: surveyBody.partial(),
    handler: async ({ ctx, params, body }) =>
      unwrap(await ctx.db.from("surveys").update({ ...body, updated_by: ctx.userId }).eq("id", params.id).eq("org_id", ctx.orgId).select("*").single()),
  }),
  route({
    method: "DELETE",
    path: "/surveys/:id",
    summary: "Delete a survey (responses are kept for the record)",
    tags: ["surveys"],
    module: M,
    permission: "survey:manage",
    response: "none",
    handler: async ({ ctx, params }) => {
      unwrap(await ctx.db.from("surveys").update({ deleted_at: new Date().toISOString(), updated_by: ctx.userId }).eq("id", params.id).eq("org_id", ctx.orgId).select("id").single());
    },
  }),
  route({
    method: "GET",
    path: "/surveys/:id/results",
    summary: "Survey results: NPS / CSAT, distribution, weekly trend, segments and comments",
    tags: ["surveys"],
    module: M,
    handler: async ({ ctx, params, query }) => {
      await requireSurveyAccess(ctx);
      const days = query.get("days");
      const res = unwrap(await ctx.db.rpc("survey_results", { p_survey: params.id, p_days: days ? Number(days) : undefined })) as {
        survey: { public_token: string | null };
      };
      return { ...res, link: res.survey.public_token ? surveyLink(res.survey.public_token) : null };
    },
  }),
  route({
    method: "GET",
    path: "/surveys/:id/qr.svg",
    summary: "QR code (SVG) for a survey's public link",
    tags: ["surveys"],
    module: M,
    permission: "survey:manage",
    handler: async ({ ctx, params }) => {
      const s = unwrap(await ctx.db.from("surveys").select("public_token").eq("id", params.id).eq("org_id", ctx.orgId).single());
      const svg = await QRCode.toString(surveyLink(s.public_token), { type: "svg", margin: 1, errorCorrectionLevel: "M" });
      return new Response(svg, { headers: { "content-type": "image/svg+xml", "cache-control": "private, max-age=3600" } });
    },
  }),
  route({
    method: "POST",
    path: "/surveys/:id/responses",
    summary: "Answer (or change your answer to) an open survey as a member",
    tags: ["surveys"],
    module: M,
    body: z.object({ score: z.number().int().min(0).max(10), comment: z.string().trim().max(2000).nullable().optional() }),
    status: 201,
    handler: async ({ ctx, params, body }) => {
      if (ctx.kind === "api_key") throw new ApiError("bad_request", "Available to signed-in users only");
      const id = unwrap(await ctx.db.rpc("survey_respond", { p_survey: params.id, p_score: body.score, p_comment: body.comment ?? undefined }));
      return { id };
    },
  }),
  route({
    method: "GET",
    path: "/feedback/resolution",
    summary: "Ratings reporters gave to resolved issues, overall and per person who resolved them",
    tags: ["surveys", "facility"],
    module: "facility",
    handler: async ({ ctx, query }) =>
      unwrap(
        await ctx.db.rpc("resolution_feedback", {
          p_org: ctx.orgId,
          p_days: Number(query.get("days") ?? 90),
          p_campus: query.get("campus_id") ?? undefined,
        }),
      ),
  }),

  // Public link / QR code: anyone can answer, protected by captcha + rate limit.
  publicRoute({
    public: true,
    method: "GET",
    path: "/public/surveys/:token",
    summary: "A public survey's question (link or QR code)",
    tags: ["public", "surveys"],
    rateLimit: { name: "public-survey", limit: 60 },
    handler: async ({ params }) => {
      const s = unwrap(await createAdminClient().rpc("public_survey", { p_token: params.token }));
      if (!s) throw ApiError.notFound("Survey");
      return s;
    },
  }),
  publicRoute({
    public: true,
    method: "POST",
    path: "/public/surveys/:token/responses",
    summary: "Answer a public survey",
    tags: ["public", "surveys"],
    rateLimit: { name: "public-survey-answer", limit: 10, windowSeconds: 600 },
    body: z.object({
      score: z.number().int().min(0).max(10),
      comment: z.string().trim().max(2000).optional(),
      segment: z.enum(SEGMENTS).optional(),
      name: z.string().trim().max(120).optional(),
      email: z.email().trim().toLowerCase().optional().or(z.literal("")),
      captcha_token: z.string().max(4096).optional(),
      website: z.string().max(0).optional(), // honeypot
    }),
    status: 201,
    handler: async ({ params, body, ip }) => {
      await verifyCaptcha(body.captcha_token, ip);
      const id = unwrap(
        await createAdminClient().rpc("public_survey_respond", {
          p_token: params.token,
          p_score: body.score,
          p_comment: body.comment || undefined,
          p_segment: body.segment,
          p_name: body.name || undefined,
          p_email: body.email || undefined,
        }),
      );
      return { id };
    },
  }),
];
