"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { BreakdownBars } from "@/components/shared/charts";
import { Money, useMoney } from "@/components/shared/format";
import { PageHeader, Stat } from "@/components/shared/page-header";
import { api } from "@/lib/client/api";
import { useT } from "@/lib/i18n/client";
import { humanize } from "@/lib/utils/format";

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function PoOverview() {
  const { t } = useT();
  const fmt = useMoney();
  const { data, isLoading } = useQuery({ queryKey: ["po-dashboard"], queryFn: () => api<any>("/po/dashboard") });
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={t("po.overview.title")} description={t("po.overview.description")} />
      {isLoading || !data ? <Skeleton className="h-64" /> : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label={t("po.overview.openValue")} value={<Money value={data.open_value} compact />} href="/po/orders?status=approved,sent,acknowledged,partially_received,received" />
            <Stat label={t("po.overview.awaitingApproval")} value={data.pending_approval + data.requisitions_pending} hint={t("po.overview.awaitingHint", { pos: data.pending_approval, reqs: data.requisitions_pending })} tone={data.pending_approval ? "warning" : "default"} href="/approvals" />
            <Stat label={t("po.overview.invoicesToReview")} value={data.invoices_pending} hint={t("po.overview.mismatchHint", { n: data.invoices_mismatch })} tone={data.invoices_mismatch ? "danger" : "default"} href="/po/invoices?status=received" />
            <Stat label={t("po.overview.overduePayables")} value={<Money value={data.payables_overdue} compact />} tone={Number(data.payables_overdue) > 0 ? "danger" : "good"} href="/po/invoices?status=approved,partially_paid" />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>{t("po.overview.byStatus")}</CardTitle></CardHeader>
              <CardContent>
                <BreakdownBars rows={Object.entries(data.by_status as Record<string, number>).map(([k, v]) => ({ label: t(`status.${k}`, undefined, humanize(k)), value: v }))} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>{t("po.overview.topVendors")}</CardTitle></CardHeader>
              <CardContent>
                {data.top_vendors.length === 0 ? <p className="text-sm text-muted-foreground">{t("po.overview.noSpend")}</p> : (
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
