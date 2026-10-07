import "server-only";
import { z } from "zod";
import { ApiError, unwrap, unwrapMaybe } from "@/lib/api/errors";
import {
  decodeCursor,
  encodeCursor,
  keysetFilter,
  pgrstValue,
  type ListParams,
  type ListResult,
} from "@/lib/api/pagination";
import type { Module, RequestContext } from "@/lib/auth/context";
import type { Scope } from "@/lib/auth/permissions";
import type { DB } from "@/lib/supabase/server";
import type { TableName } from "@/lib/supabase/database.types";
import { toCsv } from "@/lib/utils/csv";

export type FilterKind = "eq" | "in" | "bool" | "range" | "is_null" | "contains" | "user";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;
/** Generic PostgREST query builder (dynamic table names cannot be typed statically). */
export type Query = any;
/** Untyped table access for the generic layer (typed access lives in module services). */
export const table = (db: DB, name: TableName) => (db as any).from(name);
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface ResourceSpec {
  /** URL segment / OpenAPI tag, e.g. "issues". */
  name: string;
  /** Entity type used by polymorphic tables (comments, attachments, approvals). */
  entityType: string;
  table: TableName;
  module?: Module;
  /** Permission resource prefix, e.g. "issue" -> issue:read/create/update/delete. */
  permission: string;
  readPermission?: string;
  createPermission?: string;
  updatePermission?: string;
  deletePermission?: string;
  /** Org-level rows that require an org-scoped grant (settings-like resources). */
  strict?: boolean;
  /** Any org member may read (reference data); mirrors member-read RLS for API keys. */
  memberRead?: boolean;
  /**
   * Users in these columns can always read the row and (with ownerCanUpdate)
   * update it, mirroring the RLS owner rules for API-key callers.
   */
  ownerColumns?: string[];
  ownerCanUpdate?: boolean;
  /** Self-service creation, e.g. reporting your own issue with issue:report. */
  ownCreate?: { permission: string; column: string };
  campusColumn?: string;
  departmentColumn?: string;
  select?: string;
  detailSelect?: string;
  filters?: Record<string, FilterKind>;
  sortable: string[];
  defaultSort: string;
  search?: string[];
  softDelete?: boolean;
  createSchema?: z.ZodType<Row>;
  updateSchema?: z.ZodType<Row>;
  /** Mutate validated input before insert (e.g. stamp reporter_id). */
  prepareCreate?: (ctx: RequestContext, input: Row) => Promise<Row> | Row;
  prepareUpdate?: (ctx: RequestContext, input: Row, existing: Row) => Promise<Row> | Row;
  /** Columns that receive a generated value from DB triggers but are NOT NULL. */
  placeholders?: Row;
  csvColumns?: [path: string, label: string][];
  customFields?: boolean;
  /** Called after create with the validated request body (e.g. to insert nested lines). */
  afterCreate?: (ctx: RequestContext, row: Row, input: Row) => Promise<void>;
}

const perm = (spec: ResourceSpec, action: "read" | "create" | "update" | "delete") =>
  ({
    read: spec.readPermission,
    create: spec.createPermission,
    update: spec.updatePermission,
    delete: spec.deletePermission,
  })[action] ?? `${spec.permission}:${action}`;

export function rowScope(spec: ResourceSpec, row: Row): Scope {
  return {
    campusId: spec.campusColumn ? (row[spec.campusColumn] ?? null) : null,
    departmentId: spec.departmentColumn ? (row[spec.departmentColumn] ?? null) : null,
  };
}

const scopeMode = (spec: ResourceSpec) => (spec.strict ? "strict" : "auto");

async function ensureModule(ctx: RequestContext, spec: ResourceSpec) {
  if (spec.module) await ctx.requireModule(spec.module);
}

/**
 * API keys bypass RLS, so lists are restricted to the campuses/departments the
 * key's owner may read. Returns "all", "none", or a PostgREST `or` filter.
 * (Never return a query builder from an async function: builders are
 * thenables and would be executed by `await`.)
 */
