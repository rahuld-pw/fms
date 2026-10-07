"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { CheckCircle2, Circle, Link2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/components/app/session";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ActivityFeed, Attachments, Comments } from "@/components/shared/collaboration";
import { Field, ResourcePicker, UserPicker } from "@/components/shared/fields";
import { StatusBadge } from "@/components/shared/status";
import { api, errorMessage } from "@/lib/client/api";
import { cn } from "@/lib/utils/cn";
import { humanize } from "@/lib/utils/format";

/* eslint-disable @typescript-eslint/no-explicit-any */
const LINK_URL: Record<string, string> = { issue: "/facility/issues/", work_order: "/facility/work-orders/", purchase_order: "/po/orders/", requisition: "/po/requisitions/", asset: "/facility/assets/", vendor: "/facility/vendors/", expense_claim: "/expense/claims/" };

export function TaskDetail({ id }: { id: string }) {
  const qc = useQueryClient();
  const { user } = useSession();
  const key = ["tasks", "detail", id];
  const { data: t, isLoading, error } = useQuery({ queryKey: key, queryFn: () => api<any>(`/tasks/${id}`) });
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [syncedFrom, setSyncedFrom] = useState<typeof t>(undefined);
  if (t && t !== syncedFrom) {
    setSyncedFrom(t);
    setTitle(t.title);
    setDesc(t.description ?? "");
  }
  const refresh = () => qc.invalidateQueries({ queryKey: ["tasks"] });
  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => api(`/tasks/${id}`, { method: "PATCH", body }),
    onMutate: async (body) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData(key);
      qc.setQueryData(key, (old: any) => (old ? { ...old, ...body } : old));
      return { prev };
    },
    onError: (e, _b, ctx) => {
      qc.setQueryData(key, ctx?.prev);
      toast.error(errorMessage(e));
    },
    onSettled: refresh,
  });
  const put = useMutation({
    mutationFn: ({ path, body }: { path: string; body: unknown }) => api(path, { method: "PUT", body }),
    onSuccess: refresh,
    onError: (e) => toast.error(errorMessage(e)),
  });
  const [linkType, setLinkType] = useState("issue");
  const [linkId, setLinkId] = useState<string | null>(null);
  const addLink = useMutation({
    mutationFn: () => api(`/tasks/${id}/links`, { body: { entity_type: linkType, entity_id: linkId } }),
    onSuccess: () => { setLinkId(null); refresh(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const removeLink = useMutation({ mutationFn: (linkId: string) => api(`/tasks/${id}/links/${linkId}`, { method: "DELETE" }), onSuccess: refresh });

  if (isLoading) return <Skeleton className="h-96" />;
  if (error || !t) return <p className="text-sm text-muted-foreground">Task not found or you don&apos;t have access.</p>;
  const done = t.status === "done";
  const following = (t.followers ?? []).some((f: any) => f.user_id === user.id);
  return (
    <div className="mx-auto max-w-5xl">
      <nav className="mb-2 flex items-center gap-1 text-xs text-muted-foreground">
        {t.project ? <Link href={`/tasks/projects/${t.project.id}`} className="hover:text-foreground">{t.project.name}</Link> : <Link href="/tasks" className="hover:text-foreground">My tasks</Link>}
        {t.parent && <> › <Link href={`/tasks/t/${t.parent.id}`} className="hover:text-foreground">{t.parent.title}</Link></>}
      </nav>
      <div className="mb-4 flex items-start gap-3">
        <button onClick={() => patch.mutate({ status: done ? "todo" : "done" })} className="hit-area mt-1.5" aria-label={done ? "Mark incomplete" : "Mark complete"}>
          {done ? <CheckCircle2 className="size-6 text-primary" /> : <Circle className="size-6 text-muted-foreground hover:text-primary" />}
        </button>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() && title !== t.title && patch.mutate({ title })}
          className={cn("w-full bg-transparent text-xl font-semibold tracking-tight outline-none focus:rounded focus:ring-2 focus:ring-ring/30", done && "text-muted-foreground line-through")}
          aria-label="Task title"
        />
        <Button variant={following ? "secondary" : "outline"} size="sm" onClick={() => api(`/tasks/${id}/follow`, { body: { follow: !following } }).then(refresh)}>
          {following ? "Following" : "Follow"}
        </Button>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Textarea value={desc} onChange={(e) => setDesc(e.target.value)} onBlur={() => desc !== (t.description ?? "") && patch.mutate({ description: desc || null })} placeholder="Add a description…" rows={4} />
          <Card>
            <CardHeader><CardTitle>Subtasks</CardTitle></CardHeader>
            <div className="border-t">
              {(t.subtasks ?? []).sort((a: any, b: any) => a.position - b.position).map((s: any) => (
                <div key={s.id} className="flex items-center gap-2 border-b px-4 py-2 text-sm">
                  <button onClick={() => api(`/tasks/${s.id}`, { method: "PATCH", body: { status: s.status === "done" ? "todo" : "done" } }).then(refresh)} aria-label="Toggle subtask" className="hit-area">
                    {s.status === "done" ? <CheckCircle2 className="size-4 text-primary" /> : <Circle className="size-4 text-muted-foreground" />}
                  </button>
                  <Link href={`/tasks/t/${s.id}`} className={cn("flex-1 hover:underline", s.status === "done" && "text-muted-foreground line-through")}>{s.title}</Link>
                  {s.due_date && <span className="text-xs text-muted-foreground">{s.due_date}</span>}
                </div>
              ))}
              <SubtaskAdd parentId={id} projectId={t.project_id} onAdded={refresh} />
            </div>
          </Card>
          <Tabs defaultValue="comments">
            <TabsList>
              <TabsTrigger value="comments">Comments</TabsTrigger>
              <TabsTrigger value="files">Files</TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
            </TabsList>
            <TabsContent value="comments"><Comments entityType="task" entityId={id} /></TabsContent>
            <TabsContent value="files"><Attachments entityType="task" entityId={id} /></TabsContent>
            <TabsContent value="history"><ActivityFeed entityType="task" entityId={id} /></TabsContent>
          </Tabs>
        </div>
        <div className="flex flex-col gap-4">
          <Card>
            <CardContent className="flex flex-col gap-3 pt-4">
              <Field label="Status">
                <NativeSelect value={t.status} onChange={(e) => patch.mutate({ status: e.target.value })}>
                  {["todo", "in_progress", "blocked", "done", "cancelled"].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
                </NativeSelect>
              </Field>
              <Field label="Assignees">
                <UserPicker multiple value={(t.assignees ?? []).map((a: any) => a.user_id)} onChange={(v) => put.mutate({ path: `/tasks/${id}/assignees`, body: { user_ids: v ?? [] } })} />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Start"><Input type="date" defaultValue={t.start_date ?? ""} onBlur={(e) => e.target.value !== (t.start_date ?? "") && patch.mutate({ start_date: e.target.value || null })} /></Field>
                <Field label="Due"><Input type="date" defaultValue={t.due_date ?? ""} onBlur={(e) => e.target.value !== (t.due_date ?? "") && patch.mutate({ due_date: e.target.value || null })} /></Field>
              </div>
              <Field label="Priority">
                <NativeSelect value={t.priority} onChange={(e) => patch.mutate({ priority: e.target.value })}>
                  {["low", "medium", "high", "urgent"].map((p) => <option key={p} value={p}>{humanize(p)}</option>)}
                </NativeSelect>
              </Field>
              <Field label="Repeats">
                <NativeSelect
                  value={(t.recurrence as any)?.freq ?? ""}
                  onChange={(e) => patch.mutate({ recurrence: e.target.value ? { freq: e.target.value, interval: 1 } : null })}
                >
                  <option value="">Does not repeat</option>
                  {["daily", "weekly", "monthly", "yearly"].map((f) => <option key={f} value={f}>{humanize(f)}</option>)}
                </NativeSelect>
              </Field>
              <Field label="Estimate (hours)"><Input type="number" defaultValue={t.estimated_hours ?? ""} onBlur={(e) => patch.mutate({ estimated_hours: e.target.value ? Number(e.target.value) : null })} /></Field>
              {t.project_id && (
                <Field label="Blocked by" hint="Tasks that must finish first">
                  <ResourcePicker
                    multiple
                    endpoint={`/tasks?project_id=${t.project_id}`}
                    labelKey="title"
                    value={(t.dependencies ?? []).map((d: any) => d.depends_on_task_id)}
                    onChange={(v) => put.mutate({ path: `/tasks/${id}/dependencies`, body: { depends_on: ((v as string[]) ?? []).filter((x) => x !== id) } })}
                  />
                  <div className="flex flex-wrap gap-1">
                    {(t.dependencies ?? []).map((d: any) => <span key={d.depends_on_task_id} className="text-xs"><StatusBadge status={d.task?.status} label={d.task?.title} /></span>)}
                  </div>
                </Field>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Linked records</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-2">
              {(t.links ?? []).map((l: any) => (
                <div key={l.id} className="flex items-center gap-2 text-sm">
                  <Link2 className="size-4 text-muted-foreground" />
                  <Link href={`${LINK_URL[l.entity_type] ?? "#"}${l.entity_id}`} className="flex-1 text-primary hover:underline">{humanize(l.entity_type)}</Link>
                  <button onClick={() => removeLink.mutate(l.id)} aria-label="Remove link"><Trash2 className="size-3.5 text-muted-foreground" /></button>
                </div>
              ))}
              <div className="flex flex-col gap-2 border-t pt-2">
                <NativeSelect value={linkType} onChange={(e) => { setLinkType(e.target.value); setLinkId(null); }}>
                  <option value="issue">Issue</option>
                  <option value="work_order">Work order</option>
                  <option value="purchase_order">Purchase order</option>
                  <option value="requisition">Requisition</option>
                </NativeSelect>
                <ResourcePicker
                  endpoint={{ issue: "/issues", work_order: "/work-orders", purchase_order: "/purchase-orders", requisition: "/requisitions" }[linkType]!}
                  labelKey={linkType === "purchase_order" ? "number" : "title"}
                  hintKey="number"
                  value={linkId}
                  onChange={(v) => setLinkId(v as string | null)}
                />
                <Button size="sm" variant="outline" disabled={!linkId} onClick={() => addLink.mutate()}>Link</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function SubtaskAdd({ parentId, projectId, onAdded }: { parentId: string; projectId: string | null; onAdded: () => void }) {
  const [title, setTitle] = useState("");
  const add = useMutation({
    mutationFn: () => api("/tasks", { body: { title, parent_task_id: parentId, project_id: projectId ?? undefined } }),
    onSuccess: () => { setTitle(""); onAdded(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (title.trim()) add.mutate(); }} className="px-4 py-2">
      <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="+ Add subtask" className="h-8 border-dashed shadow-none" />
    </form>
  );
}
