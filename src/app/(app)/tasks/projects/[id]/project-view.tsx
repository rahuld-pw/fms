"use client";
import { DndContext, DragOverlay, PointerSensor, TouchSensor, closestCorners, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { addDays, differenceInCalendarDays, endOfMonth, format, startOfMonth, startOfWeek } from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight, Columns3, GanttChart, List, Plus, Users } from "lucide-react";
import { toast } from "sonner";
import { AvatarStack } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { DueDate } from "@/components/shared/format";
import { PageHeader } from "@/components/shared/page-header";
import { PriorityLabel } from "@/components/shared/status";
import { api, errorMessage } from "@/lib/client/api";
import { cn } from "@/lib/utils/cn";
import { QuickAdd, TaskRow, type Task } from "../../shared";

interface Board {
  project: { id: string; name: string; description: string | null; default_view: string; visibility: string; team: { name: string } | null; due_date: string | null };
  sections: { id: string; name: string; position: number }[];
  tasks: Task[];
}

const VIEWS = [
  { key: "list", label: "List", icon: List },
  { key: "board", label: "Board", icon: Columns3 },
  { key: "calendar", label: "Calendar", icon: CalendarDays },
  { key: "timeline", label: "Timeline", icon: GanttChart },
] as const;

export function ProjectView({ id }: { id: string }) {
  const params = useSearchParams();
  const router = useRouter();
  const key = useMemo(() => ["tasks", "board", id], [id]);
  const { data, isLoading } = useQuery({ queryKey: key, queryFn: () => api<Board>(`/projects/${id}/board`) });
  const view = params.get("view") ?? data?.project.default_view ?? "board";
  if (isLoading || !data) return <Skeleton className="h-96" />;
  const done = data.tasks.filter((t) => t.status === "done").length;
  const active = data.tasks.filter((t) => t.status !== "cancelled").length;
  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Projects", href: "/tasks/projects" }, { label: data.project.name }]}
        title={data.project.name}
        description={data.project.description ?? undefined}
        meta={
          <div className="flex w-full max-w-xs items-center gap-2 text-xs text-muted-foreground">
            <Progress value={active ? (done / active) * 100 : 0} />
            <span className="whitespace-nowrap">{done}/{active} done</span>
            {data.project.team && <span className="inline-flex items-center gap-1 whitespace-nowrap"><Users className="size-3" />{data.project.team.name}</span>}
          </div>
        }
        actions={
          <div className="flex rounded-md border p-0.5">
            {VIEWS.map((v) => (
              <button key={v.key} onClick={() => router.replace(`?view=${v.key}`)} className={cn("flex items-center gap-1.5 rounded px-2.5 py-1 text-sm", view === v.key ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground")} aria-pressed={view === v.key}>
                <v.icon className="size-4" /> <span className="hidden sm:inline">{v.label}</span>
              </button>
            ))}
          </div>
        }
      />
      {view === "list" && <ListView board={data} />}
      {view === "board" && <BoardView board={data} queryKey={key} />}
      {view === "calendar" && <CalendarView tasks={data.tasks} />}
      {view === "timeline" && <TimelineView tasks={data.tasks} />}
    </div>
  );
}

function ListView({ board }: { board: Board }) {
  const groups = [...board.sections.map((s) => ({ id: s.id as string | null, name: s.name })), { id: null, name: "No section" }];
  return (
    <div className="flex flex-col gap-4">
      {groups.map((g) => {
        const tasks = board.tasks.filter((t) => t.section_id === g.id).sort((a, b) => a.position - b.position);
        if (g.id === null && tasks.length === 0) return null;
        return (
          <section key={g.id ?? "none"}>
            <h2 className="mb-1.5 text-sm font-semibold">{g.name} <span className="font-normal text-muted-foreground">{tasks.length}</span></h2>
            <Card>
              {tasks.map((t) => <TaskRow key={t.id} task={t} />)}
              <QuickAdd projectId={board.project.id} sectionId={g.id} />
            </Card>
          </section>
        );
      })}
      <AddSection projectId={board.project.id} />
    </div>
  );
}

function AddSection({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const add = useMutation({
    mutationFn: () => api(`/projects/${projectId}/sections`, { body: { name } }),
    onSuccess: () => { setName(""); qc.invalidateQueries({ queryKey: ["tasks", "board", projectId] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) add.mutate(); }} className="flex max-w-xs gap-2">
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New section" className="h-8" />
      <Button type="submit" size="sm" variant="outline"><Plus /> Add</Button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Board (drag & drop between sections, optimistic)
// ---------------------------------------------------------------------------
function BoardView({ board, queryKey }: { board: Board; queryKey: readonly unknown[] }) {
  const qc = useQueryClient();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }));
  const [dragging, setDragging] = useState<Task | null>(null);
  const columns = board.sections;
  const byColumn = (sid: string) => board.tasks.filter((t) => t.section_id === sid).sort((a, b) => a.position - b.position);
  const doneSection = columns.find((c) => /done|complete/i.test(c.name))?.id;

  const move = useMutation({
    mutationFn: (v: { id: string; section_id: string; position: number; status?: string }) => api(`/tasks/${v.id}/move`, { body: { section_id: v.section_id, position: v.position, status: v.status } }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey });
      const prev = qc.getQueryData<Board>(queryKey);
      qc.setQueryData<Board>(queryKey, (old) => old && { ...old, tasks: old.tasks.map((t) => (t.id === v.id ? { ...t, section_id: v.section_id, position: v.position, status: v.status ?? t.status } : t)) });
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(queryKey, ctx.prev);
      toast.error(errorMessage(e));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
  });

  const onDragStart = (e: DragStartEvent) => setDragging(board.tasks.find((t) => t.id === e.active.id) ?? null);
  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    const task = board.tasks.find((t) => t.id === e.active.id);
    if (!task || !e.over) return;
    const overId = String(e.over.id);
    const targetSection = columns.some((c) => c.id === overId) ? overId : board.tasks.find((t) => t.id === overId)?.section_id;
    if (!targetSection) return;
    const list = byColumn(targetSection).filter((t) => t.id !== task.id);
    const overIndex = list.findIndex((t) => t.id === overId);
    const index = overIndex === -1 ? list.length : overIndex;
    const before = list[index - 1]?.position;
    const after = list[index]?.position;
    const position = before === undefined && after === undefined ? 1024 : before === undefined ? after! - 1024 : after === undefined ? before + 1024 : (before + after) / 2;
    if (targetSection === task.section_id && Math.abs(position - task.position) < 1e-9) return;
    const status = targetSection === doneSection ? "done" : task.status === "done" && targetSection !== doneSection ? "todo" : undefined;
    move.mutate({ id: task.id, section_id: targetSection, position, status });
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="-mx-3 flex gap-3 overflow-x-auto px-3 pb-4 scrollbar-thin md:-mx-6 md:px-6">
        {columns.map((c) => {
          const tasks = byColumn(c.id);
          return (
            <Column key={c.id} id={c.id} title={c.name} count={tasks.length}>
              <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                {tasks.map((t) => <SortableCard key={t.id} task={t} />)}
              </SortableContext>
              <QuickAdd projectId={board.project.id} sectionId={c.id} placeholder="+ Add task" />
            </Column>
          );
        })}
        <div className="w-64 shrink-0"><AddSection projectId={board.project.id} /></div>
      </div>
      <DragOverlay>{dragging && <TaskCard task={dragging} overlay />}</DragOverlay>
    </DndContext>
  );
}

