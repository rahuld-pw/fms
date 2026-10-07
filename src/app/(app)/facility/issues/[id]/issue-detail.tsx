"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardCheck, ListTodo, MoreHorizontal, Pause, Play, RotateCcw, Star, UserPlus, Wrench, XCircle } from "lucide-react";
import { useCan, useModule, useSession } from "@/components/app/session";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ActivityFeed, Attachments, Comments } from "@/components/shared/collaboration";
import { DateTime, DueDate } from "@/components/shared/format";
import { Field, ResourcePicker, UserChip, UserPicker } from "@/components/shared/fields";
import { DetailGrid, PageHeader } from "@/components/shared/page-header";
import { useAction } from "@/components/shared/resource-form";
import { PriorityLabel, StatusBadge } from "@/components/shared/status";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/utils/cn";
import { humanize } from "@/lib/utils/format";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Issue = Record<string, any>;

const NEXT: Record<string, { to: string; label: string; icon: React.ComponentType<{ className?: string }>; note?: boolean }[]> = {
  open: [{ to: "acknowledged", label: "Acknowledge", icon: ClipboardCheck }, { to: "in_progress", label: "Start work", icon: Play }],
  acknowledged: [{ to: "in_progress", label: "Start work", icon: Play }],
  assigned: [{ to: "acknowledged", label: "Acknowledge", icon: ClipboardCheck }, { to: "in_progress", label: "Start work", icon: Play }],
  in_progress: [{ to: "resolved", label: "Mark resolved", icon: CheckCircle2, note: true }, { to: "on_hold", label: "Put on hold", icon: Pause, note: true }],
  on_hold: [{ to: "in_progress", label: "Resume", icon: Play }],
  reopened: [{ to: "in_progress", label: "Start work", icon: Play }],
  resolved: [{ to: "closed", label: "Close", icon: CheckCircle2 }, { to: "reopened", label: "Reopen", icon: RotateCcw, note: true }],
  closed: [{ to: "reopened", label: "Reopen", icon: RotateCcw, note: true }],
};

