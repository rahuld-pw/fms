"use client";
import { useRouter } from "next/navigation";
import { Suspense, useState } from "react";
import { CalendarDays, MapPin, Plus, Tag } from "lucide-react";
import { useCan, useSession } from "@/components/app/session";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { ResourceFormDialog } from "@/components/shared/resource-form";
import { StatusBadge } from "@/components/shared/status";
import { useT } from "@/lib/i18n/client";

export default function AuditsPage() {
  const { t } = useT();
  const can = useCan();
  const router = useRouter();
  const { campuses } = useSession();
  const [open, setOpen] = useState(false);
  const [populating, setPopulating] = useState(false);
  return (
    <div>
      <PageHeader title={t("facility.assets.audits.title")} breadcrumbs={[{ label: t("facility.assets.title"), href: "/facility/assets" }, { label: t("facility.assets.auditsLabel") }]} description={t("facility.assets.audits.description")} />
      <Suspense>
        <DataTable
          id="asset-audits"
          endpoint="/asset-audits"
          defaultSort="-scheduled_for"
          rowHref={(r) => `/facility/assets/audits/${r.id}`}
          exportable={false}
          columns={[
            { key: "name", header: t("facility.assets.audits.colAudit"), pinned: true, render: (r) => <span className="font-medium">{r.name}</span> },
            { key: "campus", header: t("ui.campus"), render: (r) => r.campus?.name },
            { key: "location", header: t("facility.assets.audits.colScope"), className: "max-w-64 truncate", render: (r) => (r.location ? [...r.location.path_names, r.location.name].join(" › ") : t("facility.assets.audits.wholeCampus")) },
            { key: "category", header: t("facility.assets.audits.limitCategory"), defaultHidden: true, render: (r) => r.category?.name ?? "—" },
            { key: "scheduled_for", header: t("facility.workOrders.scheduled"), sortable: true },
            { key: "status", header: t("ui.status"), render: (r) => <StatusBadge status={r.status} /> },
          ]}
          mobileCard={(r) => (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="font-medium">{r.name}</span>
                <span className="ml-auto shrink-0"><StatusBadge status={r.status} /></span>
              </div>
              <span className="flex items-start gap-1 text-xs text-muted-foreground">
                <MapPin className="mt-px size-3 shrink-0" />
                <span className="break-words">
                  {r.location
                    ? [...(campuses.length > 1 ? [r.campus?.name] : []), ...r.location.path_names, r.location.name].filter(Boolean).join(" › ")
                    : `${r.campus?.name ?? ""} · ${t("facility.assets.audits.wholeCampus")}`}
                </span>
              </span>
              {r.category && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Tag className="size-3 shrink-0" />
                  <span className="truncate">{r.category.name}</span>
                </span>
              )}
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <CalendarDays className="size-3 shrink-0" />
                <span>{r.scheduled_for}</span>
              </span>
            </div>
          )}
          toolbar={can("asset_audit:create") && <Button size="sm" loading={populating} onClick={() => setOpen(true)}><Plus /> {t("facility.assets.audits.newAudit")}</Button>}
        />
      </Suspense>
      <ResourceFormDialog
        open={open}
        onOpenChange={setOpen}
        title={t("facility.assets.audits.planTitle")}
        endpoint="/asset-audits"
        fields={[
          { name: "name", label: t("ui.name"), required: true, full: true, placeholder: t("facility.assets.audits.namePlaceholder") },
          { name: "campus_id", label: t("ui.campus"), type: "campus", required: true },
          { name: "scheduled_for", label: t("ui.date"), type: "date" },
          { name: "location_id", label: t("facility.assets.audits.limitLocation"), type: "location", campusField: "campus_id", hint: t("facility.assets.audits.limitLocationHint") },
          { name: "category_id", label: t("facility.assets.audits.limitCategory"), type: "resource", endpoint: "/asset-categories" },
        ]}
        defaultValues={{ campus_id: campuses.length === 1 ? campuses[0].id : "", scheduled_for: new Date().toISOString().slice(0, 10) }}
        invalidate={["/asset-audits"]}
        onSaved={async (r: { id: string }) => {
          setPopulating(true);
          try {
            await fetch(`/api/v1/asset-audits/${r.id}/populate`, { method: "POST" });
          } finally {
            setPopulating(false);
          }
          router.push(`/facility/assets/audits/${r.id}`);
        }}
      />
    </div>
  );
}
