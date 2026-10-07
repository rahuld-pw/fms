"use client";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { CheckSquare } from "lucide-react";
import { useSession } from "@/components/app/session";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, PageHeader } from "@/components/shared/page-header";
import { apiList } from "@/lib/client/api";
import { QuickAdd, TaskRow, type Task } from "./shared";

export default function MyTasksPage() {
  const { user } = useSession();
  const { data, isLoading } = useQuery({ queryKey: ["tasks", "mine"], queryFn: () => apiList<Task>("/tasks/mine?limit=200&sort=due_date") });
  const groups = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const week = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const g: Record<string, Task[]> = { Overdue: [], Today: [], "Next 7 days": [], Later: [], "No due date": [] };
    for (const t of data?.data ?? []) {
      if (!t.due_date) g["No due date"].push(t);
      else if (t.due_date < today) g.Overdue.push(t);
      else if (t.due_date === today) g.Today.push(t);
      else if (t.due_date <= week) g["Next 7 days"].push(t);
      else g.Later.push(t);
    }
    return g;
  }, [data]);
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="My tasks" description="Everything assigned to you across projects." />
      <Card className="mb-4"><QuickAdd placeholder="Add a personal task and press Enter…" assignToMe={user.id} /></Card>
      {isLoading && <Skeleton className="h-64" />}
      {!isLoading && data?.data.length === 0 && <EmptyState icon={CheckSquare} title="Nothing assigned to you" description="Tasks assigned to you in any project show up here." />}
      <div className="flex flex-col gap-4">
        {Object.entries(groups).map(([label, tasks]) =>
          tasks.length === 0 ? null : (
            <section key={label}>
              <h2 className={`mb-1.5 text-xs font-semibold tracking-wide uppercase ${label === "Overdue" ? "text-destructive" : "text-muted-foreground"}`}>
                {label} <span className="font-normal">{tasks.length}</span>
              </h2>
              <Card>{tasks.map((t) => <TaskRow key={t.id} task={t} showProject />)}</Card>
            </section>
          ),
        )}
      </div>
    </div>
  );
}
