"use client";
import { useNow } from "@/lib/client/use-now";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { CheckSquare } from "lucide-react";
import { useSession } from "@/components/app/session";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, PageHeader } from "@/components/shared/page-header";
import { apiList } from "@/lib/client/api";
import { useT } from "@/lib/i18n/client";
import { QuickAdd, TaskRow, type Task } from "./shared";

const GROUP_LABEL = { overdue: "tasks.mine.groupOverdue", today: "tasks.mine.groupToday", next7: "tasks.mine.groupNext7", later: "tasks.mine.groupLater", noDue: "tasks.mine.groupNoDue" } as const;

export default function MyTasksPage() {
  const { t } = useT();
  const { user } = useSession();
  const { data, isLoading } = useQuery({ queryKey: ["tasks", "mine"], queryFn: () => apiList<Task>("/tasks/mine?limit=200&sort=due_date") });
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
      {isLoading && <Skeleton className="h-64" />}
      {!isLoading && data?.data.length === 0 && <EmptyState icon={CheckSquare} title={t("tasks.mine.emptyTitle")} description={t("tasks.mine.emptyDescription")} />}
      <div className="flex flex-col gap-4">
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
      </div>
    </div>
  );
}
