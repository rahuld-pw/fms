"use client";
import Link from "next/link";
import { Suspense } from "react";
import { Plus } from "lucide-react";
import { useCan } from "@/components/app/session";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/shared/data-table";
import { DateTime, DueDate, Money } from "@/components/shared/format";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status";
import { humanize } from "@/lib/utils/format";

const opt = (v: string) => ({ value: v, label: humanize(v) });
const OPEN = ["approved", "sent", "acknowledged", "partially_received"];

export default function OrdersPage() {
  const can = useCan();
  return (
    <div>
      <PageHeader
        title="Purchase orders"
        description="Orders to vendors, from draft and approval to receipt, invoicing and payment."
        actions={can("po:create") && <Button asChild><Link href="/po/orders/new"><Plus /> New PO</Link></Button>}
      />
      <Suspense>
        <DataTable
          id="purchase-orders"
          endpoint="/purchase-orders"
          defaultSort="-created_at"
          rowHref={(r) => `/po/orders/${r.id}`}
          columns={[
            { key: "number", header: "PO number", sortable: true, pinned: true, className: "whitespace-nowrap font-mono text-xs", render: (r) => <>{r.number}{r.version > 1 && <span className="ml-1 text-muted-foreground">v{r.version}</span>}</> },
            { key: "vendor", header: "Vendor", render: (r) => <span className="font-medium">{r.vendor?.name}</span> },
            { key: "department", header: "Department", render: (r) => r.department?.name ?? r.campus?.name },
            { key: "order_date", header: "Order date", sortable: true, render: (r) => <DateTime value={r.order_date} dateOnly /> },
            { key: "expected_delivery", header: "Expected", sortable: true, render: (r) => OPEN.includes(r.status) ? <DueDate value={r.expected_delivery} /> : <DateTime value={r.expected_delivery} dateOnly /> },
            { key: "subtotal", header: "Subtotal", align: "right", defaultHidden: true, render: (r) => <Money value={r.subtotal} /> },
            { key: "total", header: "Total", sortable: true, align: "right", render: (r) => <Money value={r.total} /> },
            { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
            { key: "creator", header: "Created by", defaultHidden: true, render: (r) => r.creator?.full_name },
          ]}
          filters={[
            { key: "status", label: "Status", type: "multi", options: ["draft", "pending_approval", "approved", "rejected", "sent", "acknowledged", "partially_received", "received", "closed", "cancelled"].map(opt) },
            { key: "order_date", label: "Order date", type: "date-range" },
          ]}
          mobileCard={(r) => (
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{r.vendor?.name}</p>
                <p className="font-mono text-xs text-muted-foreground">{r.number}</p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <Money value={r.total} className="text-sm font-medium" />
                <StatusBadge status={r.status} />
              </div>
            </div>
          )}
        />
      </Suspense>
    </div>
  );
}
