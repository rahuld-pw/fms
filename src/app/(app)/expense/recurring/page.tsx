"use client";
import { Suspense, useState } from "react";
import { Plus } from "lucide-react";
import { useSession } from "@/components/app/session";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/shared/data-table";
import { DueDate, Money } from "@/components/shared/format";
import { PageHeader } from "@/components/shared/page-header";
import { ResourceFormDialog } from "@/components/shared/resource-form";
import { humanize } from "@/lib/utils/format";

export default function RecurringPage() {
  const { campuses } = useSession();
  const [open, setOpen] = useState(false);
  return (
    <div>
      <PageHeader title="Recurring expenses" breadcrumbs={[{ label: "Claims", href: "/expense/claims" }, { label: "Recurring" }]} description="Subscriptions and regular payments drafted (or submitted) automatically on schedule." actions={<Button onClick={() => setOpen(true)}><Plus /> New</Button>} />
      <Suspense>
        <DataTable
          id="recurring"
          endpoint="/recurring-expenses"
          defaultSort="next_run_date"
          exportable={false}
          columns={[
            { key: "title", header: "Expense", pinned: true, render: (r) => <span className="font-medium">{r.title}</span> },
            { key: "category", header: "Category", render: (r) => r.category?.name },
            { key: "vendor", header: "Vendor", render: (r) => r.vendor?.name ?? "—" },
            { key: "amount", header: "Amount", align: "right", render: (r) => <Money value={r.amount} /> },
            { key: "frequency", header: "Every", render: (r) => humanize(r.frequency) },
            { key: "next_run_date", header: "Next run", sortable: true, render: (r) => <DueDate value={r.next_run_date} /> },
            { key: "auto_submit", header: "Auto-submit", render: (r) => (r.auto_submit ? "Yes" : "Draft only") },
            { key: "active", header: "Active", render: (r) => (r.active ? "Yes" : "Paused") },
          ]}
        />
      </Suspense>
      <ResourceFormDialog
        open={open}
        onOpenChange={setOpen}
        title="New recurring expense"
        endpoint="/recurring-expenses"
        fields={[
          { name: "title", label: "Title", required: true, full: true },
          { name: "amount", label: "Amount", type: "money", required: true },
          { name: "frequency", label: "Frequency", type: "select", required: true, options: ["weekly", "monthly", "quarterly", "half_yearly", "yearly"].map((v) => ({ value: v, label: humanize(v) })) },
          { name: "next_run_date", label: "First run", type: "date", required: true },
          { name: "end_date", label: "End", type: "date" },
          { name: "campus_id", label: "Campus", type: "campus", required: true },
          { name: "department_id", label: "Department", type: "department", campusField: "campus_id" },
          { name: "category_id", label: "Category", type: "resource", endpoint: "/expense-categories", required: true },
          { name: "vendor_id", label: "Vendor", type: "resource", endpoint: "/vendors?status=approved" },
          { name: "auto_submit", label: "Submit for approval automatically", type: "switch" },
        ]}
        defaultValues={{ frequency: "monthly", campus_id: campuses.length === 1 ? campuses[0].id : "" }}
        invalidate={["/recurring-expenses"]}
      />
    </div>
  );
}
