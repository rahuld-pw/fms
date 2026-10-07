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
import { humanize } from "@/lib/utils/format";

export default function AdvancesPage() {
  const can = useCan();
  const router = useRouter();
  const { campuses } = useSession();
  const [open, setOpen] = useState(false);
  return (
    <div>
      <PageHeader title="Advances" description="Cash advances for events, trips and purchases, settled with expense claims." actions={can("expense:submit") && <Button onClick={() => setOpen(true)}><Plus /> Request advance</Button>} />
      <Suspense>
        <DataTable
          id="advances"
          endpoint="/expense-advances"
          defaultSort="-created_at"
          rowHref={(r) => `/expense/advances/${r.id}`}
          columns={[
            { key: "number", header: "#", className: "whitespace-nowrap font-mono text-xs text-muted-foreground" },
            { key: "purpose", header: "Purpose", pinned: true, render: (r) => <span className="font-medium">{r.purpose}</span> },
            { key: "user", header: "Requested by", render: (r) => <UserChip name={r.user?.full_name} /> },
            { key: "amount", header: "Amount", sortable: true, align: "right", render: (r) => <Money value={r.amount} /> },
            { key: "settled_amount", header: "Settled", align: "right", render: (r) => <Money value={r.settled_amount} /> },
            { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
            { key: "created_at", header: "Requested", sortable: true, render: (r) => <DateTime value={r.created_at} relative /> },
          ]}
          filters={[
            { key: "status", label: "Status", type: "multi", options: ["draft", "pending_approval", "approved", "disbursed", "settled", "rejected"].map((v) => ({ value: v, label: humanize(v) })) },
            { key: "user_id", label: "Requester", type: "select", options: [{ value: "me", label: "Me" }] },
          ]}
        />
      </Suspense>
      <ResourceFormDialog
        open={open}
        onOpenChange={setOpen}
        title="Request an advance"
        endpoint="/expense-advances"
        fields={[
          { name: "purpose", label: "Purpose", required: true, full: true },
          { name: "amount", label: "Amount", type: "money", required: true },
          { name: "needed_by", label: "Needed by", type: "date" },
          { name: "campus_id", label: "Campus", type: "campus", required: true },
          { name: "department_id", label: "Department", type: "department", campusField: "campus_id" },
          { name: "category_id", label: "Expense category", type: "resource", endpoint: "/expense-categories" },
        ]}
        defaultValues={{ campus_id: campuses.length === 1 ? campuses[0].id : "" }}
        invalidate={["/expense-advances"]}
        onSaved={(r: { id: string }) => router.push(`/expense/advances/${r.id}`)}
      />
    </div>
  );
}
