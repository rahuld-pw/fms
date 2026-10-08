"use client";
import Link from "next/link";
import { Suspense } from "react";
import { Plus, Repeat } from "lucide-react";
import { useCan } from "@/components/app/session";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/shared/data-table";
import { DateTime, Money } from "@/components/shared/format";
import { UserChip } from "@/components/shared/fields";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status";
import { useT } from "@/lib/i18n/client";
import { humanize } from "@/lib/utils/format";

export default function ClaimsPage() {
  const can = useCan();
  const { t } = useT();
  const statusOpt = (v: string) => ({ value: v, label: t(`status.${v}`, undefined, humanize(v)) });
  const typeOpt = (v: string) => ({ value: v, label: t(`enum.claimType.${v}`, undefined, humanize(v)) });
  return (
    <div>
      <PageHeader
        title={t("expense.claims.title")}
        description={t("expense.claims.description")}
        actions={
          <>
            <Button variant="outline" asChild><Link href="/expense/recurring"><Repeat /> {t("expense.claims.recurring")}</Link></Button>
            {can("expense:submit") && <Button asChild><Link href="/expense/claims/new"><Plus /> {t("expense.claims.newClaim")}</Link></Button>}
          </>
        }
      />
      <Suspense>
        <DataTable
          id="claims"
          endpoint="/expense-claims"
          defaultSort="-created_at"
          rowHref={(r) => `/expense/claims/${r.id}`}
          columns={[
            { key: "number", header: "#", sortable: true, className: "whitespace-nowrap font-mono text-xs text-muted-foreground" },
            { key: "title", header: t("expense.claims.claim"), pinned: true, render: (r) => <span className="font-medium">{r.title}</span> },
            { key: "claimant", header: t("expense.claims.claimant"), render: (r) => <UserChip name={r.claimant?.full_name} /> },
            { key: "claim_type", header: t("ui.type"), render: (r) => t(`enum.claimType.${r.claim_type}`, undefined, humanize(r.claim_type)), defaultHidden: true },
            { key: "department", header: t("ui.department"), render: (r) => r.department?.name ?? r.campus?.name },
            { key: "total_amount", header: t("ui.amount"), sortable: true, align: "right", render: (r) => <Money value={r.total_amount} /> },
            { key: "status", header: t("ui.status"), render: (r) => <StatusBadge status={r.status} /> },
            { key: "submitted_at", header: t("expense.claims.submitted"), sortable: true, render: (r) => <DateTime value={r.submitted_at} relative /> },
          ]}
          filters={[
            { key: "status", label: t("ui.status"), type: "multi", options: ["draft", "pending_approval", "approved", "rejected", "paid", "cancelled"].map(statusOpt) },
            { key: "claimant_id", label: t("expense.claims.claimant"), type: "select", options: [{ value: "me", label: t("expense.claims.me") }] },
            { key: "claim_type", label: t("ui.type"), type: "select", options: ["reimbursement", "advance_settlement", "petty_cash_replenishment", "vendor_direct"].map(typeOpt) },
            { key: "submitted_at", label: t("expense.claims.submitted"), type: "date-range" },
          ]}
          mobileCard={(r) => (
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{r.title}</p>
                <p className="text-xs text-muted-foreground">{r.number} · {r.claimant?.full_name}</p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <Money value={r.total_amount} className="text-sm font-medium" />
                <StatusBadge status={r.status} />
              </div>
            </div>
          )}
        />
      </Suspense>
    </div>
  );
}