function Column({ id, title, count, children }: { id: string; title: string; count: number; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={cn("flex w-72 shrink-0 flex-col rounded-lg bg-muted/50 p-2 transition-colors", isOver && "bg-accent/60")}>
      <div className="flex items-center justify-between px-1.5 pb-2 text-sm font-semibold">
        {title} <span className="text-xs font-normal text-muted-foreground">{count}</span>
      </div>
      <div className="flex min-h-12 flex-col gap-2">{children}</div>
    </div>
  );
}

function SortableCard({ task }: { task: Task }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn(isDragging && "opacity-40")} {...attributes} {...listeners}>
      <TaskCard task={task} />
    </div>
  );
}

function TaskCard({ task, overlay }: { task: Task; overlay?: boolean }) {
  const done = task.status === "done";
  return (
    <Link href={`/tasks/t/${task.id}`} onClick={(e) => overlay && e.preventDefault()} className={cn("block rounded-md border bg-card p-2.5 text-sm shadow-xs hover:border-foreground/20", overlay && "rotate-2 shadow-lg")}>
      <p className={cn("leading-snug", done && "text-muted-foreground line-through")}>{task.title}</p>
      <div className="mt-2 flex items-center gap-2 text-xs">
        <PriorityLabel priority={task.priority === "medium" ? null : task.priority} />
        <span className="ml-auto"><DueDate value={task.due_date} done={done} /></span>
        <AvatarStack names={(task.assignees ?? []).map((a) => a.profile?.full_name)} max={2} />
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Calendar & timeline
// ---------------------------------------------------------------------------
function CalendarView({ tasks }: { tasks: Task[] }) {
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const from = startOfWeek(month, { weekStartsOn: 1 });
  const days = Array.from({ length: 42 }, (_, i) => addDays(from, i));
  const byDay = new Map<string, Task[]>();
  for (const t of tasks) if (t.due_date) byDay.set(t.due_date, [...(byDay.get(t.due_date) ?? []), t]);
  const today = format(new Date(), "yyyy-MM-dd");
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon-sm" onClick={() => setMonth(startOfMonth(addDays(month, -1)))} aria-label="Previous month"><ChevronLeft /></Button>
        <span className="w-36 text-center text-sm font-medium">{format(month, "MMMM yyyy")}</span>
        <Button variant="outline" size="icon-sm" onClick={() => setMonth(startOfMonth(addDays(endOfMonth(month), 1)))} aria-label="Next month"><ChevronRight /></Button>
      </div>
      <Card className="grid grid-cols-7 overflow-hidden">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="border-b py-1.5 text-center text-xs text-muted-foreground">{d}</div>)}
        {days.map((d) => {
          const k = format(d, "yyyy-MM-dd");
          return (
            <div key={k} className={cn("min-h-24 border-r border-b p-1 text-xs [&:nth-child(7n)]:border-r-0", d.getMonth() !== month.getMonth() && "bg-muted/30 text-muted-foreground")}>
              <span className={cn("inline-flex size-5 items-center justify-center rounded-full", k === today && "bg-primary text-primary-foreground")}>{d.getDate()}</span>
              {(byDay.get(k) ?? []).map((t) => (
                <Link key={t.id} href={`/tasks/t/${t.id}`} className={cn("mt-0.5 block truncate rounded bg-accent px-1 py-0.5 text-accent-foreground hover:bg-accent/70", t.status === "done" && "line-through opacity-60")}>
                  {t.title}
                </Link>
              ))}
            </div>
          );
        })}
      </Card>
    </div>
  );
}

