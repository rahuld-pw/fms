"use client";
import { useT } from "@/lib/i18n/client";

/** Breadcrumb landmark with a translated label (PageHeader renders on the server too). */
export function BreadcrumbNav({ children }: { children: React.ReactNode }) {
  const { t } = useT();
  return (
    <nav className="mb-1 flex items-center gap-1 text-xs text-muted-foreground" aria-label={t("shared.breadcrumb")}>
      {children}
    </nav>
  );
}
