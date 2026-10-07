import { z } from "zod";
import { ApiError } from "./errors";

export interface Cursor {
  v: string | number | boolean | null;
  id: string;
}

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}

export function decodeCursor(s: string): Cursor {
  try {
    const c = JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
    if (typeof c !== "object" || typeof c.id !== "string") throw new Error();
    return c as Cursor;
  } catch {
    throw new ApiError("bad_request", "Invalid cursor");
  }
}

export const listParamsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(25),
  cursor: z.string().optional(),
  page: z.coerce.number().int().min(1).optional(),
  sort: z.string().regex(/^-?[a-z_]+$/).optional(),
  q: z.string().trim().max(200).optional(),
});
export type ListParams = z.infer<typeof listParamsSchema>;

export interface ListMeta {
  has_more: boolean;
  next_cursor: string | null;
  total?: number;
  page?: number;
  limit: number;
}

export interface ListResult<T> {
  data: T[];
  meta: ListMeta;
}

/** Quotes a value for a PostgREST filter expression (or/and lists). */
export function pgrstValue(v: unknown): string {
  const s = String(v);
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Keyset condition for "rows after the cursor" given the sort direction.
 * Rows are ordered by (field, id) and nulls sort last.
 */
export function keysetFilter(field: string, ascending: boolean, c: Cursor): string {
  const op = ascending ? "gt" : "lt";
  if (c.v === null) return `and(${field}.is.null,id.${op}.${c.id})`;
  const v = pgrstValue(c.v);
  return `${field}.${op}.${v},and(${field}.eq.${v},id.${op}.${c.id}),${field}.is.null`;
}
