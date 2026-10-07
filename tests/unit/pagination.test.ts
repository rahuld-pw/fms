import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor, keysetFilter, listParamsSchema, pgrstValue } from "@/lib/api/pagination";

describe("cursor pagination", () => {
  it("round-trips cursors as opaque base64url", () => {
    const c = { v: "2026-10-07T10:00:00Z", id: "6f1c1d1e-0000-4000-8000-000000000001" };
    const s = encodeCursor(c);
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(s)).toEqual(c);
  });

  it("rejects tampered cursors with a 400-style error", () => {
    expect(() => decodeCursor("not-a-cursor")).toThrow(/Invalid cursor/);
    expect(() => decodeCursor(Buffer.from(JSON.stringify({ v: 1 })).toString("base64url"))).toThrow(/Invalid cursor/);
  });

  it("builds keyset filters that break ties on id and keep nulls last", () => {
    expect(keysetFilter("created_at", false, { v: "2026-01-01", id: "x" })).toBe('created_at.lt."2026-01-01",and(created_at.eq."2026-01-01",id.lt.x),created_at.is.null');
    expect(keysetFilter("due_date", true, { v: null, id: "y" })).toBe("and(due_date.is.null,id.gt.y)");
  });

  it("escapes values used inside PostgREST filter lists", () => {
    expect(pgrstValue('a"b,c\\')).toBe('"a\\"b,c\\\\"');
  });

  it("validates list params", () => {
    expect(listParamsSchema.parse({})).toMatchObject({ limit: 25 });
    expect(listParamsSchema.parse({ limit: "50", sort: "-created_at" })).toMatchObject({ limit: 50, sort: "-created_at" });
    expect(() => listParamsSchema.parse({ limit: "500" })).toThrow();
    expect(() => listParamsSchema.parse({ sort: "name;drop" })).toThrow();
  });
});
