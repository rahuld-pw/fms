import { z } from "zod";

export const uuid = z.uuid();
export const optUuid = z.uuid().nullable().optional();
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
export const isoDateTime = z.iso.datetime({ offset: true });
export const money = z.number().nonnegative().max(1e12).multipleOf(0.01);
export const quantity = z.number().positive().max(1e9);
export const text = (max = 2000) => z.string().trim().max(max);
export const name = z.string().trim().min(1).max(200);
export const code = z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{1,16}$/, "Use A-Z, 0-9, - or _ (max 16)");
export const priority = z.enum(["low", "medium", "high", "critical"]);
export const taskPriority = z.enum(["low", "medium", "high", "urgent"]);
export const json = z.record(z.string(), z.unknown());
export const customFields = z.record(z.string(), z.unknown()).optional();
export const gstin = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, "Invalid GSTIN");
export const pan = z.string().trim().toUpperCase().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, "Invalid PAN");
export const ifsc = z.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "Invalid IFSC");
export const phone = z.string().trim().regex(/^\+?[0-9 -]{7,20}$/, "Invalid phone number");
export const email = z.email().trim().toLowerCase();

/** Turn a create schema into an update schema where every field is optional. */
export function partial<T extends z.ZodObject>(schema: T) {
  return schema.partial();
}

export const commentInput = z.object({
  body: z.string().trim().min(1).max(20000),
  mentions: z.array(z.uuid()).max(50).default([]),
  is_internal: z.boolean().default(false),
  parent_id: z.uuid().optional(),
});

export const approvalActionInput = z.object({
  action: z.enum(["approve", "reject"]),
  comment: z.string().trim().max(2000).optional(),
});
