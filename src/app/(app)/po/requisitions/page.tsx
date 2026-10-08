"use client";
import Link from "next/link";
import { Suspense } from "react";
import { Plus } from "lucide-react";
import { useCan } from "@/components/app/session";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/shared/data-table";
import { DateTime, Money } from "@/components/shared/format";
import { UserChip } from "@/components/shared/fields";
import { PageHeader } from "@/components/shared/page-header";
import { PriorityLabel, StatusBadge } from "@/components/shared/status";
import { useT } from "@/lib/i18n/client";
import { humanize } from "@/lib/utils/format";

export default function RequisitionsPage() {
  const { t } = useT();
  const can = useCan();
  const statusOpt = (v: string) => ({ value: v, label: t(`status.${v}`, undefined, humanize(v)) });
  const priorityOpt = (v: string) => ({ value: v, label: t(`priority.${v}`, undefined, humanize(v)) });
  return (
    <div>
      <PageHeader
        title={t("po.requisitions.title")}
        description={t("po.requisitions.description")}
        actions={can("requisition:submit") && <Button asChild><Link href="/po/requisitions/new"><Plus /> {t("po.requisitions.newRequisition")}</Link></Button>}
      />
      <Suspense>
        <DataTable
          id="requisitions"
          endpoint="/requisitions"
          defaultSort="-created_at"
          rowHref={(r) => `/po/requisitions/${r.id}`}
          columns={[
            { key: "number", header: "#", sortable: true, className: "whitespace-nowrap font-mono text-xs text-muted-foreground" },
            { key: "title", header: t("po.common.requisition"), pinned: true, render: (r) => <span className="font-medium">{r.title}</span> },
            { key: "requester", header: t("po.common.requestedBy"), render: (r) => <UserChip name={r.requester?.full_name} /> },
            { key: "department", header: t("ui.department"), render: (r) => r.department?.name ?? r.campus?.name },
            { key: "priority", header: t("ui.priority"), render: (r) => <PriorityLabel priority={r.priority} /> },
            { key: "estimated_total", header: t("po.requisitions.estimate"), sortable: true, align: "right", render: (r) => <Money value={r.estimated_total} /> },
            { key: "needed_by", header: t("po.common.neededBy"), sortable: true, render: (r) => <DateTime value={r.needed_by} dateOnly /> },
            { key: "status", header: t("ui.status"), render: (r) => <StatusBadge status={r.status} /> },
            { key: "created_at", header: t("ui.created"), sortable: true, defaultHidden: true, render: (r) => <DateTime value={r.created_at} relative /> },
          ]}
          filters={[
            { key: "status", label: t("ui.status"), type: "multi", options: ["draft", "pending_approval", "approved", "rejected", "rfq", "ordered", "closed", "cancelled"].map(statusOpt) },
            { key: "requested_by", label: t("po.common.requestedBy"), type: "select", options: [{ value: "me", label: t("po.requisitions.me") }] },
            { key: "priority", label: t("ui.priority"), type: "multi", options: ["low", "medium", "high", "urgent"].map(priorityOpt) },
            { key: "created_at", label: t("ui.created"), type: "date-range" },
          ]}
          mobileCard={(r) => (
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{r.title}</p>
                <p className="text-xs text-muted-foreground">{r.number} · {r.requester?.full_name}</p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <Money value={r.estimated_total} className="text-sm font-medium" />
                <StatusBadge status={r.status} />
              </div>
            </div>
          )}
        />
      </Suspense>
    </div>
  );
}
