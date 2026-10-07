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
import { humanize } from "@/lib/utils/format";
import { printLabels } from "./labels";

const opt = (v: string) => ({ value: v, label: humanize(v) });

export const assetFields: FieldSpec[] = [
  { name: "name", label: "Name", required: true, full: true },
  { name: "campus_id", label: "Campus", type: "campus", required: true },
  { name: "category_id", label: "Category", type: "resource", endpoint: "/asset-categories" },
  { name: "location_id", label: "Location", type: "resource", endpoint: "/locations" },
  { name: "department_id", label: "Department", type: "department", campusField: "campus_id" },
  { name: "custodian_id", label: "Custodian", type: "user" },
  { name: "status", label: "Status", type: "select", required: true, options: ["in_stock", "in_use", "under_repair", "lost"].map(opt) },
  { name: "make", label: "Make" },
  { name: "model", label: "Model" },
  { name: "serial_number", label: "Serial number" },
  { name: "purchase_date", label: "Purchase date", type: "date" },
  { name: "purchase_cost", label: "Purchase cost", type: "money" },
  { name: "vendor_id", label: "Vendor", type: "resource", endpoint: "/vendors" },
  { name: "invoice_number", label: "Invoice number" },
  { name: "warranty_until", label: "Warranty until", type: "date" },
  { name: "usage_unit", label: "Usage meter unit", hint: "e.g. hours, km — for usage-based maintenance" },
  { name: "description", label: "Notes", type: "textarea" },
];

export function AssetsTable() {
  const can = useCan();
  const router = useRouter();
  const { campuses } = useSession();
  const [open, setOpen] = useState(false);
  const { data: cats = [] } = useQuery({ queryKey: ["asset-categories"], queryFn: () => api<{ id: string; name: string }[]>("/asset-categories?limit=100") });
  const columns: Column[] = [
    { key: "asset_tag", header: "Tag", sortable: true, pinned: true, className: "whitespace-nowrap font-mono text-xs" },
    { key: "name", header: "Asset", sortable: true, pinned: true, render: (r) => <span className="font-medium">{r.name}</span> },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
    { key: "category", header: "Category", render: (r) => r.category?.name ?? "—" },
    { key: "location", header: "Location", render: (r) => r.location?.name ?? r.campus?.name, className: "max-w-48 truncate" },
    { key: "custodian", header: "Custodian", render: (r) => <UserChip name={r.custodian?.full_name} /> },
    { key: "make", header: "Make / model", render: (r) => [r.make, r.model].filter(Boolean).join(" ") || "—", defaultHidden: true },
    { key: "serial_number", header: "Serial", defaultHidden: true },
    { key: "purchase_date", header: "Purchased", sortable: true, render: (r) => r.purchase_date ?? "—", defaultHidden: true },
    { key: "purchase_cost", header: "Cost", sortable: true, align: "right", render: (r) => <Money value={r.purchase_cost} /> },
    { key: "warranty_until", header: "Warranty", sortable: true, render: (r) => <DueDate value={r.warranty_until} done={r.status === "disposed"} /> },
  ];
  return (
    <>
      <DataTable
        id="assets"
        endpoint="/assets"
        columns={columns}
        defaultSort="-created_at"
        searchPlaceholder="Search name, tag, serial…"
        rowHref={(r) => `/facility/assets/${r.id}`}
        selectable
        bulkActions={(rows) => (
          <Button size="sm" variant="outline" onClick={() => printLabels("asset", rows.map((r) => r.id))}>
            <QrCode /> Print QR labels
          </Button>
        )}
        filters={[
          { key: "status", label: "Status", type: "multi", options: ["in_stock", "in_use", "under_repair", "disposed", "lost"].map(opt) },
          { key: "category_id", label: "Category", type: "select", options: cats.map((c) => ({ value: c.id, label: c.name })) },
          ...(campuses.length > 1 ? [{ key: "campus_id", label: "Campus", type: "select" as const, options: campuses.map((c) => ({ value: c.id, label: c.name })) }] : []),
          { key: "custodian_id", label: "Custodian", type: "select", options: [{ value: "me", label: "Me" }] },
          { key: "warranty_until", label: "Warranty", type: "date-range" },
        ]}
        toolbar={
          <>
            <Button size="sm" variant="outline" asChild>
              <Link href="/facility/assets/audits">
                <ClipboardCheck /> <span className="hidden sm:inline">Audits</span>
              </Link>
            </Button>
            {can("asset:create") && (
              <>
                <Button size="sm" variant="outline" asChild>
                  <Link href="/facility/assets/import">
                    <Upload /> <span className="hidden sm:inline">Import</span>
                  </Link>
                </Button>
                <Button size="sm" onClick={() => setOpen(true)}>
                  <Plus /> New
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
            <span className="text-xs text-muted-foreground">{r.location?.name ?? r.campus?.name} · {r.custodian?.full_name ?? "No custodian"}</span>
          </div>
        )}
      />
      <ResourceFormDialog
        open={open}
        onOpenChange={setOpen}
        title="New asset"
        description="The asset tag and QR code are generated automatically."
        endpoint="/assets"
        fields={assetFields}
        defaultValues={{ status: "in_stock", campus_id: campuses.length === 1 ? campuses[0].id : "" }}
        invalidate={["/assets"]}
        onSaved={(r: { id: string }) => router.push(`/facility/assets/${r.id}`)}
      />
    </>
  );
}
