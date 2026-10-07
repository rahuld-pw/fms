"use client";
import { useRouter } from "next/navigation";
import { Suspense, useState } from "react";
import { Plus } from "lucide-react";
import { useCan, useSession } from "@/components/app/session";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { ResourceFormDialog } from "@/components/shared/resource-form";
import { StatusBadge } from "@/components/shared/status";

export default function AuditsPage() {
  const can = useCan();
  const router = useRouter();
  const { campuses } = useSession();
  const [open, setOpen] = useState(false);
  return (
    <div>
      <PageHeader title="Asset verification audits" breadcrumbs={[{ label: "Assets", href: "/facility/assets" }, { label: "Audits" }]} description="Periodic physical verification: scan tags to mark assets found, missing or relocated." />
      <Suspense>
        <DataTable
          id="asset-audits"
          endpoint="/asset-audits"
          defaultSort="-scheduled_for"
          rowHref={(r) => `/facility/assets/audits/${r.id}`}
          exportable={false}
          columns={[
            { key: "name", header: "Audit", pinned: true, render: (r) => <span className="font-medium">{r.name}</span> },
            { key: "campus", header: "Campus", render: (r) => r.campus?.name },
            { key: "location", header: "Scope", render: (r) => r.location?.name ?? "Whole campus" },
            { key: "scheduled_for", header: "Scheduled", sortable: true },
            { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
          ]}
          toolbar={can("asset_audit:create") && <Button size="sm" onClick={() => setOpen(true)}><Plus /> New audit</Button>}
        />
      </Suspense>
      <ResourceFormDialog
        open={open}
        onOpenChange={setOpen}
        title="Plan an audit"
        endpoint="/asset-audits"
        fields={[
          { name: "name", label: "Name", required: true, full: true, placeholder: "e.g. Half-yearly IT asset verification" },
          { name: "campus_id", label: "Campus", type: "campus", required: true },
          { name: "scheduled_for", label: "Date", type: "date" },
          { name: "location_id", label: "Limit to location", type: "resource", endpoint: "/locations" },
          { name: "category_id", label: "Limit to category", type: "resource", endpoint: "/asset-categories" },
        ]}
        defaultValues={{ campus_id: campuses.length === 1 ? campuses[0].id : "", scheduled_for: new Date().toISOString().slice(0, 10) }}
        invalidate={["/asset-audits"]}
        onSaved={async (r: { id: string }) => {
          await fetch(`/api/v1/asset-audits/${r.id}/populate`, { method: "POST" });
          router.push(`/facility/assets/audits/${r.id}`);
        }}
      />
    </div>
  );
}
