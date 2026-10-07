"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { BreakdownBars } from "@/components/shared/charts";
import { Money, useMoney } from "@/components/shared/format";
import { PageHeader, Stat } from "@/components/shared/page-header";
import { api } from "@/lib/client/api";
import { humanize } from "@/lib/utils/format";

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function PoOverview() {
  const fmt = useMoney();
  const { data, isLoading } = useQuery({ queryKey: ["po-dashboard"], queryFn: () => api<any>("/po/dashboard") });
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Purchasing overview" description="Requisition → RFQ → PO → GRN → invoice → payment." />
      {isLoading || !data ? <Skeleton className="h-64" /> : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Open PO value" value={<Money value={data.open_value} compact />} href="/po/orders?status=approved,sent,acknowledged,partially_received,received" />
            <Stat label="Awaiting approval" value={data.pending_approval + data.requisitions_pending} hint={`${data.pending_approval} POs · ${data.requisitions_pending} requisitions`} tone={data.pending_approval ? "warning" : "default"} href="/approvals" />
            <Stat label="Invoices to review" value={data.invoices_pending} hint={`${data.invoices_mismatch} with 3-way mismatch`} tone={data.invoices_mismatch ? "danger" : "default"} href="/po/invoices?status=received" />
            <Stat label="Overdue payables" value={<Money value={data.payables_overdue} compact />} tone={Number(data.payables_overdue) > 0 ? "danger" : "good"} href="/po/invoices?status=approved,partially_paid" />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Purchase orders by status</CardTitle></CardHeader>
              <CardContent>
                <BreakdownBars rows={Object.entries(data.by_status as Record<string, number>).map(([k, v]) => ({ label: humanize(k), value: v }))} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Top vendors by spend (12 months)</CardTitle></CardHeader>
              <CardContent>
                {data.top_vendors.length === 0 ? <p className="text-sm text-muted-foreground">No spend yet.</p> : (
                  <BreakdownBars format={(v) => fmt(v, true)} rows={data.top_vendors.map((v: any) => ({ label: v.name, value: Number(v.spend) }))} />
                )}
                <div className="mt-3 flex flex-wrap gap-3 text-xs">
                  {data.top_vendors.slice(0, 5).map((v: any) => <Link key={v.id} href={`/facility/vendors/${v.id}`} className="text-primary hover:underline">{v.name}</Link>)}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
