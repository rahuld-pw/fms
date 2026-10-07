"use client";
import { Suspense } from "react";
import { DataTable } from "@/components/shared/data-table";
import { DateTime } from "@/components/shared/format";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status";
import { humanize } from "@/lib/utils/format";

export default function RfqsPage() {
  return (
    <div>
      <PageHeader title="Requests for quotation" description="Quotes collected from vendors against approved requisitions." breadcrumbs={[{ label: "Requisitions", href: "/po/requisitions" }, { label: "RFQs" }]} />
      <Suspense>
        <DataTable
          id="rfqs"
          endpoint="/rfqs"
          defaultSort="-created_at"
          rowHref={(r) => `/po/rfqs/${r.id}`}
          columns={[
            { key: "number", header: "#", sortable: true, className: "whitespace-nowrap font-mono text-xs text-muted-foreground" },
            { key: "title", header: "RFQ", pinned: true, render: (r) => <span className="font-medium">{r.title}</span> },
            { key: "requisition", header: "Requisition", render: (r) => r.requisition?.number },
            { key: "vendors", header: "Responses", render: (r) => `${(r.vendors ?? []).filter((v: { responded_at: string | null }) => v.responded_at).length} / ${(r.vendors ?? []).length}` },
            { key: "due_date", header: "Due", sortable: true, render: (r) => <DateTime value={r.due_date} dateOnly /> },
            { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
          ]}
          filters={[{ key: "status", label: "Status", type: "multi", options: ["draft", "sent", "awarded", "closed", "cancelled"].map((v) => ({ value: v, label: humanize(v) })) }]}
        />
      </Suspense>
    </div>
  );
}
