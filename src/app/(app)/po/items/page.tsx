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

/* eslint-disable @typescript-eslint/no-explicit-any */
const GST = ["0", "5", "12", "18", "28"].map((g) => ({ value: g, label: `${g}%` }));
const fields = (row?: any): FieldSpec[] => [
  { name: "name", label: "Name", required: true, full: true },
  { name: "sku", label: "SKU / code" },
  { name: "unit", label: "Unit", placeholder: "nos, kg, box…" },
  { name: "hsn_sac", label: "HSN / SAC", placeholder: "4–8 digits" },
  { name: "gst_rate", label: "GST rate", type: "select", options: GST, required: true },
  { name: "last_price", label: "Last price", type: "money" },
  { name: "expense_category_id", label: "Budget category", type: "resource", endpoint: "/expense-categories", initialLabel: row?.expense_category?.name },
  { name: "is_asset", label: "Track as asset", type: "switch" },
  { name: "asset_category_id", label: "Asset category", type: "resource", endpoint: "/asset-categories", hidden: (v) => !v.is_asset },
  { name: "active", label: "Active", type: "switch" },
  { name: "description", label: "Description", type: "textarea" },
];

export default function ItemsPage() {
  const can = useCan();
  const [editing, setEditing] = useState<any>(null);
  const toBody = (v: Record<string, unknown>) => ({ ...v, gst_rate: v.gst_rate != null ? Number(v.gst_rate) : undefined, is_asset: !!v.is_asset, active: v.active !== false });
  return (
    <div>
      <PageHeader
        title="Item catalogue"
        description="Standard items with default unit, rate and GST. Picking an item on a requisition or PO pre-fills these."
        actions={can("po:create") && <Button onClick={() => setEditing({ unit: "nos", gst_rate: "18", active: true, is_asset: false })}><Plus /> New item</Button>}
      />
      <Suspense>
        <DataTable
          id="items"
          endpoint="/items"
          defaultSort="name"
          onRowClick={can("po:create") ? (r) => setEditing({ ...r, gst_rate: String(Number(r.gst_rate)) }) : undefined}
          columns={[
            { key: "name", header: "Item", sortable: true, pinned: true, render: (r) => <span className="font-medium">{r.name}</span> },
            { key: "sku", header: "SKU", sortable: true, className: "font-mono text-xs" },
            { key: "unit", header: "Unit" },
            { key: "hsn_sac", header: "HSN/SAC", className: "font-mono text-xs" },
            { key: "gst_rate", header: "GST", align: "right", render: (r) => `${Number(r.gst_rate)}%` },
            { key: "last_price", header: "Last price", align: "right", render: (r) => <Money value={r.last_price} /> },
            { key: "is_asset", header: "Type", render: (r) => (r.is_asset ? <Badge tone="violet">Asset</Badge> : <Badge>Consumable</Badge>) },
            { key: "active", header: "Status", render: (r) => (r.active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>) },
          ]}
          filters={[
            { key: "active", label: "Active", type: "boolean" },
            { key: "is_asset", label: "Asset", type: "boolean" },
          ]}
          mobileCard={(r) => (
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{r.name}</p>
                <p className="text-xs text-muted-foreground">{[r.sku, r.unit, `GST ${Number(r.gst_rate)}%`].filter(Boolean).join(" · ")}</p>
              </div>
              <Money value={r.last_price} className="text-sm" />
            </div>
          )}
        />
      </Suspense>
      <ResourceFormDialog
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        title={editing?.id ? "Edit item" : "New item"}
        fields={fields(editing)}
        defaultValues={editing ?? undefined}
        endpoint={editing?.id ? `/items/${editing.id}` : "/items"}
        method={editing?.id ? "PATCH" : "POST"}
        invalidate={["/items"]}
        transform={toBody}
      />
    </div>
  );
}
