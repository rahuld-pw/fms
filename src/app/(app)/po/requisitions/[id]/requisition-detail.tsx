"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AlertTriangle, FileQuestion, Pencil, Send, ShoppingCart, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useCan, useSession } from "@/components/app/session";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ActivityFeed, ApprovalPanel, Attachments, Comments } from "@/components/shared/collaboration";
import { DateTime, Money } from "@/components/shared/format";
import { Field, ResourcePicker, UserChip } from "@/components/shared/fields";
import { DetailGrid, PageHeader } from "@/components/shared/page-header";
import { useAction } from "@/components/shared/resource-form";
import { PriorityLabel, StatusBadge } from "@/components/shared/status";
import { api, apiList, errorMessage } from "@/lib/client/api";
import { useT } from "@/lib/i18n/client";
import { LinesEditor, reqLinePayload, type LineDraft } from "../../lines-editor";

/* eslint-disable @typescript-eslint/no-explicit-any */
export function RequisitionDetail({ id }: { id: string }) {
  const { t } = useT();
  const qc = useQueryClient();
  const router = useRouter();
  const can = useCan();
  const { user } = useSession();
  const { data: r, isLoading } = useQuery({ queryKey: ["requisition", id], queryFn: () => api<any>(`/requisitions/${id}`) });
  const { data: rfqs } = useQuery({ queryKey: ["requisition", id, "rfqs"], queryFn: () => apiList<any>(`/rfqs?requisition_id=${id}`), enabled: !!r && ["rfq", "ordered", "closed"].includes(r.status) });
  const { data: pos } = useQuery({ queryKey: ["requisition", id, "pos"], queryFn: () => apiList<any>(`/purchase-orders?requisition_id=${id}`), enabled: !!r && ["ordered", "closed", "rfq"].includes(r.status) });
  const [editing, setEditing] = useState<LineDraft[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [dialog, setDialog] = useState<"rfq" | "po" | null>(null);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["requisition", id] });
    qc.invalidateQueries({ queryKey: ["approvals", "requisition", id] });
    qc.invalidateQueries({ queryKey: ["activity", "requisition", id] });
  };
  const submit = useAction<{ status: string; budget_check?: { result: string; message?: string } }>({
    onSuccess: (res) => {
      toast.success(res.status === "approved" ? t("po.common.autoApproved") : t("po.common.submittedForApproval"), { description: res.budget_check?.result === "warning" ? res.budget_check.message : undefined });
      refresh();
    },
  });
  const remove = useAction({ success: t("po.requisition.deleted"), onSuccess: () => router.push("/po/requisitions") });
  if (isLoading || !r) return <Skeleton className="h-96" />;

  const scope = { campusId: r.campus_id, departmentId: r.department_id };
  const mine = r.requested_by === user.id || r.created_by === user.id;
  const draft = ["draft", "rejected"].includes(r.status);
  const canEdit = draft && (mine || can("requisition:update", scope, "auto"));
  const canSource = r.status === "approved" && can("rfq:create", scope, "auto");
  const canOrder = r.status === "approved" && can("po:create", scope, "auto");
  const lines = [...(r.lines ?? [])].sort((a: any, b: any) => a.position - b.position);

  const saveLines = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const kept = new Set(editing.map((l) => l.id).filter(Boolean));
      for (const old of lines) if (!kept.has(old.id)) await api(`/requisitions/${id}/lines/${old.id}`, { method: "DELETE" });
      for (const [i, l] of editing.entries()) {
        const body = { ...reqLinePayload(l), position: i };
        if (l.id) await api(`/requisitions/${id}/lines/${l.id}`, { method: "PATCH", body });
        else await api(`/requisitions/${id}/lines`, { body });
      }
      toast.success(t("po.common.linesSaved"));
      setEditing(null);
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        breadcrumbs={[{ label: t("po.common.requisitions"), href: "/po/requisitions" }, { label: r.number }]}
        title={r.title}
        meta={
          <>
            <StatusBadge status={r.status} />
            <PriorityLabel priority={r.priority} />
            <Money value={r.estimated_total} className="text-sm font-semibold" />
          </>
        }
        actions={
          <>
            {canEdit && (
              <>
                <Button size="sm" onClick={() => submit.mutate({ path: `/requisitions/${id}/submit` })} loading={submit.isPending} disabled={!!editing || !lines.length}>
                  <Send /> {r.status === "rejected" ? t("po.common.resubmit") : t("ui.submit")}
                </Button>
                {r.status === "draft" && (
                  <Button size="sm" variant="ghost" onClick={() => confirm(t("po.requisition.confirmDelete")) && remove.mutate({ path: `/requisitions/${id}`, method: "DELETE" })}>
                    <Trash2 /> {t("ui.delete")}
                  </Button>
                )}
              </>
            )}
            {canSource && <Button size="sm" variant="outline" onClick={() => setDialog("rfq")}><FileQuestion /> {t("po.requisition.requestQuotes")}</Button>}
            {canOrder && <Button size="sm" onClick={() => setDialog("po")}><ShoppingCart /> {t("po.requisition.createPo")}</Button>}
          </>
        }
      />
      {r.budget_check?.result && r.budget_check.result !== "ok" && (
        <p className="mb-3 flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle className="size-4" /> {r.budget_check.message}
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("ui.lines")}</CardTitle>
              {canEdit && !editing && (
                <Button size="xs" variant="outline" onClick={() => setEditing(lines.map((l: any) => ({
                  id: l.id, item_id: l.item_id, description: l.description, quantity: String(l.quantity), unit: l.unit,
                  unit_price: String(l.estimated_unit_price), tax_rate: "18", discount_pct: "0", hsn_sac: "", is_asset: false,
                })))}>
                  <Pencil /> {t("po.common.editLines")}
                </Button>
              )}
            </CardHeader>
            {editing ? (
              <CardContent className="flex flex-col gap-3">
                <LinesEditor lines={editing} onChange={setEditing} mode="requisition" />
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => setEditing(null)}>{t("po.common.discard")}</Button>
                  <Button size="sm" onClick={saveLines} loading={saving}>{t("po.common.saveLines")}</Button>
                </div>
              </CardContent>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>{t("ui.item")}</TH>
                    <TH className="text-right">{t("ui.qty")}</TH>
                    <TH className="text-right">{t("po.common.estRate")}</TH>
                    <TH className="text-right">{t("ui.amount")}</TH>
                  </TR>
                </THead>
                <TBody>
                  {lines.map((l: any) => (
                    <TR key={l.id}>
                      <TD>
                        {l.description}
                        {l.item && <span className="block text-xs text-muted-foreground">{l.item.sku ?? l.item.name}</span>}
                      </TD>
                      <TD className="text-right tabular">{Number(l.quantity)} {l.unit}</TD>
                      <TD className="text-right"><Money value={l.estimated_unit_price} /></TD>
                      <TD className="text-right"><Money value={l.line_total} /></TD>
                    </TR>
                  ))}
                  <TR>
                    <TD colSpan={3} className="text-right font-medium">{t("po.common.estimatedTotal")}</TD>
                    <TD className="text-right font-semibold"><Money value={r.estimated_total} /></TD>
                  </TR>
                </TBody>
              </Table>
            )}
          </Card>
          {(rfqs?.data.length || pos?.data.length) ? (
            <Card>
              <CardHeader><CardTitle>{t("po.requisition.sourcing")}</CardTitle></CardHeader>
              <CardContent className="flex flex-col divide-y text-sm">
                {rfqs?.data.map((q: any) => (
                  <Link key={q.id} href={`/po/rfqs/${q.id}`} className="flex items-center gap-2 py-2 hover:underline">
                    <FileQuestion className="size-4 text-muted-foreground" /> <span className="font-mono text-xs">{q.number}</span>
                    <span className="flex-1 truncate">{t("po.requisition.vendorsInvited", { n: q.vendors?.length ?? 0 })}</span>
                    <StatusBadge status={q.status} />
                  </Link>
                ))}
                {pos?.data.map((p: any) => (
                  <Link key={p.id} href={`/po/orders/${p.id}`} className="flex items-center gap-2 py-2 hover:underline">
                    <ShoppingCart className="size-4 text-muted-foreground" /> <span className="font-mono text-xs">{p.number}</span>
                    <span className="flex-1 truncate">{p.vendor?.name}</span>
                    <Money value={p.total} />
                    <StatusBadge status={p.status} />
                  </Link>
                ))}
              </CardContent>
            </Card>
          ) : null}
          <Tabs defaultValue="approval">
            <TabsList>
              <TabsTrigger value="approval">{t("po.common.approval")}</TabsTrigger>
              <TabsTrigger value="files">{t("ui.files")}</TabsTrigger>
              <TabsTrigger value="comments">{t("ui.comments")}</TabsTrigger>
              <TabsTrigger value="history">{t("ui.history")}</TabsTrigger>
            </TabsList>
            <TabsContent value="approval"><ApprovalPanel entityType="requisition" entityId={id} onDecided={refresh} /></TabsContent>
            <TabsContent value="files"><Attachments entityType="requisition" entityId={id} canUpload={canEdit} /></TabsContent>
            <TabsContent value="comments"><Comments entityType="requisition" entityId={id} /></TabsContent>
            <TabsContent value="history"><ActivityFeed entityType="requisition" entityId={id} /></TabsContent>
          </Tabs>
        </div>
        <Card className="h-fit">
          <CardContent className="pt-4">
            <DetailGrid
              items={[
                { label: t("po.common.requestedBy"), value: <UserChip name={r.requester?.full_name} />, wide: true },
                { label: t("ui.campus"), value: r.campus?.name },
                { label: t("ui.department"), value: r.department?.name },
                { label: t("ui.category"), value: r.category?.name },
                { label: t("po.common.neededBy"), value: <DateTime value={r.needed_by} dateOnly /> },
                { label: t("ui.created"), value: <DateTime value={r.created_at} /> },
                ...(r.justification ? [{ label: t("po.requisition.justification"), value: r.justification, wide: true }] : []),
              ]}
            />
          </CardContent>
        </Card>
      </div>
      <RfqDialog id={id} open={dialog === "rfq"} onOpenChange={(o) => setDialog(o ? "rfq" : null)} onDone={(rfqId) => router.push(`/po/rfqs/${rfqId}`)} />
      <DirectPoDialog id={id} open={dialog === "po"} onOpenChange={(o) => setDialog(o ? "po" : null)} onDone={(poId) => router.push(`/po/orders/${poId}`)} />
    </div>
  );
}

