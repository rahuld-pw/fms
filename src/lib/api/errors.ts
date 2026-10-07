import { z } from "zod";

export type ErrorCode =
  | "bad_request"
  | "validation_failed"
  | "unauthorized"
  | "forbidden"
  | "module_disabled"
  | "not_found"
  | "conflict"
  | "unprocessable"
  | "rate_limited"
  | "idempotency_conflict"
  | "internal_error";

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  validation_failed: 422,
  unauthorized: 401,
  forbidden: 403,
  module_disabled: 403,
  not_found: 404,
  conflict: 409,
  unprocessable: 422,
  rate_limited: 429,
  idempotency_conflict: 409,
  internal_error: 500,
};

/** The one error type thrown by the service layer; rendered as the standard error envelope. */
export class ApiError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
    readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.status = STATUS[code];
  }

  static notFound(what = "Resource") {
    return new ApiError("not_found", `${what} not found`);
  }
  static forbidden(message = "You do not have permission to perform this action") {
    return new ApiError("forbidden", message);
  }
}

/** Shape of a Postgres / PostgREST error as returned by supabase-js. */
interface PgError {
  code?: string;
  message: string;
  details?: string | null;
  hint?: string | null;
}

/**
 * Maps database errors to API errors. Business rules raised in plpgsql use
 * SQLSTATEs: 42501 permission, P0002 not found, P0001 invalid state,
 * 23514/22023 validation, 23505 duplicate.
 */
export function fromPgError(err: PgError): ApiError {
  const msg = err.message ?? "Database error";
  switch (err.code) {
    case "42501":
      return new ApiError("forbidden", msg.includes("row-level security") ? "You do not have permission to perform this action" : msg);
    case "P0002":
    case "PGRST116":
      return new ApiError("not_found", msg.includes("JSON object") ? "Resource not found" : msg);
    case "P0001":
      return new ApiError("conflict", msg);
    case "23514":
    case "22023":
    case "22P02":
    case "23502":
      return new ApiError("unprocessable", msg, err.details ?? undefined);
    case "23505":
      return new ApiError("conflict", "A record with these values already exists", err.details ?? undefined);
    case "23503":
      return new ApiError("unprocessable", "A referenced record does not exist or is still in use", err.details ?? undefined);
    default:
      return new ApiError("internal_error", "Unexpected database error", process.env.NODE_ENV === "production" ? undefined : msg);
  }
}

/**
 * Throws an ApiError if a supabase-js result carries an error, otherwise
 * returns the data (non-null: lists, single(), RPCs).
 */
export function unwrap<R extends { data: unknown; error: PgError | null }>(res: R): NonNullable<R["data"]> {
  if (res.error) throw fromPgError(res.error);
  return res.data as NonNullable<R["data"]>;
}

/** Like unwrap, for maybeSingle() where "no row" is a valid answer. */
export function unwrapMaybe<R extends { data: unknown; error: PgError | null }>(res: R): R["data"] | null {
  if (res.error) throw fromPgError(res.error);
  return res.data;
}

export function fromZodError(err: z.ZodError): ApiError {
  return new ApiError(
    "validation_failed",
    "Request validation failed",
    err.issues.map((i) => ({ path: i.path.join("."), message: i.message, code: i.code })),
  );
}

export interface ErrorBody {
  error: { code: ErrorCode; message: string; details?: unknown; request_id: string };
}

export function errorBody(e: ApiError, requestId: string): ErrorBody {
  return { error: { code: e.code, message: e.message, details: e.details, request_id: requestId } };
}
