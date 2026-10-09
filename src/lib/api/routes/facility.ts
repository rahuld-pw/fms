import "server-only";
import { z } from "zod";
import type { RequestContext } from "@/lib/auth/context";
import { crudRoutes } from "@/lib/api/crud";
import { ApiError, unwrap, unwrapMaybe } from "@/lib/api/errors";
import { route, type RouteDef } from "@/lib/api/router";
import {
  customFields,
  gstin,
  ifsc,
  isoDate,
  money,
  name,
  optUuid,
  pan,
  priority,
} from "@/lib/schemas/common";
import {
  createVendorPortalLink,
  depreciationSchedule,
  importAssets,
  inviteVendor,
  locationTree,
  maintenanceCalendar,
  vendorInviteSchema,
} from "@/lib/services/facility";
import { getResource, rowScope, updateResource, type ResourceSpec } from "@/lib/services/resource";
import { labelsPdf, qrPng, qrSvg } from "@/lib/utils/qr";

const M = "facility" as const;

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------
const locationSchema = z.object({
  campus_id: z.uuid(),
  parent_id: optUuid,
  type: z.enum(["building", "floor", "room", "area"]),
  name,
  code: z.string().trim().max(40).nullable().optional(),
  description: z.string().max(1000).nullable().optional(),
  capacity: z.number().int().nonnegative().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export const locations: ResourceSpec = {
  name: "locations",
  memberRead: true,
  entityType: "location",
  table: "locations",
  module: [M, "po"],
  permission: "location",
  campusColumn: "campus_id",
  select: "*, campus:campuses(id, name, code)",
  filters: { campus_id: "eq", parent_id: "eq", type: "in" },
  sortable: ["name", "created_at", "type"],
  defaultSort: "name",
  search: ["name", "code"],
  softDelete: true,
  createSchema: locationSchema,
  updateSchema: locationSchema.omit({ campus_id: true }).partial(),
  csvColumns: [["name", "Name"], ["type", "Type"], ["code", "Code"], ["campus.name", "Campus"], ["path_names", "Path"], ["qr_token", "QR token"]],
};

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------
const issueCreate = z.object({
  campus_id: z.uuid().optional(),
  location_id: optUuid,
  asset_id: optUuid,
  category_id: optUuid,
  department_id: optUuid,
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(5000).nullable().optional(),
  priority: priority.optional(),
  source: z.enum(["web", "mobile", "qr", "api", "email"]).optional(),
  assignee_id: optUuid,
  vendor_id: optUuid,
  reporter_id: optUuid,
  /** Hide the reporter from everyone except organisation admins. */
  is_anonymous: z.boolean().optional(),
  custom_fields: customFields,
});
const issueUpdate = z
  .object({
    title: z.string().trim().min(3).max(200),
    description: z.string().trim().max(5000).nullable(),
    priority,
    category_id: z.uuid().nullable(),
    location_id: z.uuid().nullable(),
    asset_id: z.uuid().nullable(),
    department_id: z.uuid().nullable(),
    assignee_id: z.uuid().nullable(),
    vendor_id: z.uuid().nullable(),
    status: z.enum(["open", "acknowledged", "assigned", "in_progress", "on_hold", "resolved", "closed", "reopened", "cancelled"]),
    resolution_notes: z.string().max(5000).nullable(),
    rating: z.number().int().min(1).max(5),
    feedback: z.string().max(2000).nullable(),
    custom_fields: customFields,
  })
  .partial();

export const issues: ResourceSpec = {
  name: "issues",
  ownerColumns: ["reporter_id", "assignee_id"],
  ownerCanUpdate: true,
  ownCreate: { permission: "issue:report", column: "reporter_id" },
  entityType: "issue",
  table: "issues",
  module: M,
  permission: "issue",
  campusColumn: "campus_id",
  departmentColumn: "department_id",
  select:
    "*, campus:campuses(id, name, code), category:issue_categories(id, name), location:locations(id, name, path_names), assignee:profiles!issues_assignee_id_fkey(id, full_name), reporter:profiles!issues_reporter_id_fkey(id, full_name), vendor:vendors(id, name), reported_by_me",
  detailSelect:
    "*, campus:campuses(id, name, code), category:issue_categories(id, name), location:locations(id, name, path_names, qr_token), asset:assets(id, name, asset_tag), assignee:profiles!issues_assignee_id_fkey(id, full_name, email), reporter:profiles!issues_reporter_id_fkey(id, full_name, email), resolver:profiles!issues_resolved_by_fkey(id, full_name), vendor:vendors(id, name, phone), work_order:work_orders!issues_work_order_id_fkey(id, number, status), reported_by_me, confidential_reporter:issue_reporter_identities(user_id, profile:profiles(id, full_name, email))",
  filters: {
    status: "in",
    priority: "in",
    campus_id: "eq",
    category_id: "eq",
    location_id: "eq",
    asset_id: "eq",
    assignee_id: "user",
    reporter_id: "user",
    vendor_id: "eq",
    department_id: "eq",
    source: "in",
    is_anonymous: "bool",
    escalation_level: "eq",
    created_at: "range",
    resolution_due_at: "range",
  },
  sortable: ["created_at", "updated_at", "resolution_due_at", "priority", "number", "status"],
  defaultSort: "-created_at",
  search: ["title", "number"],
  softDelete: true,
  customFields: true,
  placeholders: { number: "" },
  createSchema: issueCreate,
  updateSchema: issueUpdate,
  prepareCreate: async (ctx, input) => {
    // People report as themselves; reporting on behalf of others needs issue:create.
    // Anonymous reports are always your own (the database hides the name).
    if (input.is_anonymous) {
      if (ctx.kind !== "user") throw new ApiError("bad_request", "Anonymous reports are made by signed-in users");
      if (input.reporter_id && input.reporter_id !== ctx.userId) throw new ApiError("validation_failed", "Anonymous reports can only be made as yourself");
      input.reporter_id = ctx.userId;
    } else if (!input.reporter_id || input.reporter_id === ctx.userId) input.reporter_id = ctx.userId;
    else await ctx.require("issue:create", { campusId: input.campus_id });
    if (!input.campus_id && !input.location_id) throw new ApiError("validation_failed", "campus_id or location_id is required");
    if (!input.campus_id) {
      const loc = unwrapMaybe(await ctx.db.from("locations").select("campus_id").eq("id", input.location_id).maybeSingle());
      if (!loc) throw new ApiError("validation_failed", "Unknown location");
      input.campus_id = loc.campus_id;
    }
    input.priority ??= null; // category default applies
    return input;
  },
  csvColumns: [
    ["number", "Number"], ["title", "Title"], ["status", "Status"], ["priority", "Priority"], ["campus.name", "Campus"],
    ["category.name", "Category"], ["location.name", "Location"], ["assignee.full_name", "Assignee"], ["vendor.name", "Vendor"],
    ["created_at", "Created"], ["response_due_at", "Response due"], ["resolution_due_at", "Resolution due"],
    ["resolved_at", "Resolved"], ["escalation_level", "Escalation"], ["rating", "Rating"],
  ],
};

const issueCategorySchema = z.object({
  name,
  parent_id: optUuid,
  description: z.string().max(500).nullable().optional(),
  icon: z.string().max(40).nullable().optional(),
  default_priority: priority.default("medium"),
  response_minutes: z.number().int().positive().nullable().optional(),
  resolution_minutes: z.number().int().positive().nullable().optional(),
  default_assignee_id: optUuid,
  default_vendor_id: optUuid,
  service_category_id: optUuid,
  auto_create: z.enum(["none", "task", "work_order"]).default("none"),
  public_visible: z.boolean().default(true),
  active: z.boolean().default(true),
  position: z.number().int().default(0),
});
export const issueCategories: ResourceSpec = {
  name: "issue-categories",
  memberRead: true,
  entityType: "issue_category",
  table: "issue_categories",
  module: M,
  permission: "issue",
  readPermission: "issue:report",
  createPermission: "issue:configure",
  updatePermission: "issue:configure",
  deletePermission: "issue:configure",
  filters: { active: "bool", public_visible: "bool" },
  sortable: ["position", "name"],
  defaultSort: "position",
  search: ["name"],
  createSchema: issueCategorySchema,
  updateSchema: issueCategorySchema.partial(),
};

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------
const assetSchema = z.object({
  campus_id: z.uuid(),
  location_id: optUuid,
  department_id: optUuid,
  category_id: optUuid,
  subcategory_id: optUuid,
  asset_tag: z.string().trim().max(60).optional(),
  name,
  description: z.string().max(2000).nullable().optional(),
  make: z.string().max(100).nullable().optional(),
  model: z.string().max(100).nullable().optional(),
  serial_number: z.string().max(100).nullable().optional(),
  status: z.enum(["in_stock", "in_use", "under_repair", "disposed", "lost"]).optional(),
  condition: z.enum(["new", "good", "fair", "poor", "damaged"]).nullable().optional(),
  custodian_id: optUuid,
  purchase_date: isoDate.nullable().optional(),
  purchase_cost: money.nullable().optional(),
  vendor_id: optUuid,
  po_id: optUuid,
  invoice_number: z.string().max(60).nullable().optional(),
  warranty_start: isoDate.nullable().optional(),
  warranty_until: isoDate.nullable().optional(),
  installed_on: isoDate.nullable().optional(),
  amc_contract_id: optUuid,
  depreciation_method: z.enum(["none", "slm", "wdv"]).nullable().optional(),
  useful_life_months: z.number().int().positive().nullable().optional(),
  salvage_value: money.nullable().optional(),
  usage_meter: z.number().nonnegative().optional(),
  usage_unit: z.string().max(20).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  custom_fields: customFields,
});
export const assets: ResourceSpec = {
  name: "assets",
  ownerColumns: ["custodian_id"],
  entityType: "asset",
  table: "assets",
  module: M,
  permission: "asset",
  campusColumn: "campus_id",
  departmentColumn: "department_id",
  select:
    "*, campus:campuses(id, name, code), category:asset_categories!assets_category_id_fkey(id, name, code), subcategory:subcategory(id, name), location:locations(id, name, path_names), custodian:profiles!assets_custodian_id_fkey(id, full_name)",
  detailSelect:
    "*, campus:campuses(id, name, code), category:asset_categories!assets_category_id_fkey(*), subcategory:subcategory(id, name, code), location:locations(id, name, type, path_names, parent_id), custodian:profiles!assets_custodian_id_fkey(id, full_name, email), vendor:vendors(id, name), amc:amc_contracts!assets_amc_contract_id_fkey(id, title, end_date), purchase_order:purchase_orders!assets_po_fk(id, number), grn:grns!assets_grn_fk(id, number)",
  filters: {
    status: "in",
    condition: "in",
    campus_id: "eq",
    category_id: "eq",
    subcategory_id: "eq",
    location_id: "eq",
    custodian_id: "user",
    department_id: "eq",
    vendor_id: "eq",
    warranty_until: "range",
    purchase_date: "range",
  },
  sortable: ["created_at", "name", "asset_tag", "purchase_date", "warranty_until", "purchase_cost"],
  defaultSort: "-created_at",
  search: ["name", "asset_tag", "serial_number", "model"],
  softDelete: true,
  customFields: true,
  placeholders: { asset_tag: "" },
  createSchema: assetSchema,
  updateSchema: assetSchema.partial(),
  csvColumns: [
    ["asset_tag", "Asset tag"], ["name", "Name"], ["status", "Status"], ["condition", "Condition"], ["category.name", "Category"],
    ["subcategory.name", "Sub-category"], ["campus.name", "Campus"], ["location.name", "Location"], ["custodian.full_name", "Custodian"],
    ["make", "Make"], ["model", "Model"], ["serial_number", "Serial"], ["purchase_date", "Purchase date"], ["purchase_cost", "Cost"],
    ["installed_on", "Installed on"], ["warranty_start", "Warranty start"], ["warranty_until", "Warranty until"],
  ],
};

const assetCategorySchema = z.object({
  name,
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,8}$/),
  parent_id: optUuid,
  depreciation_method: z.enum(["none", "slm", "wdv"]).default("slm"),
  useful_life_months: z.number().int().positive().nullable().optional(),
  wdv_rate_percent: z.number().min(0).max(100).nullable().optional(),
  salvage_percent: z.number().min(0).max(100).default(5),
  verification_frequency_months: z.number().int().positive().nullable().optional(),
});
export const assetCategories: ResourceSpec = {
  name: "asset-categories",
  memberRead: true,
  entityType: "asset_category",
  table: "asset_categories",
  module: M,
  permission: "asset",
  createPermission: "asset:configure",
  updatePermission: "asset:configure",
  deletePermission: "asset:configure",
  select: "*, parent:asset_categories!asset_categories_parent_id_fkey(id, name)",
  filters: { parent_id: "eq" },
  sortable: ["name", "code"],
  defaultSort: "name",
  search: ["name", "code"],
  createSchema: assetCategorySchema,
  updateSchema: assetCategorySchema.partial(),
};

