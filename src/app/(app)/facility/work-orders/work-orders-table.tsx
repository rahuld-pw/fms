"use client";
import { useState } from "react";
import { Plus } from "lucide-react";
import { useCan, useSession } from "@/components/app/session";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/shared/data-table";
import { DueDate } from "@/components/shared/format";
import { UserChip } from "@/components/shared/fields";
import { ResourceFormDialog, type FieldSpec } from "@/components/shared/resource-form";
import { PriorityLabel, StatusBadge } from "@/components/shared/status";
import { humanize } from "@/lib/utils/format";
import { useRouter } from "next/navigation";

const opt = (v: string) => ({ value: v, label: humanize(v) });

export const workOrderFields: FieldSpec[] = [
  { name: "title", label: "Title", required: true, full: true },
  { name: "campus_id", label: "Campus", type: "campus", required: true },
  { name: "type", label: "Type", type: "select", required: true, options: ["corrective", "preventive", "inspection", "compliance", "installation"].map(opt) },
  { name: "priority", label: "Priority", type: "select", required: true, options: ["low", "medium", "high", "critical"].map(opt) },
  { name: "location_id", label: "Location", type: "resource", endpoint: "/locations" },
  { name: "asset_id", label: "Asset", type: "resource", endpoint: "/assets", hintKey: "asset_tag" },
  { name: "assignee_id", label: "Assign to", type: "user" },
  { name: "vendor_id", label: "Vendor", type: "resource", endpoint: "/vendors?status=approved" },
  { name: "checklist_template_id", label: "Checklist", type: "resource", endpoint: "/checklist-templates" },
  { name: "scheduled_for", label: "Scheduled for", type: "datetime" },
  { name: "due_at", label: "Due", type: "datetime" },
  { name: "description", label: "Description", type: "textarea" },
];

export function WorkOrdersTable() {
  const can = useCan();
  const router = useRouter();
  const { campuses } = useSession();
  const [open, setOpen] = useState(false);
  const columns: Column[] = [
    { key: "number", header: "#", sortable: true, pinned: true, className: "whitespace-nowrap font-mono text-xs text-muted-foreground" },
    { key: "title", header: "Work order", pinned: true, render: (r) => <span className="font-medium">{r.title}</span> },
    { key: "type", header: "Type", render: (r) => humanize(r.type) },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
    { key: "priority", header: "Priority", sortable: true, render: (r) => <PriorityLabel priority={r.priority} /> },
    { key: "asset", header: "Asset / location", render: (r) => r.asset?.name ?? r.location?.name ?? "—" },
    { key: "assignee", header: "Assignee", render: (r) => (r.vendor ? r.vendor.name : <UserChip name={r.assignee?.full_name} />) },
    { key: "vendor_booking_status", header: "Booking", render: (r) => (r.vendor_booking_status === "not_required" ? "—" : <StatusBadge status={r.vendor_booking_status} />), defaultHidden: true },
    { key: "scheduled_for", header: "Scheduled", sortable: true, render: (r) => <DueDate value={r.scheduled_for} done /> },
    { key: "due_at", header: "Due", sortable: true, render: (r) => <DueDate value={r.due_at} done={["completed", "verified", "cancelled"].includes(r.status)} /> },
  ];
  return (
    <>
      <DataTable
        id="work-orders"
        endpoint="/work-orders"
        columns={columns}
        defaultSort="-created_at"
        rowHref={(r) => `/facility/work-orders/${r.id}`}
        filters={[
          { key: "status", label: "Status", type: "multi", options: ["open", "scheduled", "in_progress", "on_hold", "completed", "verified", "cancelled"].map(opt) },
          { key: "type", label: "Type", type: "multi", options: ["corrective", "preventive", "inspection", "compliance", "installation"].map(opt) },
          { key: "assignee_id", label: "Assignee", type: "select", options: [{ value: "me", label: "Me" }] },
          ...(campuses.length > 1 ? [{ key: "campus_id", label: "Campus", type: "select" as const, options: campuses.map((c) => ({ value: c.id, label: c.name })) }] : []),
          { key: "due_at", label: "Due", type: "date-range" },
        ]}
        toolbar={
          can("work_order:create") && (
            <Button size="sm" onClick={() => setOpen(true)}>
              <Plus /> New
            </Button>
          )
        }
        mobileCard={(r) => (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-muted-foreground">{r.number}</span>
              <StatusBadge status={r.status} />
              <span className="ml-auto text-xs"><DueDate value={r.due_at} done={["completed", "verified"].includes(r.status)} /></span>
            </div>
            <span className="font-medium">{r.title}</span>
            <span className="text-xs text-muted-foreground">{r.asset?.name ?? r.location?.name ?? humanize(r.type)}</span>
          </div>
        )}
      />
      <ResourceFormDialog
        open={open}
        onOpenChange={setOpen}
        title="New work order"
        endpoint="/work-orders"
        fields={workOrderFields}
        defaultValues={{ type: "corrective", priority: "medium", campus_id: campuses.length === 1 ? campuses[0].id : "" }}
        invalidate={["/work-orders"]}
        onSaved={(r: { id: string }) => router.push(`/facility/work-orders/${r.id}`)}
      />
    </>
  );
}