function RfqDialog({ id, open, onOpenChange, onDone }: { id: string; open: boolean; onOpenChange: (o: boolean) => void; onDone: (rfqId: string) => void }) {
  const { t } = useT();
  const [vendors, setVendors] = useState<string[]>([]);
  const [due, setDue] = useState("");
  const [terms, setTerms] = useState("");
  const act = useAction<{ id: string }>({ success: t("po.requisition.rfqSent"), onSuccess: (r) => onDone(r.id) });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("po.requisition.rfqTitle")}</DialogTitle>
          <DialogDescription>{t("po.requisition.rfqDescription")}</DialogDescription>
        </DialogHeader>
        <Field label={t("po.requisition.vendors")} required>
          <ResourcePicker endpoint="/vendors?status=approved" hintKey="code" multiple value={vendors} onChange={(v) => setVendors((v as string[]) ?? [])} />
        </Field>
        <Field label={t("po.requisition.quotesDueBy")}><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        <Field label={t("po.common.terms")}><Textarea rows={3} value={terms} onChange={(e) => setTerms(e.target.value)} placeholder={t("po.requisition.termsPlaceholder")} /></Field>
        <DialogFooter>
          <Button disabled={!vendors.length} loading={act.isPending} onClick={() => act.mutate({ path: `/requisitions/${id}/rfq`, body: { vendor_ids: vendors, due_date: due || undefined, terms: terms || undefined } })}>
            {t("po.requisition.sendRfq")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DirectPoDialog({ id, open, onOpenChange, onDone }: { id: string; open: boolean; onOpenChange: (o: boolean) => void; onDone: (poId: string) => void }) {
  const { t } = useT();
  const [vendor, setVendor] = useState<string | null>(null);
  const [expected, setExpected] = useState("");
  const act = useAction<{ id: string }>({ success: t("po.requisition.draftPoCreated"), onSuccess: (r) => onDone(r.id) });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("po.requisition.createPoTitle")}</DialogTitle>
          <DialogDescription>{t("po.requisition.createPoDescription")}</DialogDescription>
        </DialogHeader>
        <Field label={t("ui.vendor")} required>
          <ResourcePicker endpoint="/vendors?status=approved" hintKey="code" value={vendor} onChange={(v) => setVendor(v as string | null)} />
        </Field>
        <Field label={t("po.common.expectedDelivery")}><Input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} /></Field>
        <DialogFooter>
          <Button disabled={!vendor} loading={act.isPending} onClick={() => act.mutate({ path: `/requisitions/${id}/purchase-order`, body: { vendor_id: vendor, expected_delivery: expected || undefined } })}>
            {t("po.requisition.createDraftPo")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