export const assetTransfers: ResourceSpec = {
  name: "asset-transfers",
  entityType: "asset_transfer",
  table: "asset_transfers",
  module: M,
  permission: "asset",
  readPermission: "asset:read",
  createPermission: "asset:transfer",
  updatePermission: "asset:transfer",
  campusColumn: "from_campus_id",
  select:
    "*, asset:assets(id, name, asset_tag), from_campus:campuses!asset_transfers_from_campus_id_fkey(name), to_campus:campuses!asset_transfers_to_campus_id_fkey(name), to_location:locations!asset_transfers_to_location_id_fkey(name, path_names), from_location:locations!asset_transfers_from_location_id_fkey(name, path_names), from_custodian:profiles!asset_transfers_from_custodian_id_fkey(full_name), requester:profiles!asset_transfers_requested_by_fkey(full_name), decider:profiles!asset_transfers_decided_by_fkey(full_name), to_custodian:profiles!asset_transfers_to_custodian_id_fkey(full_name)",
  filters: { asset_id: "eq", status: "in", from_campus_id: "eq", to_campus_id: "eq" },
  sortable: ["created_at"],
  defaultSort: "-created_at",
  createSchema: z.object({
    asset_id: z.uuid(),
    to_campus_id: z.uuid().optional(),
    to_location_id: optUuid,
    to_custodian_id: optUuid,
    to_department_id: optUuid,
    reason: z.string().max(500).nullable().optional(),
  }),
  prepareCreate: async (ctx, input) => {
    const a = unwrapMaybe(
      await ctx.db.from("assets").select("campus_id, location_id, custodian_id, department_id").eq("id", input.asset_id).maybeSingle(),
    );
    if (!a) throw ApiError.notFound("Asset");
    return {
      ...input,
      from_campus_id: a.campus_id,
      to_campus_id: input.to_campus_id ?? a.campus_id,
      from_location_id: a.location_id,
      from_custodian_id: a.custodian_id,
      from_department_id: a.department_id,
      requested_by: ctx.userId,
    };
  },
};

const auditSchema = z.object({
  campus_id: z.uuid(),
  location_id: optUuid,
  category_id: optUuid,
  name,
  scheduled_for: isoDate.optional(),
});
export const assetAudits: ResourceSpec = {
  name: "asset-audits",
  entityType: "asset_audit",
  table: "asset_verification_audits",
  module: M,
  permission: "asset_audit",
  campusColumn: "campus_id",
  select: "*, campus:campuses(id, name), location:locations(id, name)",
  filters: { campus_id: "eq", status: "in" },
  sortable: ["scheduled_for", "created_at"],
  defaultSort: "-scheduled_for",
  search: ["name"],
  createSchema: auditSchema,
  updateSchema: auditSchema.omit({ campus_id: true }).extend({ status: z.enum(["planned", "in_progress", "completed", "cancelled"]) }).partial(),
};

