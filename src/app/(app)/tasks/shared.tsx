"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { CheckCircle2, Circle, Repeat } from "lucide-react";
import { toast } from "sonner";
import { AvatarStack } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { DueDate } from "@/components/shared/format";
import { PriorityLabel } from "@/components/shared/status";
import { api, errorMessage } from "@/lib/client/api";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils/cn";

export interface Task {
  id: string;
  title: string;
  status: string;
  priority: string;
  due_date: string | null;
  start_date: string | null;
  section_id: string | null;
  project_id: string | null;
  parent_task_id: string | null;
  position: number;
  recurrence: unknown;
  project?: { id: string; name: string; color: string } | null;
  section?: { id: string; name: string } | null;
  assignees?: { user_id: string; profile: { id: string; full_name: string | null } | null }[];
  subtask_count?: { count: number }[];
}

/** Completion toggle with optimistic update across any cached task lists. */
export function useToggleDone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (t: Task) => api(`/tasks/${t.id}`, { method: "PATCH", body: { status: t.status === "done" ? "todo" : "done" } }),
    onMutate: async (t) => {
      const next = t.status === "done" ? "todo" : "done";
      const snapshots = qc.getQueriesData({ queryKey: ["tasks"] });
      qc.setQueriesData({ queryKey: ["tasks"] }, (old: unknown) => patchTasks(old, t.id, { status: next }));
      return { snapshots };
    },
    onError: (e, _t, ctx) => {
      ctx?.snapshots.forEach(([k, v]) => qc.setQueryData(k, v));
      toast.error(errorMessage(e));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
  });
}

/** Applies a patch to a task wherever it appears in a cached payload shape. */
export function patchTasks(old: unknown, id: string, patch: Partial<Task>): unknown {
  if (!old || typeof old !== "object") return old;
  const fix = (list: Task[]) => list.map((t) => (t.id === id ? { ...t, ...patch } : t));
  const o = old as { data?: Task[]; tasks?: Task[] };
  if (Array.isArray(o.data)) return { ...o, data: fix(o.data) };
  if (Array.isArray(o.tasks)) return { ...o, tasks: fix(o.tasks) };
  return old;
}

export function TaskRow({ task, showProject, onOpen }: { task: Task; showProject?: boolean; onOpen?: (t: Task) => void }) {
  const { t } = useT();
  const toggle = useToggleDone();
  const done = task.status === "done";
  const subtasks = task.subtask_count?.[0]?.count ?? 0;
  return (
    <div className="group flex items-center gap-2.5 border-b px-3 py-2 text-sm last:border-0 hover:bg-muted/40">
      <button onClick={() => toggle.mutate(task)} disabled={toggle.isPending} aria-busy={toggle.isPending || undefined} aria-label={done ? t("tasks.common.markIncomplete") : t("tasks.common.markComplete")} className="hit-area flex size-[18px] shrink-0 items-center justify-center">
        {toggle.isPending ? <Spinner className="text-muted-foreground" /> : done ? <CheckCircle2 className="size-[18px] text-primary" /> : <Circle className="size-[18px] text-muted-foreground hover:text-primary" />}
      </button>
      <Link href={`/tasks/t/${task.id}`} onClick={(e) => { if (onOpen) { e.preventDefault(); onOpen(task); } }} className={cn("min-w-0 flex-1 truncate", done && "text-muted-foreground line-through")}>
        {task.title}
      </Link>
      {task.recurrence ? <Repeat className="size-3.5 text-muted-foreground" aria-label={t("tasks.common.recurring")} /> : null}
      {subtasks > 0 && <span className="text-xs text-muted-foreground">{t("tasks.common.subtasks", { n: subtasks })}</span>}
      {showProject && task.project && (
        <span className="hidden max-w-36 truncate rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground sm:inline">{task.project.name}</span>
      )}
      <span className="hidden sm:inline"><PriorityLabel priority={task.priority === "medium" ? null : task.priority} /></span>
      <AvatarStack names={(task.assignees ?? []).map((a) => a.profile?.full_name)} />
      <span className="w-20 text-right text-xs"><DueDate value={task.due_date} done={done} /></span>
    </div>
  );
}

/** Inline "add a task" input. */
export function QuickAdd({ projectId, sectionId, placeholder, onAdded, assignToMe }: { projectId?: string | null; sectionId?: string | null; placeholder?: string; onAdded?: () => void; assignToMe?: string }) {
  const { t } = useT();
  const [title, setTitle] = useState("");
  const qc = useQueryClient();
  const add = useMutation({
    mutationFn: () => api("/tasks", { body: { title, project_id: projectId ?? undefined, section_id: sectionId ?? undefined, assignee_ids: assignToMe ? [assignToMe] : undefined } }),
    onSuccess: () => {
      setTitle("");
      qc.invalidateQueries({ queryKey: ["tasks"] });
      onAdded?.();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (title.trim() && !add.isPending) add.mutate(); }} className="px-3 py-2">
      <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={placeholder ?? t("tasks.common.addTask")} className="h-8 border-dashed shadow-none" disabled={add.isPending} />
    </form>
  );
}