function TimelineView({ tasks }: { tasks: Task[] }) {
  const dated = tasks.filter((t) => t.due_date).sort((a, b) => (a.start_date ?? a.due_date!).localeCompare(b.start_date ?? b.due_date!));
  if (dated.length === 0) return <p className="text-sm text-muted-foreground">Add start and due dates to see tasks on the timeline.</p>;
  const start = new Date(Math.min(...dated.map((t) => new Date(t.start_date ?? t.due_date!).getTime()), Date.now()));
  const end = new Date(Math.max(...dated.map((t) => new Date(t.due_date!).getTime()), Date.now() + 7 * 86400000));
  const total = Math.max(1, differenceInCalendarDays(end, start) + 1);
  const pct = (d: Date) => (differenceInCalendarDays(d, start) / total) * 100;
  const weeks = Array.from({ length: Math.ceil(total / 7) }, (_, i) => addDays(startOfWeek(start, { weekStartsOn: 1 }), i * 7));
  return (
    <Card className="overflow-x-auto">
      <div className="min-w-[720px]">
        <div className="relative ml-56 h-7 border-b text-[11px] text-muted-foreground">
          {weeks.map((w) => (
            <span key={w.toISOString()} className="absolute top-1.5 border-l pl-1" style={{ left: `${Math.max(0, pct(w))}%` }}>{format(w, "d MMM")}</span>
          ))}
          <span className="absolute inset-y-0 w-px bg-primary" style={{ left: `${pct(new Date())}%` }} aria-label="Today" />
        </div>
        {dated.map((t) => {
          const s = new Date(t.start_date ?? t.due_date!);
          const e = new Date(t.due_date!);
          return (
            <div key={t.id} className="flex h-9 items-center border-b last:border-0">
              <Link href={`/tasks/t/${t.id}`} className="w-56 shrink-0 truncate px-3 text-sm hover:underline">{t.title}</Link>
              <div className="relative h-full flex-1">
                <div
                  className={cn("absolute top-2 h-5 rounded-[4px] text-[11px] leading-5 text-white", t.status === "done" ? "bg-muted-foreground/50" : "bg-[var(--chart-1)]")}
                  style={{ left: `${pct(s)}%`, width: `max(${((differenceInCalendarDays(e, s) + 1) / total) * 100}%, 6px)` }}
                  title={`${t.start_date ?? t.due_date} → ${t.due_date}`}
                />
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