// ---------------------------------------------------------------------------
// Vendors
// ---------------------------------------------------------------------------
const vendorSchema = z.object({
  name,
  legal_name: z.string().max(200).nullable().optional(),
  vendor_type: z.enum(["service", "supplier", "both"]).optional(),
  contact_name: z.string().max(120).nullable().optional(),
  email: z.email().nullable().optional(),
  phone: z.string().max(20).nullable().optional(),
  website: z.string().max(200).nullable().optional(),
  address: z.string().max(500).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  state: z.string().max(100).nullable().optional(),
  pincode: z.string().max(10).nullable().optional(),
  gstin: gstin.nullable().optional(),
  pan: pan.nullable().optional(),
  msme_number: z.string().max(40).nullable().optional(),
  bank_account_name: z.string().max(120).nullable().optional(),
  bank_account_number: z.string().regex(/^[0-9]{6,20}$/).nullable().optional(),
  bank_ifsc: ifsc.nullable().optional(),
  bank_name: z.string().max(120).nullable().optional(),
  payment_terms_days: z.number().int().min(0).max(365).optional(),
  service_category_ids: z.array(z.uuid()).optional(),
  category_id: optUuid,
  campus_ids: z.array(z.uuid()).max(100).optional(),
  service_area: z.string().max(500).nullable().optional(),
  contract_type: z.enum(["amc", "rate_contract", "annual", "retainer", "on_call", "one_time", "other"]).nullable().optional(),
  contract_start: isoDate.nullable().optional(),
  contract_end: isoDate.nullable().optional(),
  contract_value: money.nullable().optional(),
  sla_response_hours: z.number().positive().max(10000).nullable().optional(),
  sla_resolution_hours: z.number().positive().max(10000).nullable().optional(),
  sla_terms: z.string().max(2000).nullable().optional(),
  penalty_terms: z.string().max(2000).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  custom_fields: customFields,
});
export const vendors: ResourceSpec = {
  name: "vendors",
  entityType: "vendor",
  table: "vendors",
  module: [M, "po"],
  permission: "vendor",
  select: "id, org_id, vendor_code, name, status, vendor_type, contact_name, email, phone, city, gstin, rating_avg, rating_count, service_category_ids, category_id, campus_ids, contract_type, contract_end, created_at, updated_at, category:service_categories(id, name)",
  detailSelect: "*, category:service_categories(id, name)",
  filters: { status: "in", vendor_type: "in", service_category_ids: "contains", category_id: "eq", campus_ids: "contains", contract_type: "in", contract_end: "range", city: "eq" },
  sortable: ["name", "created_at", "rating_avg", "vendor_code", "contract_end"],
  defaultSort: "name",
  search: ["name", "legal_name", "gstin", "vendor_code", "email"],
  softDelete: true,
  customFields: true,
  createSchema: vendorSchema,
  updateSchema: vendorSchema.partial(),
  csvColumns: [
    ["vendor_code", "Code"], ["name", "Name"], ["status", "Status"], ["vendor_type", "Type"], ["contact_name", "Contact"],
    ["email", "Email"], ["phone", "Phone"], ["city", "City"], ["gstin", "GSTIN"], ["rating_avg", "Rating"], ["category.name", "Category"],
    ["contract_type", "Contract type"], ["contract_end", "Contract end"],
  ],
};

export const serviceCategories: ResourceSpec = {
  name: "service-categories",
  memberRead: true,
  entityType: "service_category",
  table: "service_categories",
  module: M,
  permission: "vendor",
  createPermission: "vendor:update",
  updatePermission: "vendor:update",
  deletePermission: "vendor:update",
  sortable: ["name"],
  defaultSort: "name",
  createSchema: z.object({ name }),
  updateSchema: z.object({ name }),
};

// ---------------------------------------------------------------------------
// Work orders, PM, AMC, compliance
// ---------------------------------------------------------------------------
const checklistItem = z.object({
  key: z.string().max(60),
  label: z.string().max(200),
  type: z.enum(["check", "number", "text", "photo"]).default("check"),
  required: z.boolean().default(false),
  result: z.union([z.boolean(), z.number(), z.string()]).nullable().optional(),
  note: z.string().max(500).nullable().optional(),
});
const workOrderSchema = z.object({
  campus_id: z.uuid(),
  title: z.string().trim().min(3).max(200),
  description: z.string().max(5000).nullable().optional(),
  type: z.enum(["corrective", "preventive", "inspection", "compliance", "installation"]).default("corrective"),
  priority: priority.default("medium"),
  asset_id: optUuid,
  location_id: optUuid,
  issue_id: optUuid,
  assignee_id: optUuid,
  vendor_id: optUuid,
  amc_contract_id: optUuid,
  checklist_template_id: optUuid,
  scheduled_for: z.iso.datetime({ offset: true }).nullable().optional(),
  due_at: z.iso.datetime({ offset: true }).nullable().optional(),
  custom_fields: customFields,
});
export const workOrders: ResourceSpec = {
  name: "work-orders",
  ownerColumns: ["assignee_id", "created_by"],
  ownerCanUpdate: true,
  entityType: "work_order",
  table: "work_orders",
  module: M,
  permission: "work_order",
  campusColumn: "campus_id",
  select:
    "*, campus:campuses(id, name, code), asset:assets(id, name, asset_tag), location:locations(id, name, path_names), assignee:profiles!work_orders_assignee_id_fkey(id, full_name), vendor:vendors(id, name)",
  filters: {
    status: "in",
    type: "in",
    priority: "in",
    campus_id: "eq",
    assignee_id: "user",
    vendor_id: "eq",
    asset_id: "eq",
    issue_id: "eq",
    pm_schedule_id: "eq",
    vendor_booking_status: "in",
    due_at: "range",
    scheduled_for: "range",
  },
  sortable: ["created_at", "due_at", "scheduled_for", "priority", "number"],
  defaultSort: "-created_at",
  search: ["title", "number"],
  softDelete: true,
  customFields: true,
  placeholders: { number: "" },
  createSchema: workOrderSchema,
  updateSchema: workOrderSchema
    .omit({ campus_id: true, issue_id: true })
    .extend({
      status: z.enum(["open", "scheduled", "in_progress", "on_hold", "completed", "verified", "cancelled"]),
      checklist: z.array(checklistItem).max(200),
      completion_notes: z.string().max(5000).nullable(),
      labour_cost: money.nullable(),
      material_cost: money.nullable(),
      vendor_booking_status: z.enum(["not_required", "requested", "confirmed", "declined", "rescheduled", "completed"]),
      vendor_booking_note: z.string().max(1000).nullable(),
    })
    .partial(),
  csvColumns: [
    ["number", "Number"], ["title", "Title"], ["type", "Type"], ["status", "Status"], ["priority", "Priority"], ["campus.name", "Campus"],
    ["asset.asset_tag", "Asset"], ["assignee.full_name", "Assignee"], ["vendor.name", "Vendor"], ["scheduled_for", "Scheduled"],
    ["due_at", "Due"], ["completed_at", "Completed"], ["labour_cost", "Labour"], ["material_cost", "Material"],
  ],
};

const checklistTemplateSchema = z.object({
  name,
  description: z.string().max(1000).nullable().optional(),
  items: z.array(checklistItem.omit({ result: true, note: true })).max(200),
  active: z.boolean().default(true),
});
export const checklistTemplates: ResourceSpec = {
  name: "checklist-templates",
  memberRead: true,
  entityType: "checklist_template",
  table: "checklist_templates",
  module: M,
  permission: "pm",
  sortable: ["name", "created_at"],
  defaultSort: "name",
  search: ["name"],
  createSchema: checklistTemplateSchema,
  updateSchema: checklistTemplateSchema.partial(),
};