async function apiKeyScopeFilter(ctx: RequestContext, spec: ResourceSpec): Promise<"all" | "none" | string> {
  if (ctx.kind !== "api_key") return "all";
  const p = perm(spec, "read");
  if (spec.memberRead) return "all";
  const owners = (spec.ownerColumns ?? []).map((c) => `${c}.eq.${ctx.userId}`);
  if (!spec.campusColumn && !spec.departmentColumn) {
    if (await ctx.can(p, {}, scopeMode(spec))) return "all";
    return owners.length ? owners.join(",") : "none";
  }
  const scopes = await ctx.scopesFor(p);
  if (scopes === null) return "all";
  const parts: string[] = [...owners];
  if (spec.campusColumn && scopes.campusIds.length) parts.push(`${spec.campusColumn}.in.(${scopes.campusIds.join(",")})`);
  if (spec.departmentColumn && scopes.departmentIds.length)
    parts.push(`${spec.departmentColumn}.in.(${scopes.departmentIds.join(",")})`);
  return parts.length ? parts.join(",") : "none";
}

const isOwner = (ctx: RequestContext, spec: ResourceSpec, row: Row) =>
  (spec.ownerColumns ?? []).some((c) => row[c] === ctx.userId);

export function applyFilters(ctx: RequestContext, spec: ResourceSpec, q: Query, query: URLSearchParams): Query {
  for (const [col, kind] of Object.entries(spec.filters ?? {})) {
    if (kind === "range") {
      const from = query.get(`${col}_from`);
      const to = query.get(`${col}_to`);
      if (from) q = q.gte(col, from);
      if (to) q = q.lte(col, to);
      continue;
    }
    if (kind === "is_null") {
      const v = query.get(`${col}_null`);
      if (v === "true") q = q.is(col, null);
      if (v === "false") q = q.not(col, "is", null);
      continue;
    }
    const raw = query.get(col);
    if (raw === null || raw === "") continue;
    const value = raw === "me" ? ctx.userId : raw;
    switch (kind) {
      case "eq":
      case "user":
        q = value === "null" ? q.is(col, null) : q.eq(col, value);
        break;
      case "in":
        q = q.in(
          col,
          value.split(",").map((v) => (v === "me" ? ctx.userId : v)),
        );
        break;
      case "bool":
        q = q.eq(col, value === "true");
        break;
      case "contains":
        q = q.contains(col, [value]);
        break;
    }
  }
  return q;
}

function parseSort(spec: ResourceSpec, sort?: string) {
  const s = sort ?? spec.defaultSort;
  const ascending = !s.startsWith("-");
  const field = s.replace(/^-/, "");
  if (!spec.sortable.includes(field)) {
    throw new ApiError("bad_request", `Cannot sort by "${field}". Sortable: ${spec.sortable.join(", ")}`);
  }
  return { field, ascending };
}

export async function listResource(
  ctx: RequestContext,
  spec: ResourceSpec,
  params: ListParams,
  query: URLSearchParams = new URLSearchParams(),
  extra?: (q: Query) => Query,
): Promise<ListResult<Row>> {
  await ensureModule(ctx, spec);
  const { field, ascending } = parseSort(spec, params.sort);
  const usePage = params.page !== undefined;
  let q: Query = table(ctx.db, spec.table)
    .select(spec.select ?? "*", usePage ? { count: "exact" } : undefined)
    .eq("org_id", ctx.orgId);
  if (spec.softDelete && query.get("include_deleted") !== "true") q = q.is("deleted_at", null);
  q = applyFilters(ctx, spec, q, query);
  if (extra) q = extra(q);
  if (params.q && spec.search?.length) {
    const term = pgrstValue(`%${params.q.replace(/[%_]/g, (m) => `\\${m}`)}%`);
    q = q.or(spec.search.map((c) => `${c}.ilike.${term}`).join(","));
  }
  const scope = await apiKeyScopeFilter(ctx, spec);
  if (scope === "none") return { data: [], meta: { has_more: false, next_cursor: null, limit: params.limit, total: 0 } };
  if (scope !== "all") q = q.or(scope);
  q = q.order(field, { ascending, nullsFirst: false }).order("id", { ascending });

  if (usePage) {
    const from = (params.page! - 1) * params.limit;
    const res = await q.range(from, from + params.limit - 1);
    const rows = unwrap(res) as Row[];
    const total = res.count ?? rows.length;
    return {
      data: rows,
      meta: { has_more: from + rows.length < total, next_cursor: null, total, page: params.page, limit: params.limit },
    };
  }

  if (params.cursor) q = q.or(keysetFilter(field, ascending, decodeCursor(params.cursor)));
  const rows = unwrap(await q.limit(params.limit + 1)) as Row[];
  const hasMore = rows.length > params.limit;
  const page = hasMore ? rows.slice(0, params.limit) : rows;
  const last = page[page.length - 1];
  return {
    data: page,
    meta: {
      has_more: hasMore,
      next_cursor: hasMore && last ? encodeCursor({ v: last[field] ?? null, id: last.id }) : null,
      limit: params.limit,
    },
  };
}

