"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Circle } from "lucide-react";
import { useModule } from "@/components/app/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { DateTime, DueDate, Money } from "@/components/shared/format";
import { StatusBadge } from "@/components/shared/status";
import { api, apiList } from "@/lib/client/api";
import { humanize } from "@/lib/utils/format";

interface Approval { id: string; title: string; entity_type: string; entity_id: string; amount: number | null; submitted_at: string; requester: { full_name: string | null } | null }
interface Task { id: string; title: string; due_date: string | null; status: string; project: { name: string } | null }
interface Issue { id: string; number: string; title: string; status: string; created_at: string; location: { name: string } | null }
interface Activity { id: number; entity_type: string; entity_id: string; action: string; created_at: string; actor: { full_name: string | null } | null }

const ENTITY_URL: Record<string, string> = {
  expense_claim: "/expense/claims/", expense_advance: "/expense/advances/", purchase_order: "/po/orders/", requisition: "/po/requisitions/",
  vendor: "/facility/vendors/", budget_amendment: "/expense/budgets/", issue: "/facility/issues/", work_order: "/facility/work-orders/",
  asset: "/facility/assets/", task: "/tasks/t/", project: "/tasks/projects/",
};
export const entityHref = (type: string, id: string) => (ENTITY_URL[type] ? `${ENTITY_URL[type]}${type === "budget_amendment" ? "" : id}` : "#");

const VERBS: Record<string, string> = {
  created: "created", updated: "updated", deleted: "deleted", status_changed: "changed the status of", commented: "commented on",
  approval_approved: "approved", approval_rejected: "rejected", approval_cancelled: "withdrew", escalated: "escalated",
};
export function activityPhrase(action: string, entityType: string) {
  const noun = humanize(entityType).toLowerCase();
  const article = /^[aeiou]/.test(noun) ? "an" : "a";
  return `${VERBS[action] ?? humanize(action).toLowerCase()} ${article} ${noun}`;
}

export function HomeWidgets() {
  const tasks = useModule("tasks");
  const facility = useModule("facility");
  const approvals = useQuery({ queryKey: ["approvals-inbox"], queryFn: () => api<Approval[]>("/approvals/inbox") });
  const myTasks = useQuery({ queryKey: ["tasks-mine-home"], queryFn: () => apiList<Task>("/tasks/mine?limit=8&sort=due_date"), enabled: tasks });
  const issues = useQuery({ queryKey: ["issues-home"], queryFn: () => apiList<Issue>("/issues?limit=6&sort=-created_at"), enabled: facility });
  const activity = useQuery({ queryKey: ["activity-home"], queryFn: () => api<Activity[]>("/activity?limit=12") });

  return (
    <div className="mt-6 grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Approvals waiting for you</CardTitle>
          <Link href="/approvals" className="text-xs text-primary hover:underline">View all</Link>
        </CardHeader>
        <CardContent className="flex flex-col divide-y">
          {approvals.isLoading && <Skeleton className="h-24" />}
          {approvals.data?.length === 0 && <p className="py-4 text-sm text-muted-foreground">Nothing to approve. 🎉</p>}
          {approvals.data?.slice(0, 6).map((a) => (
            <Link key={a.id} href={entityHref(a.entity_type, a.entity_id)} className="flex items-center gap-3 py-2.5 hover:bg-muted/40">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{a.title}</p>
                <p className="text-xs text-muted-foreground">
                  {humanize(a.entity_type)} · {a.requester?.full_name} · <DateTime value={a.submitted_at} relative />
                </p>
              </div>
              {a.amount !== null && <Money value={a.amount} className="text-sm" />}
              <ArrowRight className="size-4 text-muted-foreground" />
            </Link>
          ))}
        </CardContent>
      </Card>

      {tasks && (
        <Card>
          <CardHeader>
            <CardTitle>My tasks</CardTitle>
            <Link href="/tasks" className="text-xs text-primary hover:underline">Open My Tasks</Link>
          </CardHeader>
          <CardContent className="flex flex-col divide-y">
            {myTasks.isLoading && <Skeleton className="h-24" />}
            {myTasks.data?.data.length === 0 && <p className="py-4 text-sm text-muted-foreground">No open tasks assigned to you.</p>}
            {myTasks.data?.data.map((t) => (
              <Link key={t.id} href={`/tasks/t/${t.id}`} className="flex items-center gap-2.5 py-2 hover:bg-muted/40">
                {t.status === "done" ? <CheckCircle2 className="size-4 text-primary" /> : <Circle className="size-4 text-muted-foreground" />}
                <span className="min-w-0 flex-1 truncate text-sm">{t.title}</span>
                {t.project && <span className="hidden truncate text-xs text-muted-foreground sm:inline">{t.project.name}</span>}
                <span className="text-xs"><DueDate value={t.due_date} /></span>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      {facility && (
        <Card>
          <CardHeader>
            <CardTitle>Recent issues</CardTitle>
            <Link href="/facility/issues" className="text-xs text-primary hover:underline">All issues</Link>
          </CardHeader>
          <CardContent className="flex flex-col divide-y">
            {issues.isLoading && <Skeleton className="h-24" />}
            {issues.data?.data.length === 0 && <p className="py-4 text-sm text-muted-foreground">No issues reported.</p>}
            {issues.data?.data.map((i) => (
              <Link key={i.id} href={`/facility/issues/${i.id}`} className="flex items-center gap-2.5 py-2 hover:bg-muted/40">
                <span className="w-20 shrink-0 font-mono text-xs text-muted-foreground">{i.number}</span>
                <span className="min-w-0 flex-1 truncate text-sm">{i.title}</span>
                <StatusBadge status={i.status} />
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Activity</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2.5">
          {activity.isLoading && <Skeleton className="h-24" />}
          {activity.data?.map((a) => (
            <Link key={a.id} href={entityHref(a.entity_type, a.entity_id)} className="text-sm hover:underline">
              <span className="font-medium">{a.actor?.full_name ?? "System"}</span>{" "}
              <span className="text-muted-foreground">
                {activityPhrase(a.action, a.entity_type)} · <DateTime value={a.created_at} relative />
              </span>
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