const pmSchema = z
  .object({
    campus_id: z.uuid(),
    asset_id: optUuid,
    location_id: optUuid,
    title: z.string().trim().min(3).max(200),
    description: z.string().max(2000).nullable().optional(),
    trigger_type: z.enum(["time", "usage"]).default("time"),
    frequency: z.enum(["daily", "weekly", "monthly", "quarterly", "half_yearly", "yearly", "custom_days"]).nullable().optional(),
    interval_days: z.number().int().positive().nullable().optional(),
    next_due_date: isoDate.nullable().optional(),
    lead_days: z.number().int().min(0).max(90).default(3),
    usage_interval: z.number().positive().nullable().optional(),
    checklist_template_id: optUuid,
    assignee_id: optUuid,
    vendor_id: optUuid,
    amc_contract_id: optUuid,
    priority: priority.default("medium"),
    requires_vendor_booking: z.boolean().default(false),
    estimated_minutes: z.number().int().positive().nullable().optional(),
    active: z.boolean().default(true),
  });
export const pmSchedules: ResourceSpec = {
  name: "pm-schedules",
  entityType: "pm_schedule",
  table: "pm_schedules",
  module: M,
  permission: "pm",
  campusColumn: "campus_id",
  select:
    "*, campus:campuses(id, name), asset:assets(id, name, asset_tag), location:locations(id, name), assignee:profiles!pm_schedules_assignee_id_fkey(id, full_name), vendor:vendors(id, name)",
  filters: { campus_id: "eq", asset_id: "eq", active: "bool", trigger_type: "eq", next_due_date: "range" },
  sortable: ["next_due_date", "title", "created_at"],
  defaultSort: "next_due_date",
  search: ["title"],
  softDelete: true,
  createSchema: pmSchema.refine((v) => v.asset_id || v.location_id, "asset_id or location_id is required"),
  updateSchema: pmSchema.omit({ campus_id: true }).partial(),
};

const amcSchema = z.object({
  campus_id: optUuid,
  vendor_id: z.uuid(),
  title: name,
  contract_number: z.string().max(60).nullable().optional(),
  contract_type: z.enum(["comprehensive", "non_comprehensive", "labour_only"]).default("comprehensive"),
  coverage: z.string().max(2000).nullable().optional(),
  start_date: isoDate,
  end_date: isoDate,
  value: money.nullable().optional(),
  visits_included: z.number().int().min(0).default(0),
  visit_frequency: z.enum(["monthly", "quarterly", "half_yearly", "yearly", "on_call"]).nullable().optional(),
  renewal_reminder_days: z.number().int().min(0).max(365).default(45),
  status: z.enum(["draft", "active", "expired", "renewed", "terminated"]).default("active"),
  po_id: optUuid,
  notes: z.string().max(2000).nullable().optional(),
});
export const amcContracts: ResourceSpec = {
  name: "amc-contracts",
  entityType: "amc_contract",
  table: "amc_contracts",
  module: M,
  permission: "amc",
  campusColumn: "campus_id",
  select: "*, vendor:vendors(id, name), campus:campuses(id, name), assets:amc_contract_assets(asset_id)",
  filters: { vendor_id: "eq", campus_id: "eq", status: "in", end_date: "range" },
  sortable: ["end_date", "start_date", "title", "created_at"],
  defaultSort: "end_date",
  search: ["title", "contract_number"],
  softDelete: true,
  createSchema: amcSchema,
  updateSchema: amcSchema.partial(),
};

