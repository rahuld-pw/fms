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
import { useT } from "@/lib/i18n/client";
import { humanize } from "@/lib/utils/format";

const OPEN = ["approved", "sent", "acknowledged", "partially_received"];

export default function OrdersPage() {
  const { t } = useT();
  const can = useCan();
  const opt = (v: string) => ({ value: v, label: t(`status.${v}`, undefined, humanize(v)) });
  return (
    <div>
      <PageHeader
        title={t("po.orders.title")}
        description={t("po.orders.description")}
        actions={can("po:create") && <Button asChild><Link href="/po/orders/new"><Plus /> {t("po.orders.newPo")}</Link></Button>}
      />
      <Suspense>
        <DataTable
          id="purchase-orders"
          endpoint="/purchase-orders"
          defaultSort="-created_at"
          rowHref={(r) => `/po/orders/${r.id}`}
          columns={[
            { key: "number", header: t("po.orders.poNumber"), sortable: true, pinned: true, className: "whitespace-nowrap font-mono text-xs", render: (r) => <>{r.number}{r.version > 1 && <span className="ml-1 text-muted-foreground">v{r.version}</span>}</> },
            { key: "vendor", header: t("ui.vendor"), render: (r) => <span className="font-medium">{r.vendor?.name}</span> },
            { key: "department", header: t("ui.department"), render: (r) => r.department?.name ?? r.campus?.name },
            { key: "order_date", header: t("po.common.orderDate"), sortable: true, render: (r) => <DateTime value={r.order_date} dateOnly /> },
            { key: "expected_delivery", header: t("po.common.expected"), sortable: true, render: (r) => OPEN.includes(r.status) ? <DueDate value={r.expected_delivery} /> : <DateTime value={r.expected_delivery} dateOnly /> },
            { key: "subtotal", header: t("ui.subtotal"), align: "right", defaultHidden: true, render: (r) => <Money value={r.subtotal} /> },
            { key: "total", header: t("ui.total"), sortable: true, align: "right", render: (r) => <Money value={r.total} /> },
            { key: "status", header: t("ui.status"), render: (r) => <StatusBadge status={r.status} /> },
            { key: "creator", header: t("ui.createdBy"), defaultHidden: true, render: (r) => r.creator?.full_name },
          ]}
          filters={[
            { key: "status", label: t("ui.status"), type: "multi", options: ["draft", "pending_approval", "approved", "rejected", "sent", "acknowledged", "partially_received", "received", "closed", "cancelled"].map(opt) },
            { key: "order_date", label: t("po.common.orderDate"), type: "date-range" },
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
