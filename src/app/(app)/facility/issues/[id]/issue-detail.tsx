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
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils/cn";
import { humanize } from "@/lib/utils/format";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Issue = Record<string, any>;

const NEXT: Record<string, { to: string; labelKey: string; icon: React.ComponentType<{ className?: string }>; note?: boolean }[]> = {
  open: [{ to: "acknowledged", labelKey: "facility.issues.detail.acknowledge", icon: ClipboardCheck }, { to: "in_progress", labelKey: "facility.issues.detail.startWork", icon: Play }],
  acknowledged: [{ to: "in_progress", labelKey: "facility.issues.detail.startWork", icon: Play }],
  assigned: [{ to: "acknowledged", labelKey: "facility.issues.detail.acknowledge", icon: ClipboardCheck }, { to: "in_progress", labelKey: "facility.issues.detail.startWork", icon: Play }],
  in_progress: [{ to: "resolved", labelKey: "facility.issues.detail.markResolved", icon: CheckCircle2, note: true }, { to: "on_hold", labelKey: "facility.issues.detail.putOnHold", icon: Pause, note: true }],
  on_hold: [{ to: "in_progress", labelKey: "facility.issues.detail.resume", icon: Play }],
  reopened: [{ to: "in_progress", labelKey: "facility.issues.detail.startWork", icon: Play }],
  resolved: [{ to: "closed", labelKey: "facility.issues.detail.close", icon: CheckCircle2 }, { to: "reopened", labelKey: "facility.issues.detail.reopen", icon: RotateCcw, note: true }],
  closed: [{ to: "reopened", labelKey: "facility.issues.detail.reopen", icon: RotateCcw, note: true }],
};