async function fetchRow(ctx: RequestContext, spec: ResourceSpec, id: string, select?: string): Promise<Row> {
  if (!z.uuid().safeParse(id).success) throw ApiError.notFound(spec.entityType);
  let q = table(ctx.db, spec.table).select(select ?? spec.detailSelect ?? spec.select ?? "*").eq("id", id).eq("org_id", ctx.orgId);
  if (spec.softDelete) q = q.is("deleted_at", null);
  const row = unwrapMaybe(await q.maybeSingle()) as Row | null;
  if (!row) throw ApiError.notFound(spec.entityType.replace(/_/g, " "));
  if (
    ctx.kind === "api_key" &&
    !spec.memberRead &&
    !isOwner(ctx, spec, row) &&
    !(await ctx.can(perm(spec, "read"), rowScope(spec, row), scopeMode(spec)))
  ) {
    throw ApiError.notFound(spec.entityType.replace(/_/g, " "));
  }
  return row;
}

export async function getResource(ctx: RequestContext, spec: ResourceSpec, id: string): Promise<Row> {
  await ensureModule(ctx, spec);
  const row = await fetchRow(ctx, spec, id);
  if (spec.customFields) row.custom_fields = await readCustomFields(ctx, spec.entityType, id);
  return row;
}

function splitCustomFields(input: Row) {
  const { custom_fields: custom, ...rest } = input;
  return { rest, custom: (custom ?? null) as Record<string, unknown> | null };
}

export async function createResource(ctx: RequestContext, spec: ResourceSpec, body: unknown): Promise<Row> {
  await ensureModule(ctx, spec);
  if (!spec.createSchema) throw new ApiError("bad_request", `${spec.name} cannot be created via the API`);
  const parsed = spec.createSchema.parse(body);
  const { rest, custom } = splitCustomFields(parsed);
  let input: Row = { ...(spec.placeholders ?? {}), ...rest, org_id: ctx.orgId };
  if (spec.prepareCreate) input = await spec.prepareCreate(ctx, input);
  if (ctx.kind === "api_key") {
    const own = spec.ownCreate;
    const selfService = own && input[own.column] === ctx.userId && (await ctx.can(own.permission, rowScope(spec, input)));
    if (!selfService) await ctx.require(perm(spec, "create"), rowScope(spec, input), scopeMode(spec));
  }
  const row = unwrap(await table(ctx.db, spec.table).insert(input).select(spec.detailSelect ?? spec.select ?? "*").single()) as Row;
  if (custom && spec.customFields) await writeCustomFields(ctx, spec.entityType, row.id, custom);
  if (spec.afterCreate) await spec.afterCreate(ctx, row, parsed);
  return row;
}

export async function updateResource(ctx: RequestContext, spec: ResourceSpec, id: string, body: unknown): Promise<Row> {
  await ensureModule(ctx, spec);
  if (!spec.updateSchema) throw new ApiError("bad_request", `${spec.name} cannot be updated via the API`);
  const parsed = spec.updateSchema.parse(body);
  const { rest, custom } = splitCustomFields(parsed);
  const existing = await fetchRow(ctx, spec, id, "*");
  let input: Row = rest;
  if (spec.prepareUpdate) input = await spec.prepareUpdate(ctx, input, existing);
  if (ctx.kind === "api_key" && !(spec.ownerCanUpdate && isOwner(ctx, spec, existing))) {
    await ctx.require(perm(spec, "update"), rowScope(spec, existing), scopeMode(spec));
    const next = { ...existing, ...input };
    if (JSON.stringify(rowScope(spec, next)) !== JSON.stringify(rowScope(spec, existing))) {
      await ctx.require(perm(spec, "update"), rowScope(spec, next), scopeMode(spec));
    }
  }
  if (Object.keys(input).length > 0) {
    const updated = unwrap(
      await table(ctx.db, spec.table).update(input).eq("id", id).eq("org_id", ctx.orgId).select("id"),
    ) as Row[];
    if (updated.length === 0) throw ApiError.forbidden();
  }
  if (custom && spec.customFields) await writeCustomFields(ctx, spec.entityType, id, custom);
  return getResource(ctx, spec, id);
}

