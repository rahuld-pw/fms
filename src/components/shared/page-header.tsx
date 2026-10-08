import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { BreadcrumbNav } from "./breadcrumb-nav";

export function PageHeader({
  title,
  description,
  actions,
  breadcrumbs,
  className,
  meta,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  breadcrumbs?: { label: string; href?: string }[];
  className?: string;
  meta?: React.ReactNode;
}) {
  return (
    <div className={cn("mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0">
        {breadcrumbs && breadcrumbs.length > 0 && (
          <BreadcrumbNav>
            {breadcrumbs.map((b, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <ChevronRight className="size-3" />}
                {b.href ? (
                  <Link href={b.href} className="hit-area hover:text-foreground">
                    {b.label}
                  </Link>
                ) : (
                  <span>{b.label}</span>
                )}
              </span>
            ))}
          </BreadcrumbNav>
        )}
        <h1 className="text-xl font-semibold tracking-tight text-balance">{title}</h1>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
        {meta && <div className="mt-2 flex flex-wrap items-center gap-2">{meta}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, description, action }: { icon?: React.ComponentType<{ className?: string }>; title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-12 text-center">
      {Icon && <Icon className="size-8 text-muted-foreground/60" />}
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Stat({ label, value, hint, tone, href }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: "default" | "warning" | "danger" | "good"; href?: string }) {
  const inner = (
    <div className="flex h-full flex-col gap-1 rounded-lg border bg-card p-4 transition-colors hover:border-foreground/15">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span
        className={cn(
          "text-2xl font-semibold tracking-tight tabular",
          tone === "warning" && "text-amber-600 dark:text-amber-400",
          tone === "danger" && "text-destructive",
          tone === "good" && "text-primary",
        )}
      >
        {value}
      </span>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

export function DetailGrid({ items }: { items: { label: string; value: React.ReactNode; wide?: boolean }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
      {items.map((i) => (
        <div key={i.label} className={cn("min-w-0", i.wide && "sm:col-span-2")}>
          <dt className="text-xs text-muted-foreground">{i.label}</dt>
          <dd className="mt-0.5 break-words">{i.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