export function IssueDetail({ id }: { id: string }) {
  const qc = useQueryClient();
  const can = useCan();
  const { user } = useSession();
  const tasksEnabled = useModule("tasks");
  const { data: issue, isLoading, error } = useQuery({ queryKey: ["issue", id], queryFn: () => api<Issue>(`/issues/${id}`) });
  const [transition, setTransition] = useState<{ to: string; label: string; note?: boolean } | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [rateOpen, setRateOpen] = useState(false);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["issue", id] });
    qc.invalidateQueries({ queryKey: ["activity", "issue", id] });
    qc.invalidateQueries({ queryKey: ["comments", "issue", id] });
  };
  const act = useAction({ onSuccess: refresh });

  if (isLoading) return <Skeleton className="h-96" />;
  if (error || !issue) return <p className="text-sm text-muted-foreground">Issue not found or you don&apos;t have access.</p>;

  const scope = { campusId: issue.campus_id, departmentId: issue.department_id };
  const manager = can("issue:update", scope, "auto");
  const isAssignee = issue.assignee_id === user.id;
  const isReporter = issue.reporter_id === user.id;
  const options = (NEXT[issue.status] ?? []).filter((o) => {
    if (manager) return true;
    if (isAssignee) return ["acknowledged", "in_progress", "on_hold", "resolved"].includes(o.to);
    if (isReporter) return ["reopened", "closed"].includes(o.to);
    return false;
  });
  const open = !["resolved", "closed", "cancelled"].includes(issue.status);
  const breached = open && issue.resolution_due_at && new Date(issue.resolution_due_at) < new Date();

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        breadcrumbs={[{ label: "Issues", href: "/facility/issues" }, { label: issue.number }]}
        title={issue.title}
        meta={
          <>
            <StatusBadge status={issue.status} />
            <PriorityLabel priority={issue.priority} />
            {issue.escalation_level > 0 && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive">
                <AlertTriangle className="size-3.5" /> Escalated L{issue.escalation_level}
              </span>
            )}
            {issue.is_anonymous && <span className="text-xs text-muted-foreground">Anonymous report</span>}
          </>
        }
        actions={
          <>
            {options.map((o) => (
              <Button key={o.to} variant={o.to === "resolved" || o.to === "in_progress" ? "default" : "outline"} size="sm" onClick={() => (o.note ? setTransition(o) : act.mutate({ path: `/issues/${id}/transition`, body: { status: o.to } }))} loading={act.isPending && !o.note}>
                <o.icon /> {o.label}
              </Button>
            ))}
            {isReporter && ["resolved", "closed"].includes(issue.status) && !issue.rating && (
              <Button size="sm" variant="outline" onClick={() => setRateOpen(true)}>
                <Star /> Rate
              </Button>
            )}
            {manager && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon-sm" aria-label="More actions">
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onSelect={() => setAssignOpen(true)}>
                    <UserPlus /> Assign
                  </DropdownMenuItem>
                  {!issue.work_order_id && can("work_order:create", { campusId: issue.campus_id }) && (
                    <DropdownMenuItem onSelect={() => act.mutate({ path: `/issues/${id}/work-order`, body: {} })}>
                      <Wrench /> Create work order
                    </DropdownMenuItem>
                  )}
                  {tasksEnabled && !issue.task_id && (
                    <DropdownMenuItem onSelect={() => act.mutate({ path: `/issues/${id}/task`, body: { assignee_ids: issue.assignee_id ? [issue.assignee_id] : [] } })}>
                      <ListTodo /> Create task
                    </DropdownMenuItem>
                  )}
                  {open && (
                    <DropdownMenuItem destructive onSelect={() => setTransition({ to: "cancelled", label: "Cancel issue", note: true })}>
                      <XCircle /> Cancel issue
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="flex min-w-0 flex-col gap-4">
          {issue.description && (
            <Card>
              <CardContent className="pt-4 text-sm whitespace-pre-wrap">{issue.description}</CardContent>
            </Card>
          )}
          {issue.resolution_notes && (
            <Card className="border-primary/30 bg-accent/30">
              <CardContent className="pt-4 text-sm">
                <p className="mb-1 text-xs font-medium text-accent-foreground">Resolution</p>
                {issue.resolution_notes}
              </CardContent>
            </Card>
          )}
          <Tabs defaultValue="comments">
            <TabsList>
              <TabsTrigger value="comments">Updates</TabsTrigger>
              <TabsTrigger value="files">Photos & files</TabsTrigger>
              <TabsTrigger value="activity">History</TabsTrigger>
            </TabsList>
            <TabsContent value="comments">
              <Comments entityType="issue" entityId={id} allowInternal={manager || isAssignee} />
            </TabsContent>
            <TabsContent value="files">
              <Attachments entityType="issue" entityId={id} kind="photo" />
            </TabsContent>
            <TabsContent value="activity">
              <ActivityFeed entityType="issue" entityId={id} />
            </TabsContent>
          </Tabs>
        </div>
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>SLA</CardTitle>
              {breached && <span className="text-xs font-medium text-destructive">Breached</span>}
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <SlaRow label="First response" due={issue.response_due_at} done={issue.first_response_at} />
              <SlaRow label="Resolution" due={issue.resolution_due_at} done={issue.resolved_at} />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <DetailGrid
                items={[
                  { label: "Number", value: <span className="font-mono">{issue.number}</span> },
                  { label: "Category", value: issue.category?.name },
                  { label: "Location", value: issue.location ? [...issue.location.path_names, issue.location.name].join(" › ") : issue.campus?.name, wide: true },
                  { label: "Asset", value: issue.asset ? <Link className="text-primary hover:underline" href={`/facility/assets/${issue.asset.id}`}>{issue.asset.asset_tag} · {issue.asset.name}</Link> : null, wide: true },
                  { label: "Assignee", value: <UserChip name={issue.assignee?.full_name} /> },
                  { label: "Vendor", value: issue.vendor?.name },
                  { label: "Reported by", value: issue.is_anonymous ? "Anonymous" : <UserChip name={issue.reporter?.full_name} /> },
                  { label: "Reported", value: <DateTime value={issue.created_at} /> },
                  { label: "Source", value: humanize(issue.source) },
                  { label: "Reopened", value: issue.reopened_count ? `${issue.reopened_count}×` : "—" },
                  { label: "Work order", value: issue.work_order ? <Link className="text-primary hover:underline" href={`/facility/work-orders/${issue.work_order.id}`}>{issue.work_order.number}</Link> : null },
                  { label: "Task", value: issue.task_id ? <Link className="text-primary hover:underline" href={`/tasks/t/${issue.task_id}`}>Open task</Link> : null },
                  ...(issue.rating ? [{ label: "Rating", value: `${"★".repeat(issue.rating)}${"☆".repeat(5 - issue.rating)}${issue.feedback ? ` — “${issue.feedback}”` : ""}`, wide: true }] : []),
                ]}
              />
            </CardContent>
          </Card>
        </div>
      </div>

      <TransitionDialog id={id} transition={transition} onClose={() => setTransition(null)} onDone={refresh} />
      <AssignDialog issue={issue} open={assignOpen} onOpenChange={setAssignOpen} onDone={refresh} />
      <RateDialog id={id} open={rateOpen} onOpenChange={setRateOpen} onDone={refresh} />
    </div>
  );
}

function SlaRow({ label, due, done }: { label: string; due: string | null; done: string | null }) {
  const late = done ? due && new Date(done) > new Date(due) : due && new Date(due) < new Date();
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("text-right", late && "text-destructive")}>
        {done ? (
          <>
            {late ? "Late" : "Met"} · <DateTime value={done} relative />
          </>
        ) : (
          <>
            due <DueDate value={due} />
          </>
        )}
      </span>
    </div>
  );
}

