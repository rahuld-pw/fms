import { formatInTimeZone } from "date-fns-tz";
import { formatDistanceToNowStrict } from "date-fns";

/** Money in the org currency, Indian digit grouping for en-IN (12,34,567.00). */
export function formatMoney(value: number | string | null | undefined, currency = "INR", locale = "en-IN", compact = false) {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: compact ? 1 : 2,
    minimumFractionDigits: compact ? 0 : 2,
    notation: compact ? "compact" : "standard",
  }).format(n);
}

export function formatNumber(value: number | string | null | undefined, locale = "en-IN") {
  if (value === null || value === undefined || value === "") return "—";
  return new Intl.NumberFormat(locale).format(Number(value));
}

/** Timestamps are stored in UTC and displayed in the organisation's timezone. */
export function formatDateTime(value: string | Date | null | undefined, timeZone = "Asia/Kolkata", pattern = "dd MMM yyyy, HH:mm") {
  if (!value) return "—";
  return formatInTimeZone(value, timeZone, pattern);
}

export function formatDate(value: string | Date | null | undefined, timeZone = "Asia/Kolkata") {
  if (!value) return "—";
  // plain dates (YYYY-MM-DD) have no timezone: format as-is
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-").map(Number);
    return formatInTimeZone(new Date(Date.UTC(y, m - 1, d, 12)), "UTC", "dd MMM yyyy");
  }
  return formatInTimeZone(value, timeZone, "dd MMM yyyy");
}

export function relativeTime(value: string | Date | null | undefined) {
  if (!value) return "—";
  return formatDistanceToNowStrict(new Date(value), { addSuffix: true });
}

export const humanize = (s: string | null | undefined) =>
  s ? s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : "—";

/** Financial year label (Apr–Mar default) for a date, e.g. "FY 2026-27". */
export function fyLabel(date: Date, fyStartMonth = 4) {
  const m = date.getMonth() + 1;
  const start = m >= fyStartMonth ? date.getFullYear() : date.getFullYear() - 1;
  return fyStartMonth === 1 ? `FY ${start}` : `FY ${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

export function initials(name: string | null | undefined) {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}
