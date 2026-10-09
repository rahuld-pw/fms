"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ClipboardCheck, Plus, QrCode, Upload } from "lucide-react";
import { useCan, useSession } from "@/components/app/session";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/shared/data-table";
import { DueDate, Money } from "@/components/shared/format";
import { UserChip } from "@/components/shared/fields";
import { ResourceFormDialog, type FieldSpec } from "@/components/shared/resource-form";
import { StatusBadge } from "@/components/shared/status";
import { api } from "@/lib/client/api";
import { useT } from "@/lib/i18n/client";
import type { TFunction } from "@/lib/i18n/translate";
import { humanize } from "@/lib/utils/format";
import { printLabels } from "./labels";

const statusOpt = (t: TFunction) => (v: string) => ({ value: v, label: t(`status.${v}`, undefined, humanize(v)) });

const CONDITIONS = ["new", "good", "fair", "poor", "damaged"];

export const assetFields = (t: TFunction): FieldSpec[] => [
  { name: "name", label: t("ui.name"), required: true, full: true },
  { name: "category_id", label: t("ui.category"), type: "resource", endpoint: "/asset-categories", extraParams: () => "&parent_id=null" },
  { name: "subcategory_id", label: t("facility.assets.subcategory"), type: "resource", endpoint: "/asset-categories", extraParams: (v) => `&parent_id=${v.category_id}`, hidden: (v) => !v.category_id, hint: t("facility.assets.subcategoryHint") },
  { name: "status", label: t("ui.status"), type: "select", required: true, options: ["in_stock", "in_use", "under_repair", "lost"].map(statusOpt(t)) },
  { name: "condition", label: t("facility.assets.condition"), type: "select", options: CONDITIONS.map((c) => ({ value: c, label: t(`enum.assetCondition.${c}`, undefined, humanize(c)) })) },
  { name: "campus_id", label: t("ui.campus"), type: "campus", required: true },
  { name: "location_id", label: t("facility.assets.exactLocation"), type: "location", campusField: "campus_id", hint: t("facility.assets.exactLocationHint") },
  { name: "department_id", label: t("ui.department"), type: "department", campusField: "campus_id" },
  { name: "custodian_id", label: t("facility.assets.custodian"), type: "user" },
  { name: "make", label: t("facility.assets.make") },
  { name: "model", label: t("facility.assets.model") },
  { name: "serial_number", label: t("facility.assets.serialNumber") },
  { name: "vendor_id", label: t("ui.vendor"), type: "resource", endpoint: "/vendors" },
  { name: "purchase_date", label: t("facility.assets.purchaseDate"), type: "date" },
  { name: "purchase_cost", label: t("facility.assets.purchaseCost"), type: "money" },
  { name: "invoice_number", label: t("facility.assets.invoiceNumber") },
  { name: "installed_on", label: t("facility.assets.installedOn"), type: "date", hint: t("facility.assets.installedOnHint") },
  { name: "warranty_start", label: t("facility.assets.warrantyStart"), type: "date" },
  { name: "warranty_until", label: t("facility.assets.warrantyUntil"), type: "date" },
  { name: "amc_contract_id", label: t("facility.assets.detail.amc"), type: "resource", endpoint: "/amc-contracts", labelKey: "title", hintKey: "end_date", extraParams: (v) => `&status=active${v.campus_id ? `&campus_id=${v.campus_id}` : ""}`, hint: t("facility.assets.amcHint") },
  { name: "usage_unit", label: t("facility.assets.usageUnit"), hint: t("facility.assets.usageUnitHint") },
  { name: "description", label: t("ui.notes"), type: "textarea" },
];

