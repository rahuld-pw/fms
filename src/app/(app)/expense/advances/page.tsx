"use client";
import { useRouter } from "next/navigation";
import { Suspense, useState } from "react";
import { Plus } from "lucide-react";
import { useCan, useSession } from "@/components/app/session";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/shared/data-table";
import { DateTime, Money } from "@/components/shared/format";
import { UserChip } from "@/components/shared/fields";
import { PageHeader } from "@/components/shared/page-header";
import { ResourceFormDialog } from "@/components/shared/resource-form";
import { StatusBadge } from "@/components/shared/status";
import { useT } from "@/lib/i18n/client";
import { humanize } from "@/lib/utils/format";

export default function AdvancesPage() {
  const can = useCan();
  const { t } = useT();
  const router = useRouter();
  const { campuses } = useSession();
  const [open, setOpen] = useState(false);
  return (
    <div>
      <PageHeader title={t("expense.advances.title")} description={t("expense.advances.description")} actions={can("expense:submit") && <Button onClick={() => setOpen(true)}><Plus /> {t("expense.advances.requestAdvance")}</Button>} />
      <Suspense>
        <DataTable
          id="advances"
          endpoint="/expense-advances"
          defaultSort="-created_at"
          rowHref={(r) => `/expense/advances/${r.id}`}
          columns={[
            { key: "number", header: "#", className: "whitespace-nowrap font-mono text-xs text-muted-foreground" },
            { key: "purpose", header: t("expense.advances.purpose"), pinned: true, render: (r) => <span className="font-medium">{r.purpose}</span> },
            { key: "user", header: t("expense.advances.requestedBy"), render: (r) => <UserChip name={r.user?.full_name} /> },
            { key: "amount", header: t("ui.amount"), sortable: true, align: "right", render: (r) => <Money value={r.amount} /> },
            { key: "settled_amount", header: t("expense.advances.settled"), align: "right", render: (r) => <Money value={r.settled_amount} /> },
            { key: "status", header: t("ui.status"), render: (r) => <StatusBadge status={r.status} /> },
            { key: "created_at", header: t("expense.advances.requested"), sortable: true, render: (r) => <DateTime value={r.created_at} relative /> },
          ]}
          filters={[
            { key: "status", label: t("ui.status"), type: "multi", options: ["draft", "pending_approval", "approved", "disbursed", "settled", "rejected"].map((v) => ({ value: v, label: t(`status.${v}`, undefined, humanize(v)) })) },
            { key: "user_id", label: t("ui.requester"), type: "select", options: [{ value: "me", label: t("expense.advances.me") }] },
          ]}
        />
      </Suspense>
      <ResourceFormDialog
        open={open}
        onOpenChange={setOpen}
        title={t("expense.advances.requestTitle")}
        endpoint="/expense-advances"
        fields={[
          { name: "purpose", label: t("expense.advances.purpose"), required: true, full: true },
          { name: "amount", label: t("ui.amount"), type: "money", required: true },
          { name: "needed_by", label: t("expense.advances.neededBy"), type: "date" },
          { name: "campus_id", label: t("ui.campus"), type: "campus", required: true },
          { name: "department_id", label: t("ui.department"), type: "department", campusField: "campus_id" },
          { name: "category_id", label: t("expense.advances.expenseCategory"), type: "resource", endpoint: "/expense-categories" },
        ]}
        defaultValues={{ campus_id: campuses.length === 1 ? campuses[0].id : "" }}
        invalidate={["/expense-advances"]}
        onSaved={(r: { id: string }) => router.push(`/expense/advances/${r.id}`)}
      />
    </div>
  );
}
