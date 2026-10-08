"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Inbox } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApprovalActions } from "@/components/shared/collaboration";
import { DateTime, Money } from "@/components/shared/format";
import { EmptyState } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status";
import { api } from "@/lib/client/api";
import { useT } from "@/lib/i18n/client";
import { humanize } from "@/lib/utils/format";
import { entityHref } from "../home-widgets";

interface Req {
  id: string;
  title: string;
  status: string;
  entity_type: string;
  entity_id: string;
  amount: number | null;
  submitted_at: string;
  decided_at: string | null;
  requester: { full_name: string | null } | null;
  steps?: { step_order: number; name: string; status: string }[];
}

export function ApprovalsView() {
  const qc = useQueryClient();
  const { t } = useT();
  const inbox = useQuery({ queryKey: ["approvals-inbox"], queryFn: () => api<Req[]>("/approvals/inbox") });
  const mine = useQuery({ queryKey: ["approvals-mine"], queryFn: () => api<Req[]>("/approvals?mine=true") });
  const all = useQuery({ queryKey: ["approvals-all"], queryFn: () => api<Req[]>("/approvals?status=approved,rejected,cancelled") });
  const refresh = () => qc.invalidateQueries({ queryKey: ["approvals-inbox"] });

  return (
    <Tabs defaultValue="inbox">
      <TabsList>
        <TabsTrigger value="inbox">
          {t("approvals.view.waitingForMe")} {inbox.data?.length ? <span className="rounded-full bg-primary px-1.5 text-[11px] text-primary-foreground">{inbox.data.length}</span> : null}
        </TabsTrigger>
        <TabsTrigger value="mine">{t("approvals.view.myRequests")}</TabsTrigger>
        <TabsTrigger value="history">{t("approvals.view.decided")}</TabsTrigger>
      </TabsList>
      <TabsContent value="inbox" className="flex flex-col gap-3">
        {inbox.isLoading && <Skeleton className="h-28" />}
        {inbox.data?.length === 0 && <EmptyState icon={Inbox} title={t("approvals.view.caughtUpTitle")} description={t("approvals.view.caughtUpDescription")} />}
        {inbox.data?.map((r) => {
          const current = r.steps?.find((s) => s.status === "pending");
          return (
            <Card key={r.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <Link href={entityHref(r.entity_type, r.entity_id)} className="font-medium hover:underline">
                  {r.title}
                </Link>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t(`enum.entityType.${r.entity_type}`, undefined, humanize(r.entity_type))} · {t("approvals.view.by", { name: r.requester?.full_name ?? "" })} · <DateTime value={r.submitted_at} relative />
                  {current && <> · {t("approvals.view.step", { n: current.step_order, name: current.name })}</>}
                </p>
              </div>
              {r.amount !== null && <Money value={r.amount} className="text-base font-semibold" />}
              <ApprovalActions requestId={r.id} onDone={refresh} />
            </Card>
          );
        })}
      </TabsContent>
      <TabsContent value="mine">
        <RequestList rows={mine.data} loading={mine.isLoading} />
      </TabsContent>
      <TabsContent value="history">
        <RequestList rows={all.data} loading={all.isLoading} />
      </TabsContent>
    </Tabs>
  );
}

function RequestList({ rows, loading }: { rows?: Req[]; loading: boolean }) {
  const { t } = useT();
  if (loading) return <Skeleton className="h-40" />;
  if (!rows?.length) return <p className="py-8 text-center text-sm text-muted-foreground">{t("approvals.view.noRequests")}</p>;
  return (
    <Card className="divide-y">
      {rows.map((r) => (
        <Link key={r.id} href={entityHref(r.entity_type, r.entity_id)} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{r.title}</p>
            <p className="text-xs text-muted-foreground">
              {t(`enum.entityType.${r.entity_type}`, undefined, humanize(r.entity_type))} · {r.requester?.full_name} · <DateTime value={r.submitted_at} relative />
            </p>
          </div>
          {r.amount !== null && <Money value={r.amount} className="text-sm" />}
          <StatusBadge status={r.status} />
        </Link>
      ))}
    </Card>
  );
}
