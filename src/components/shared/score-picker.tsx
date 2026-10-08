"use client";
import { Star } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils/cn";

/**
 * NPS (0-10) or CSAT (1-5) scale. Selection is shown with a ring and weight,
 * not colour alone; the two ends are labelled.
 */
export function ScorePicker({ kind, value, onChange, disabled }: { kind: "nps" | "csat"; value: number | null; onChange: (v: number) => void; disabled?: boolean }) {
  const { t } = useT();
  const scores = kind === "nps" ? Array.from({ length: 11 }, (_, i) => i) : [1, 2, 3, 4, 5];
  return (
    <div className="flex flex-col gap-1.5">
      <div role="radiogroup" aria-label={t("surveys.scale.label")} className={cn("grid gap-1", kind === "nps" ? "grid-cols-11" : "grid-cols-5")}>
        {scores.map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            disabled={disabled}
            onClick={() => onChange(n)}
            className={cn(
              "flex h-10 min-w-0 items-center justify-center rounded-md border text-sm tabular transition-colors hover:bg-muted disabled:opacity-50",
              value === n && "border-primary bg-primary font-semibold text-primary-foreground ring-2 ring-primary/30 hover:bg-primary",
            )}
          >
            {kind === "csat" ? ["😞", "🙁", "😐", "🙂", "😄"][n - 1] : n}
            {kind === "csat" && <span className="sr-only">{n}</span>}
          </button>
        ))}
      </div>
      <div className="flex justify-between text-[11px] text-muted-foreground">
        <span>{kind === "nps" ? t("surveys.scale.npsLow") : t("surveys.scale.csatLow")}</span>
        <span>{kind === "nps" ? t("surveys.scale.npsHigh") : t("surveys.scale.csatHigh")}</span>
      </div>
    </div>
  );
}

/** NPS headline: the number plus a word, so it never relies on colour alone. */
export function npsBand(nps: number | null | undefined): "excellent" | "good" | "fair" | "poor" | null {
  if (nps === null || nps === undefined) return null;
  return nps >= 50 ? "excellent" : nps >= 20 ? "good" : nps >= 0 ? "fair" : "poor";
}

export function NpsValue({ value, kind = "nps", className }: { value: number | string | null | undefined; kind?: "nps" | "csat"; className?: string }) {
  const { t } = useT();
  if (value === null || value === undefined || value === "") return <span className={cn("text-muted-foreground", className)}>—</span>;
  const n = Number(value);
  if (kind === "csat") return <span className={cn("tabular", className)}>{n.toFixed(1)}<span className="text-sm font-normal text-muted-foreground"> / 5</span></span>;
  const band = npsBand(n)!;
  return (
    <span className={cn("tabular", band === "poor" && "text-destructive", band === "excellent" && "text-primary", className)}>
      {n > 0 ? `+${n}` : n}
      <span className="ml-1.5 text-xs font-medium text-muted-foreground">{t(`surveys.band.${band}`)}</span>
    </span>
  );
}

/** Average star rating (1-5) with the number shown, not just stars. */
export function Stars({ value, className }: { value: number | null; className?: string }) {
  const { t } = useT();
  if (value === null || value === undefined) return <span className="text-muted-foreground">—</span>;
  const v = Number(value);
  return (
    <span className={`inline-flex items-center gap-1 tabular ${className ?? ""}`} aria-label={t("surveys.resolution.starsOf", { v: v.toFixed(1) })}>
      <Star className="size-4 fill-amber-400 text-amber-400" aria-hidden />
      {v.toFixed(1)}
    </span>
  );
}