export async function deleteResource(ctx: RequestContext, spec: ResourceSpec, id: string): Promise<void> {
  await ensureModule(ctx, spec);
  const existing = await fetchRow(ctx, spec, id, "*");
  if (ctx.kind === "api_key") await ctx.require(perm(spec, "delete"), rowScope(spec, existing), scopeMode(spec));
  else if (!(await ctx.can(perm(spec, "delete"), rowScope(spec, existing), scopeMode(spec)))) throw ApiError.forbidden();
  // Soft delete uses the admin client after the explicit check above: an update
  // of deleted_at must not depend on owner-only update policies.
  const db = spec.softDelete ? ctx.admin() : ctx.db;
  const q = spec.softDelete
    ? table(db, spec.table).update({ deleted_at: new Date().toISOString() })
    : table(db, spec.table).delete();
  unwrap(await q.eq("id", id).eq("org_id", ctx.orgId));
}

export async function exportResourceCsv(
  ctx: RequestContext,
  spec: ResourceSpec,
  params: ListParams,
  query: URLSearchParams,
  maxRows = 10_000,
): Promise<string> {
  const rows: Row[] = [];
  let cursor: string | undefined;
  do {
    const page = await listResource(ctx, spec, { ...params, page: undefined, limit: 200, cursor }, query);
    rows.push(...page.data);
    cursor = page.meta.next_cursor ?? undefined;
  } while (cursor && rows.length < maxRows);
  const columns = spec.csvColumns ?? Object.keys(rows[0] ?? {}).map((k) => [k, k] as [string, string]);
  return toCsv(rows.slice(0, maxRows), columns);
}

// ---------------------------------------------------------------------------
// Custom fields
// ---------------------------------------------------------------------------
export async function readCustomFields(ctx: RequestContext, entityType: string, entityId: string) {
  const values = unwrap(
    await ctx.db
      .from("custom_field_values")
      .select("value, definition:custom_field_definitions(key)")
      .eq("org_id", ctx.orgId)
      .eq("entity_type", entityType)
      .eq("entity_id", entityId),
  );
  const out: Record<string, unknown> = {};
  for (const v of values as unknown as { value: unknown; definition: { key: string } | null }[]) {
    if (v.definition) out[v.definition.key] = v.value;
  }
  return out;
}

export async function writeCustomFields(
  ctx: RequestContext,
  entityType: string,
  entityId: string,
  values: Record<string, unknown>,
) {
  const defs = unwrap(
    await ctx.db
      .from("custom_field_definitions")
      .select("id, key, field_type, required, options")
      .eq("org_id", ctx.orgId)
      .eq("entity_type", entityType)
      .eq("active", true),
  );
  const rows = [];
  for (const [key, value] of Object.entries(values)) {
    const def = defs.find((d) => d.key === key);
    if (!def) throw new ApiError("validation_failed", `Unknown custom field "${key}"`);
    validateCustomValue(def.field_type, def.options, value, key);
    rows.push({ definition_id: def.id, org_id: ctx.orgId, entity_type: entityType, entity_id: entityId, value: value as never });
  }
  if (rows.length) unwrap(await ctx.db.from("custom_field_values").upsert(rows));
}

export function validateCustomValue(type: string, options: unknown, value: unknown, key: string) {
  if (value === null) return;
  const opts = Array.isArray(options) ? (options as unknown[]).map((o) => (typeof o === "object" && o ? (o as { value: unknown }).value : o)) : [];
  const ok = (() => {
    switch (type) {
      case "text":
      case "user":
        return typeof value === "string";
      case "number":
      case "currency":
        return typeof value === "number" && Number.isFinite(value);
      case "boolean":
        return typeof value === "boolean";
      case "date":
        return typeof value === "string" && !Number.isNaN(Date.parse(value));
      case "select":
        return opts.includes(value);
      case "multiselect":
        return Array.isArray(value) && value.every((v) => opts.includes(v));
      default:
        return false;
    }
  })();
  if (!ok) throw new ApiError("validation_failed", `Invalid value for custom field "${key}" (${type})`);
}
