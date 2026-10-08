"use client";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { useSession } from "@/components/app/session";
import { DataTable, type Column, type Row } from "@/components/shared/data-table";
import { DateTime, DueDate } from "@/components/shared/format";
import { UserChip } from "@/components/shared/fields";
import { PriorityLabel, StatusBadge } from "@/components/shared/status";
import { api } from "@/lib/client/api";
import { useT } from "@/lib/i18n/client";

const STATUSES = ["open", "acknowledged", "assigned", "in_progress", "on_hold", "resolved", "closed", "reopened", "cancelled"];
const humanLabel = (v: string) => v.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export function IssuesTable() {
  const { t } = useT();
  const { campuses } = useSession();
  const { data: categories = [] } = useQuery({ queryKey: ["issue-categories"], queryFn: () => api<{ id: string; name: string }[]>("/issue-categories?limit=100") });
  const columns: Column[] = [
    { key: "number", header: "#", sortable: true, pinned: true, className: "w-28 whitespace-nowrap font-mono text-xs text-muted-foreground" },
    {
      key: "title",
      header: t("facility.issues.colIssue"),
      pinned: true,
      render: (r: Row) => (
        <div className="flex min-w-48 items-center gap-1.5">
          {r.escalation_level > 0 && <AlertTriangle className="size-3.5 shrink-0 text-destructive" aria-label={t("facility.issues.escalatedLevel", { n: r.escalation_level })} />}
          <span className="truncate font-medium">{r.title}</span>
        </div>
      ),
    },
    { key: "status", header: t("ui.status"), sortable: true, render: (r) => <StatusBadge status={r.status} /> },
    { key: "priority", header: t("ui.priority"), sortable: true, render: (r) => <PriorityLabel priority={r.priority} /> },
    { key: "category", header: t("ui.category"), render: (r) => r.category?.name ?? "—" },
    { key: "location", header: t("ui.location"), render: (r) => (r.location ? [...r.location.path_names, r.location.name].join(" › ") : "—"), className: "max-w-56 truncate" },
    { key: "campus", header: t("ui.campus"), render: (r) => r.campus?.code, defaultHidden: campuses.length < 2 },
    { key: "assignee", header: t("ui.assignee"), render: (r) => (r.vendor ? r.vendor.name : <UserChip name={r.assignee?.full_name} />) },
    { key: "resolution_due_at", header: t("ui.due"), sortable: true, render: (r) => <DueDate value={r.resolution_due_at} done={["resolved", "closed", "cancelled"].includes(r.status)} /> },
    { key: "created_at", header: t("facility.issues.reported"), sortable: true, render: (r) => <DateTime value={r.created_at} relative /> },
    { key: "reporter", header: t("ui.reporter"), render: (r) => (r.is_anonymous ? <span className="text-muted-foreground">{t("facility.issues.anonymous")}</span> : <UserChip name={r.reporter?.full_name} />), defaultHidden: true },
  ];
  return (
    <DataTable
      id="issues"
      endpoint="/issues"
      columns={columns}
      defaultSort="-created_at"
      searchPlaceholder={t("facility.issues.searchPlaceholder")}
      rowHref={(r) => `/facility/issues/${r.id}`}
      filters={[
        { key: "status", label: t("ui.status"), type: "multi", options: STATUSES.map((v) => ({ value: v, label: t(`status.${v}`, undefined, humanLabel(v)) })) },
        { key: "priority", label: t("ui.priority"), type: "multi", options: ["critical", "high", "medium", "low"].map((v) => ({ value: v, label: t(`priority.${v}`, undefined, humanLabel(v)) })) },
        { key: "category_id", label: t("ui.category"), type: "select", options: categories.map((c) => ({ value: c.id, label: c.name })) },
        ...(campuses.length > 1 ? [{ key: "campus_id", label: t("ui.campus"), type: "select" as const, options: campuses.map((c) => ({ value: c.id, label: c.name })) }] : []),
        { key: "assignee_id", label: t("ui.assignee"), type: "select", options: [{ value: "me", label: t("facility.me") }, { value: "null", label: t("ui.unassigned") }] },
        { key: "created_at", label: t("facility.issues.reported"), type: "date-range" },
      ]}
      mobileCard={(r) => (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">{r.number}</span>
            <StatusBadge status={r.status} />
            <span className="ml-auto text-xs">
              <DueDate value={r.resolution_due_at} done={["resolved", "closed", "cancelled"].includes(r.status)} />
            </span>
          </div>
          <span className="font-medium">{r.title}</span>
          <span className="text-xs text-muted-foreground">
            {r.location?.name ?? r.campus?.name} · <PriorityLabel priority={r.priority} />
          </span>
        </div>
      )}
    />
  );
}
