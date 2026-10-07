import { cn } from "@/lib/utils/cn";

export function Progress({ value, className, tone = "primary" }: { value: number; className?: string; tone?: "primary" | "warning" | "destructive" }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div
        className={cn("h-full rounded-full transition-[width]", { primary: "bg-primary", warning: "bg-warning", destructive: "bg-destructive" }[tone])}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
