"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { CalendarCheck, CheckCircle2, Pause, Pencil, Play, ShieldCheck, XCircle } from "lucide-react";
import { toast } from "sonner";
import { useCan, useSession } from "@/components/app/session";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input, Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ActivityFeed, Attachments, Comments } from "@/components/shared/collaboration";
import { DateTime, DueDate, Money } from "@/components/shared/format";
import { Field, UserChip } from "@/components/shared/fields";
import { DetailGrid, PageHeader } from "@/components/shared/page-header";
import { ResourceFormDialog, useAction } from "@/components/shared/resource-form";
import { PriorityLabel, StatusBadge } from "@/components/shared/status";
import { api, errorMessage } from "@/lib/client/api";
import { humanize } from "@/lib/utils/format";
import { workOrderFields } from "../work-orders-table";

/* eslint-disable @typescript-eslint/no-explicit-any */
interface ChecklistItem { key: string; label: string; type: "check" | "number" | "text" | "photo"; required?: boolean; result?: any; note?: string | null }

export function WorkOrderDetail({ id }: { id: string }) {
  const qc = useQueryClient();
  const can = useCan();
  const { user } = useSession();
  const { data: wo, isLoading } = useQuery({ queryKey: ["work-order", id], queryFn: () => api<Record<string, any>>(`/work-orders/${id}`) });
  const [edit, setEdit] = useState(false);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [notes, setNotes] = useState("");
  const [costs, setCosts] = useState({ labour_cost: "", material_cost: "" });
  const [syncedFrom, setSyncedFrom] = useState<typeof wo>(undefined);
  if (wo && wo !== syncedFrom) {
    setSyncedFrom(wo);
    setChecklist(wo.checklist ?? []);
    setNotes(wo.completion_notes ?? "");
    setCosts({ labour_cost: wo.labour_cost ?? "", material_cost: wo.material_cost ?? "" });
  }
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["work-order", id] });
    qc.invalidateQueries({ queryKey: ["activity", "work_order", id] });
  };
  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => api(`/work-orders/${id}`, { method: "PATCH", body }),
    onSuccess: () => {
      toast.success("Saved");
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const booking = useAction({ success: "Booking updated", onSuccess: refresh });
  if (isLoading || !wo) return <Skeleton className="h-96" />;

  const manager = can("work_order:update", { campusId: wo.campus_id }, "auto");
  const mine = wo.assignee_id === user.id || wo.created_by === user.id;
  const editable = (manager || mine) && !["verified", "cancelled"].includes(wo.status);
  const setResult = (i: number, result: any) => setChecklist((c) => c.map((x, j) => (j === i ? { ...x, result } : x)));
  const saveWork = (status?: string) =>
    patch.mutate({
      checklist,
      completion_notes: notes || null,
      labour_cost: costs.labour_cost === "" ? null : Number(costs.labour_cost),
      material_cost: costs.material_cost === "" ? null : Number(costs.material_cost),
      ...(status ? { status } : {}),
    });

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        breadcrumbs={[{ label: "Work orders", href: "/facility/work-orders" }, { label: wo.number }]}
        title={wo.title}
        meta={
          <>
            <StatusBadge status={wo.status} />
            <PriorityLabel priority={wo.priority} />
            <span className="text-xs text-muted-foreground">{humanize(wo.type)}</span>
          </>
        }
        actions={
          editable && (
            <>
              {["open", "scheduled", "on_hold"].includes(wo.status) && (
                <Button size="sm" onClick={() => patch.mutate({ status: "in_progress" })}>
                  <Play /> Start
                </Button>
              )}
              {wo.status === "in_progress" && (
                <>
                  <Button size="sm" onClick={() => saveWork("completed")} loading={patch.isPending}>
                    <CheckCircle2 /> Complete
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => patch.mutate({ status: "on_hold" })}>
                    <Pause /> Hold
                  </Button>
                </>
              )}
              {wo.status === "completed" && manager && (
                <Button size="sm" onClick={() => patch.mutate({ status: "verified" })}>
                  <ShieldCheck /> Verify
                </Button>
              )}
              {manager && (
                <Button size="sm" variant="outline" onClick={() => setEdit(true)}>
                  <Pencil /> Edit
                </Button>
              )}
              {manager && !["completed"].includes(wo.status) && (
                <Button size="sm" variant="ghost" onClick={() => patch.mutate({ status: "cancelled" })}>
                  <XCircle /> Cancel
                </Button>
              )}
            </>
          )
        }
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="flex min-w-0 flex-col gap-4">
          {wo.description && (
            <Card>
              <CardContent className="pt-4 text-sm whitespace-pre-wrap">{wo.description}</CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle>Checklist</CardTitle>
              <span className="text-xs text-muted-foreground">
                {checklist.filter((c) => c.result !== undefined && c.result !== null && c.result !== "").length}/{checklist.length} done
              </span>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {checklist.length === 0 && <p className="text-sm text-muted-foreground">No checklist for this work order.</p>}
              {checklist.map((c, i) => (
                <div key={c.key} className="flex flex-wrap items-center gap-3 border-b pb-3 text-sm last:border-0 last:pb-0">
                  {c.type === "check" ? (
                    <label className="flex flex-1 items-center gap-2.5">
                      <Checkbox checked={c.result === true} disabled={!editable} onCheckedChange={(v) => setResult(i, v ? true : null)} className="size-5" />
                      <span>
                        {c.label}
                        {c.required && <span className="text-destructive"> *</span>}
                      </span>
                    </label>
                  ) : (
                    <>
                      <span className="flex-1">
                        {c.label}
                        {c.required && <span className="text-destructive"> *</span>}
                      </span>
                      <Input
                        className="w-full sm:w-48"
                        type={c.type === "number" ? "number" : "text"}
                        inputMode={c.type === "number" ? "decimal" : undefined}
                        disabled={!editable}
                        value={c.result ?? ""}
                        onChange={(e) => setResult(i, e.target.value === "" ? null : c.type === "number" ? Number(e.target.value) : e.target.value)}
                      />
                    </>
                  )}
                </div>
              ))}
              {editable && (
                <div className="grid gap-3 border-t pt-3 sm:grid-cols-2">
                  <Field label="Completion notes" className="sm:col-span-2">
                    <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
                  </Field>
                  <Field label="Labour cost">
                    <Input type="number" inputMode="decimal" value={costs.labour_cost} onChange={(e) => setCosts({ ...costs, labour_cost: e.target.value })} />
                  </Field>
                  <Field label="Material cost">
                    <Input type="number" inputMode="decimal" value={costs.material_cost} onChange={(e) => setCosts({ ...costs, material_cost: e.target.value })} />
                  </Field>
                  <Button variant="outline" className="sm:col-span-2 sm:justify-self-start" onClick={() => saveWork()} loading={patch.isPending}>
                    Save progress
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
          <Tabs defaultValue="comments">
            <TabsList>
              <TabsTrigger value="comments">Updates</TabsTrigger>
              <TabsTrigger value="files">Files & reports</TabsTrigger>
              <TabsTrigger value="activity">History</TabsTrigger>
            </TabsList>
            <TabsContent value="comments">
              <Comments entityType="work_order" entityId={id} allowInternal />
            </TabsContent>
            <TabsContent value="files">
              <Attachments entityType="work_order" entityId={id} />
            </TabsContent>
            <TabsContent value="activity">
              <ActivityFeed entityType="work_order" entityId={id} />
            </TabsContent>
          </Tabs>
        </div>
        <div className="flex flex-col gap-4">
          {wo.vendor && (
            <Card>
              <CardHeader>
                <CardTitle>Vendor booking</CardTitle>
                <StatusBadge status={wo.vendor_booking_status} />
              </CardHeader>
              <CardContent className="flex flex-col gap-2 text-sm">
                <p>
                  <Link href={`/facility/vendors/${wo.vendor.id}`} className="font-medium text-primary hover:underline">{wo.vendor.name}</Link>
                </p>
                {wo.vendor_booking_note && <p className="text-muted-foreground">“{wo.vendor_booking_note}”</p>}
                {manager && (
                  <div className="flex flex-wrap gap-2">
                    {wo.vendor_booking_status === "not_required" && (
                      <Button size="xs" variant="outline" onClick={() => booking.mutate({ path: `/work-orders/${id}/booking`, body: { vendor_booking_status: "requested" } })}>Request visit</Button>
                    )}
                    {["requested", "rescheduled"].includes(wo.vendor_booking_status) && (
                      <Button size="xs" variant="outline" onClick={() => booking.mutate({ path: `/work-orders/${id}/booking`, body: { vendor_booking_status: "confirmed" } })}>
                        <CalendarCheck /> Mark confirmed
                      </Button>
                    )}
                    <Button size="xs" variant="ghost" asChild>
                      <Link href={`/facility/vendors/${wo.vendor.id}`}>Send portal link</Link>
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
          <Card>
            <CardContent className="pt-4">
              <DetailGrid
                items={[
                  { label: "Campus", value: wo.campus?.name },
                  { label: "Assignee", value: <UserChip name={wo.assignee?.full_name} /> },
                  { label: "Asset", value: wo.asset ? <Link className="text-primary hover:underline" href={`/facility/assets/${wo.asset.id}`}>{wo.asset.asset_tag}</Link> : null },
                  { label: "Location", value: wo.location?.name },
                  { label: "Scheduled", value: <DateTime value={wo.scheduled_for} /> },
                  { label: "Due", value: <DueDate value={wo.due_at} done={["completed", "verified"].includes(wo.status)} /> },
                  { label: "Started", value: <DateTime value={wo.started_at} /> },
                  { label: "Completed", value: <DateTime value={wo.completed_at} /> },
                  { label: "Issue", value: wo.issue_id ? <Link className="text-primary hover:underline" href={`/facility/issues/${wo.issue_id}`}>View issue</Link> : null },
                  { label: "PM schedule", value: wo.pm_schedule_id ? "Preventive (auto-generated)" : null },
                  { label: "Labour", value: wo.labour_cost ? <Money value={wo.labour_cost} /> : null },
                  { label: "Material", value: wo.material_cost ? <Money value={wo.material_cost} /> : null },
                ]}
              />
            </CardContent>
          </Card>
        </div>
      </div>
      <ResourceFormDialog
        open={edit}
        onOpenChange={setEdit}
        title="Edit work order"
        endpoint={`/work-orders/${id}`}
        method="PATCH"
        fields={workOrderFields.filter((f) => f.name !== "campus_id")}
        defaultValues={{
          ...wo,
          scheduled_for: wo.scheduled_for?.slice(0, 16) ?? "",
          due_at: wo.due_at?.slice(0, 16) ?? "",
        }}
        invalidate={["work-order"]}
        onSaved={refresh}
      />
    </div>
  );
}
