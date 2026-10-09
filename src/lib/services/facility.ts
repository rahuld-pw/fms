import "server-only";
import { randomBytes } from "node:crypto";
import { addMonths, differenceInMonths, format, parseISO } from "date-fns";
import { z } from "zod";
import { ApiError, unwrap, unwrapMaybe } from "@/lib/api/errors";
import type { RequestContext } from "@/lib/auth/context";
import { publicEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/server";
import { parseCsvObjects } from "@/lib/utils/csv";
import { sha256 } from "./core";

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------
export interface LocationNode {
  id: string;
  name: string;
  type: string;
  code: string | null;
  parent_id: string | null;
  campus_id: string;
  qr_token: string;
  children: LocationNode[];
}

export async function locationTree(ctx: RequestContext, campusId?: string) {
  let q = ctx.db
    .from("locations")
    .select("id, name, type, code, parent_id, campus_id, qr_token")
    .eq("org_id", ctx.orgId)
    .is("deleted_at", null)
    .order("name");
  if (campusId) q = q.eq("campus_id", campusId);
  const rows = unwrap(await q);
  const byId = new Map<string, LocationNode>(rows.map((r) => [r.id, { ...r, children: [] }]));
  const roots: LocationNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parent_id ? byId.get(node.parent_id) : undefined;
    (parent ? parent.children : roots).push(node);
  }
  return roots;
}

