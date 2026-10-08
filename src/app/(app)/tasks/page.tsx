"use client";
import { useNow } from "@/lib/client/use-now";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { CheckSquare } from "lucide-react";
import { useSession } from "@/components/app/session";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, PageHeader } from "@/components/shared/page-header";
import { apiList } from "@/lib/client/api";
import { relativeTime } from "@/lib/utils/format";
import { useT } from "@/lib/i18n/client";
import { QuickAdd, TaskRow, type Task } from "./shared";

const GROUP_LABEL = { overdue: "tasks.mine.groupOverdue", today: "tasks.mine.groupToday", next7: "tasks.mine.groupNext7", later: "tasks.mine.groupLater", noDue: "tasks.mine.groupNoDue" } as const;

type View = "assigned" | "created" | "completed";

export default function MyTasksPage() {
  const { t, locale } = useT();
  const { user } = useSession();
  // open tasks assigned to me, open tasks I created, or recently completed ones
  const [view, setView] = useState<View>("assigned");
  const { data, isLoading } = useQuery({
    queryKey: ["tasks", "mine", view],
    queryFn: () => apiList<Task>(view === "completed" ? "/tasks/mine?view=completed&limit=100" : `/tasks/mine?view=${view}&limit=200&sort=due_date`),
  });
  const now = useNow();
  const groups = useMemo(() => {
    const today = new Date(now).toISOString().slice(0, 10);
    const week = new Date(now + 7 * 86400000).toISOString().slice(0, 10);
    const g: Record<"overdue" | "today" | "next7" | "later" | "noDue", Task[]> = { overdue: [], today: [], next7: [], later: [], noDue: [] };
    for (const task of data?.data ?? []) {
      if (!task.due_date) g.noDue.push(task);
      else if (task.due_date < today) g.overdue.push(task);
      else if (task.due_date === today) g.today.push(task);
      else if (task.due_date <= week) g.next7.push(task);
      else g.later.push(task);
    }
    return g;
  }, [data, now]);
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={t("tasks.mine.title")} description={t("tasks.mine.description")} />
      <Card className="mb-4"><QuickAdd placeholder={t("tasks.mine.quickAdd")} assignToMe={user.id} /></Card>
      <Tabs value={view} onValueChange={(v) => setView(v as View)} className="mb-4">
        <TabsList>
          <TabsTrigger value="assigned">{t("tasks.mine.tabs.assigned")}</TabsTrigger>
          <TabsTrigger value="created">{t("tasks.mine.tabs.created")}</TabsTrigger>
          <TabsTrigger value="completed">{t("tasks.mine.tabs.completed")}</TabsTrigger>
        </TabsList>
      </Tabs>
      {isLoading && <Skeleton className="h-64" />}
      {!isLoading && data?.data.length === 0 && (
        <EmptyState
          icon={CheckSquare}
          title={t(view === "created" ? "tasks.mine.emptyCreatedTitle" : view === "completed" ? "tasks.mine.emptyCompletedTitle" : "tasks.mine.emptyTitle")}
          description={t(view === "created" ? "tasks.mine.emptyCreatedDescription" : view === "completed" ? "tasks.mine.emptyCompletedDescription" : "tasks.mine.emptyDescription")}
        />
      )}
      {view === "completed" && !!data?.data.length && (
        <Card>
          {data.data.map((task) => (
            <div key={task.id} className="flex items-center">
              <div className="min-w-0 flex-1"><TaskRow task={task} showProject /></div>
              {task.completed_at && <span className="shrink-0 px-3 text-xs text-muted-foreground tabular">{t("tasks.mine.completedAgo", { when: relativeTime(task.completed_at, locale) })}</span>}
            </div>
          ))}
        </Card>
      )}
      {view !== "completed" && <div className="flex flex-col gap-4">
        {Object.entries(groups).map(([group, tasks]) =>
          tasks.length === 0 ? null : (
            <section key={group}>
              <h2 className={`mb-1.5 text-xs font-semibold tracking-wide uppercase ${group === "overdue" ? "text-destructive" : "text-muted-foreground"}`}>
                {t(GROUP_LABEL[group as keyof typeof GROUP_LABEL])} <span className="font-normal">{tasks.length}</span>
              </h2>
              <Card>{tasks.map((task) => <TaskRow key={task.id} task={task} showProject />)}</Card>
            </section>
          ),
        )}
      </div>}
    </div>
  );
}
