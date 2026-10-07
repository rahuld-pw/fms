import { z } from "zod";
import type { RouteDef } from "./router";

const errorSchema = {
  type: "object",
  required: ["error"],
  properties: {
    error: {
      type: "object",
      required: ["code", "message", "request_id"],
      properties: {
        code: {
          type: "string",
          enum: [
            "bad_request", "validation_failed", "unauthorized", "forbidden", "module_disabled", "not_found",
            "conflict", "unprocessable", "rate_limited", "idempotency_conflict", "internal_error",
          ],
        },
        message: { type: "string" },
        details: {},
        request_id: { type: "string" },
      },
    },
  },
};

function toJsonSchema(schema: z.ZodType, io: "input" | "output" = "input") {
  try {
    const s = z.toJSONSchema(schema, { io, unrepresentable: "any" }) as Record<string, unknown>;
    delete s.$schema;
    return s;
  } catch {
    return {};
  }
}

const errorRef = { content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } };

/** Builds the OpenAPI 3.1 document from the same route table that serves /api/v1. */
export function buildOpenApi(routes: RouteDef[], serverUrl: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of routes) {
    const path = r.path.replace(/:([a-z_]+)/g, "{$1}");
    const pathParams = [...r.path.matchAll(/:([a-z_]+)/g)].map((m) => ({
      name: m[1],
      in: "path",
      required: true,
      schema: { type: "string" },
    }));
    const queryParams: unknown[] = [];
    if (r.query) {
      const js = toJsonSchema(r.query) as { properties?: Record<string, unknown>; required?: string[] };
      for (const [name, schema] of Object.entries(js.properties ?? {})) {
        queryParams.push({
          name,
          in: "query",
          required: js.required?.includes(name) ?? false,
          schema,
          description: (schema as { description?: string }).description,
        });
      }
    }
    const okStatus = String(r.status ?? (r.method === "POST" ? 201 : r.response === "none" ? 204 : 200));
    let okResponse: Record<string, unknown>;
    switch (r.response) {
      case "list":
        okResponse = { description: "Paginated list", content: { "application/json": { schema: { $ref: "#/components/schemas/List" } } } };
        break;
      case "csv":
        okResponse = { description: "CSV file", content: { "text/csv": { schema: { type: "string" } } } };
        break;
      case "pdf":
        okResponse = { description: "PDF document", content: { "application/pdf": { schema: { type: "string", format: "binary" } } } };
        break;
      case "none":
        okResponse = { description: "No content" };
        break;
      case undefined:
      case "object":
        okResponse = { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/Object" } } } };
        break;
      default:
        okResponse = {
          description: "OK",
          content: {
            "application/json": {
              schema: { type: "object", properties: { data: toJsonSchema(r.response, "output") } },
            },
          },
        };
    }
    const op: Record<string, unknown> = {
      operationId: `${r.method.toLowerCase()}${r.path.replace(/[/:-]+([a-z])/g, (_, c: string) => c.toUpperCase())}`,
      summary: r.summary,
      description: r.description,
      tags: r.tags,
      parameters: [
        ...pathParams,
        ...queryParams,
        ...(r.method === "POST" || r.method === "PATCH" || r.method === "PUT"
          ? [{ name: "Idempotency-Key", in: "header", required: false, schema: { type: "string", maxLength: 255 } }]
          : []),
      ],
      responses: {
        [okStatus]: okResponse,
        "400": { description: "Bad request", ...errorRef },
        ...(r.public ? {} : { "401": { description: "Unauthenticated", ...errorRef }, "403": { description: "Forbidden or module disabled", ...errorRef } }),
        "404": { description: "Not found", ...errorRef },
        "409": { description: "Conflict / invalid state", ...errorRef },
        "422": { description: "Validation failed", ...errorRef },
        "429": { description: "Rate limited", ...errorRef },
      },
      security: r.public ? [] : [{ apiKey: [] }, { session: [] }],
    };
    if (!r.public && "permission" in r && r.permission) op["x-permission"] = r.permission;
    if (!r.public && "module" in r && r.module) op["x-module"] = r.module;
    if (r.body) {
      op.requestBody = { required: true, content: { "application/json": { schema: toJsonSchema(r.body) } } };
    }
    paths[path] ??= {};
    paths[path][r.method.toLowerCase()] = op;
  }

  const tags = [...new Set(routes.flatMap((r) => r.tags))].sort().map((name) => ({ name }));
  return {
    openapi: "3.1.0",
    info: {
      title: "Campus Ops API",
      version: "1.0.0",
      description: [
        "REST API for the Campus Ops platform (facility, expense, task and PO management).",
        "",
        "**Authentication**: `Authorization: Bearer co_live_…` API key (scoped, revocable, rate limited) or the browser session.",
        "**Pagination**: list endpoints return `{ data, meta: { has_more, next_cursor } }`; pass `cursor` for the next page.",
        "**Idempotency**: send `Idempotency-Key` on POST/PATCH to make retries safe.",
        "**Errors**: `{ error: { code, message, details, request_id } }`.",
        "**Money** is in the organisation currency (INR by default); timestamps are UTC ISO-8601.",
      ].join("\n"),
    },
    servers: [{ url: `${serverUrl}/api/v1` }],
    tags,
    paths,
    components: {
      securitySchemes: {
        apiKey: { type: "http", scheme: "bearer", description: "API key created in Settings > API keys" },
        session: { type: "apiKey", in: "cookie", name: "sb-access-token" },
      },
      schemas: {
        Error: errorSchema,
        Object: { type: "object", properties: { data: { type: "object" } } },
        List: {
          type: "object",
          properties: {
            data: { type: "array", items: { type: "object" } },
            meta: {
              type: "object",
              properties: {
                has_more: { type: "boolean" },
                next_cursor: { type: ["string", "null"] },
                total: { type: "integer" },
                page: { type: "integer" },
                limit: { type: "integer" },
              },
            },
          },
        },
      },
    },
  };
}
