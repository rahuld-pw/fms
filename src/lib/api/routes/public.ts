import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ApiError, unwrap, unwrapMaybe } from "@/lib/api/errors";
import { publicRoute, type RouteDef } from "@/lib/api/router";
import { serverEnv } from "@/lib/env";
import { isoDate, money, quantity } from "@/lib/schemas/common";
import { createAdminClient } from "@/lib/supabase/server";
import { createVendorPortalLink } from "@/lib/services/facility";
import type { TablesUpdate } from "@/lib/supabase/database.types";

const IMAGE_MIME = /^image\/(png|jpe?g|webp|heic|heif)$/;

/** Cloudflare Turnstile verification; skipped when no secret is configured (dev). */
export async function verifyCaptcha(token: string | undefined, ip: string) {
  const secret = serverEnv().TURNSTILE_SECRET_KEY;
  if (!secret) return;
  if (!token) throw new ApiError("bad_request", "Captcha is required");
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: new URLSearchParams({ secret, response: token, remoteip: ip }),
  });
  const data = (await res.json().catch(() => ({}))) as { success?: boolean };
  if (!data.success) throw new ApiError("bad_request", "Captcha verification failed");
}

async function signedPhotoUploads(orgId: string, issueId: string, photos: { file_name: string; mime_type: string; size_bytes: number }[]) {
  const admin = createAdminClient();
  const out = [];
  for (const p of photos) {
    const path = `${orgId}/issue/${issueId}/${randomUUID()}-${p.file_name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-80)}`;
    unwrap(
      await admin.from("attachments").insert({
        org_id: orgId, entity_type: "issue", entity_id: issueId, path, file_name: p.file_name, mime_type: p.mime_type,
        size_bytes: p.size_bytes, kind: "photo",
      }),
    );
    const { data, error } = await admin.storage.from("attachments").createSignedUploadUrl(path);
    if (error || !data) throw new ApiError("internal_error", "Could not prepare photo upload");
    out.push({ path, url: data.signedUrl, token: data.token });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Vendor portal
// ---------------------------------------------------------------------------
interface VendorSession {
  vendorId: string;
  orgId: string;
  purpose: string;
  status: string;
}

async function vendorSession(req: Request): Promise<VendorSession> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("VendorToken ") ? header.slice(12).trim() : new URL(req.url).searchParams.get("token");
  if (!token) throw new ApiError("unauthorized", "Vendor token required");
  const rows = unwrap(await createAdminClient().rpc("vendor_portal_resolve", { p_token: token }));
  const s = rows?.[0];
  if (!s) throw new ApiError("unauthorized", "This link is invalid or has expired. Request a new one.");
  return { vendorId: s.vendor_id, orgId: s.org_id, purpose: s.purpose, status: s.vendor_status };
}

const ONBOARDING_EDITABLE = ["invited", "draft", "submitted", "under_verification", "rejected"];

const vendorProfileSchema = z
  .object({
    name: z.string().trim().min(2).max(200),
    legal_name: z.string().max(200).nullable(),
    contact_name: z.string().max(120).nullable(),
    phone: z.string().max(20).nullable(),
    website: z.string().max(200).nullable(),
    address: z.string().max(500).nullable(),
    city: z.string().max(100).nullable(),
    state: z.string().max(100).nullable(),
    pincode: z.string().max(10).nullable(),
    gstin: z.string().trim().toUpperCase().regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/).nullable(),
    pan: z.string().trim().toUpperCase().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/).nullable(),
    msme_number: z.string().max(40).nullable(),
    bank_account_name: z.string().max(120).nullable(),
    bank_account_number: z.string().regex(/^[0-9]{6,20}$/).nullable(),
    bank_ifsc: z.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/).nullable(),
    bank_name: z.string().max(120).nullable(),
    service_category_ids: z.array(z.uuid()).max(30),
  })
  .partial();

