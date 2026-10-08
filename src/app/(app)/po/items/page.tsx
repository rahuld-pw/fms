"use client";
import { Suspense, useState } from "react";
import { Plus } from "lucide-react";
import { useCan } from "@/components/app/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/shared/data-table";
import { Money } from "@/components/shared/format";
import { PageHeader } from "@/components/shared/page-header";
import { ResourceFormDialog, type FieldSpec } from "@/components/shared/resource-form";
import { useT } from "@/lib/i18n/client";
import type { TFunction } from "@/lib/i18n/translate";

/* eslint-disable @typescript-eslint/no-explicit-any */
const GST = ["0", "5", "12", "18", "28"].map((g) => ({ value: g, label: `${g}%` }));
const fields = (t: TFunction, row?: any): FieldSpec[] => [
  { name: "name", label: t("ui.name"), required: true, full: true },
  { name: "sku", label: t("po.items.skuCode") },
  { name: "unit", label: t("ui.unit"), placeholder: t("po.items.unitPlaceholder") },
  { name: "hsn_sac", label: t("po.items.hsnSac"), placeholder: t("po.items.hsnPlaceholder") },
  { name: "gst_rate", label: t("po.items.gstRate"), type: "select", options: GST, required: true },
  { name: "last_price", label: t("po.items.lastPrice"), type: "money" },
  { name: "expense_category_id", label: t("po.common.budgetCategory"), type: "resource", endpoint: "/expense-categories", initialLabel: row?.expense_category?.name },
  { name: "is_asset", label: t("po.items.trackAsAsset"), type: "switch" },
  { name: "asset_category_id", label: t("po.common.assetCategory"), type: "resource", endpoint: "/asset-categories", hidden: (v) => !v.is_asset },
  { name: "active", label: t("ui.active"), type: "switch" },
  { name: "description", label: t("ui.description"), type: "textarea" },
];

export default function ItemsPage() {
  const { t } = useT();
  const can = useCan();
  const [editing, setEditing] = useState<any>(null);
  const toBody = (v: Record<string, unknown>) => ({ ...v, gst_rate: v.gst_rate != null ? Number(v.gst_rate) : undefined, is_asset: !!v.is_asset, active: v.active !== false });
  return (
    <div>
      <PageHeader
        title={t("po.items.title")}
        description={t("po.items.description")}
        actions={can("po:create") && <Button onClick={() => setEditing({ unit: "nos", gst_rate: "18", active: true, is_asset: false })}><Plus /> {t("po.items.newItem")}</Button>}
      />
      <Suspense>
        <DataTable
          id="items"
          endpoint="/items"
          defaultSort="name"
          onRowClick={can("po:create") ? (r) => setEditing({ ...r, gst_rate: String(Number(r.gst_rate)) }) : undefined}
          columns={[
            { key: "name", header: t("ui.item"), sortable: true, pinned: true, render: (r) => <span className="font-medium">{r.name}</span> },
            { key: "sku", header: t("po.items.sku"), sortable: true, className: "font-mono text-xs" },
            { key: "unit", header: t("ui.unit") },
            { key: "hsn_sac", header: t("po.items.hsnSacShort"), className: "font-mono text-xs" },
            { key: "gst_rate", header: t("po.common.gst"), align: "right", render: (r) => `${Number(r.gst_rate)}%` },
            { key: "last_price", header: t("po.items.lastPrice"), align: "right", render: (r) => <Money value={r.last_price} /> },
            { key: "is_asset", header: t("ui.type"), render: (r) => (r.is_asset ? <Badge tone="violet">{t("ui.asset")}</Badge> : <Badge>{t("po.items.consumable")}</Badge>) },
            { key: "active", header: t("ui.status"), render: (r) => (r.active ? <Badge tone="green">{t("ui.active")}</Badge> : <Badge>{t("ui.inactive")}</Badge>) },
          ]}
          filters={[
            { key: "active", label: t("ui.active"), type: "boolean" },
            { key: "is_asset", label: t("ui.asset"), type: "boolean" },
          ]}
          mobileCard={(r) => (
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{r.name}</p>
                <p className="text-xs text-muted-foreground">{[r.sku, r.unit, t("po.common.gstRate", { rate: Number(r.gst_rate) })].filter(Boolean).join(" · ")}</p>
              </div>
              <Money value={r.last_price} className="text-sm" />
            </div>
          )}
        />
      </Suspense>
      <ResourceFormDialog
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        title={editing?.id ? t("po.items.editItem") : t("po.items.newItem")}
        fields={fields(t, editing)}
        defaultValues={editing ?? undefined}
        endpoint={editing?.id ? `/items/${editing.id}` : "/items"}
        method={editing?.id ? "PATCH" : "POST"}
        invalidate={["/items"]}
        transform={toBody}
      />
    </div>
  );
}
