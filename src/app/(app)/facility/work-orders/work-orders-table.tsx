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
import { useT } from "@/lib/i18n/client";
import type { TFunction } from "@/lib/i18n/translate";
import { useRouter } from "next/navigation";

const WO_TYPES = ["corrective", "preventive", "inspection", "compliance", "installation"];
const typeOpt = (t: TFunction) => (v: string) => ({ value: v, label: t(`enum.workOrderType.${v}`, undefined, humanize(v)) });

export const workOrderFields = (t: TFunction): FieldSpec[] => [
  { name: "title", label: t("ui.title"), required: true, full: true },
  { name: "campus_id", label: t("ui.campus"), type: "campus", required: true },
  { name: "type", label: t("ui.type"), type: "select", required: true, options: WO_TYPES.map(typeOpt(t)) },
  { name: "priority", label: t("ui.priority"), type: "select", required: true, options: ["low", "medium", "high", "critical"].map((v) => ({ value: v, label: t(`priority.${v}`, undefined, humanize(v)) })) },
  { name: "location_id", label: t("ui.location"), type: "resource", endpoint: "/locations" },
  { name: "asset_id", label: t("ui.asset"), type: "resource", endpoint: "/assets", hintKey: "asset_tag" },
  { name: "assignee_id", label: t("facility.workOrders.assignTo"), type: "user" },
  { name: "vendor_id", label: t("ui.vendor"), type: "resource", endpoint: "/vendors?status=approved" },
  { name: "checklist_template_id", label: t("facility.workOrders.checklist"), type: "resource", endpoint: "/checklist-templates" },
  { name: "scheduled_for", label: t("facility.workOrders.scheduledFor"), type: "datetime" },
  { name: "due_at", label: t("ui.due"), type: "datetime" },
  { name: "description", label: t("ui.description"), type: "textarea" },
];

export function WorkOrdersTable() {
  const { t } = useT();
  const can = useCan();
  const router = useRouter();
  const { campuses } = useSession();
  const [open, setOpen] = useState(false);
  const columns: Column[] = [
    { key: "number", header: "#", sortable: true, pinned: true, className: "whitespace-nowrap font-mono text-xs text-muted-foreground" },
    { key: "title", header: t("facility.workOrders.colWorkOrder"), pinned: true, render: (r) => <span className="font-medium">{r.title}</span> },
    { key: "type", header: t("ui.type"), render: (r) => t(`enum.workOrderType.${r.type}`, undefined, humanize(r.type)) },
    { key: "status", header: t("ui.status"), render: (r) => <StatusBadge status={r.status} /> },
    { key: "priority", header: t("ui.priority"), sortable: true, render: (r) => <PriorityLabel priority={r.priority} /> },
    { key: "asset", header: t("facility.workOrders.colAssetLocation"), render: (r) => r.asset?.name ?? r.location?.name ?? "—" },
    { key: "assignee", header: t("ui.assignee"), render: (r) => (r.vendor ? r.vendor.name : <UserChip name={r.assignee?.full_name} />) },
    { key: "vendor_booking_status", header: t("facility.workOrders.colBooking"), render: (r) => (r.vendor_booking_status === "not_required" ? "—" : <StatusBadge status={r.vendor_booking_status} />), defaultHidden: true },
    { key: "scheduled_for", header: t("facility.workOrders.scheduled"), sortable: true, render: (r) => <DueDate value={r.scheduled_for} done /> },
    { key: "due_at", header: t("ui.due"), sortable: true, render: (r) => <DueDate value={r.due_at} done={["completed", "verified", "cancelled"].includes(r.status)} /> },
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
          { key: "status", label: t("ui.status"), type: "multi", options: ["open", "scheduled", "in_progress", "on_hold", "completed", "verified", "cancelled"].map((v) => ({ value: v, label: t(`status.${v}`, undefined, humanize(v)) })) },
          { key: "type", label: t("ui.type"), type: "multi", options: WO_TYPES.map(typeOpt(t)) },
          { key: "assignee_id", label: t("ui.assignee"), type: "select", options: [{ value: "me", label: t("facility.me") }] },
          ...(campuses.length > 1 ? [{ key: "campus_id", label: t("ui.campus"), type: "select" as const, options: campuses.map((c) => ({ value: c.id, label: c.name })) }] : []),
          { key: "due_at", label: t("ui.due"), type: "date-range" },
        ]}
        toolbar={
          can("work_order:create") && (
            <Button size="sm" onClick={() => setOpen(true)}>
              <Plus /> {t("common.new")}
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
            <span className="text-xs text-muted-foreground">{r.asset?.name ?? r.location?.name ?? t(`enum.workOrderType.${r.type}`, undefined, humanize(r.type))}</span>
          </div>
        )}
      />
      <ResourceFormDialog
        open={open}
        onOpenChange={setOpen}
        title={t("facility.workOrders.newTitle")}
        endpoint="/work-orders"
        fields={workOrderFields(t)}
        defaultValues={{ type: "corrective", priority: "medium", campus_id: campuses.length === 1 ? campuses[0].id : "" }}
        invalidate={["/work-orders"]}
        onSaved={(r: { id: string }) => router.push(`/facility/work-orders/${r.id}`)}
      />
    </>
  );
}
