import { describe, expect, it } from "vitest";
import { getPath, parseCsv, parseCsvObjects, toCsv } from "@/lib/utils/csv";

describe("toCsv", () => {
  it("writes headers, nested paths and CRLF line endings", () => {
    const csv = toCsv([{ number: "PO/1", vendor: { name: "LabLine" }, total: 1200.5 }], [["number", "PO"], ["vendor.name", "Vendor"], ["total", "Total"]]);
    expect(csv).toBe("PO,Vendor,Total\r\nPO/1,LabLine,1200.5\r\n");
  });

  it("quotes commas, quotes and newlines", () => {
    expect(toCsv([{ a: 'He said "hi", then\nleft' }], [["a", "A"]])).toBe('A\r\n"He said ""hi"", then\nleft"\r\n');
  });

  it("neutralises spreadsheet formula injection but keeps negative numbers", () => {
    const csv = toCsv([{ a: "=HYPERLINK(\"x\")" }, { a: "-42" }, { a: "@SUM(A1)" }], [["a", "A"]]);
    const lines = csv.trim().split("\r\n");
    expect(lines[1]).toBe(`"'=HYPERLINK(""x"")"`);
    expect(lines[2]).toBe("-42");
    expect(lines[3]).toBe("'@SUM(A1)");
  });

  it("joins arrays and blanks nulls", () => {
    expect(toCsv([{ tags: ["a", "b"], x: null }], [["tags", "Tags"], ["x", "X"]])).toBe("Tags,X\r\na; b,\r\n");
  });
});

describe("parseCsv", () => {
  it("round-trips quoted fields and strips a BOM", () => {
    expect(parseCsv('﻿name,notes\r\n"Desk, oak","say ""hi"""\n\nChair,\n')).toEqual([["name", "notes"], ["Desk, oak", 'say "hi"'], ["Chair", ""]]);
  });

  it("parses objects with normalised header keys", () => {
    expect(parseCsvObjects("Asset Name,Purchase Cost (INR)\nProjector , 45000\n")).toEqual([{ asset_name: "Projector", purchase_cost_inr: "45000" }]);
  });

  it("reads dotted paths safely", () => {
    expect(getPath({ a: { b: { c: 1 } } }, "a.b.c")).toBe(1);
    expect(getPath({ a: null }, "a.b")).toBeUndefined();
  });
});
