"use client";
import { useT } from "@/lib/i18n/client";
import { useNow } from "@/lib/client/use-now";
import { useOptionalSession } from "@/components/app/session";
import { Tooltip } from "@/components/ui/tooltip";
import { formatDate, formatDateTime, formatMoney, relativeTime } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

// Outside an organisation (platform console) fall back to Indian defaults.
const FALLBACK = { currency: "INR", locale: "en-IN", timezone: "Asia/Kolkata" };
function useOrgFormat() {
  return useOptionalSession()?.org ?? FALLBACK;
}

/** Money in the organisation currency and locale. */
export function Money({ value, compact, className }: { value: number | string | null | undefined; compact?: boolean; className?: string }) {
  const org = useOrgFormat();
  return <span className={cn("tabular whitespace-nowrap", className)}>{formatMoney(value, org.currency, org.locale, compact)}</span>;
}

export function useMoney() {
  const org = useOrgFormat();
  return (v: number | string | null | undefined, compact?: boolean) => formatMoney(v, org.currency, org.locale, compact);
}

/** UTC timestamp rendered in the organisation timezone. */
export function DateTime({ value, relative, dateOnly }: { value: string | null | undefined; relative?: boolean; dateOnly?: boolean }) {
  const { locale } = useT();
  const org = useOrgFormat();
  if (!value) return <span className="text-muted-foreground">—</span>;
  const full = formatDateTime(value, org.timezone, undefined, locale);
  if (relative)
    return (
      <Tooltip content={full}>
        <time dateTime={value} className="whitespace-nowrap">
          {relativeTime(value, locale)}
        </time>
      </Tooltip>
    );
  return (
    <time dateTime={value} className="whitespace-nowrap">
      {dateOnly ? formatDate(value, org.timezone, locale) : full}
    </time>
  );
}

/** Due date with overdue / due-soon emphasis. */
export function DueDate({ value, done }: { value: string | null | undefined; done?: boolean }) {
  const { locale } = useT();
  const org = useOrgFormat();
  const now = useNow();
  if (!value) return <span className="text-muted-foreground">—</span>;
  const due = new Date(value.length === 10 ? `${value}T23:59:59` : value).getTime();
  const overdue = !done && due < now;
  const soon = !done && !overdue && due - now < 2 * 86400_000;
  return (
    <span className={cn("whitespace-nowrap", overdue && "font-medium text-destructive", soon && "text-amber-600 dark:text-amber-400")}>
      {value.length === 10 ? formatDate(value, undefined, locale) : formatDateTime(value, org.timezone, "dd MMM, HH:mm", locale)}
    </span>
  );
}
