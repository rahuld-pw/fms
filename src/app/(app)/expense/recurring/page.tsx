"use client";
import { Suspense, useState } from "react";
import { Plus } from "lucide-react";
import { useSession } from "@/components/app/session";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/shared/data-table";
import { DueDate, Money } from "@/components/shared/format";
import { PageHeader } from "@/components/shared/page-header";
import { ResourceFormDialog } from "@/components/shared/resource-form";
import { useT } from "@/lib/i18n/client";
import { humanize } from "@/lib/utils/format";

export default function RecurringPage() {
  const { campuses } = useSession();
  const { t } = useT();
  const [open, setOpen] = useState(false);
  return (
    <div>
      <PageHeader title={t("expense.recurring.title")} breadcrumbs={[{ label: t("expense.claims.breadcrumb"), href: "/expense/claims" }, { label: t("expense.recurring.breadcrumb") }]} description={t("expense.recurring.description")} actions={<Button onClick={() => setOpen(true)}><Plus /> {t("expense.recurring.new")}</Button>} />
      <Suspense>
        <DataTable
          id="recurring"
          endpoint="/recurring-expenses"
          defaultSort="next_run_date"
          exportable={false}
          columns={[
            { key: "title", header: t("expense.recurring.expense"), pinned: true, render: (r) => <span className="font-medium">{r.title}</span> },
            { key: "category", header: t("ui.category"), render: (r) => r.category?.name },
            { key: "vendor", header: t("ui.vendor"), render: (r) => r.vendor?.name ?? "—" },
            { key: "amount", header: t("ui.amount"), align: "right", render: (r) => <Money value={r.amount} /> },
            { key: "frequency", header: t("expense.recurring.every"), render: (r) => t(`enum.frequency.${r.frequency}`, undefined, humanize(r.frequency)) },
            { key: "next_run_date", header: t("expense.recurring.nextRun"), sortable: true, render: (r) => <DueDate value={r.next_run_date} /> },
            { key: "auto_submit", header: t("expense.recurring.autoSubmit"), render: (r) => (r.auto_submit ? t("ui.yes") : t("expense.recurring.draftOnly")) },
            { key: "active", header: t("ui.active"), render: (r) => (r.active ? t("ui.yes") : t("expense.recurring.paused")) },
          ]}
        />
      </Suspense>
      <ResourceFormDialog
        open={open}
        onOpenChange={setOpen}
        title={t("expense.recurring.newTitle")}
        endpoint="/recurring-expenses"
        fields={[
          { name: "title", label: t("ui.title"), required: true, full: true },
          { name: "amount", label: t("ui.amount"), type: "money", required: true },
          { name: "frequency", label: t("expense.recurring.frequency"), type: "select", required: true, options: ["weekly", "monthly", "quarterly", "half_yearly", "yearly"].map((v) => ({ value: v, label: t(`enum.frequency.${v}`, undefined, humanize(v)) })) },
          { name: "next_run_date", label: t("expense.recurring.firstRun"), type: "date", required: true },
          { name: "end_date", label: t("expense.recurring.end"), type: "date" },
          { name: "campus_id", label: t("ui.campus"), type: "campus", required: true },
          { name: "department_id", label: t("ui.department"), type: "department", campusField: "campus_id" },
          { name: "category_id", label: t("ui.category"), type: "resource", endpoint: "/expense-categories", required: true },
          { name: "vendor_id", label: t("ui.vendor"), type: "resource", endpoint: "/vendors?status=approved" },
          { name: "auto_submit", label: t("expense.recurring.submitAutomatically"), type: "switch" },
        ]}
        defaultValues={{ frequency: "monthly", campus_id: campuses.length === 1 ? campuses[0].id : "" }}
        invalidate={["/recurring-expenses"]}
      />
    </div>
  );
}
