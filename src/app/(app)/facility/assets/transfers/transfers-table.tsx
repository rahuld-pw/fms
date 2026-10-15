"use client";
import Link from "next/link";
import { ArrowDown, Package, User } from "lucide-react";
import { useCan, useSession } from "@/components/app/session";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/shared/data-table";
import { DateTime } from "@/components/shared/format";
import { isActing, useAction } from "@/components/shared/resource-form";
import { StatusBadge } from "@/components/shared/status";
import { useT } from "@/lib/i18n/client";
import { humanize } from "@/lib/utils/format";

/* eslint-disable @typescript-eslint/no-explicit-any */
// campus › building › floor › room
const place = (campus: { name: string } | null | undefined, loc: { name: string; path_names?: string[] } | null | undefined) =>
  [campus?.name, ...(loc ? [...(loc.path_names ?? []), loc.name] : [])].filter(Boolean).join(" › ");

/** Every asset transfer the user can see, newest first; pending ones can be received or rejected here. */
export function TransfersTable() {
  const { t } = useT();
  const can = useCan();
  const { campuses } = useSession();
  const decide = useAction({ success: t("facility.assets.detail.transferUpdated"), invalidate: ["/asset-transfers"] });
  const actions = (tr: any) =>
    tr.status === "pending" &&
    can("asset:transfer", { campusId: tr.to_campus_id }, "auto") && (
      <div className="flex gap-1">
        <Button size="xs" disabled={decide.isPending} loading={isActing(decide, `/asset-transfers/${tr.id}/decide`, { status: "completed" })} onClick={() => decide.mutate({ path: `/asset-transfers/${tr.id}/decide`, body: { status: "completed" } })}>
          {t("facility.assets.detail.receive")}
        </Button>
        <Button size="xs" variant="outline" disabled={decide.isPending} loading={isActing(decide, `/asset-transfers/${tr.id}/decide`, { status: "rejected" })} onClick={() => decide.mutate({ path: `/asset-transfers/${tr.id}/decide`, body: { status: "rejected" } })}>
          {t("ui.reject")}
        </Button>
      </div>
    );
  const asset = (tr: any) =>
    tr.asset ? (
      <Link href={`/facility/assets/${tr.asset.id}`} className="hover:underline">
        <span className="font-mono text-xs text-muted-foreground">{tr.asset.asset_tag}</span> <span className="font-medium">{tr.asset.name}</span>
      </Link>
    ) : "—";
  const columns: Column[] = [
    { key: "asset", header: t("ui.asset"), pinned: true, render: asset },
    { key: "from", header: t("ui.from"), className: "max-w-56", render: (r) => <span className="line-clamp-2 text-xs">{place(r.from_campus, r.from_location)}</span> },
    { key: "to", header: t("ui.to"), className: "max-w-56", render: (r) => <span className="line-clamp-2 text-xs font-medium">{place(r.to_campus, r.to_location)}</span> },
    { key: "to_custodian", header: t("facility.assets.custodian"), render: (r) => r.to_custodian?.full_name ?? "—" },
    { key: "reason", header: t("facility.assets.detail.reason"), defaultHidden: true, className: "max-w-48 truncate", render: (r) => r.reason ?? "—" },
    { key: "requester", header: t("ui.requester"), render: (r) => r.requester?.full_name ?? "—" },
    { key: "created_at", header: t("ui.created"), sortable: true, render: (r) => <DateTime value={r.created_at} relative /> },
    { key: "status", header: t("ui.status"), render: (r) => <StatusBadge status={r.status} /> },
    { key: "actions", header: "", render: (r) => actions(r) || null },
  ];
  const campusOptions = campuses.map((c) => ({ value: c.id, label: c.name }));
  return (
    <DataTable
      id="asset-transfers"
      endpoint="/asset-transfers"
      columns={columns}
      defaultSort="-created_at"
      searchPlaceholder={t("facility.assets.detail.reason")}
      filters={[
        { key: "status", label: t("ui.status"), type: "multi", options: ["pending", "completed", "rejected", "cancelled"].map((v) => ({ value: v, label: t(`status.${v}`, undefined, humanize(v)) })) },
        ...(campuses.length > 1
          ? [
              { key: "from_campus_id", label: `${t("ui.from")}: ${t("ui.campus")}`, type: "select" as const, options: campusOptions },
              { key: "to_campus_id", label: `${t("ui.to")}: ${t("ui.campus")}`, type: "select" as const, options: campusOptions },
            ]
          : []),
        { key: "requested_by", label: t("ui.requester"), type: "select", options: [{ value: "me", label: t("facility.me") }] },
        { key: "created_at", label: t("ui.created"), type: "date-range" },
      ]}
      mobileCard={(r) => (
        <div className="flex flex-col gap-1.5 text-sm">
          <div className="flex items-start gap-2">
            <span className="flex min-w-0 flex-1 items-start gap-1">
              <Package className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 break-words">{asset(r)}</span>
            </span>
            <span className="shrink-0"><StatusBadge status={r.status} /></span>
          </div>
          <div className="flex flex-col gap-0.5 text-xs">
            <span className="break-words text-muted-foreground">{place(r.from_campus, r.from_location)}</span>
            <ArrowDown className="size-3 text-muted-foreground" />
            <span className="break-words font-medium">{place(r.to_campus, r.to_location)}</span>
          </div>
          {r.to_custodian?.full_name && (
            <span className="flex items-center gap-1 text-xs">
              <User className="size-3 shrink-0 text-muted-foreground" />
              {t("facility.assets.detail.toCustodian", { name: r.to_custodian.full_name })}
            </span>
          )}
          <span className="break-words text-xs text-muted-foreground">
            {[r.reason, r.requester?.full_name && t("facility.assets.transfer.requestedBy", { name: r.requester.full_name }), r.decider?.full_name && t("facility.assets.transfer.decidedBy", { name: r.decider.full_name })].filter(Boolean).join(" · ")} · <DateTime value={r.created_at} relative />
          </span>
          {actions(r)}
        </div>
      )}
    />
  );
}
