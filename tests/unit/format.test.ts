import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatMoney, fyLabel, humanize, initials } from "@/lib/utils/format";

describe("formatting", () => {
  it("formats INR with Indian digit grouping", () => {
    expect(formatMoney(1234567.5)).toBe("₹12,34,567.50");
    expect(formatMoney("100")).toBe("₹100.00");
    expect(formatMoney(null)).toBe("—");
    expect(formatMoney("abc")).toBe("—");
  });

  it("shows UTC timestamps in the organisation's timezone", () => {
    expect(formatDateTime("2026-10-07T20:00:00Z", "Asia/Kolkata")).toBe("08 Oct 2026, 01:30");
    expect(formatDateTime("2026-10-07T20:00:00Z", "Europe/London")).toBe("07 Oct 2026, 21:00");
  });

  it("does not shift plain dates across timezones", () => {
    expect(formatDate("2026-04-01", "America/New_York")).toBe("01 Apr 2026");
  });

  it("labels Indian financial years (April–March)", () => {
    expect(fyLabel(new Date(2026, 3, 1))).toBe("FY 2026-27");
    expect(fyLabel(new Date(2027, 2, 31))).toBe("FY 2026-27");
    expect(fyLabel(new Date(2026, 5, 1), 1)).toBe("FY 2026");
  });

  it("humanizes keys and builds initials", () => {
    expect(humanize("partially_received")).toBe("Partially received");
    expect(initials("Meera Iyer")).toBe("MI");
    expect(initials(null)).toBe("?");
  });
});
