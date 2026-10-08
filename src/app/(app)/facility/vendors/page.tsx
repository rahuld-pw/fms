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
import { useT } from "@/lib/i18n/client";
import type { TFunction } from "@/lib/i18n/translate";
import { humanize } from "@/lib/utils/format";
import { vendorFields } from "./vendor-fields";

const typeOpt = (t: TFunction) => (v: string) => ({ value: v, label: t(`enum.vendorType.${v}`, undefined, humanize(v)) });

export default function VendorsPage() {
  const { t } = useT();
  const can = useCan();
  const router = useRouter();
  const [dialog, setDialog] = useState<"invite" | "new" | null>(null);
  return (
    <div>
      <PageHeader
        title={t("facility.vendors.title")}
        description={t("facility.vendors.description")}
        actions={
          can("vendor:create") && (
            <>
              <Button variant="outline" onClick={() => setDialog("new")}><Plus /> {t("facility.vendors.addDirectly")}</Button>
              <Button onClick={() => setDialog("invite")}><Mail /> {t("facility.vendors.inviteVendor")}</Button>
            </>
          )
        }
      />
      <Suspense>
        <DataTable
          id="vendors"
          endpoint="/vendors"
          defaultSort="name"
          searchPlaceholder={t("facility.vendors.searchPlaceholder")}
          rowHref={(r) => `/facility/vendors/${r.id}`}
          columns={[
            { key: "vendor_code", header: t("ui.code"), sortable: true, className: "whitespace-nowrap font-mono text-xs" },
            { key: "name", header: t("ui.vendor"), sortable: true, pinned: true, render: (r) => <span className="font-medium">{r.name}</span> },
            { key: "status", header: t("ui.status"), render: (r) => <StatusBadge status={r.status} /> },
            { key: "vendor_type", header: t("ui.type"), render: (r) => (r.vendor_type ? t(`enum.vendorType.${r.vendor_type}`, undefined, humanize(r.vendor_type)) : humanize(r.vendor_type)) },
            { key: "contact_name", header: t("facility.vendors.contact"), render: (r) => [r.contact_name, r.phone].filter(Boolean).join(" · ") || "—" },
            { key: "city", header: t("facility.vendors.fields.city") },
            { key: "gstin", header: t("facility.vendors.fields.gstin"), className: "font-mono text-xs", defaultHidden: true },
            { key: "rating_avg", header: t("facility.vendors.rating"), sortable: true, render: (r) => (r.rating_avg ? <span className="inline-flex items-center gap-1"><Star className="size-3.5 fill-amber-400 text-amber-400" />{Number(r.rating_avg).toFixed(1)} <span className="text-xs text-muted-foreground">({r.rating_count})</span></span> : "—") },
          ]}
          filters={[
            { key: "status", label: t("ui.status"), type: "multi", options: ["invited", "draft", "submitted", "under_verification", "pending_approval", "approved", "rejected", "blacklisted", "inactive"].map((v) => ({ value: v, label: t(`status.${v}`, undefined, humanize(v)) })) },
            { key: "vendor_type", label: t("ui.type"), type: "select", options: ["service", "supplier", "both"].map(typeOpt(t)) },
          ]}
        />
      </Suspense>
      <ResourceFormDialog
        open={dialog === "invite"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t("facility.vendors.inviteTitle")}
        description={t("facility.vendors.inviteDesc")}
        endpoint="/vendors/invite"
        fields={[
          { name: "name", label: t("facility.vendors.businessName"), required: true, full: true },
          { name: "email", label: t("ui.email"), type: "email", required: true },
          { name: "contact_name", label: t("facility.vendors.fields.contactPerson") },
          { name: "phone", label: t("ui.phone") },
          { name: "vendor_type", label: t("ui.type"), type: "select", options: ["service", "supplier", "both"].map(typeOpt(t)) },
          { name: "service_category_ids", label: t("facility.vendors.fields.services"), type: "resources", endpoint: "/service-categories" },
        ]}
        defaultValues={{ vendor_type: "service" }}
        submitLabel={t("facility.vendors.sendInvitation")}
        invalidate={["/vendors"]}
        onSaved={(r: { vendor: { id: string } }) => router.push(`/facility/vendors/${r.vendor.id}`)}
      />
      <ResourceFormDialog
        open={dialog === "new"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t("facility.vendors.addVendor")}
        endpoint="/vendors"
        fields={vendorFields(t)}
        defaultValues={{ vendor_type: "service" }}
        invalidate={["/vendors"]}
        onSaved={(r: { id: string }) => router.push(`/facility/vendors/${r.id}`)}
      />
    </div>
  );
}