export function IssueDetail({ id }: { id: string }) {
  const { t } = useT();
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
  if (error || !issue) return <p className="text-sm text-muted-foreground">{t("facility.issues.detail.notFound")}</p>;

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
        breadcrumbs={[{ label: t("facility.issues.title"), href: "/facility/issues" }, { label: issue.number }]}
        title={issue.title}
        meta={
          <>
            <StatusBadge status={issue.status} />
            <PriorityLabel priority={issue.priority} />
            {issue.escalation_level > 0 && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive">
                <AlertTriangle className="size-3.5" /> {t("facility.issues.detail.escalatedL", { n: issue.escalation_level })}
              </span>
            )}
            {issue.is_anonymous && <span className="text-xs text-muted-foreground">{t("facility.issues.detail.anonymousReport")}</span>}
          </>
        }
        actions={
          <>
            {options.map((o) => (
              <Button key={o.to} variant={o.to === "resolved" || o.to === "in_progress" ? "default" : "outline"} size="sm" onClick={() => (o.note ? setTransition({ to: o.to, label: t(o.labelKey), note: o.note }) : act.mutate({ path: `/issues/${id}/transition`, body: { status: o.to } }))} loading={act.isPending && !o.note}>
                <o.icon /> {t(o.labelKey)}
              </Button>
            ))}
            {isReporter && ["resolved", "closed"].includes(issue.status) && !issue.rating && (
              <Button size="sm" variant="outline" onClick={() => setRateOpen(true)}>
                <Star /> {t("facility.issues.detail.rate")}
              </Button>
            )}
            {manager && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon-sm" aria-label={t("facility.issues.detail.moreActions")}>
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onSelect={() => setAssignOpen(true)}>
                    <UserPlus /> {t("facility.issues.detail.assign")}
                  </DropdownMenuItem>
                  {!issue.work_order_id && can("work_order:create", { campusId: issue.campus_id }) && (
                    <DropdownMenuItem onSelect={() => act.mutate({ path: `/issues/${id}/work-order`, body: {} })}>
                      <Wrench /> {t("facility.issues.detail.createWorkOrder")}
                    </DropdownMenuItem>
                  )}
                  {tasksEnabled && !issue.task_id && (
                    <DropdownMenuItem onSelect={() => act.mutate({ path: `/issues/${id}/task`, body: { assignee_ids: issue.assignee_id ? [issue.assignee_id] : [] } })}>
                      <ListTodo /> {t("facility.issues.detail.createTask")}
                    </DropdownMenuItem>
                  )}
                  {open && (
                    <DropdownMenuItem destructive onSelect={() => setTransition({ to: "cancelled", label: t("facility.issues.detail.cancelIssue"), note: true })}>
                      <XCircle /> {t("facility.issues.detail.cancelIssue")}
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
                <p className="mb-1 text-xs font-medium text-accent-foreground">{t("facility.issues.detail.resolution")}</p>
                {issue.resolution_notes}
              </CardContent>
            </Card>
          )}
          <Tabs defaultValue="comments">
            <TabsList>
              <TabsTrigger value="comments">{t("facility.issues.detail.tabUpdates")}</TabsTrigger>
              <TabsTrigger value="files">{t("facility.issues.detail.tabFiles")}</TabsTrigger>
              <TabsTrigger value="activity">{t("ui.history")}</TabsTrigger>
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
              <CardTitle>{t("facility.issues.detail.sla")}</CardTitle>
              {breached && <span className="text-xs font-medium text-destructive">{t("facility.issues.detail.breached")}</span>}
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <SlaRow label={t("facility.issues.detail.firstResponse")} due={issue.response_due_at} done={issue.first_response_at} />
              <SlaRow label={t("facility.issues.detail.resolution")} due={issue.resolution_due_at} done={issue.resolved_at} />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <DetailGrid
                items={[
                  { label: t("ui.number"), value: <span className="font-mono">{issue.number}</span> },
                  { label: t("ui.category"), value: issue.category?.name },
                  { label: t("ui.location"), value: issue.location ? [...issue.location.path_names, issue.location.name].join(" › ") : issue.campus?.name, wide: true },
                  { label: t("ui.asset"), value: issue.asset ? <Link className="text-primary hover:underline" href={`/facility/assets/${issue.asset.id}`}>{issue.asset.asset_tag} · {issue.asset.name}</Link> : null, wide: true },
                  { label: t("ui.assignee"), value: <UserChip name={issue.assignee?.full_name} /> },
                  { label: t("ui.vendor"), value: issue.vendor?.name },
                  { label: t("facility.issues.detail.reportedBy"), value: issue.is_anonymous ? t("facility.issues.anonymous") : <UserChip name={issue.reporter?.full_name} /> },
                  { label: t("facility.issues.reported"), value: <DateTime value={issue.created_at} /> },
                  { label: t("facility.issues.detail.source"), value: issue.source ? t(`enum.issueSource.${issue.source}`, undefined, humanize(issue.source)) : humanize(issue.source) },
                  { label: t("facility.issues.detail.reopened"), value: issue.reopened_count ? t("facility.issues.detail.times", { n: issue.reopened_count }) : "—" },
                  { label: t("facility.issues.detail.workOrder"), value: issue.work_order ? <Link className="text-primary hover:underline" href={`/facility/work-orders/${issue.work_order.id}`}>{issue.work_order.number}</Link> : null },
                  { label: t("facility.issues.detail.task"), value: issue.task_id ? <Link className="text-primary hover:underline" href={`/tasks/t/${issue.task_id}`}>{t("facility.issues.detail.openTask")}</Link> : null },
                  ...(issue.rating ? [{ label: t("facility.issues.detail.rating"), value: `${"★".repeat(issue.rating)}${"☆".repeat(5 - issue.rating)}${issue.feedback ? ` — “${issue.feedback}”` : ""}`, wide: true }] : []),
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
  const { t } = useT();
  const late = done ? due && new Date(done) > new Date(due) : due && new Date(due) < new Date();
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("text-right", late && "text-destructive")}>
        {done ? (
          <>
            {late ? t("facility.issues.detail.late") : t("facility.issues.detail.met")} · <DateTime value={done} relative />
          </>
        ) : (
          <>
            {t("facility.issues.detail.due")} <DueDate value={due} />
          </>
        )}
      </span>
    </div>
  );
}

function TransitionDialog({ id, transition, onClose, onDone }: { id: string; transition: { to: string; label: string } | null; onClose: () => void; onDone: () => void }) {
  const { t } = useT();
  const [note, setNote] = useState("");
  const act = useAction({ success: t("ui.updated_"), onSuccess: () => { onDone(); onClose(); setNote(""); } });
  const required = transition?.to === "resolved" || transition?.to === "cancelled" || transition?.to === "reopened";
  return (
    <Dialog open={!!transition} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{transition?.label}</DialogTitle>
          <DialogDescription>{transition?.to === "resolved" ? t("facility.issues.detail.resolveDesc") : t("facility.issues.detail.noteDesc")}</DialogDescription>
        </DialogHeader>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={4} autoFocus placeholder={transition?.to === "resolved" ? t("facility.issues.detail.resolutionNotes") : t("facility.issues.detail.note")} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("ui.cancel")}</Button>
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
  const { t } = useT();
  const act = useAction({ success: t("facility.issues.detail.assigned"), onSuccess: () => { onDone(); onOpenChange(false); } });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("facility.issues.detail.assignTitle")}</DialogTitle>
          <DialogDescription>{t("facility.issues.detail.assignDesc")}</DialogDescription>
        </DialogHeader>
        <Field label={t("facility.issues.detail.staff")}>
          <UserPicker value={assignee} onChange={(v) => setAssignee(v as string | null)} initialLabel={issue.assignee?.full_name} />
        </Field>
        <Field label={t("ui.vendor")}>
          <ResourcePicker endpoint="/vendors" extraParams="&status=approved" value={vendor} onChange={(v) => setVendor(v as string | null)} initialLabel={issue.vendor?.name} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("ui.cancel")}</Button>
          <Button loading={act.isPending} onClick={() => act.mutate({ path: `/issues/${issue.id}/assign`, body: { assignee_id: assignee, vendor_id: vendor } })}>
            {t("facility.issues.detail.assign")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RateDialog({ id, open, onOpenChange, onDone }: { id: string; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [rating, setRating] = useState(0);
  const [feedback, setFeedback] = useState("");
  const { t } = useT();
  const act = useAction({ success: t("facility.issues.detail.thanks"), onSuccess: () => { onDone(); onOpenChange(false); } });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("facility.issues.detail.rateTitle")}</DialogTitle>
          <DialogDescription>{t("facility.issues.detail.rateDesc")}</DialogDescription>
        </DialogHeader>
        <div className="flex justify-center gap-1" role="radiogroup" aria-label={t("facility.issues.detail.rating")}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} role="radio" aria-checked={rating === n} onClick={() => setRating(n)} className="p-1" aria-label={n > 1 ? t("facility.issues.detail.starsOther", { n }) : t("facility.issues.detail.starsOne", { n })}>
              <Star className={cn("size-8", n <= rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground")} />
            </button>
          ))}
        </div>
        <Textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder={t("facility.issues.detail.feedbackPlaceholder")} />
        <DialogFooter>
          <Button disabled={!rating} loading={act.isPending} onClick={() => act.mutate({ path: `/issues/${id}`, method: "PATCH", body: { rating, feedback: feedback || null, status: "closed" } })}>
            {t("ui.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
