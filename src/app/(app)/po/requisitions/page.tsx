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
import { humanize } from "@/lib/utils/format";

const opt = (v: string) => ({ value: v, label: humanize(v) });

export default function RequisitionsPage() {
  const can = useCan();
  return (
    <div>
      <PageHeader
        title="Requisitions"
        description="Purchase requests from departments. Approved requisitions become RFQs or purchase orders."
        actions={can("requisition:submit") && <Button asChild><Link href="/po/requisitions/new"><Plus /> New requisition</Link></Button>}
      />
      <Suspense>
        <DataTable
          id="requisitions"
          endpoint="/requisitions"
          defaultSort="-created_at"
          rowHref={(r) => `/po/requisitions/${r.id}`}
          columns={[
            { key: "number", header: "#", sortable: true, className: "whitespace-nowrap font-mono text-xs text-muted-foreground" },
            { key: "title", header: "Requisition", pinned: true, render: (r) => <span className="font-medium">{r.title}</span> },
            { key: "requester", header: "Requested by", render: (r) => <UserChip name={r.requester?.full_name} /> },
            { key: "department", header: "Department", render: (r) => r.department?.name ?? r.campus?.name },
            { key: "priority", header: "Priority", render: (r) => <PriorityLabel priority={r.priority} /> },
            { key: "estimated_total", header: "Estimate", sortable: true, align: "right", render: (r) => <Money value={r.estimated_total} /> },
            { key: "needed_by", header: "Needed by", sortable: true, render: (r) => <DateTime value={r.needed_by} dateOnly /> },
            { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
            { key: "created_at", header: "Created", sortable: true, defaultHidden: true, render: (r) => <DateTime value={r.created_at} relative /> },
          ]}
          filters={[
            { key: "status", label: "Status", type: "multi", options: ["draft", "pending_approval", "approved", "rejected", "rfq", "ordered", "closed", "cancelled"].map(opt) },
            { key: "requested_by", label: "Requested by", type: "select", options: [{ value: "me", label: "Me" }] },
            { key: "priority", label: "Priority", type: "multi", options: ["low", "medium", "high", "urgent"].map(opt) },
            { key: "created_at", label: "Created", type: "date-range" },
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