// ---------------------------------------------------------------------------
// Assets: depreciation schedule & CSV import
// ---------------------------------------------------------------------------
export async function depreciationSchedule(ctx: RequestContext, assetId: string) {
  const a = unwrapMaybe(
    await ctx.db
      .from("assets")
      .select("id, purchase_cost, purchase_date, salvage_value, useful_life_months, depreciation_method, category:asset_categories!assets_category_id_fkey(wdv_rate_percent)")
      .eq("id", assetId)
      .eq("org_id", ctx.orgId)
      .maybeSingle(),
  );
  if (!a) throw ApiError.notFound("Asset");
  if (!a.purchase_cost || !a.purchase_date) return { method: a.depreciation_method, rows: [], current_value: null };
  const cost = Number(a.purchase_cost);
  const salvage = Number(a.salvage_value ?? 0);
  const start = parseISO(a.purchase_date);
  const method = a.depreciation_method ?? "none";
  const life = a.useful_life_months ?? 60;
  const rate = Number((a.category as { wdv_rate_percent: number | null } | null)?.wdv_rate_percent ?? 15) / 100;
  const rows: { year: number; period_end: string; opening: number; depreciation: number; closing: number }[] = [];
  let value = cost;
  const years = Math.ceil((method === "wdv" ? Math.max(life, 120) : life) / 12);
  for (let y = 1; y <= years && value > salvage + 0.005; y++) {
    const opening = value;
    let dep = method === "slm" ? (cost - salvage) * Math.min(12, life - (y - 1) * 12) / life : method === "wdv" ? opening * rate : 0;
    dep = Math.min(dep, opening - salvage);
    value = Math.round((opening - dep) * 100) / 100;
    rows.push({ year: y, period_end: format(addMonths(start, y * 12), "yyyy-MM-dd"), opening: round2(opening), depreciation: round2(dep), closing: value });
    if (method === "none") break;
  }
  const current = unwrap(await ctx.db.rpc("asset_book_value", { p_asset_id: assetId }));
  return { method, useful_life_months: life, age_months: differenceInMonths(new Date(), start), current_value: current, rows };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const importRow = z.object({
  name: z.string().min(1).max(200),
  campus_code: z.string().min(1),
  category_code: z.string().optional(),
  subcategory_code: z.string().optional(),
  location_code: z.string().optional(),
  asset_tag: z.string().max(60).optional(),
  make: z.string().max(100).optional(),
  model: z.string().max(100).optional(),
  serial_number: z.string().max(100).optional(),
  status: z.enum(["in_stock", "in_use", "under_repair", "disposed", "lost"]).optional(),
  purchase_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  purchase_cost: z.coerce.number().nonnegative().optional(),
  warranty_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  warranty_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  installed_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  condition: z.enum(["new", "good", "fair", "poor", "damaged"]).optional(),
  custodian_email: z.email().optional(),
});

/**
 * Bulk import assets from CSV. Columns: name, campus_code, category_code,
 * location_code, asset_tag, make, model, serial_number, status, purchase_date,
 * purchase_cost, warranty_until, custodian_email. Validates everything first;
 * with dry_run=true nothing is written.
 */
export async function importAssets(ctx: RequestContext, csv: string, dryRun: boolean) {
  await ctx.requireModule("facility");
  const raw = parseCsvObjects(csv);
  if (raw.length === 0) throw new ApiError("validation_failed", "CSV has no data rows");
  if (raw.length > 5000) throw new ApiError("validation_failed", "Import at most 5000 rows at a time");
  const [campuses, categories, locations, members] = await Promise.all([
    unwrap(await ctx.db.from("campuses").select("id, code").eq("org_id", ctx.orgId)),
    unwrap(await ctx.db.from("asset_categories").select("id, code, parent_id").eq("org_id", ctx.orgId)),
    unwrap(await ctx.db.from("locations").select("id, code, campus_id").eq("org_id", ctx.orgId).not("code", "is", null)),
    unwrap(
      await ctx.db
        .from("org_members")
        .select("user_id, profile:profiles!org_members_user_id_fkey(email)")
        .eq("org_id", ctx.orgId),
    ),
  ]);
  const errors: { row: number; message: string }[] = [];
  const inserts = [];
  for (let i = 0; i < raw.length; i++) {
    const clean = Object.fromEntries(Object.entries(raw[i]).filter(([, v]) => v !== ""));
    const parsed = importRow.safeParse(clean);
    if (!parsed.success) {
      errors.push({ row: i + 2, message: parsed.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ") });
      continue;
    }
    const r = parsed.data;
    const campus = campuses.find((c) => c.code.toUpperCase() === r.campus_code.toUpperCase());
    if (!campus) {
      errors.push({ row: i + 2, message: `Unknown campus_code ${r.campus_code}` });
      continue;
    }
    if (!(await ctx.can("asset:create", { campusId: campus.id }))) {
      errors.push({ row: i + 2, message: `No permission to create assets in campus ${r.campus_code}` });
      continue;
    }
    const category = r.category_code ? categories.find((c) => c.code === r.category_code!.toUpperCase()) : undefined;
    if (r.category_code && !category) {
      errors.push({ row: i + 2, message: `Unknown category_code ${r.category_code}` });
      continue;
    }
    const sub = r.subcategory_code ? categories.find((c) => c.code === r.subcategory_code!.toUpperCase() && c.parent_id) : undefined;
    if (r.subcategory_code && (!sub || (category && sub.parent_id !== category.id))) {
      errors.push({ row: i + 2, message: `Unknown sub-category ${r.subcategory_code}${category ? ` under ${r.category_code}` : ""}` });
      continue;
    }
    const location = r.location_code ? locations.find((l) => l.code === r.location_code && l.campus_id === campus.id) : undefined;
    if (r.location_code && !location) {
      errors.push({ row: i + 2, message: `Unknown location_code ${r.location_code} in campus ${r.campus_code}` });
      continue;
    }
    const custodian = r.custodian_email
      ? members.find((m) => (m.profile as { email: string | null } | null)?.email?.toLowerCase() === r.custodian_email!.toLowerCase())
      : undefined;
    if (r.custodian_email && !custodian) {
      errors.push({ row: i + 2, message: `No member with email ${r.custodian_email}` });
      continue;
    }
    inserts.push({
      org_id: ctx.orgId,
      campus_id: campus.id,
      category_id: category?.id ?? sub?.parent_id ?? null,
      subcategory_id: sub?.id ?? null,
      location_id: location?.id ?? null,
      custodian_id: custodian?.user_id ?? null,
      name: r.name,
      asset_tag: r.asset_tag ?? "",
      make: r.make ?? null,
      model: r.model ?? null,
      serial_number: r.serial_number ?? null,
      status: r.status ?? (custodian ? "in_use" : "in_stock"),
      purchase_date: r.purchase_date ?? null,
      purchase_cost: r.purchase_cost ?? null,
      warranty_start: r.warranty_start ?? null,
      warranty_until: r.warranty_until ?? null,
      installed_on: r.installed_on ?? null,
      condition: r.condition ?? null,
    });
  }
  if (errors.length > 0 || dryRun) {
    return { created: 0, valid_rows: inserts.length, errors, dry_run: dryRun };
  }
  const db = ctx.kind === "api_key" ? ctx.admin() : ctx.db;
  let created = 0;
  for (let i = 0; i < inserts.length; i += 500) {
    const chunk = inserts.slice(i, i + 500);
    unwrap(await db.from("assets").insert(chunk));
    created += chunk.length;
  }
  return { created, valid_rows: inserts.length, errors: [], dry_run: false };
}

// ---------------------------------------------------------------------------
// Maintenance calendar: work orders + upcoming PM + compliance
// ---------------------------------------------------------------------------
export async function maintenanceCalendar(ctx: RequestContext, from: string, to: string, campusId?: string) {
  let wo = ctx.db
    .from("work_orders")
    .select("id, number, title, type, status, priority, scheduled_for, due_at, campus_id, vendor_booking_status")
    .eq("org_id", ctx.orgId)
    .is("deleted_at", null)
    .or(`and(scheduled_for.gte.${from},scheduled_for.lte.${to}),and(due_at.gte.${from},due_at.lte.${to})`);
  let pm = ctx.db
    .from("pm_schedules")
    .select("id, title, next_due_date, frequency, campus_id, asset_id")
    .eq("org_id", ctx.orgId)
    .eq("active", true)
    .is("deleted_at", null)
    .gte("next_due_date", from.slice(0, 10))
    .lte("next_due_date", to.slice(0, 10));
  let comp = ctx.db
    .from("compliance_items")
    .select("id, title, compliance_type, next_due_on, campus_id")
    .eq("org_id", ctx.orgId)
    .is("deleted_at", null)
    .lte("next_due_on", to.slice(0, 10));
  if (campusId) {
    wo = wo.eq("campus_id", campusId);
    pm = pm.eq("campus_id", campusId);
    comp = comp.eq("campus_id", campusId);
  }
  const [w, p, c] = await Promise.all([wo, pm, comp]);
  return {
    work_orders: unwrap(w),
    pm_due: unwrap(p),
    compliance_due: unwrap(c),
  };
}

// ---------------------------------------------------------------------------
// Vendors: invitations & portal magic links
// ---------------------------------------------------------------------------
export async function createVendorPortalLink(
  ctx: RequestContext | null,
  vendorId: string,
  purpose: "onboarding" | "portal",
  opts: { orgId?: string; email?: string; days?: number } = {},
) {
  const admin = createAdminClient();
  const orgId = ctx?.orgId ?? opts.orgId!;
  const vendor = unwrapMaybe(await admin.from("vendors").select("id, name, email, org_id").eq("id", vendorId).eq("org_id", orgId).maybeSingle());
  if (!vendor) throw ApiError.notFound("Vendor");
  const email = opts.email ?? vendor.email;
  if (!email) throw new ApiError("unprocessable", "Vendor has no email address");
  const token = randomBytes(24).toString("base64url");
  unwrap(
    await admin.from("vendor_portal_tokens").insert({
      org_id: orgId,
      vendor_id: vendor.id,
      email,
      purpose,
      token_hash: sha256(token),
      expires_at: new Date(Date.now() + (opts.days ?? (purpose === "onboarding" ? 14 : 2)) * 86400_000).toISOString(),
      created_by: ctx?.userId ?? null,
    }),
  );
  const link = `${publicEnv.appUrl}/vendor-portal?token=${token}`;
  unwrap(
    await admin.from("message_outbox").insert({
      org_id: orgId,
      channel: "email",
      recipient: email,
      template: purpose === "onboarding" ? "vendor_invite" : "vendor_magic_link",
      subject: purpose === "onboarding" ? "Complete your vendor registration" : "Your vendor portal sign-in link",
      payload: { link, vendor: vendor.name },
    }),
  );
  return { link, email, expires_in_days: opts.days ?? (purpose === "onboarding" ? 14 : 2) };
}

export const vendorInviteSchema = z.object({
  name: z.string().trim().min(2).max(200),
  email: z.email().trim().toLowerCase(),
  contact_name: z.string().max(120).optional(),
  phone: z.string().max(20).optional(),
  vendor_type: z.enum(["service", "supplier", "both"]).default("service"),
  service_category_ids: z.array(z.uuid()).default([]),
  category_id: z.uuid().nullable().optional(),
  campus_ids: z.array(z.uuid()).max(100).default([]),
});

export async function inviteVendor(ctx: RequestContext, input: z.infer<typeof vendorInviteSchema>) {
  await ctx.require("vendor:create");
  const db = ctx.kind === "api_key" ? ctx.admin() : ctx.db;
  const vendor = unwrap(
    await db
      .from("vendors")
      .insert({ ...input, org_id: ctx.orgId, status: "invited" })
      .select("*")
      .single(),
  );
  const link = await createVendorPortalLink(ctx, vendor.id, "onboarding");
  return { vendor, invite: link };
}
