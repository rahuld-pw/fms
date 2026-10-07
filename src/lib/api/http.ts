import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { ApiError, errorBody, fromZodError } from "./errors";

export function json(data: unknown, init: ResponseInit & { requestId?: string } = {}) {
  const res = NextResponse.json(data, init);
  if (init.requestId) res.headers.set("x-request-id", init.requestId);
  return res;
}

export function errorResponse(e: unknown, requestId: string) {
  let err: ApiError;
  if (e instanceof ApiError) err = e;
  else if (e instanceof z.ZodError) err = fromZodError(e);
  else if (e instanceof SyntaxError) err = new ApiError("bad_request", "Malformed JSON body");
  else {
    console.error(`[${requestId}]`, e);
    err = new ApiError("internal_error", "Something went wrong");
  }
  const res = json(errorBody(err, requestId), { status: err.status, requestId });
  for (const [k, v] of Object.entries(err.headers ?? {})) res.headers.set(k, v);
  return res;
}

export async function readJson<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  const text = await req.text();
  const body = text ? JSON.parse(text) : {};
  return schema.parse(body);
}

export function clientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

/** Fixed-window rate limiting backed by Postgres (works on serverless). */
export async function rateLimit(bucket: string, limit: number, windowSeconds = 60) {
  const { data, error } = await createAdminClient().rpc("rate_limit_hit", {
    p_bucket: bucket,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) return; // fail open: rate limiting must not take the API down
  const row = data?.[0];
  if (row && !row.allowed) {
    const retry = Math.max(1, Math.ceil((new Date(row.reset_at).getTime() - Date.now()) / 1000));
    throw new ApiError("rate_limited", "Too many requests, slow down", undefined, {
      "retry-after": String(retry),
      "x-ratelimit-limit": String(limit),
      "x-ratelimit-remaining": "0",
    });
  }
}
