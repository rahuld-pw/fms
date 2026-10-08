"use client";
import { useState, type ReactNode } from "react";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils/cn";

/*
 * Small, dependency-free charts following the data-viz method: thin marks with
 * 4px rounded data ends on the baseline, 2px surface gaps, recessive axes, a
 * legend for 2+ series, hover tooltips with values, and text in text colours
 * (never the series colour). Categorical colours come from the validated
 * --chart-N tokens in fixed order.
 */

export interface Series {
  key: string;
  label: string;
  color: string; // CSS colour, e.g. "var(--chart-1)"
}

export function Legend({ series }: { series: Series[] }) {
  if (series.length < 2) return null;
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {series.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px]" style={{ background: s.color }} />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

/** Grouped columns over a categorical/time x-axis (e.g. opened vs resolved per day). */
export function ColumnChart({
  data,
  x,
  series,
  height = 180,
  formatX = (v) => String(v),
  formatY = (v) => String(v),
  ariaLabel,
}: {
  data: Record<string, number | string>[];
  x: string;
  series: Series[];
  height?: number;
  formatX?: (v: string) => string;
  formatY?: (v: number) => string;
  ariaLabel: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(0, ...data.flatMap((d) => series.map((s) => Number(d[s.key]) || 0))));
  const W = 600;
  const H = height;
  const padL = 28;
  const padB = 20;
  const plotW = W - padL;
  const plotH = H - padB - 6;
  const band = plotW / Math.max(1, data.length);
  const gap = 2;
  const barW = Math.max(2, Math.min(14, (band * 0.7 - gap * (series.length - 1)) / series.length));
  const ticks = [0, max / 2, max];
  const labelEvery = Math.ceil(data.length / 8);
  const yOf = (v: number) => 6 + plotH - (v / max) * plotH;

  return (
    <div className="flex flex-col gap-2">
      <Legend series={series} />
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={ariaLabel} onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={W} y1={yOf(t)} y2={yOf(t)} stroke="currentColor" className="text-border" strokeWidth={1} />
              <text x={padL - 6} y={yOf(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[10px]">
                {formatY(t)}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const groupW = series.length * barW + gap * (series.length - 1);
            const x0 = padL + i * band + (band - groupW) / 2;
            return (
              <g key={i} onMouseEnter={() => setHover(i)}>
                {/* hit target: the whole band, bigger than the marks */}
                <rect x={padL + i * band} y={0} width={band} height={H - padB} fill="transparent" />
                {hover === i && <rect x={padL + i * band} y={6} width={band} height={plotH} className="fill-muted" opacity={0.6} />}
                {series.map((s, j) => {
                  const v = Number(d[s.key]) || 0;
                  const y = yOf(v);
                  const h = Math.max(0, 6 + plotH - y);
                  const r = Math.min(4, barW / 2, h);
                  const bx = x0 + j * (barW + gap);
                  return h > 0 ? (
                    <path
                      key={s.key}
                      d={`M${bx},${y + h} V${y + r} Q${bx},${y} ${bx + r},${y} H${bx + barW - r} Q${bx + barW},${y} ${bx + barW},${y + r} V${y + h} Z`}
                      fill={s.color}
                    />
                  ) : null;
                })}
                {i % labelEvery === 0 && (
                  <text x={padL + i * band + band / 2} y={H - 6} textAnchor="middle" className="fill-muted-foreground text-[10px]">
                    {formatX(String(d[x]))}
                  </text>
                )}
              </g>
            );
          })}
          <line x1={padL} x2={W} y1={6 + plotH} y2={6 + plotH} stroke="currentColor" className="text-muted-foreground/40" />
        </svg>
        {hover !== null && data[hover] && (
          <div
            className="pointer-events-none absolute top-0 z-10 rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md"
            style={{ left: `clamp(0px, calc(${((padL + hover * band + band / 2) / W) * 100}% - 60px), calc(100% - 140px))` }}
          >
            <div className="mb-0.5 font-medium">{formatX(String(data[hover][x]))}</div>
            {series.map((s) => (
              <div key={s.key} className="flex items-center gap-1.5">
                <span className="size-2 rounded-[2px]" style={{ background: s.color }} />
                <span className="text-muted-foreground">{s.label}</span>
                <span className="ml-auto pl-3 font-medium tabular">{formatY(Number(data[hover][s.key]) || 0)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Horizontal "budget bullet" bars: actual + committed stacked against the total
 * budget (track). Over-budget is shown with a marker and a text label, not
 * colour alone.
 */
export function BudgetBars({
  rows,
  format,
}: {
  rows: { id: string; label: string; total: number; committed: number; actual: number }[];
  format: (v: number) => string;
}) {
  const { t } = useT();
  const [hover, setHover] = useState<string | null>(null);
  const series: Series[] = [
    { key: "actual", label: t("shared.chart.actual"), color: "var(--chart-1)" },
    { key: "committed", label: t("shared.chart.committedOpenPos"), color: "var(--chart-2)" },
  ];
  const max = Math.max(1, ...rows.map((r) => Math.max(r.total, r.actual + r.committed)));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-4">
        <Legend series={series} />
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="h-2.5 w-4 rounded-[3px] bg-chart-track" /> {t("ui.budget")}
        </span>
      </div>
      <ul className="flex flex-col gap-2.5">
        {rows.map((r) => {
          const used = r.actual + r.committed;
          const over = used > r.total;
          const pct = r.total > 0 ? Math.round((used / r.total) * 100) : null;
          return (
            <li key={r.id} className="relative grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-sm" onMouseEnter={() => setHover(r.id)} onMouseLeave={() => setHover(null)}>
              <span className="truncate text-muted-foreground" title={r.label}>
                {r.label}
              </span>
              <div className="relative h-3">
                <div className="absolute inset-y-0 left-0 rounded bg-chart-track" style={{ width: `${(r.total / max) * 100}%` }} />
                <div className="absolute inset-y-0 left-0 flex gap-[2px]" style={{ width: `${(used / max) * 100}%` }}>
                  {r.actual > 0 && <div className="h-full rounded-l rounded-r-[4px]" style={{ background: "var(--chart-1)", flex: r.actual }} />}
                  {r.committed > 0 && <div className="h-full rounded-r-[4px]" style={{ background: "var(--chart-2)", flex: r.committed }} />}
                </div>
                {r.total > 0 && <div className="absolute -inset-y-0.5 w-0.5 bg-foreground/70" style={{ left: `${(r.total / max) * 100}%` }} title={t("ui.budget")} />}
              </div>
              <span className={cn("w-16 text-right text-xs tabular", over ? "font-semibold text-destructive" : "text-muted-foreground")}>
                {pct === null ? t("shared.chart.noBudget") : `${pct}%${over ? " ⚠" : ""}`}
              </span>
              {hover === r.id && (
                <div className="pointer-events-none absolute top-full left-36 z-10 mt-1 rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md">
                  <div className="mb-0.5 font-medium">{r.label}</div>
                  <div>{withValue(t("shared.chart.budgetValue"), <b className="tabular">{format(r.total)}</b>)}</div>
                  <div>{withValue(t("shared.chart.actualValue"), <b className="tabular">{format(r.actual)}</b>)}</div>
                  <div>{withValue(t("shared.chart.committedValue"), <b className="tabular">{format(r.committed)}</b>)}</div>
                  <div>{withValue(t("shared.chart.availableValue"), <b className={cn("tabular", over && "text-destructive")}>{format(r.total - used)}</b>)}</div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Puts a node where `{value}` appears in a translated label. */
function withValue(text: string, node: ReactNode) {
  const [pre, post] = text.split("{value}");
  return (
    <>
      {pre}
      {post !== undefined && node}
      {post}
    </>
  );
}

/** Single-series horizontal bars for a breakdown (one hue; the title names it, so no legend). */
export function BreakdownBars({ rows, format = (v) => v.toLocaleString("en-IN") }: { rows: { label: string; value: number; href?: string }[]; format?: (v: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[minmax(0,8rem)_1fr_auto] items-center gap-3 text-sm">
          <span className="truncate text-muted-foreground">{r.label}</span>
          <div className="h-2.5">
            <div className="h-full rounded-r-[4px] rounded-l-sm" style={{ width: `${Math.max(r.value > 0 ? 2 : 0, (r.value / max) * 100)}%`, background: "var(--chart-1)" }} />
          </div>
          <span className="w-10 text-right text-xs font-medium tabular">{format(r.value)}</span>
        </li>
      ))}
    </ul>
  );
}