export const publicRoutes: RouteDef[] = [
  publicRoute({
    public: true,
    method: "GET",
    path: "/public/qr/:token",
    summary: "Resolve a scanned QR code (location or asset) for the public report form",
    tags: ["public"],
    rateLimit: { name: "qr", limit: 60 },
    handler: async ({ params }) => {
      const admin = createAdminClient();
      const info = unwrap(await admin.rpc("resolve_qr", { p_token: params.token })) as Record<string, unknown> | null;
      if (!info) throw ApiError.notFound("QR code");
      const categories = unwrap(
        await admin
          .from("issue_categories")
          .select("id, name, icon")
          .eq("org_id", info.org_id as string)
          .eq("active", true)
          .eq("public_visible", true)
          .order("position"),
      );
      const org = unwrapMaybe(await admin.from("organisations").select("settings").eq("id", info.org_id as string).maybeSingle());
      const settings = (org?.settings ?? {}) as { public_issue_reporting?: boolean };
      return { ...info, categories, public_reporting: settings.public_issue_reporting !== false };
    },
  }),
  publicRoute({
    public: true,
    method: "POST",
    path: "/public/issues",
    summary: "Report an issue anonymously (QR code or org/campus), protected by captcha + rate limit",
    description: "No reporter identity is stored. Keep the returned tracking_token to check status. Optional photos get signed upload URLs.",
    tags: ["public"],
    rateLimit: { name: "public-issue", limit: 5, windowSeconds: 600 },
    body: z
      .object({
        qr_token: z.string().max(64).optional(),
        org_slug: z.string().max(48).optional(),
        campus_id: z.uuid().optional(),
        title: z.string().trim().min(3).max(200),
        description: z.string().trim().max(2000).optional(),
        category_id: z.uuid().optional(),
        priority: z.enum(["low", "medium", "high", "critical"]).optional(),
        captcha_token: z.string().max(4096).optional(),
        // honeypot: real users never fill this
        website: z.string().max(0).optional(),
        photos: z
          .array(z.object({ file_name: z.string().min(1).max(200), mime_type: z.string().regex(IMAGE_MIME), size_bytes: z.number().int().positive().max(10 * 1024 * 1024) }))
          .max(3)
          .default([]),
      })
      .refine((b) => b.qr_token || (b.org_slug && b.campus_id), "qr_token or org_slug + campus_id is required"),
    status: 201,
    handler: async ({ body, ip }) => {
      await verifyCaptcha(body.captcha_token, ip);
      const admin = createAdminClient();
      const res = unwrap(
        await admin.rpc("submit_public_issue", {
          p_qr_token: body.qr_token ?? (null as never),
          p_title: body.title,
          p_description: body.description ?? (null as never),
          p_category_id: body.category_id,
          p_priority: body.priority,
          p_campus_id: body.campus_id,
          p_org_slug: body.org_slug,
        }),
      )[0];
      const issue = unwrap(await admin.from("issues").select("org_id").eq("id", res.issue_id).single());
      const uploads = body.photos.length ? await signedPhotoUploads(issue.org_id, res.issue_id, body.photos) : [];
      return { number: res.issue_number, tracking_token: res.tracking_token, uploads };
    },
  }),
  publicRoute({
    public: true,
    method: "GET",
    path: "/public/issues/status",
    summary: "Check an anonymous issue's status with its tracking token",
    tags: ["public"],
    rateLimit: { name: "issue-status", limit: 30 },
    query: z.object({ token: z.string().min(10).max(64) }),
    handler: async ({ query }) => {
      const status = unwrap(await createAdminClient().rpc("public_issue_status", { p_tracking_token: query.get("token")! }));
      if (!status) throw ApiError.notFound("Issue");
      return status;
    },
  }),
  publicRoute({
    public: true,
    method: "POST",
    path: "/public/issues/feedback",
    summary: "Rate a resolved anonymous issue or reopen it",
    tags: ["public"],
    rateLimit: { name: "issue-feedback", limit: 10 },
    body: z.object({
      token: z.string().min(10).max(64),
      action: z.enum(["rate", "reopen"]),
      rating: z.number().int().min(1).max(5).optional(),
      feedback: z.string().trim().max(2000).optional(),
    }),
    status: 200,
    handler: async ({ body }) => {
      if (body.action === "rate" && !body.rating) throw new ApiError("validation_failed", "rating is required");
      const status = unwrap(
        await createAdminClient().rpc("public_issue_feedback", {
          p_tracking_token: body.token, p_action: body.action, p_rating: body.rating, p_feedback: body.feedback,
        }),
      );
      return { status };
    },
  }),

  // Vendor portal ------------------------------------------------------------
  publicRoute({
    public: true,
    method: "POST",
    path: "/portal/login",
    summary: "Request a vendor portal magic link (always returns 202)",
    tags: ["vendor-portal"],
    rateLimit: { name: "vendor-login", limit: 5, windowSeconds: 600 },
    body: z.object({ email: z.email().trim().toLowerCase(), org_slug: z.string().max(48) }),
    status: 202,
    handler: async ({ body }) => {
      const admin = createAdminClient();
      const org = unwrapMaybe(await admin.from("organisations").select("id").eq("slug", body.org_slug).maybeSingle());
      if (org) {
        const vendor = unwrapMaybe(
          await admin
            .from("vendors")
            .select("id")
            .eq("org_id", org.id)
            .ilike("email", body.email)
            .is("deleted_at", null)
            .not("status", "in", "(blacklisted,inactive)")
            .limit(1)
            .maybeSingle(),
        );
        if (vendor) await createVendorPortalLink(null, vendor.id, "portal", { orgId: org.id, email: body.email });
      }
      return { message: "If that email belongs to a registered vendor, a sign-in link is on its way." };
    },
  }),
  publicRoute({
    public: true,
    method: "GET",
    path: "/portal/me",
    summary: "Vendor portal home: profile, documents, open POs, bookings and RFQs",
    tags: ["vendor-portal"],
    rateLimit: { name: "portal", limit: 120 },
    handler: async ({ req }) => {
      const s = await vendorSession(req);
      const admin = createAdminClient();
      const [vendor, org, docs, pos, wos, rfqs, categories] = await Promise.all([
        admin
          .from("vendors")
          .select("id, name, legal_name, status, contact_name, email, phone, website, address, city, state, pincode, gstin, pan, msme_number, bank_account_name, bank_account_number, bank_ifsc, bank_name, service_category_ids, rating_avg")
          .eq("id", s.vendorId)
          .single(),
        admin.from("organisations").select("name, slug, logo_path, currency, locale, timezone").eq("id", s.orgId).single(),
        admin.from("vendor_documents").select("id, doc_type, title, doc_number, expires_on, verification_status, remarks").eq("vendor_id", s.vendorId),
        admin
          .from("purchase_orders")
          .select("id, number, version, status, order_date, expected_delivery, total, vendor_ack_at")
          .eq("vendor_id", s.vendorId)
          .in("status", ["sent", "acknowledged", "partially_received", "received", "closed"])
          .order("order_date", { ascending: false })
          .limit(50),
        admin
          .from("work_orders")
          .select("id, number, title, status, scheduled_for, due_at, vendor_booking_status, vendor_booking_note, location:locations(name, path_names), campus:campuses(name, address)")
          .eq("vendor_id", s.vendorId)
          .is("deleted_at", null)
          .not("status", "in", "(cancelled,verified)")
          .order("scheduled_for")
          .limit(50),
        admin
          .from("rfq_vendors")
          .select("rfq:rfqs(id, number, title, due_date, status, terms, requisition:requisitions(lines:requisition_lines(id, description, quantity, unit)))")
          .eq("vendor_id", s.vendorId)
          .limit(50),
        admin.from("service_categories").select("id, name").eq("org_id", s.orgId).order("name"),
      ]);
      return {
        purpose: s.purpose,
        vendor: unwrap(vendor),
        organisation: unwrap(org),
        documents: unwrap(docs),
        purchase_orders: unwrap(pos),
        work_orders: unwrap(wos),
        rfqs: unwrap(rfqs)
          .map((r) => r.rfq)
          .filter((r) => r && (r as { status: string }).status === "sent"),
        service_categories: unwrap(categories),
        can_edit_profile: ONBOARDING_EDITABLE.includes(s.status),
      };
    },
  }),
  publicRoute({
    public: true,
    method: "PATCH",
    path: "/portal/profile",
    summary: "Vendor self-fills registration details (during onboarding)",
    tags: ["vendor-portal"],
    rateLimit: { name: "portal-write", limit: 30 },
    body: vendorProfileSchema,
    handler: async ({ req, body }) => {
      const s = await vendorSession(req);
      if (!ONBOARDING_EDITABLE.includes(s.status)) throw new ApiError("conflict", "Profile is locked after approval; contact the organisation to change it");
      const admin = createAdminClient();
      return unwrap(
        await admin
          .from("vendors")
          .update({ ...body, status: s.status === "invited" ? "draft" : s.status })
          .eq("id", s.vendorId)
          .select("id, name, status")
          .single(),
      );
    },
  }),
  publicRoute({
    public: true,
    method: "POST",
    path: "/portal/documents",
    summary: "Upload a registration document (returns a signed upload URL)",
    tags: ["vendor-portal"],
    rateLimit: { name: "portal-write", limit: 30 },
    body: z.object({
      doc_type: z.enum(["gst_certificate", "pan_card", "cancelled_cheque", "msme_certificate", "incorporation", "insurance", "license", "other"]),
      doc_number: z.string().max(80).optional(),
      expires_on: isoDate.optional(),
      file_name: z.string().min(1).max(200),
      mime_type: z.string().regex(/^(application\/pdf|image\/(png|jpe?g|webp))$/),
      size_bytes: z.number().int().positive().max(10 * 1024 * 1024),
    }),
    status: 201,
    handler: async ({ req, body }) => {
      const s = await vendorSession(req);
      const admin = createAdminClient();
      const path = `${s.orgId}/vendor/${s.vendorId}/${randomUUID()}-${body.file_name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-80)}`;
      const att = unwrap(
        await admin
          .from("attachments")
          .insert({ org_id: s.orgId, entity_type: "vendor", entity_id: s.vendorId, path, file_name: body.file_name, mime_type: body.mime_type, size_bytes: body.size_bytes, kind: "document" })
          .select("id")
          .single(),
      );
      const doc = unwrap(
        await admin
          .from("vendor_documents")
          .insert({ org_id: s.orgId, vendor_id: s.vendorId, doc_type: body.doc_type, doc_number: body.doc_number ?? null, expires_on: body.expires_on ?? null, attachment_id: att.id })
          .select("*")
          .single(),
      );
      const { data, error } = await admin.storage.from("attachments").createSignedUploadUrl(path);
      if (error || !data) throw new ApiError("internal_error", "Could not prepare upload");
      return { document: doc, upload: { url: data.signedUrl, token: data.token, path } };
    },
  }),
  publicRoute({
    public: true,
    method: "POST",
    path: "/portal/submit",
    summary: "Submit the completed registration for verification",
    tags: ["vendor-portal"],
    rateLimit: { name: "portal-write", limit: 10 },
    status: 200,
    handler: async ({ req }) => {
      const s = await vendorSession(req);
      if (!["invited", "draft", "rejected"].includes(s.status)) throw new ApiError("conflict", "Registration was already submitted");
      const admin = createAdminClient();
      const v = unwrap(await admin.from("vendors").select("name, pan, bank_account_number, bank_ifsc").eq("id", s.vendorId).single());
      if (!v.pan || !v.bank_account_number || !v.bank_ifsc) throw new ApiError("validation_failed", "PAN and bank details are required before submitting");
      unwrap(await admin.from("vendors").update({ status: "submitted" }).eq("id", s.vendorId));
      const managers = unwrap(
        await admin
          .from("user_role_assignments")
          .select("user_id, role:roles!inner(is_superuser, role_permissions(permission_key))")
          .eq("org_id", s.orgId),
      ).filter((a) => {
        const role = a.role as unknown as { is_superuser: boolean; role_permissions: { permission_key: string }[] };
        return role.is_superuser || role.role_permissions.some((p) => p.permission_key === "vendor:update");
      });
      const unique = [...new Set(managers.map((m) => m.user_id))];
      if (unique.length)
        unwrap(
          await admin.from("notifications").insert(
            unique.map((u) => ({
              org_id: s.orgId, user_id: u, type: "vendor.submitted", title: `Vendor registration submitted: ${v.name}`,
              entity_type: "vendor", entity_id: s.vendorId, link: `/facility/vendors/${s.vendorId}`,
            })),
          ),
        );
      return { status: "submitted" };
    },
  }),
  publicRoute({
    public: true,
    method: "POST",
    path: "/portal/work-orders/:id/booking",
    summary: "Confirm, decline or propose a new time for a service visit",
    tags: ["vendor-portal"],
    rateLimit: { name: "portal-write", limit: 30 },
    body: z.object({
      action: z.enum(["confirm", "decline", "reschedule", "complete"]),
      scheduled_for: z.iso.datetime({ offset: true }).optional(),
      note: z.string().max(1000).optional(),
    }),
    status: 200,
    handler: async ({ req, params, body }) => {
      const s = await vendorSession(req);
      const admin = createAdminClient();
      const wo = unwrapMaybe(await admin.from("work_orders").select("id, status, assignee_id, created_by, number").eq("id", params.id).eq("vendor_id", s.vendorId).maybeSingle());
      if (!wo) throw ApiError.notFound("Work order");
      if (body.action === "reschedule" && !body.scheduled_for) throw new ApiError("validation_failed", "scheduled_for is required");
      const patch: TablesUpdate<"work_orders"> = {
        vendor_booking_status: { confirm: "confirmed", decline: "declined", reschedule: "rescheduled", complete: "completed" }[body.action],
        vendor_booking_note: body.note ?? null,
      };
      if (body.scheduled_for) patch.scheduled_for = body.scheduled_for;
      if (body.action === "confirm" && wo.status === "open") patch.status = "scheduled";
      unwrap(await admin.from("work_orders").update(patch).eq("id", wo.id));
      for (const u of new Set([wo.assignee_id, wo.created_by].filter(Boolean) as string[])) {
        unwrap(
          await admin.from("notifications").insert({
            org_id: s.orgId, user_id: u, type: "work_order.vendor_update", title: `Vendor ${body.action}ed visit for ${wo.number}`,
            body: body.note ?? null, entity_type: "work_order", entity_id: wo.id, link: `/facility/work-orders/${wo.id}`,
          }),
        );
      }
      return { ok: true };
    },
  }),
  publicRoute({
    public: true,
    method: "POST",
    path: "/portal/work-orders/:id/report",
    summary: "Upload a service report for a work order",
    tags: ["vendor-portal"],
    rateLimit: { name: "portal-write", limit: 30 },
    body: z.object({
      notes: z.string().max(5000).optional(),
      file_name: z.string().min(1).max(200),
      mime_type: z.string().regex(/^(application\/pdf|image\/(png|jpe?g|webp))$/),
      size_bytes: z.number().int().positive().max(15 * 1024 * 1024),
    }),
    status: 201,
    handler: async ({ req, params, body }) => {
      const s = await vendorSession(req);
      const admin = createAdminClient();
      const wo = unwrapMaybe(await admin.from("work_orders").select("id, org_id").eq("id", params.id).eq("vendor_id", s.vendorId).maybeSingle());
      if (!wo) throw ApiError.notFound("Work order");
      const path = `${s.orgId}/work_order/${wo.id}/${randomUUID()}-${body.file_name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-80)}`;
      unwrap(
        await admin.from("attachments").insert({
          org_id: s.orgId, entity_type: "work_order", entity_id: wo.id, path, file_name: body.file_name, mime_type: body.mime_type,
          size_bytes: body.size_bytes, kind: "service_report",
        }),
      );
      if (body.notes) {
        const v = unwrap(await admin.from("vendors").select("name").eq("id", s.vendorId).single());
        unwrap(await admin.from("comments").insert({ org_id: s.orgId, entity_type: "work_order", entity_id: wo.id, body: body.notes, author_label: `${v.name} (vendor)` }));
      }
      const { data, error } = await admin.storage.from("attachments").createSignedUploadUrl(path);
      if (error || !data) throw new ApiError("internal_error", "Could not prepare upload");
      return { upload: { url: data.signedUrl, token: data.token, path } };
    },
  }),
  publicRoute({
    public: true,
    method: "POST",
    path: "/portal/rfqs/:id/quote",
    summary: "Submit a quote for an RFQ",
    tags: ["vendor-portal"],
    rateLimit: { name: "portal-write", limit: 20 },
    body: z.object({
      quote_reference: z.string().max(60).optional(),
      valid_until: isoDate.optional(),
      delivery_days: z.number().int().min(0).max(365).optional(),
      payment_terms: z.string().max(500).optional(),
      notes: z.string().max(2000).optional(),
      lines: z
        .array(z.object({ requisition_line_id: z.uuid().optional(), description: z.string().min(1).max(500), quantity, unit_price: money, tax_rate: z.number().min(0).max(28).default(18) }))
        .min(1)
        .max(500),
    }),
    status: 201,
    handler: async ({ req, params, body }) => {
      const s = await vendorSession(req);
      const admin = createAdminClient();
      const invite = unwrapMaybe(
        await admin.from("rfq_vendors").select("rfq:rfqs!inner(id, status, due_date)").eq("rfq_id", params.id).eq("vendor_id", s.vendorId).maybeSingle(),
      );
      const rfq = invite?.rfq as { id: string; status: string; due_date: string | null } | undefined;
      if (!rfq) throw ApiError.notFound("RFQ");
      if (rfq.status !== "sent") throw new ApiError("conflict", "This RFQ is no longer accepting quotes");
      if (rfq.due_date && rfq.due_date < new Date().toISOString().slice(0, 10)) throw new ApiError("conflict", "The quote deadline has passed");
      const { lines, ...header } = body;
      const quote = unwrap(
        await admin
          .from("quotes")
          .upsert({ ...header, org_id: s.orgId, rfq_id: rfq.id, vendor_id: s.vendorId, submitted_via: "portal", status: "received" }, { onConflict: "rfq_id,vendor_id" })
          .select("id")
          .single(),
      );
      unwrap(await admin.from("quote_lines").delete().eq("quote_id", quote.id));
      unwrap(await admin.from("quote_lines").insert(lines.map((l) => ({ ...l, org_id: s.orgId, quote_id: quote.id }))));
      unwrap(await admin.from("rfq_vendors").update({ responded_at: new Date().toISOString() }).eq("rfq_id", rfq.id).eq("vendor_id", s.vendorId));
      return { quote_id: quote.id };
    },
  }),
  publicRoute({
    public: true,
    method: "POST",
    path: "/portal/purchase-orders/:id/acknowledge",
    summary: "Acknowledge a purchase order",
    tags: ["vendor-portal"],
    rateLimit: { name: "portal-write", limit: 20 },
    body: z.object({ name: z.string().trim().min(2).max(120), note: z.string().max(1000).optional() }),
    status: 200,
    handler: async ({ req, params, body }) => {
      const s = await vendorSession(req);
      unwrap(
        await createAdminClient().rpc("po_vendor_acknowledge", { p_po_id: params.id, p_vendor_id: s.vendorId, p_name: body.name, p_note: body.note }),
      );
      return { acknowledged: true };
    },
  }),
  publicRoute({
    public: true,
    method: "GET",
    path: "/portal/purchase-orders/:id",
    summary: "View a purchase order sent to this vendor",
    tags: ["vendor-portal"],
    rateLimit: { name: "portal", limit: 120 },
    handler: async ({ req, params }) => {
      const s = await vendorSession(req);
      const po = unwrapMaybe(
        await createAdminClient()
          .from("purchase_orders")
          .select("id, number, version, status, order_date, expected_delivery, payment_terms, terms_and_conditions, shipping_address, subtotal, tax_total, total, tax_type, vendor_ack_at, lines:po_lines(line_no, description, hsn_sac, quantity, unit, unit_price, discount_pct, tax_rate, line_total, received_qty), campus:campuses(name, address, city, gstin)")
          .eq("id", params.id)
          .eq("vendor_id", s.vendorId)
          .not("status", "in", "(draft,pending_approval,rejected)")
          .maybeSingle(),
      );
      if (!po) throw ApiError.notFound("Purchase order");
      return po;
    },
  }),
];