export function AssetsTable() {
  const { t } = useT();
  const can = useCan();
  const router = useRouter();
  const { campuses } = useSession();
  const [open, setOpen] = useState(false);
  const { data: cats = [] } = useQuery({ queryKey: ["asset-categories"], queryFn: () => api<{ id: string; name: string; parent_id: string | null }[]>("/asset-categories?limit=200") });
  const columns: Column[] = [
    { key: "asset_tag", header: t("facility.assets.colTag"), sortable: true, pinned: true, className: "whitespace-nowrap font-mono text-xs" },
    { key: "name", header: t("ui.asset"), sortable: true, pinned: true, render: (r) => <span className="font-medium">{r.name}</span> },
    { key: "status", header: t("ui.status"), render: (r) => <StatusBadge status={r.status} /> },
    { key: "category", header: t("ui.category"), render: (r) => [r.category?.name, r.subcategory?.name].filter(Boolean).join(" › ") || "—" },
    { key: "condition", header: t("facility.assets.condition"), render: (r) => (r.condition ? t(`enum.assetCondition.${r.condition}`, undefined, humanize(r.condition)) : "—"), defaultHidden: true },
    { key: "location", header: t("ui.location"), render: (r) => (r.location ? [...r.location.path_names, r.location.name].join(" › ") : r.campus?.name), className: "max-w-56 truncate" },
    { key: "custodian", header: t("facility.assets.custodian"), render: (r) => <UserChip name={r.custodian?.full_name} /> },
    { key: "make", header: t("facility.assets.colMakeModel"), render: (r) => [r.make, r.model].filter(Boolean).join(" ") || "—", defaultHidden: true },
    { key: "serial_number", header: t("facility.assets.colSerial"), defaultHidden: true },
    { key: "purchase_date", header: t("facility.assets.colPurchased"), sortable: true, render: (r) => r.purchase_date ?? "—", defaultHidden: true },
    { key: "purchase_cost", header: t("ui.cost"), sortable: true, align: "right", render: (r) => <Money value={r.purchase_cost} /> },
    { key: "warranty_until", header: t("facility.assets.colWarranty"), sortable: true, render: (r) => <DueDate value={r.warranty_until} done={r.status === "disposed"} /> },
    { key: "installed_on", header: t("facility.assets.installedOn"), render: (r) => r.installed_on ?? "—", defaultHidden: true },
  ];
  return (
    <>
      <DataTable
        id="assets"
        endpoint="/assets"
        columns={columns}
        defaultSort="-created_at"
        searchPlaceholder={t("facility.assets.searchPlaceholder")}
        rowHref={(r) => `/facility/assets/${r.id}`}
        selectable
        bulkActions={(rows) => (
          <Button size="sm" variant="outline" onClick={() => printLabels("asset", rows.map((r) => r.id))}>
            <QrCode /> {t("facility.assets.printQr")}
          </Button>
        )}
        filters={[
          { key: "status", label: t("ui.status"), type: "multi", options: ["in_stock", "in_use", "under_repair", "disposed", "lost"].map(statusOpt(t)) },
          { key: "category_id", label: t("ui.category"), type: "select", options: cats.filter((c) => !c.parent_id).map((c) => ({ value: c.id, label: c.name })) },
          ...(cats.some((c) => c.parent_id) ? [{ key: "subcategory_id", label: t("facility.assets.subcategory"), type: "select" as const, options: cats.filter((c) => c.parent_id).map((c) => ({ value: c.id, label: c.name })) }] : []),
          { key: "condition", label: t("facility.assets.condition"), type: "multi", options: CONDITIONS.map((c) => ({ value: c, label: t(`enum.assetCondition.${c}`, undefined, humanize(c)) })) },
          ...(campuses.length > 1 ? [{ key: "campus_id", label: t("ui.campus"), type: "select" as const, options: campuses.map((c) => ({ value: c.id, label: c.name })) }] : []),
          { key: "custodian_id", label: t("facility.assets.custodian"), type: "select", options: [{ value: "me", label: t("facility.me") }] },
          { key: "warranty_until", label: t("facility.assets.colWarranty"), type: "date-range" },
        ]}
        toolbar={
          <>
            <Button size="sm" variant="outline" asChild>
              <Link href="/facility/assets/audits">
                <ClipboardCheck /> <span className="hidden sm:inline">{t("facility.assets.auditsLabel")}</span>
              </Link>
            </Button>
            {can("asset:create") && (
              <>
                <Button size="sm" variant="outline" asChild>
                  <Link href="/facility/assets/import">
                    <Upload /> <span className="hidden sm:inline">{t("ui.import")}</span>
                  </Link>
                </Button>
                <Button size="sm" onClick={() => setOpen(true)}>
                  <Plus /> {t("common.new")}
                </Button>
              </>
            )}
          </>
        }
        mobileCard={(r) => (
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs">{r.asset_tag}</span>
              <StatusBadge status={r.status} />
            </div>
            <span className="font-medium">{r.name}</span>
            <span className="text-xs text-muted-foreground">{r.location?.name ?? r.campus?.name} · {r.custodian?.full_name ?? t("facility.assets.noCustodian")}</span>
          </div>
        )}
      />
      <ResourceFormDialog
        open={open}
        onOpenChange={setOpen}
        title={t("facility.assets.newTitle")}
        description={t("facility.assets.newDesc")}
        endpoint="/assets"
        fields={assetFields(t)}
        defaultValues={{ status: "in_stock", campus_id: campuses.length === 1 ? campuses[0].id : "" }}
        invalidate={["/assets"]}
        onSaved={(r: { id: string }) => router.push(`/facility/assets/${r.id}`)}
      />
    </>
  );
}
