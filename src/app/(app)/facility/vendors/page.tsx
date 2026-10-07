"use client";
import { useRouter } from "next/navigation";
import { Suspense, useState } from "react";
import { Mail, Plus, Star } from "lucide-react";
import { useCan } from "@/components/app/session";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { ResourceFormDialog } from "@/components/shared/resource-form";
import { StatusBadge } from "@/components/shared/status";
import { humanize } from "@/lib/utils/format";
import { vendorFields } from "./vendor-fields";

const opt = (v: string) => ({ value: v, label: humanize(v) });

export default function VendorsPage() {
  const can = useCan();
  const router = useRouter();
  const [dialog, setDialog] = useState<"invite" | "new" | null>(null);
  return (
    <div>
      <PageHeader
        title="Vendors"
        description="Service providers and suppliers: onboarding, documents, agreements and performance."
        actions={
          can("vendor:create") && (
            <>
              <Button variant="outline" onClick={() => setDialog("new")}><Plus /> Add directly</Button>
              <Button onClick={() => setDialog("invite")}><Mail /> Invite vendor</Button>
            </>
          )
        }
      />
      <Suspense>
        <DataTable
          id="vendors"
          endpoint="/vendors"
          defaultSort="name"
          searchPlaceholder="Search name, GSTIN, code…"
          rowHref={(r) => `/facility/vendors/${r.id}`}
          columns={[
            { key: "vendor_code", header: "Code", sortable: true, className: "whitespace-nowrap font-mono text-xs" },
            { key: "name", header: "Vendor", sortable: true, pinned: true, render: (r) => <span className="font-medium">{r.name}</span> },
            { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
            { key: "vendor_type", header: "Type", render: (r) => humanize(r.vendor_type) },
            { key: "contact_name", header: "Contact", render: (r) => [r.contact_name, r.phone].filter(Boolean).join(" · ") || "—" },
            { key: "city", header: "City" },
            { key: "gstin", header: "GSTIN", className: "font-mono text-xs", defaultHidden: true },
            { key: "rating_avg", header: "Rating", sortable: true, render: (r) => (r.rating_avg ? <span className="inline-flex items-center gap-1"><Star className="size-3.5 fill-amber-400 text-amber-400" />{Number(r.rating_avg).toFixed(1)} <span className="text-xs text-muted-foreground">({r.rating_count})</span></span> : "—") },
          ]}
          filters={[
            { key: "status", label: "Status", type: "multi", options: ["invited", "draft", "submitted", "under_verification", "pending_approval", "approved", "rejected", "blacklisted", "inactive"].map(opt) },
            { key: "vendor_type", label: "Type", type: "select", options: ["service", "supplier", "both"].map(opt) },
          ]}
        />
      </Suspense>
      <ResourceFormDialog
        open={dialog === "invite"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Invite a vendor"
        description="They get an email link to fill in their details and upload documents. You then verify and send for approval."
        endpoint="/vendors/invite"
        fields={[
          { name: "name", label: "Business name", required: true, full: true },
          { name: "email", label: "Email", type: "email", required: true },
          { name: "contact_name", label: "Contact person" },
          { name: "phone", label: "Phone" },
          { name: "vendor_type", label: "Type", type: "select", options: ["service", "supplier", "both"].map(opt) },
          { name: "service_category_ids", label: "Services", type: "resources", endpoint: "/service-categories" },
        ]}
        defaultValues={{ vendor_type: "service" }}
        submitLabel="Send invitation"
        invalidate={["/vendors"]}
        onSaved={(r: { vendor: { id: string } }) => router.push(`/facility/vendors/${r.vendor.id}`)}
      />
      <ResourceFormDialog
        open={dialog === "new"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Add vendor"
        endpoint="/vendors"
        fields={vendorFields}
        defaultValues={{ vendor_type: "service" }}
        invalidate={["/vendors"]}
        onSaved={(r: { id: string }) => router.push(`/facility/vendors/${r.id}`)}
      />
    </div>
  );
}
