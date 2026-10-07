import "server-only";
import { z } from "zod";
import { listParamsSchema } from "./pagination";
import { route, type RouteDef } from "./router";
import {
  createResource,
  deleteResource,
  exportResourceCsv,
  getResource,
  listResource,
  updateResource,
  type ResourceSpec,
} from "@/lib/services/resource";

export type CrudOp = "list" | "get" | "create" | "update" | "delete" | "export";

export function filterQuerySchema(spec: ResourceSpec) {
  const shape: Record<string, z.ZodType> = {};
  for (const [col, kind] of Object.entries(spec.filters ?? {})) {
    if (kind === "range") {
      shape[`${col}_from`] = z.string().optional().describe(`${col} >= value`);
      shape[`${col}_to`] = z.string().optional().describe(`${col} <= value`);
    } else if (kind === "is_null") {
      shape[`${col}_null`] = z.enum(["true", "false"]).optional();
    } else if (kind === "in") {
      shape[col] = z.string().optional().describe("Comma separated list");
    } else if (kind === "bool") {
      shape[col] = z.enum(["true", "false"]).optional();
    } else if (kind === "user") {
      shape[col] = z.string().optional().describe('User id, or "me"');
    } else {
      shape[col] = z.string().optional();
    }
  }
  if (spec.softDelete) shape.include_deleted = z.enum(["true", "false"]).optional();
  return listParamsSchema.extend(shape);
}

/** Standard REST endpoints for a resource spec. */
export function crudRoutes(
  spec: ResourceSpec,
  opts: { ops?: CrudOp[]; tag?: string; label?: string } = {},
): RouteDef[] {
  const ops = opts.ops ?? ["list", "get", "create", "update", "delete", "export"];
  const tag = opts.tag ?? spec.name;
  const label = opts.label ?? spec.entityType.replace(/_/g, " ");
  const base = `/${spec.name}`;
  const query = filterQuerySchema(spec);
  const routes: RouteDef[] = [];

  if (ops.includes("list"))
    routes.push(
      route({
        method: "GET",
        path: base,
        summary: `List ${spec.name.replace(/-/g, " ")}`,
        description: `Sortable by: ${spec.sortable.join(", ")}. Use \`cursor\` for keyset pagination or \`page\` for offset pagination with totals.`,
        tags: [tag],
        module: spec.module,
        query,
        response: "list",
        handler: ({ ctx, query: q }) => listResource(ctx, spec, listParamsSchema.parse(Object.fromEntries(q)), q),
      }),
    );
  if (ops.includes("export"))
    routes.push(
      route({
        method: "GET",
        path: `${base}/export`,
        summary: `Export ${spec.name.replace(/-/g, " ")} as CSV`,
        tags: [tag],
        module: spec.module,
        query,
        response: "csv",
        handler: async ({ ctx, query: q }) => {
          const csv = await exportResourceCsv(ctx, spec, listParamsSchema.parse(Object.fromEntries(q)), q);
          return new Response(csv, {
            headers: {
              "content-type": "text/csv; charset=utf-8",
              "content-disposition": `attachment; filename="${spec.name}-${new Date().toISOString().slice(0, 10)}.csv"`,
            },
          });
        },
      }),
    );
  if (ops.includes("get"))
    routes.push(
      route({
        method: "GET",
        path: `${base}/:id`,
        summary: `Get a ${label}`,
        tags: [tag],
        module: spec.module,
        response: "object",
        handler: ({ ctx, params }) => getResource(ctx, spec, params.id),
      }),
    );
  if (ops.includes("create") && spec.createSchema)
    routes.push(
      route({
        method: "POST",
        path: base,
        summary: `Create a ${label}`,
        tags: [tag],
        module: spec.module,
        body: spec.createSchema,
        response: "object",
        handler: ({ ctx, body }) => createResource(ctx, spec, body),
      }),
    );
  if (ops.includes("update") && spec.updateSchema)
    routes.push(
      route({
        method: "PATCH",
        path: `${base}/:id`,
        summary: `Update a ${label}`,
        tags: [tag],
        module: spec.module,
        body: spec.updateSchema,
        response: "object",
        handler: ({ ctx, params, body }) => updateResource(ctx, spec, params.id, body),
      }),
    );
  if (ops.includes("delete"))
    routes.push(
      route({
        method: "DELETE",
        path: `${base}/:id`,
        summary: spec.softDelete ? `Delete (soft) a ${label}` : `Delete a ${label}`,
        tags: [tag],
        module: spec.module,
        response: "none",
        handler: async ({ ctx, params }) => {
          await deleteResource(ctx, spec, params.id);
        },
      }),
    );
  return routes;
}