function TransitionDialog({ id, transition, onClose, onDone }: { id: string; transition: { to: string; label: string } | null; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState("");
  const act = useAction({ success: "Updated", onSuccess: () => { onDone(); onClose(); setNote(""); } });
  const required = transition?.to === "resolved" || transition?.to === "cancelled" || transition?.to === "reopened";
  return (
    <Dialog open={!!transition} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{transition?.label}</DialogTitle>
          <DialogDescription>{transition?.to === "resolved" ? "Describe what was done. The reporter is notified." : "Add a note for the record."}</DialogDescription>
        </DialogHeader>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={4} autoFocus placeholder={transition?.to === "resolved" ? "Resolution notes" : "Note"} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={required && !note.trim()} loading={act.isPending} onClick={() => act.mutate({ path: `/issues/${id}/transition`, body: { status: transition!.to, note: note || undefined } })}>
            {transition?.label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AssignDialog({ issue, open, onOpenChange, onDone }: { issue: Issue; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [assignee, setAssignee] = useState<string | null>(issue.assignee_id);
  const [vendor, setVendor] = useState<string | null>(issue.vendor_id);
  const act = useAction({ success: "Assigned", onSuccess: () => { onDone(); onOpenChange(false); } });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign issue</DialogTitle>
          <DialogDescription>Assign to a staff member, a vendor, or both.</DialogDescription>
        </DialogHeader>
        <Field label="Staff">
          <UserPicker value={assignee} onChange={(v) => setAssignee(v as string | null)} initialLabel={issue.assignee?.full_name} />
        </Field>
        <Field label="Vendor">
          <ResourcePicker endpoint="/vendors" extraParams="&status=approved" value={vendor} onChange={(v) => setVendor(v as string | null)} initialLabel={issue.vendor?.name} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={act.isPending} onClick={() => act.mutate({ path: `/issues/${issue.id}/assign`, body: { assignee_id: assignee, vendor_id: vendor } })}>
            Assign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RateDialog({ id, open, onOpenChange, onDone }: { id: string; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [rating, setRating] = useState(0);
  const [feedback, setFeedback] = useState("");
  const act = useAction({ success: "Thanks for the feedback", onSuccess: () => { onDone(); onOpenChange(false); } });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>How did we do?</DialogTitle>
          <DialogDescription>Your rating helps the facilities team improve.</DialogDescription>
        </DialogHeader>
        <div className="flex justify-center gap-1" role="radiogroup" aria-label="Rating">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} role="radio" aria-checked={rating === n} onClick={() => setRating(n)} className="p-1" aria-label={`${n} star${n > 1 ? "s" : ""}`}>
              <Star className={cn("size-8", n <= rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground")} />
            </button>
          ))}
        </div>
        <Textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="Anything else? (optional)" />
        <DialogFooter>
          <Button disabled={!rating} loading={act.isPending} onClick={() => act.mutate({ path: `/issues/${id}`, method: "PATCH", body: { rating, feedback: feedback || null, status: "closed" } })}>
            Submit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