const complianceSchema = z.object({
  campus_id: z.uuid(),
  location_id: optUuid,
  asset_id: optUuid,
  title: name,
  compliance_type: z.enum(["fire_safety", "lift", "water_tank", "electrical", "pest_control", "dg_set", "building_safety",
    "pollution", "food_safety", "transport", "other"]),
  authority: z.string().max(200).nullable().optional(),
  certificate_number: z.string().max(100).nullable().optional(),
  frequency_months: z.number().int().positive().default(12),
  last_done_on: isoDate.nullable().optional(),
  next_due_on: isoDate,
  reminder_days: z.number().int().min(0).max(365).default(30),
  responsible_user_id: optUuid,
  vendor_id: optUuid,
  auto_create_work_order: z.boolean().default(true),
  notes: z.string().max(2000).nullable().optional(),
});
export const complianceItems: ResourceSpec = {
  name: "compliance-items",
  ownerColumns: ["responsible_user_id"],
  entityType: "compliance_item",
  table: "compliance_items",
  module: M,
  permission: "compliance",
  campusColumn: "campus_id",
  select: "*, campus:campuses(id, name), responsible:profiles!compliance_items_responsible_user_id_fkey(id, full_name), vendor:vendors(id, name)",
  filters: { campus_id: "eq", compliance_type: "in", next_due_on: "range", responsible_user_id: "user" },
  sortable: ["next_due_on", "title"],
  defaultSort: "next_due_on",
  search: ["title", "certificate_number"],
  softDelete: true,
  createSchema: complianceSchema,
  updateSchema: complianceSchema.partial(),
  csvColumns: [["title", "Title"], ["compliance_type", "Type"], ["campus.name", "Campus"], ["authority", "Authority"],
    ["last_done_on", "Last done"], ["next_due_on", "Next due"], ["responsible.full_name", "Responsible"], ["vendor.name", "Vendor"]],
};

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
const pdfResponse = (bytes: Uint8Array, filename: string) =>
  new Response(Buffer.from(bytes), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${filename}"` } });

const vendorDocSchema = z.object({
  doc_type: z.enum(["gst_certificate", "pan_card", "cancelled_cheque", "msme_certificate", "incorporation", "insurance", "license", "agreement", "contract", "sla", "work_completion", "other"]),
  title: z.string().max(200).nullable().optional(),
  doc_number: z.string().max(80).nullable().optional(),
  attachment_id: optUuid,
  issued_on: isoDate.nullable().optional(),
  expires_on: isoDate.nullable().optional(),
});

const agreementSchema = z.object({
  title: name,
  agreement_type: z.enum(["service", "supply", "nda", "rate_contract", "other"]).default("service"),
  start_date: isoDate,
  end_date: isoDate.nullable().optional(),
  value: money.nullable().optional(),
  auto_renew: z.boolean().default(false),
  renewal_reminder_days: z.number().int().min(0).max(365).default(30),
  status: z.enum(["draft", "active", "expired", "terminated", "renewed"]).default("active"),
  attachment_id: optUuid,
  notes: z.string().max(2000).nullable().optional(),
});

const warrantySchema = z.object({
  warranty_type: z.enum(["extended", "additional", "manufacturer", "insurance", "other"]).default("extended"),
  provider: z.string().trim().max(200).nullable().optional(),
  vendor_id: optUuid,
  reference_number: z.string().trim().max(100).nullable().optional(),
  start_date: isoDate,
  end_date: isoDate,
  cost: money.nullable().optional(),
  coverage: z.string().max(2000).nullable().optional(),
  attachment_id: optUuid,
  notes: z.string().max(2000).nullable().optional(),
});

/** API keys bypass RLS, so their writes run as admin after the explicit permission checks. */
const assetDb = (ctx: RequestContext) => (ctx.kind === "api_key" ? ctx.admin() : ctx.db);

export const facilityRoutes: RouteDef[] = [
  route({
    method: "GET",
    path: "/facility/dashboard",
    summary: "Facility KPIs: issues, SLA, work orders, PM, assets, compliance",
    tags: ["facility"],
    module: M,
    permission: "issue:read",
    handler: async ({ ctx, query }) =>
      unwrap(await ctx.db.rpc("facility_dashboard", { p_org: ctx.orgId, p_campus: query.get("campus_id") ?? undefined })),
  }),

  // Locations
  route({
    method: "GET",
    path: "/locations/tree",
    summary: "Location hierarchy (building > floor > room)",
    tags: ["locations"],
    module: M,
    handler: ({ ctx, query }) => locationTree(ctx, query.get("campus_id") ?? undefined),
  }),
  ...crudRoutes(locations),
  route({
    method: "GET",
    path: "/qr/:token/svg",
    summary: "QR code image (SVG) for a location or asset token",
    tags: ["locations"],
    module: M,
    handler: async ({ params }) =>
      new Response(await qrSvg(params.token), { headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=86400" } }),
  }),
  route({
    method: "GET",
    path: "/qr/:token/png",
    summary: "QR code image (PNG) for a location or asset token",
    tags: ["locations"],
    module: M,
    handler: async ({ params }) =>
      new Response(new Uint8Array(await qrPng(params.token, 600)), { headers: { "content-type": "image/png", "cache-control": "public, max-age=86400" } }),
  }),
  route({
    method: "POST",
    path: "/qr/labels",
    summary: "Printable PDF sheet of QR labels for locations or assets",
    tags: ["locations"],
    module: M,
    response: "pdf",
    status: 200,
    body: z.object({ kind: z.enum(["location", "asset"]), ids: z.array(z.uuid()).min(1).max(500) }),
    handler: async ({ ctx, body }) => {
      const labels =
        body.kind === "location"
          ? unwrap(await ctx.db.from("locations").select("qr_token, name, path_names").in("id", body.ids).eq("org_id", ctx.orgId)).map((l) => ({
              token: l.qr_token,
              title: l.name,
              subtitle: l.path_names.join(" / "),
            }))
          : unwrap(await ctx.db.from("assets").select("qr_token, name, asset_tag").in("id", body.ids).eq("org_id", ctx.orgId)).map((a) => ({
              token: a.qr_token,
              title: a.asset_tag,
              subtitle: a.name,
            }));
      return pdfResponse(await labelsPdf(labels, ctx.org.name), `qr-labels-${body.kind}.pdf`);
    },
  }),

  // Issues
  ...crudRoutes(issues),
  ...crudRoutes(issueCategories, { tag: "issues", ops: ["list", "get", "create", "update", "delete"] }),
  route({
    method: "POST",
    path: "/issues/:id/transition",
    summary: "Move an issue through its workflow (with optional note)",
    tags: ["issues"],
    module: M,
    status: 200,
    body: z.object({
      status: z.enum(["acknowledged", "assigned", "in_progress", "on_hold", "resolved", "closed", "reopened", "cancelled", "open"]),
      note: z.string().trim().max(5000).optional(),
      internal: z.boolean().default(false),
    }),
    handler: async ({ ctx, params, body }) => {
      const patch: Record<string, unknown> = { status: body.status };
      if (body.status === "resolved" && body.note) patch.resolution_notes = body.note;
      const issue = await updateResource(ctx, issues, params.id, patch);
      if (body.note) {
        const db = ctx.kind === "api_key" ? ctx.admin() : ctx.db;
        unwrap(
          await db.from("comments").insert({
            org_id: ctx.orgId, entity_type: "issue", entity_id: params.id, body: body.note, is_internal: body.internal, author_id: ctx.userId,
          }),
        );
      }
      return issue;
    },
  }),
  route({
    method: "POST",
    path: "/issues/:id/assign",
    summary: "Assign an issue to staff and/or a vendor",
    tags: ["issues"],
    module: M,
    status: 200,
    body: z.object({ assignee_id: z.uuid().nullable().optional(), vendor_id: z.uuid().nullable().optional() }),
    handler: ({ ctx, params, body }) => updateResource(ctx, issues, params.id, body),
  }),
  route({
    method: "POST",
    path: "/issues/:id/work-order",
    summary: "Create a work order from an issue",
    tags: ["issues"],
    module: M,
    body: z.object({ assignee_id: optUuid, vendor_id: optUuid, scheduled_for: z.iso.datetime({ offset: true }).optional() }),
    handler: async ({ ctx, params, body }) => {
      const issue = await getResource(ctx, issues, params.id);
      if (issue.work_order_id) throw new ApiError("conflict", "This issue already has a work order");
      await ctx.require("work_order:create", { campusId: issue.campus_id });
      const db = ctx.kind === "api_key" ? ctx.admin() : ctx.db;
      const wo = unwrap(
        await db
          .from("work_orders")
          .insert({
            org_id: ctx.orgId, campus_id: issue.campus_id, number: "", title: issue.title, description: issue.description, type: "corrective",
            priority: issue.priority, asset_id: issue.asset_id, location_id: issue.location_id, issue_id: issue.id,
            assignee_id: body.assignee_id ?? issue.assignee_id, vendor_id: body.vendor_id ?? issue.vendor_id,
            scheduled_for: body.scheduled_for ?? null, due_at: issue.resolution_due_at,
          })
          .select("*")
          .single(),
      );
      unwrap(await ctx.admin().from("issues").update({ work_order_id: wo.id }).eq("id", issue.id));
      return wo;
    },
  }),
  route({
    method: "POST",
    path: "/issues/:id/task",
    summary: "Create a linked task from an issue",
    tags: ["issues"],
    module: M,
    body: z.object({ project_id: optUuid, assignee_ids: z.array(z.uuid()).max(10).default([]), due_date: isoDate.optional() }),
    handler: async ({ ctx, params, body }) => {
      await ctx.requireModule("tasks");
      const issue = await getResource(ctx, issues, params.id);
      const db = ctx.kind === "api_key" ? ctx.admin() : ctx.db;
      const task = unwrap(
        await db
          .from("tasks")
          .insert({
            org_id: ctx.orgId, project_id: body.project_id ?? null, title: `${issue.number}: ${issue.title}`, description: issue.description,
            priority: issue.priority === "critical" ? "urgent" : issue.priority, due_date: body.due_date ?? issue.resolution_due_at?.slice(0, 10),
            created_by: ctx.userId,
          })
          .select("*")
          .single(),
      );
      if (body.assignee_ids.length)
        unwrap(await db.from("task_assignees").insert(body.assignee_ids.map((u) => ({ task_id: task.id, user_id: u, org_id: ctx.orgId }))));
      unwrap(await db.from("task_links").insert({ org_id: ctx.orgId, task_id: task.id, entity_type: "issue", entity_id: issue.id }));
      unwrap(await ctx.admin().from("issues").update({ task_id: task.id }).eq("id", issue.id));
      return task;
    },
  }),

  // Assets
  ...crudRoutes(assets),
  ...crudRoutes(assetCategories, { tag: "assets", ops: ["list", "get", "create", "update", "delete"] }),
  route({
    method: "POST",
    path: "/assets/import",
    summary: "Bulk import assets from CSV (use dry_run to validate)",
    description:
      "Body: `{ csv, dry_run }`. Columns: name, campus_code, category_code, subcategory_code, location_code, asset_tag, make, model, serial_number, status, condition, purchase_date, purchase_cost, installed_on, warranty_start, warranty_until, custodian_email.",
    tags: ["assets"],
    module: M,
    status: 200,
    body: z.object({ csv: z.string().min(1).max(5_000_000), dry_run: z.boolean().default(true) }),
    handler: ({ ctx, body }) => importAssets(ctx, body.csv, body.dry_run),
  }),
  route({
    method: "GET",
    path: "/assets/:id/depreciation",
    summary: "Depreciation schedule and current book value",
    tags: ["assets"],
    module: M,
    handler: async ({ ctx, params }) => {
      await getResource(ctx, assets, params.id);
      return depreciationSchedule(ctx, params.id);
    },
  }),
  route({
    method: "POST",
    path: "/assets/:id/dispose",
    summary: "Dispose an asset",
    tags: ["assets"],
    module: M,
    status: 200,
    body: z.object({
      disposal_method: z.enum(["sold", "scrapped", "donated", "written_off", "returned"]),
      disposal_value: money.nullable().optional(),
      disposal_reason: z.string().trim().min(3).max(1000),
      disposed_at: isoDate.optional(),
    }),
    handler: async ({ ctx, params, body }) => {
      const a = await getResource(ctx, assets, params.id);
      await ctx.require("asset:delete", { campusId: a.campus_id, departmentId: a.department_id });
      return updateResource(ctx, assets, params.id, {
        ...body,
        status: "disposed",
        disposed_at: body.disposed_at ?? new Date().toISOString().slice(0, 10),
        custodian_id: null,
      } as never);
    },
  }),
  route({
    method: "GET",
    path: "/assets/:id/warranties",
    summary: "Extended and additional warranties on an asset",
    tags: ["assets"],
    module: M,
    handler: async ({ ctx, params }) => {
      await getResource(ctx, assets, params.id);
      return unwrap(
        await assetDb(ctx)
          .from("asset_warranties")
          .select("*, vendor:vendors(id, name), attachment:attachments(id, file_name, mime_type)")
          .eq("asset_id", params.id)
          .eq("org_id", ctx.orgId)
          .order("end_date", { ascending: false }),
      );
    },
  }),
  route({
    method: "POST",
    path: "/assets/:id/warranties",
    summary: "Add an extended or additional warranty (with its document)",
    tags: ["assets"],
    module: M,
    body: warrantySchema,
    handler: async ({ ctx, params, body }) => {
      const a = await getResource(ctx, assets, params.id);
      await ctx.require("asset:update", rowScope(assets, a));
      return unwrap(
        await assetDb(ctx).from("asset_warranties").insert({ ...body, org_id: ctx.orgId, asset_id: params.id }).select("*").single(),
      );
    },
  }),
  route({
    method: "PATCH",
    path: "/assets/:id/warranties/:warrantyId",
    summary: "Update a warranty",
    tags: ["assets"],
    module: M,
    body: warrantySchema.partial(),
    handler: async ({ ctx, params, body }) => {
      const a = await getResource(ctx, assets, params.id);
      await ctx.require("asset:update", rowScope(assets, a));
      return unwrap(
        await assetDb(ctx).from("asset_warranties").update(body).eq("id", params.warrantyId).eq("asset_id", params.id).eq("org_id", ctx.orgId).select("*").single(),
      );
    },
  }),
  route({
    method: "DELETE",
    path: "/assets/:id/warranties/:warrantyId",
    summary: "Remove a warranty",
    tags: ["assets"],
    module: M,
    response: "none",
    handler: async ({ ctx, params }) => {
      const a = await getResource(ctx, assets, params.id);
      await ctx.require("asset:update", rowScope(assets, a));
      unwrap(await assetDb(ctx).from("asset_warranties").delete().eq("id", params.warrantyId).eq("asset_id", params.id).eq("org_id", ctx.orgId));
    },
  }),
  route({
    method: "GET",
    path: "/assets/:id/conditions",
    summary: "Condition history of an asset",
    tags: ["assets"],
    module: M,
    handler: async ({ ctx, params }) => {
      await getResource(ctx, assets, params.id);
      return unwrap(
        await assetDb(ctx)
          .from("asset_condition_logs")
          .select("*, recorder:profiles!asset_condition_logs_recorded_by_fkey(id, full_name), attachment:attachments(id, file_name, mime_type)")
          .eq("asset_id", params.id)
          .eq("org_id", ctx.orgId)
          .order("recorded_at", { ascending: false })
          .limit(200),
      );
    },
  }),
  route({
    method: "POST",
    path: "/assets/:id/conditions",
    summary: "Record the asset's current condition (custodians can too)",
    tags: ["assets"],
    module: M,
    body: z.object({
      condition: z.enum(["new", "good", "fair", "poor", "damaged"]),
      notes: z.string().trim().max(2000).nullable().optional(),
      attachment_id: optUuid,
    }),
    handler: async ({ ctx, params, body }) => {
      const a = await getResource(ctx, assets, params.id);
      if (a.custodian_id !== ctx.userId) await ctx.require("asset:update", rowScope(assets, a));
      return unwrap(
        await assetDb(ctx)
          .from("asset_condition_logs")
          .insert({ ...body, org_id: ctx.orgId, asset_id: params.id, recorded_by: ctx.userId })
          .select("*")
          .single(),
      );
    },
  }),
  route({
    method: "PUT",
    path: "/assets/:id/amc",
    summary: "Put the asset under an AMC contract (null removes it)",
    tags: ["assets"],
    module: M,
    status: 200,
    body: z.object({ amc_contract_id: z.uuid().nullable() }),
    handler: async ({ ctx, params, body }) => {
      const a = await getResource(ctx, assets, params.id);
      await ctx.require("asset:update", rowScope(assets, a));
      const db = assetDb(ctx);
      const target = body.amc_contract_id ?? a.amc_contract_id;
      if (target) {
        const amc = await getResource(ctx, amcContracts, target);
        await ctx.require("amc:update", { campusId: amc.campus_id });
      }
      // linking is done by a trigger when amc_contract_id changes
      if (a.amc_contract_id && a.amc_contract_id !== body.amc_contract_id)
        unwrap(await db.from("amc_contract_assets").delete().eq("amc_contract_id", a.amc_contract_id).eq("asset_id", params.id));
      return updateResource(ctx, assets, params.id, { amc_contract_id: body.amc_contract_id });
    },
  }),
  ...crudRoutes(assetTransfers, { tag: "assets", ops: ["list", "get", "create"] }),
  route({
    method: "POST",
    path: "/asset-transfers/:id/decide",
    summary: "Complete, reject or cancel a pending transfer",
    tags: ["assets"],
    module: M,
    status: 200,
    body: z.object({ status: z.enum(["completed", "rejected", "cancelled"]) }),
    handler: async ({ ctx, params, body }) => {
      const t = await getResource(ctx, assetTransfers, params.id);
      await ctx.require("asset:transfer", { campusId: body.status === "completed" ? t.to_campus_id : t.from_campus_id });
      const db = ctx.kind === "api_key" ? ctx.admin() : ctx.db;
      unwrap(await db.from("asset_transfers").update({ status: body.status, decided_by: ctx.userId }).eq("id", params.id));
      return getResource(ctx, assetTransfers, params.id);
    },
  }),
  ...crudRoutes(assetAudits, { tag: "assets", ops: ["list", "get", "create", "update"] }),
  route({
    method: "POST",
    path: "/asset-audits/:id/populate",
    summary: "Add all in-scope assets to a verification audit",
    tags: ["assets"],
    module: M,
    status: 200,
    handler: async ({ ctx, params }) => {
      await getResource(ctx, assetAudits, params.id);
      return { added: unwrap(await ctx.db.rpc("asset_audit_populate", { p_audit_id: params.id })) };
    },
  }),
  route({
    method: "GET",
    path: "/asset-audits/:id/items",
    summary: "Assets in an audit with verification results",
    tags: ["assets"],
    module: M,
    handler: async ({ ctx, params }) => {
      await getResource(ctx, assetAudits, params.id);
      return unwrap(
        await ctx.db
          .from("asset_verification_items")
          .select("*, asset:assets(id, name, asset_tag, qr_token, location:locations(name)), verifier:profiles!asset_verification_items_verified_by_fkey(full_name), found_location:locations!asset_verification_items_found_location_id_fkey(name)")
          .eq("audit_id", params.id)
          .order("result"),
      );
    },
  }),
  route({
    method: "POST",
    path: "/asset-audits/:id/verify",
    summary: "Record a verification result (by asset id or scanned QR token)",
    tags: ["assets"],
    module: M,
    status: 200,
    body: z
      .object({
        asset_id: z.uuid().optional(),
        qr_token: z.string().max(64).optional(),
        result: z.enum(["found", "missing", "damaged", "relocated"]),
        found_location_id: optUuid,
        condition: z.enum(["new", "good", "fair", "poor", "damaged"]).nullable().optional(),
        notes: z.string().max(1000).nullable().optional(),
      })
      .refine((b) => b.asset_id || b.qr_token, "asset_id or qr_token required")
      .refine((b) => b.result !== "relocated" || b.found_location_id, { message: "Pick where it was found", path: ["found_location_id"] }),
    handler: async ({ ctx, params, body }) => {
      const audit = await getResource(ctx, assetAudits, params.id);
      await ctx.require("asset_audit:update", { campusId: audit.campus_id });
      let assetId = body.asset_id;
      if (!assetId) {
        const a = unwrapMaybe(await ctx.db.from("assets").select("id").eq("qr_token", body.qr_token!).eq("org_id", ctx.orgId).maybeSingle());
        if (!a) throw ApiError.notFound("Asset for this QR code");
        assetId = a.id;
      }
      const db = ctx.kind === "api_key" ? ctx.admin() : ctx.db;
      const item = unwrap(
        await db
          .from("asset_verification_items")
          .upsert(
            {
              org_id: ctx.orgId, audit_id: params.id, asset_id: assetId, result: body.result, found_location_id: body.found_location_id ?? null,
              condition: body.condition ?? null, notes: body.notes ?? null, verified_by: ctx.userId, verified_at: new Date().toISOString(),
            },
            { onConflict: "audit_id,asset_id" },
          )
          .select("*, asset:assets(id, name, asset_tag)")
          .single(),
      );
      if (audit.status === "planned") unwrap(await db.from("asset_verification_audits").update({ status: "in_progress" }).eq("id", params.id));
      return item;
    },
  }),

  // Vendors
  ...crudRoutes(vendors),
  ...crudRoutes(serviceCategories, { tag: "vendors", ops: ["list", "create", "update", "delete"] }),
  route({
    method: "POST",
    path: "/vendors/invite",
    summary: "Invite a vendor to self-register via the vendor portal",
    tags: ["vendors"],
    module: M,
    body: vendorInviteSchema,
    handler: ({ ctx, body }) => inviteVendor(ctx, body),
  }),
  route({
    method: "POST",
    path: "/vendors/:id/portal-link",
    summary: "Send the vendor a magic link to the portal",
    tags: ["vendors"],
    module: M,
    body: z.object({ purpose: z.enum(["onboarding", "portal"]).default("portal"), email: z.email().optional() }),
    handler: async ({ ctx, params, body }) => {
      await ctx.require("vendor:update");
      await getResource(ctx, vendors, params.id);
      return createVendorPortalLink(ctx, params.id, body.purpose, { email: body.email });
    },
  }),
  route({
    method: "POST",
    path: "/vendors/:id/start-verification",
    summary: "Move a submitted vendor into verification",
    tags: ["vendors"],
    module: M,
    status: 200,
    handler: async ({ ctx, params }) => {
      await ctx.require("vendor:update");
      const db = ctx.kind === "api_key" ? ctx.admin() : ctx.db;
      unwrap(await db.from("vendors").update({ status: "under_verification" }).eq("id", params.id).eq("org_id", ctx.orgId));
      return getResource(ctx, vendors, params.id);
    },
  }),
  route({
    method: "POST",
    path: "/vendors/:id/submit-for-approval",
    summary: "Submit a verified vendor for approval (approval engine)",
    tags: ["vendors"],
    module: M,
    status: 200,
    handler: async ({ ctx, params }) => unwrap(await ctx.db.rpc("vendor_submit_for_approval", { p_vendor_id: params.id })),
  }),
  route({
    method: "POST",
    path: "/vendors/:id/blacklist",
    summary: "Blacklist or reinstate a vendor",
    tags: ["vendors"],
    module: M,
    status: 200,
    body: z.object({ blacklisted: z.boolean(), reason: z.string().trim().min(3).max(1000).optional() }),
    handler: async ({ ctx, params, body }) => {
      await ctx.require("vendor:approve");
      if (body.blacklisted && !body.reason) throw new ApiError("validation_failed", "reason is required");
      const db = ctx.kind === "api_key" ? ctx.admin() : ctx.db;
      unwrap(
        await db
          .from("vendors")
          .update(body.blacklisted ? { status: "blacklisted", blacklist_reason: body.reason } : { status: "approved", blacklist_reason: null })
          .eq("id", params.id)
          .eq("org_id", ctx.orgId),
      );
      return getResource(ctx, vendors, params.id);
    },
  }),
  route({
    method: "GET",
    path: "/vendors/:id/documents",
    summary: "Vendor documents",
    tags: ["vendors"],
    module: M,
    handler: async ({ ctx, params }) =>
      unwrap(await ctx.db.from("vendor_documents").select("*, attachment:attachments(id, file_name, mime_type)").eq("vendor_id", params.id).order("created_at")),
  }),
  route({
    method: "POST",
    path: "/vendors/:id/documents",
    summary: "Add a vendor document",
    tags: ["vendors"],
    module: M,
    body: vendorDocSchema,
    handler: async ({ ctx, params, body }) => {
      await ctx.require("vendor:update");
      const db = ctx.kind === "api_key" ? ctx.admin() : ctx.db;
      return unwrap(await db.from("vendor_documents").insert({ ...body, org_id: ctx.orgId, vendor_id: params.id }).select("*").single());
    },
  }),
  route({
    method: "POST",
    path: "/vendors/:id/documents/:docId/verify",
    summary: "Verify or reject a vendor document",
    tags: ["vendors"],
    module: M,
    status: 200,
    body: z.object({ verification_status: z.enum(["verified", "rejected"]), remarks: z.string().max(500).optional() }),
    handler: async ({ ctx, params, body }) => {
      await ctx.require("vendor:update");
      const db = ctx.kind === "api_key" ? ctx.admin() : ctx.db;
      return unwrap(
        await db
          .from("vendor_documents")
          .update({ ...body, verified_by: ctx.userId, verified_at: new Date().toISOString() })
          .eq("id", params.docId)
          .eq("vendor_id", params.id)
          .eq("org_id", ctx.orgId)
          .select("*")
          .single(),
      );
    },
  }),
  route({
    method: "GET",
    path: "/vendors/:id/agreements",
    summary: "Vendor agreements",
    tags: ["vendors"],
    module: M,
    handler: async ({ ctx, params }) =>
      unwrap(await ctx.db.from("vendor_agreements").select("*").eq("vendor_id", params.id).order("start_date", { ascending: false })),
  }),
  route({
    method: "POST",
    path: "/vendors/:id/agreements",
    summary: "Add a vendor agreement",
    tags: ["vendors"],
    module: M,
    body: agreementSchema,
    handler: async ({ ctx, params, body }) => {
      await ctx.require("vendor:update");
      const db = ctx.kind === "api_key" ? ctx.admin() : ctx.db;
      return unwrap(await db.from("vendor_agreements").insert({ ...body, org_id: ctx.orgId, vendor_id: params.id }).select("*").single());
    },
  }),
  route({
    method: "PATCH",
    path: "/vendors/:id/agreements/:agreementId",
    summary: "Update a vendor agreement",
    tags: ["vendors"],
    module: M,
    body: agreementSchema.partial(),
    handler: async ({ ctx, params, body }) => {
      await ctx.require("vendor:update");
      const db = ctx.kind === "api_key" ? ctx.admin() : ctx.db;
      return unwrap(
        await db.from("vendor_agreements").update(body).eq("id", params.agreementId).eq("vendor_id", params.id).eq("org_id", ctx.orgId).select("*").single(),
      );
    },
  }),
  route({
    method: "GET",
    path: "/vendors/:id/ratings",
    summary: "Vendor ratings and performance",
    tags: ["vendors"],
    module: M,
    handler: async ({ ctx, params }) => {
      const [ratings, wo, po] = await Promise.all([
        ctx.db.from("vendor_ratings").select("*, rater:profiles!vendor_ratings_rated_by_fkey(full_name)").eq("vendor_id", params.id).order("created_at", { ascending: false }).limit(100),
        ctx.db.from("work_orders").select("status, due_at, completed_at").eq("vendor_id", params.id).is("deleted_at", null),
        ctx.db.from("purchase_orders").select("status, total, expected_delivery").eq("vendor_id", params.id).is("deleted_at", null),
      ]);
      const wos = unwrap(wo);
      const done = wos.filter((w) => w.completed_at);
      return {
        ratings: unwrap(ratings),
        work_orders_total: wos.length,
        work_orders_completed: done.length,
        on_time_pct: done.length ? Math.round((100 * done.filter((w) => !w.due_at || w.completed_at! <= w.due_at).length) / done.length) : null,
        purchase_orders_total: unwrap(po).length,
        spend: unwrap(po).filter((p) => !["draft", "rejected", "cancelled"].includes(p.status)).reduce((s, p) => s + Number(p.total), 0),
      };
    },
  }),
  route({
    method: "POST",
    path: "/vendors/:id/ratings",
    summary: "Rate a vendor",
    tags: ["vendors"],
    module: M,
    body: z.object({
      rating: z.number().int().min(1).max(5),
      quality: z.number().int().min(1).max(5).optional(),
      timeliness: z.number().int().min(1).max(5).optional(),
      communication: z.number().int().min(1).max(5).optional(),
      comment: z.string().max(2000).optional(),
      source_type: z.enum(["manual", "purchase_order", "work_order", "issue"]).default("manual"),
      source_id: optUuid,
    }),
    handler: async ({ ctx, params, body }) => {
      const db = ctx.kind === "api_key" ? ctx.admin() : ctx.db;
      return unwrap(await db.from("vendor_ratings").insert({ ...body, org_id: ctx.orgId, vendor_id: params.id, rated_by: ctx.userId }).select("*").single());
    },
  }),

  // Work orders, PM, AMC, compliance
  ...crudRoutes(workOrders),
  route({
    method: "POST",
    path: "/work-orders/:id/booking",
    summary: "Update the vendor booking for a work order",
    tags: ["work-orders"],
    module: M,
    status: 200,
    body: z.object({
      vendor_booking_status: z.enum(["requested", "confirmed", "declined", "rescheduled", "completed"]),
      scheduled_for: z.iso.datetime({ offset: true }).optional(),
      vendor_booking_note: z.string().max(1000).optional(),
    }),
    handler: async ({ ctx, params, body }) => {
      const patch: Record<string, unknown> = { ...body };
      if (body.vendor_booking_status === "confirmed") patch.status = "scheduled";
      return updateResource(ctx, workOrders, params.id, patch);
    },
  }),
  ...crudRoutes(checklistTemplates, { tag: "maintenance", ops: ["list", "get", "create", "update", "delete"] }),
  ...crudRoutes(pmSchedules, { tag: "maintenance" }),
  route({
    method: "GET",
    path: "/maintenance/calendar",
    summary: "Work orders, PM due dates and compliance due dates in a window",
    tags: ["maintenance"],
    module: M,
    query: z.object({ from: z.string(), to: z.string(), campus_id: z.uuid().optional() }),
    handler: ({ ctx, query }) => maintenanceCalendar(ctx, query.get("from")!, query.get("to")!, query.get("campus_id") ?? undefined),
  }),
  ...crudRoutes(amcContracts, { tag: "maintenance" }),
  route({
    method: "PUT",
    path: "/amc-contracts/:id/assets",
    summary: "Set the assets covered by an AMC",
    tags: ["maintenance"],
    module: M,
    status: 200,
    body: z.object({ asset_ids: z.array(z.uuid()).max(2000) }),
    handler: async ({ ctx, params, body }) => {
      const amc = await getResource(ctx, amcContracts, params.id);
      await ctx.require("amc:update", { campusId: amc.campus_id });
      const db = ctx.kind === "api_key" ? ctx.admin() : ctx.db;
      unwrap(await db.from("amc_contract_assets").delete().eq("amc_contract_id", params.id));
      if (body.asset_ids.length)
        unwrap(await db.from("amc_contract_assets").insert(body.asset_ids.map((a) => ({ amc_contract_id: params.id, asset_id: a, org_id: ctx.orgId }))));
      unwrap(await db.from("assets").update({ amc_contract_id: params.id }).in("id", body.asset_ids).eq("org_id", ctx.orgId));
      return { amc_contract_id: params.id, asset_ids: body.asset_ids };
    },
  }),
  route({
    method: "GET",
    path: "/amc-contracts/:id/usage",
    summary: "Visits included / used / remaining",
    tags: ["maintenance"],
    module: M,
    handler: async ({ ctx, params }) => unwrap(await ctx.db.from("amc_contract_usage").select("*").eq("amc_contract_id", params.id).single()),
  }),
  route({
    method: "POST",
    path: "/amc-contracts/:id/renew",
    summary: "Renew an AMC into a new contract period",
    tags: ["maintenance"],
    module: M,
    body: z.object({ start_date: isoDate, end_date: isoDate, value: money.nullable().optional(), contract_number: z.string().max(60).optional() }),
    handler: async ({ ctx, params, body }) => {
      const amc = await getResource(ctx, amcContracts, params.id);
      await ctx.require("amc:create", { campusId: amc.campus_id });
      const db = ctx.kind === "api_key" ? ctx.admin() : ctx.db;
      const next = unwrap(
        await db
          .from("amc_contracts")
          .insert({
            org_id: ctx.orgId, campus_id: amc.campus_id, vendor_id: amc.vendor_id, title: amc.title, contract_type: amc.contract_type,
            coverage: amc.coverage, visits_included: amc.visits_included, visit_frequency: amc.visit_frequency,
            renewal_reminder_days: amc.renewal_reminder_days, start_date: body.start_date, end_date: body.end_date,
            value: body.value ?? amc.value, contract_number: body.contract_number ?? amc.contract_number, renewed_from_id: amc.id,
          })
          .select("*")
          .single(),
      );
      const covered = unwrap(await db.from("amc_contract_assets").select("asset_id").eq("amc_contract_id", amc.id));
      if (covered.length)
        unwrap(await db.from("amc_contract_assets").insert(covered.map((c) => ({ amc_contract_id: next.id, asset_id: c.asset_id, org_id: ctx.orgId }))));
      unwrap(await db.from("amc_contracts").update({ status: "renewed" }).eq("id", amc.id));
      return next;
    },
  }),
  ...crudRoutes(complianceItems, { tag: "maintenance" }),
  route({
    method: "POST",
    path: "/compliance-items/:id/complete",
    summary: "Record completion of a compliance activity and roll the due date",
    tags: ["maintenance"],
    module: M,
    status: 200,
    body: z.object({ done_on: isoDate, certificate_number: z.string().max(100).optional(), notes: z.string().max(2000).optional() }),
    handler: async ({ ctx, params, body }) => {
      const item = await getResource(ctx, complianceItems, params.id);
      const next = new Date(body.done_on);
      next.setMonth(next.getMonth() + item.frequency_months);
      return updateResource(ctx, complianceItems, params.id, {
        last_done_on: body.done_on,
        next_due_on: next.toISOString().slice(0, 10),
        ...(body.certificate_number ? { certificate_number: body.certificate_number } : {}),
        ...(body.notes ? { notes: body.notes } : {}),
      });
    },
  }),
];
