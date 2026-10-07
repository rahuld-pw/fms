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
import { humanize } from "@/lib/utils/format";

const opt = (v: string) => ({ value: v, label: humanize(v) });

export default function ClaimsPage() {
  const can = useCan();
  return (
    <div>
      <PageHeader
        title="Expense claims"
        description="Reimbursements, advance settlements and vendor-direct expenses."
        actions={
          <>
            <Button variant="outline" asChild><Link href="/expense/recurring"><Repeat /> Recurring</Link></Button>
            {can("expense:submit") && <Button asChild><Link href="/expense/claims/new"><Plus /> New claim</Link></Button>}
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
            { key: "title", header: "Claim", pinned: true, render: (r) => <span className="font-medium">{r.title}</span> },
            { key: "claimant", header: "Claimant", render: (r) => <UserChip name={r.claimant?.full_name} /> },
            { key: "claim_type", header: "Type", render: (r) => humanize(r.claim_type), defaultHidden: true },
            { key: "department", header: "Department", render: (r) => r.department?.name ?? r.campus?.name },
            { key: "total_amount", header: "Amount", sortable: true, align: "right", render: (r) => <Money value={r.total_amount} /> },
            { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
            { key: "submitted_at", header: "Submitted", sortable: true, render: (r) => <DateTime value={r.submitted_at} relative /> },
          ]}
          filters={[
            { key: "status", label: "Status", type: "multi", options: ["draft", "pending_approval", "approved", "rejected", "paid", "cancelled"].map(opt) },
            { key: "claimant_id", label: "Claimant", type: "select", options: [{ value: "me", label: "Me" }] },
            { key: "claim_type", label: "Type", type: "select", options: ["reimbursement", "advance_settlement", "petty_cash_replenishment", "vendor_direct"].map(opt) },
            { key: "submitted_at", label: "Submitted", type: "date-range" },
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
