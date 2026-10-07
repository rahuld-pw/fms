import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Module, RequestContext } from "@/lib/auth/context";
import { getApiContext } from "@/lib/auth/context";
import { ApiError } from "./errors";
import { clientIp, errorResponse, json, rateLimit } from "./http";
import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/server";

export type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

interface BaseArgs {
  req: Request;
  params: Record<string, string>;
  query: URLSearchParams;
  requestId: string;
}

export interface AuthedArgs<B> extends BaseArgs {
  ctx: RequestContext;
  body: B;
}

export interface PublicArgs<B> extends BaseArgs {
  ip: string;
  body: B;
}

interface RouteMeta {
  method: Method;
  path: string; // e.g. /issues/:id/comments
  summary: string;
  description?: string;
  tags: string[];
  /** Response description for docs: "list" (paginated), "object", "csv", "none" or a schema. */
  response?: "list" | "object" | "csv" | "none" | "pdf" | z.ZodType;
  query?: z.ZodObject;
  status?: number;
}

export interface AuthedRoute<B = unknown> extends RouteMeta {
  public?: false;
  /** Required module; a list means any one of them (shared master data). */
  module?: Module | Module[];
  permission?: string;
  body?: z.ZodType<B>;
  handler: (args: AuthedArgs<B>) => Promise<unknown>;
}

export interface PublicRoute<B = unknown> extends RouteMeta {
  public: true;
  rateLimit: { name: string; limit: number; windowSeconds?: number };
  body?: z.ZodType<B>;
  handler: (args: PublicArgs<B>) => Promise<unknown>;
}

export type RouteDef = AuthedRoute<any> | PublicRoute<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Typed helper so handler bodies are inferred from the zod schema. */
export function route<B = undefined>(def: AuthedRoute<B>): RouteDef {
  return def as RouteDef;
}
export function publicRoute<B = undefined>(def: PublicRoute<B>): RouteDef {
  return def as RouteDef;
}

interface Compiled {
  def: RouteDef;
  regex: RegExp;
  keys: string[];
  specificity: number;
}

function compile(def: RouteDef): Compiled {
  const keys: string[] = [];
  const pattern = def.path
    .split("/")
    .map((seg) => {
      if (seg.startsWith(":")) {
        keys.push(seg.slice(1));
        return "([^/]+)";
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  // static segments win over params: /issues/export before /issues/:id
  const specificity = def.path.split("/").reduce((n, s) => n + (s.startsWith(":") ? 1 : 10), 0);
  return { def, regex: new RegExp(`^${pattern}/?$`), keys, specificity };
}

export class Router {
  private compiled: Compiled[] = [];

  constructor(readonly routes: RouteDef[]) {
    this.compiled = routes.map(compile).sort((a, b) => b.specificity - a.specificity);
  }

  match(method: string, path: string) {
    let pathMatched = false;
    for (const c of this.compiled) {
      const m = c.regex.exec(path);
      if (!m) continue;
      pathMatched = true;
      if (c.def.method !== method) continue;
      const params: Record<string, string> = {};
      c.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      return { def: c.def, params };
    }
    return pathMatched ? "method_not_allowed" : null;
  }

  async handle(req: Request, path: string): Promise<Response> {
    const requestId = req.headers.get("x-request-id") ?? randomUUID();
    try {
      const matched = this.match(req.method, path);
      if (matched === null) throw new ApiError("not_found", `No route for ${req.method} ${path}`);
      if (matched === "method_not_allowed") throw new ApiError("bad_request", `Method ${req.method} not allowed on ${path}`);
      const { def, params } = matched;
      const url = new URL(req.url);
      const bodyText = req.method === "GET" || req.method === "DELETE" ? "" : await req.text();
      const rawBody = bodyText ? JSON.parse(bodyText) : {};
      if (def.query) def.query.parse(Object.fromEntries(url.searchParams));

      if (def.public) {
        const ip = clientIp(req);
        await rateLimit(`ip:${ip}:${def.rateLimit.name}`, def.rateLimit.limit, def.rateLimit.windowSeconds ?? 60);
        const body = def.body ? def.body.parse(rawBody) : undefined;
        const result = await def.handler({ req, params, query: url.searchParams, requestId, ip, body });
        return toResponse(result, def, req, requestId);
      }

      const ctx = await getApiContext(req, requestId);
      if (ctx.apiKey) await rateLimit(`key:${ctx.apiKey.id}`, ctx.apiKey.rateLimitPerMinute);
      else if (req.method !== "GET") await rateLimit(`user:${ctx.userId}`, 600);
      if (def.module) await ctx.requireModule(def.module);
      if (def.permission) await ctx.require(def.permission, {}, "anywhere");

      return await withIdempotency(req, ctx, path, bodyText, async () => {
        const body = def.body ? def.body.parse(rawBody) : rawBody;
        const result = await def.handler({ req, params, query: url.searchParams, requestId, ctx, body });
        return toResponse(result, def, req, requestId);
      });
    } catch (e) {
      return errorResponse(e, requestId);
    }
  }
}

function toResponse(result: unknown, def: RouteDef, req: Request, requestId: string): Response {
  if (result instanceof Response) {
    result.headers.set("x-request-id", requestId);
    return result;
  }
  if (result === undefined) return new Response(null, { status: 204, headers: { "x-request-id": requestId } });
  const isList = !!result && typeof result === "object" && "data" in result && "meta" in result;
  return json(isList ? result : { data: result }, {
    status: def.status ?? (req.method === "POST" ? 201 : 200),
    requestId,
  });
}

async function withIdempotency(
  req: Request,
  ctx: RequestContext,
  path: string,
  bodyText: string,
  run: () => Promise<Response>,
): Promise<Response> {
  const key = req.headers.get("idempotency-key");
  if (!key || req.method === "GET") return run();
  if (key.length > 255) throw new ApiError("bad_request", "Idempotency-Key is too long");
  const admin = createAdminClient();
  const scope = `${ctx.orgId}:${ctx.apiKey?.id ?? ctx.userId}`;
  const hash = createHash("sha256").update(`${req.method}\n${path}\n${bodyText}`).digest("hex");
  const { data, error } = await admin.rpc("idempotency_begin", {
    p_scope: scope,
    p_key: key,
    p_request_hash: hash,
    p_method: req.method,
    p_path: path,
  });
  if (error) return run();
  const state = data?.[0];
  if (state?.state === "replay") {
    const res = json(state.response, { status: state.status_code ?? 200 });
    res.headers.set("idempotent-replayed", "true");
    return res;
  }
  if (state?.state === "mismatch")
    throw new ApiError("idempotency_conflict", "Idempotency-Key was already used with a different request");
  if (state?.state === "in_progress")
    throw new ApiError("idempotency_conflict", "A request with this Idempotency-Key is still in progress");
  try {
    const res = await run();
    if (res.status < 500) {
      const body = res.status === 204 ? null : await res.clone().json().catch(() => null);
      await admin.rpc("idempotency_complete", { p_scope: scope, p_key: key, p_status_code: res.status, p_response: body });
    } else {
      await admin.rpc("idempotency_release", { p_scope: scope, p_key: key });
    }
    return res;
  } catch (e) {
    await admin.rpc("idempotency_release", { p_scope: scope, p_key: key });
    throw e;
  }
}
