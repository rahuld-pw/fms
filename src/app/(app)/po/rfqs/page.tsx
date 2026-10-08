"use client";
import { Suspense } from "react";
import { DataTable } from "@/components/shared/data-table";
import { DateTime } from "@/components/shared/format";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status";
import { useT } from "@/lib/i18n/client";
import { humanize } from "@/lib/utils/format";

export default function RfqsPage() {
  const { t } = useT();
  return (
    <div>
      <PageHeader title={t("po.rfqs.title")} description={t("po.rfqs.description")} breadcrumbs={[{ label: t("po.common.requisitions"), href: "/po/requisitions" }, { label: t("po.rfqs.rfqs") }]} />
      <Suspense>
        <DataTable
          id="rfqs"
          endpoint="/rfqs"
          defaultSort="-created_at"
          rowHref={(r) => `/po/rfqs/${r.id}`}
          columns={[
            { key: "number", header: "#", sortable: true, className: "whitespace-nowrap font-mono text-xs text-muted-foreground" },
            { key: "title", header: t("po.rfqs.rfq"), pinned: true, render: (r) => <span className="font-medium">{r.title}</span> },
            { key: "requisition", header: t("po.common.requisition"), render: (r) => r.requisition?.number },
            { key: "vendors", header: t("po.rfqs.responses"), render: (r) => `${(r.vendors ?? []).filter((v: { responded_at: string | null }) => v.responded_at).length} / ${(r.vendors ?? []).length}` },
            { key: "due_date", header: t("ui.due"), sortable: true, render: (r) => <DateTime value={r.due_date} dateOnly /> },
            { key: "status", header: t("ui.status"), render: (r) => <StatusBadge status={r.status} /> },
          ]}
          filters={[{ key: "status", label: t("ui.status"), type: "multi", options: ["draft", "sent", "awarded", "closed", "cancelled"].map((v) => ({ value: v, label: t(`status.${v}`, undefined, humanize(v)) })) }]}
        />
      </Suspense>
    </div>
  );
}
