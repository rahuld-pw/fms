"use client";
import { Suspense } from "react";
import { DataTable } from "@/components/shared/data-table";
import { DateTime, DueDate, Money } from "@/components/shared/format";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status";
import { useT } from "@/lib/i18n/client";
import { humanize } from "@/lib/utils/format";

export default function InvoicesPage() {
  const { t } = useT();
  const opt = (v: string) => ({ value: v, label: t(`status.${v}`, undefined, humanize(v)) });
  return (
    <div>
      <PageHeader title={t("po.invoices.title")} description={t("po.invoices.description")} />
      <Suspense>
        <DataTable
          id="invoices"
          endpoint="/invoices"
          defaultSort="-invoice_date"
          rowHref={(r) => `/po/invoices/${r.id}`}
          columns={[
            { key: "vendor_invoice_number", header: t("po.invoices.invoiceNo"), pinned: true, render: (r) => <span className="font-medium">{r.vendor_invoice_number}</span> },
            { key: "number", header: t("po.common.ref"), defaultHidden: true, className: "font-mono text-xs text-muted-foreground" },
            { key: "vendor", header: t("ui.vendor"), render: (r) => r.vendor?.name },
            { key: "po", header: t("po.invoices.po"), className: "whitespace-nowrap font-mono text-xs", render: (r) => r.po?.number },
            { key: "invoice_date", header: t("ui.date"), sortable: true, render: (r) => <DateTime value={r.invoice_date} dateOnly /> },
            { key: "due_date", header: t("ui.due"), sortable: true, render: (r) => <DueDate value={r.due_date} done={r.status === "paid"} /> },
            { key: "total", header: t("ui.total"), sortable: true, align: "right", render: (r) => <Money value={r.total} /> },
            { key: "amount_paid", header: t("po.common.paid"), align: "right", render: (r) => <Money value={r.amount_paid} /> },
            { key: "match_status", header: t("po.invoices.threeWayMatch"), render: (r) => <StatusBadge status={r.match_status} /> },
            { key: "status", header: t("ui.status"), render: (r) => <StatusBadge status={r.status} /> },
          ]}
          filters={[
            { key: "status", label: t("ui.status"), type: "multi", options: ["received", "approved", "partially_paid", "paid", "disputed", "cancelled"].map(opt) },
            { key: "match_status", label: t("po.invoices.match"), type: "multi", options: ["pending", "matched", "qty_mismatch", "price_mismatch", "over_billed", "override"].map(opt) },
            { key: "due_date", label: t("ui.due"), type: "date-range" },
          ]}
          mobileCard={(r) => (
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{r.vendor?.name}</p>
                <p className="text-xs text-muted-foreground">{r.vendor_invoice_number} · {r.po?.number}</p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <Money value={r.total} className="text-sm font-medium" />
                <StatusBadge status={r.status === "received" ? r.match_status : r.status} />
              </div>
            </div>
          )}
        />
      </Suspense>
    </div>
  );
}
