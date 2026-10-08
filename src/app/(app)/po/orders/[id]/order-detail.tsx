"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  AlertTriangle, Ban, CheckCircle2, FileDown, FilePen, Lock, MoreHorizontal, PackageCheck, Pencil, Receipt, Send, Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useCan } from "@/components/app/session";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApprovalPanel, Attachments, Comments } from "@/components/shared/collaboration";
import { DateTime, Money } from "@/components/shared/format";
import { UserChip } from "@/components/shared/fields";
import { DetailGrid, EmptyState, PageHeader } from "@/components/shared/page-header";
import { useAction } from "@/components/shared/resource-form";
import { StatusBadge } from "@/components/shared/status";
import { api, apiList, errorMessage } from "@/lib/client/api";
import { useT } from "@/lib/i18n/client";
import { humanize } from "@/lib/utils/format";
import { LinesEditor, poLinePayload, type LineDraft } from "../../lines-editor";
import { CloseDialog, CreateAssetsDialog, InvoiceDialog, ReasonDialog, ReceiveDialog, type AssetCandidate } from "./po-dialogs";

/* eslint-disable @typescript-eslint/no-explicit-any */
const RECEIVABLE = ["approved", "sent", "acknowledged", "partially_received"];
type DialogName = "receive" | "invoice" | "amend" | "cancel" | "close" | null;

export function OrderDetail({ id }: { id: string }) {
  const { t } = useT();
  const qc = useQueryClient();
  const router = useRouter();
  const can = useCan();
  const { data: po, isLoading } = useQuery({ queryKey: ["po", id], queryFn: () => api<any>(`/purchase-orders/${id}`) });
  const { data: grns } = useQuery({ queryKey: ["po", id, "grns"], queryFn: () => apiList<any>(`/grns?po_id=${id}&limit=100`) });
  const { data: invoices } = useQuery({ queryKey: ["po", id, "invoices"], queryFn: () => apiList<any>(`/invoices?po_id=${id}&limit=100`) });
  const [editing, setEditing] = useState<LineDraft[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [dialog, setDialog] = useState<DialogName>(null);
  const [assetCandidates, setAssetCandidates] = useState<AssetCandidate[]>([]);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["po", id] });
    qc.invalidateQueries({ queryKey: ["approvals", "purchase_order", id] });
    qc.invalidateQueries({ queryKey: ["activity", "purchase_order", id] });
  };
  const submit = useAction<{ result: { status: string; budget_check?: { result: string; message?: string } } }>({
    onSuccess: (r) => {
      const st = r.result?.status;
      toast.success(st === "approved" ? t("po.common.autoApproved") : t("po.common.submittedForApproval"), { description: r.result?.budget_check?.result === "warning" ? r.result.budget_check.message : undefined });
      refresh();
    },
  });
  const send = useAction({ success: t("po.order.sentToVendor"), onSuccess: refresh });
  const remove = useAction({ success: t("po.order.draftDeleted"), onSuccess: () => router.push("/po/orders") });
  if (isLoading || !po) return <Skeleton className="h-96" />;

  const scope = { campusId: po.campus_id, departmentId: po.department_id };
  const draft = ["draft", "rejected"].includes(po.status);
  const canEdit = draft && can("po:update", scope, "auto");
  const lines = [...(po.lines ?? [])].sort((a: any, b: any) => a.line_no - b.line_no);
  const ordered = lines.reduce((s, l: any) => s + Number(l.quantity), 0);
  const received = lines.reduce((s, l: any) => s + Number(l.received_qty), 0);
  const hasPendingReceipt = lines.some((l: any) => Number(l.received_qty) < Number(l.quantity));
  const hasUninvoiced = lines.some((l: any) => Number(l.received_qty) > Number(l.invoiced_qty));
  const igst = po.tax_type === "igst";

  const actions = [
    can("po:send", scope, "auto") && ["approved"].includes(po.status) && { key: "send", label: t("po.order.sendToVendor"), icon: Send, primary: true, run: () => send.mutate({ path: `/purchase-orders/${id}/send` }) },
    can("grn:create", { campusId: po.campus_id }, "auto") && RECEIVABLE.includes(po.status) && hasPendingReceipt && { key: "receive", label: t("po.order.receiveGoods"), icon: PackageCheck, primary: po.status !== "approved", run: () => setDialog("receive") },
    can("invoice:create", { campusId: po.campus_id }, "auto") && hasUninvoiced && { key: "invoice", label: t("po.order.recordInvoice"), icon: Receipt, run: () => setDialog("invoice") },
    can("po:send", scope, "auto") && po.status === "sent" && { key: "resend", label: t("po.order.resendToVendor"), icon: Send, run: () => send.mutate({ path: `/purchase-orders/${id}/send` }) },
    can("po:amend", scope, "auto") && RECEIVABLE.includes(po.status) && { key: "amend", label: t("po.order.amend"), icon: FilePen, run: () => setDialog("amend") },
    can("po:close", scope, "auto") && ["received", "partially_received", "acknowledged", "sent", "approved"].includes(po.status) && { key: "close", label: t("po.order.closePo"), icon: Lock, run: () => setDialog("close") },
    can("po:cancel", scope, "auto") && !["closed", "cancelled"].includes(po.status) && received === 0 && { key: "cancel", label: t("po.order.cancelPo"), icon: Ban, run: () => setDialog("cancel") },
  ].filter(Boolean) as { key: string; label: string; icon: React.ComponentType; primary?: boolean; run: () => void }[];
  const primary = actions.filter((a) => a.primary);
  const menuBusy = (send.isPending && actions.some((a) => a.key === "resend")) || remove.isPending;
  const secondary = actions.filter((a) => !a.primary);

  const saveLines = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const kept = new Set(editing.map((l) => l.id).filter(Boolean));
      for (const old of lines) if (!kept.has(old.id)) await api(`/purchase-orders/${id}/lines/${old.id}`, { method: "DELETE" });
      for (const l of editing) {
        if (l.id) await api(`/purchase-orders/${id}/lines/${l.id}`, { method: "PATCH", body: poLinePayload(l) });
        else await api(`/purchase-orders/${id}/lines`, { body: poLinePayload(l) });
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
    <div className="mx-auto max-w-6xl">
      <PageHeader
        breadcrumbs={[{ label: t("po.common.purchaseOrders"), href: "/po/orders" }, { label: po.number }]}
        title={<span className="font-mono">{po.number}{po.version > 1 && <span className="ml-2 text-base text-muted-foreground">v{po.version}</span>}</span>}
        meta={
          <>
            <StatusBadge status={po.status} />
            <Link href={`/facility/vendors/${po.vendor_id}`} className="text-sm font-medium hover:underline">{po.vendor?.name}</Link>
            <Money value={po.total} className="text-sm font-semibold" />
          </>
        }
        actions={
          <>
            {canEdit && (
              <Button size="sm" onClick={() => submit.mutate({ path: `/purchase-orders/${id}/submit` })} loading={submit.isPending} disabled={!!editing || !lines.length}>
                <Send /> {po.status === "rejected" ? t("po.common.resubmit") : t("ui.submit")}
              </Button>
            )}
            {primary.map((a) => <Button key={a.key} size="sm" onClick={a.run} loading={a.key === "send" && send.isPending}><a.icon /> {a.label}</Button>)}
            <Button size="sm" variant="outline" asChild>
              <a href={`/api/v1/purchase-orders/${id}/pdf`} target="_blank" rel="noreferrer"><FileDown /> {t("po.order.pdf")}</a>
            </Button>
            {(secondary.length > 0 || (draft && can("po:delete", scope, "auto"))) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button size="icon-sm" variant="outline" loading={menuBusy} aria-label={t("po.order.moreActions")}>{!menuBusy && <MoreHorizontal />}</Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {secondary.map((a) => <DropdownMenuItem key={a.key} disabled={a.key === "resend" && send.isPending} onSelect={a.run}>{a.key === "resend" && send.isPending ? <Spinner /> : <a.icon />} {a.label}</DropdownMenuItem>)}
                  {draft && po.version === 1 && can("po:delete", scope, "auto") && (
                    <DropdownMenuItem destructive disabled={remove.isPending} onSelect={() => confirm(t("po.order.confirmDelete")) && remove.mutate({ path: `/purchase-orders/${id}`, method: "DELETE" })}>
                      {remove.isPending ? <Spinner /> : <Trash2 />} {t("po.order.deleteDraft")}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        }
      />
      {po.amendment_reason && po.status === "draft" && (
        <p className="mb-3 flex items-center gap-2 rounded-md border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-sm text-blue-800 dark:text-blue-300">
          <FilePen className="size-4 shrink-0" /> {t("po.order.amendmentNotice", { version: po.version, reason: po.amendment_reason })}
        </p>
      )}
      {po.budget_check?.result && !["ok", "no_budget"].includes(po.budget_check.result) && (
        <p className="mb-3 flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle className="size-4 shrink-0" /> {po.budget_check.message}
        </p>
      )}
      {po.status === "cancelled" && po.cancel_reason && <p className="mb-3 rounded-md border px-3 py-2 text-sm text-muted-foreground">{t("po.order.cancelled", { reason: po.cancel_reason })}</p>}
      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("ui.lines")}</CardTitle>
              {canEdit && !editing && (
                <Button size="xs" variant="outline" onClick={() => setEditing(lines.map((l: any) => ({
                  id: l.id, item_id: l.item_id, description: l.description, quantity: String(Number(l.quantity)), unit: l.unit, unit_price: String(l.unit_price),
                  tax_rate: String(Number(l.tax_rate)), discount_pct: String(Number(l.discount_pct)), hsn_sac: l.hsn_sac ?? "", is_asset: l.is_asset,
                })))}>
                  <Pencil /> {t("po.common.editLines")}
                </Button>
              )}
            </CardHeader>
            {editing ? (
              <CardContent className="flex flex-col gap-3">
                <LinesEditor lines={editing} onChange={setEditing} mode="po" />
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => setEditing(null)}>{t("po.common.discard")}</Button>
                  <Button size="sm" onClick={saveLines} loading={saving}>{t("po.common.saveLines")}</Button>
                </div>
              </CardContent>
            ) : (
              <>
                {/* phone: stacked cards */}
                <div className="flex flex-col divide-y sm:hidden">
                  {lines.map((l: any) => (
                    <div key={l.id} className="flex flex-col gap-1 px-4 py-3 text-sm">
                      <div className="flex justify-between gap-2"><span className="font-medium">{l.description}</span><Money value={l.line_total} className="font-medium" /></div>
                      <span className="text-xs text-muted-foreground">
                        {Number(l.quantity)} {l.unit} × <Money value={l.unit_price} />{Number(l.discount_pct) > 0 && ` −${Number(l.discount_pct)}%`} · {t("po.common.gstRate", { rate: Number(l.tax_rate) })}
                      </span>
                      {!draft && <span className="text-xs text-muted-foreground">{t("po.order.receivedInvoiced", { received: Number(l.received_qty), invoiced: Number(l.invoiced_qty) })}</span>}
                    </div>
                  ))}
                </div>
                <div className="hidden overflow-x-auto sm:block">
                  <Table>
                    <THead>
                      <TR>
                        <TH className="w-8">#</TH>
                        <TH>{t("ui.item")}</TH>
                        <TH className="text-right">{t("ui.qty")}</TH>
                        <TH className="text-right">{t("ui.rate")}</TH>
                        <TH className="text-right">{t("po.common.gst")}</TH>
                        <TH className="text-right">{t("ui.amount")}</TH>
                        {!draft && <TH className="text-right">{t("po.order.rcvdInv")}</TH>}
                      </TR>
                    </THead>
                    <TBody>
                      {lines.map((l: any) => (
                        <TR key={l.id}>
                          <TD className="text-muted-foreground">{l.line_no}</TD>
                          <TD>
                            {l.description}
                            <span className="block text-xs text-muted-foreground">{[l.hsn_sac && t("po.order.hsn", { code: l.hsn_sac }), l.is_asset && t("ui.asset")].filter(Boolean).join(" · ")}</span>
                          </TD>
                          <TD className="whitespace-nowrap text-right tabular">{Number(l.quantity)} {l.unit}</TD>
                          <TD className="text-right"><Money value={l.unit_price} />{Number(l.discount_pct) > 0 && <span className="block text-xs text-muted-foreground">−{Number(l.discount_pct)}%</span>}</TD>
                          <TD className="text-right"><Money value={Number(l.cgst_amount) + Number(l.sgst_amount) + Number(l.igst_amount)} /><span className="block text-xs text-muted-foreground">{Number(l.tax_rate)}%</span></TD>
                          <TD className="text-right font-medium"><Money value={l.line_total} /></TD>
                          {!draft && <TD className="whitespace-nowrap text-right tabular text-muted-foreground">{Number(l.received_qty)} / {Number(l.invoiced_qty)}</TD>}
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </div>
                <CardContent className="flex flex-col items-end gap-1 border-t pt-3 text-sm">
                  <Row label={t("po.order.taxableValue")} value={po.subtotal} />
                  {Number(po.discount_total) > 0 && <Row label={t("ui.discount")} value={-po.discount_total} />}
                  {igst ? <Row label={t("po.order.igst")} value={po.tax_total} /> : <><Row label={t("po.order.cgst")} value={po.tax_total / 2} /><Row label={t("po.order.sgst")} value={po.tax_total / 2} /></>}
                  <Row label={t("ui.total")} value={po.total} strong />
                </CardContent>
              </>
            )}
          </Card>
          {!draft && ordered > 0 && (
            <Card>
              <CardContent className="grid gap-3 pt-4 sm:grid-cols-2">
                <ProgressRow label={t("po.common.received")} value={received} max={ordered} />
                <ProgressRow label={t("po.common.invoiced")} value={lines.reduce((s, l: any) => s + Number(l.invoiced_qty), 0)} max={ordered} />
              </CardContent>
            </Card>
          )}
          <Tabs defaultValue={draft || po.status === "pending_approval" ? "approval" : "receipts"}>
            <TabsList className="max-w-full overflow-x-auto">
              <TabsTrigger value="approval">{t("po.common.approval")}</TabsTrigger>
              <TabsTrigger value="receipts">{grns?.data.length ? t("po.order.receiptsCount", { n: grns.data.length }) : t("po.order.receipts")}</TabsTrigger>
              <TabsTrigger value="invoices">{invoices?.data.length ? t("po.order.invoicesCount", { n: invoices.data.length }) : t("po.order.invoices")}</TabsTrigger>
              <TabsTrigger value="timeline">{t("po.order.timeline")}</TabsTrigger>
              <TabsTrigger value="comments">{t("ui.comments")}</TabsTrigger>
              <TabsTrigger value="files">{t("ui.files")}</TabsTrigger>
            </TabsList>
            <TabsContent value="approval"><ApprovalPanel entityType="purchase_order" entityId={id} onDecided={refresh} /></TabsContent>
            <TabsContent value="receipts">
              <Card>
                {grns?.data.length ? (
                  <div className="flex flex-col divide-y">
                    {grns.data.map((g: any) => (
                      <div key={g.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
                        <PackageCheck className="size-4 text-muted-foreground" />
                        <span className="font-mono text-xs">{g.number}</span>
                        <span className="text-muted-foreground"><DateTime value={g.received_date} dateOnly /></span>
                        {g.delivery_note_number && <span className="text-muted-foreground">{t("po.order.deliveryNote", { number: g.delivery_note_number })}</span>}
                        <span className="ml-auto flex items-center gap-2"><UserChip name={g.receiver?.full_name} /><StatusBadge status={g.status} /></span>
                      </div>
                    ))}
                  </div>
                ) : <CardContent className="pt-4"><EmptyState icon={PackageCheck} title={t("po.order.nothingReceived")} /></CardContent>}
              </Card>
            </TabsContent>
            <TabsContent value="invoices">
              <Card>
                {invoices?.data.length ? (
                  <div className="flex flex-col divide-y">
                    {invoices.data.map((v: any) => (
                      <Link key={v.id} href={`/po/invoices/${v.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm hover:bg-muted/50">
                        <Receipt className="size-4 text-muted-foreground" />
                        <span className="font-medium">{v.vendor_invoice_number}</span>
                        <span className="text-muted-foreground"><DateTime value={v.invoice_date} dateOnly /></span>
                        <span className="ml-auto flex items-center gap-2"><Money value={v.total} /><StatusBadge status={v.match_status} /><StatusBadge status={v.status} /></span>
                      </Link>
                    ))}
                  </div>
                ) : <CardContent className="pt-4"><EmptyState icon={Receipt} title={t("po.order.noInvoices")} /></CardContent>}
              </Card>
            </TabsContent>
            <TabsContent value="timeline"><Timeline id={id} /></TabsContent>
            <TabsContent value="comments"><Comments entityType="purchase_order" entityId={id} /></TabsContent>
            <TabsContent value="files"><Attachments entityType="purchase_order" entityId={id} /></TabsContent>
          </Tabs>
        </div>
        <div className="flex flex-col gap-4">
          <Card>
            <CardContent className="pt-4">
              <DetailGrid
                items={[
                  { label: t("ui.vendor"), value: <>{po.vendor?.name}{po.vendor?.gstin && <span className="block font-mono text-xs text-muted-foreground">{po.vendor.gstin}</span>}</>, wide: true },
                  { label: t("ui.campus"), value: po.campus?.name },
                  { label: t("ui.department"), value: po.department?.name },
                  { label: t("po.common.orderDate"), value: <DateTime value={po.order_date} dateOnly /> },
                  { label: t("po.common.expected"), value: <DateTime value={po.expected_delivery} dateOnly /> },
                  { label: t("ui.category"), value: po.category?.name },
                  { label: t("po.common.gst"), value: igst ? t("po.order.igstInterState") : po.tax_type === "none" ? t("ui.none") : t("enum.taxType.cgst_sgst", undefined, "CGST + SGST") },
                  ...(po.requisition ? [{ label: t("po.common.requisition"), value: <Link className="hover:underline" href={`/po/requisitions/${po.requisition.id}`}>{po.requisition.number}</Link>, wide: true }] : []),
                  { label: t("po.common.paymentTerms"), value: po.payment_terms, wide: true },
                  ...(po.vendor_ack_at ? [{ label: t("po.order.vendorAcknowledged"), value: <><DateTime value={po.vendor_ack_at} /> · {po.vendor_ack_name}</>, wide: true }] : []),
                  { label: t("ui.createdBy"), value: <UserChip name={po.creator?.full_name} /> },
                  { label: t("po.order.sent"), value: <DateTime value={po.sent_at} /> },
                ]}
              />
            </CardContent>
          </Card>
          {po.versions?.length > 0 && (
            <Card>
              <CardHeader><CardTitle>{t("po.order.previousVersions")}</CardTitle></CardHeader>
              <CardContent className="flex flex-col gap-2 text-sm">
                {[...po.versions].sort((a: any, b: any) => b.version - a.version).map((v: any) => (
                  <div key={v.id} className="flex flex-col">
                    <span className="font-medium">v{v.version} <span className="font-normal text-muted-foreground">· <DateTime value={v.created_at} relative /></span></span>
                    {v.change_reason && <span className="text-xs text-muted-foreground">{v.change_reason}</span>}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
      {dialog === "receive" && <ReceiveDialog po={po} open onOpenChange={(o) => !o && setDialog(null)} onDone={() => { refresh(); qc.invalidateQueries({ queryKey: ["po", id, "grns"] }); }} onAssets={setAssetCandidates} />}
      {dialog === "invoice" && <InvoiceDialog po={po} open onOpenChange={(o) => !o && setDialog(null)} onDone={() => { refresh(); qc.invalidateQueries({ queryKey: ["po", id, "invoices"] }); }} />}
      <ReasonDialog open={dialog === "amend"} onOpenChange={(o) => !o && setDialog(null)} onDone={refresh} path={`/purchase-orders/${id}/amend`} title={t("po.order.amendTitle")}
        description={t("po.order.amendDescription")} cta={t("po.order.startAmendment")} />
      <ReasonDialog open={dialog === "cancel"} onOpenChange={(o) => !o && setDialog(null)} onDone={refresh} path={`/purchase-orders/${id}/cancel`} title={t("po.order.cancelTitle")}
        description={t("po.order.cancelDescription")} cta={t("po.order.cancelPo")} destructive />
      <CloseDialog id={id} open={dialog === "close"} onOpenChange={(o) => !o && setDialog(null)} onDone={refresh} />
      <CreateAssetsDialog candidates={assetCandidates} onClose={() => setAssetCandidates([])} />
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="flex w-full max-w-64 justify-between gap-4">
      <span className={strong ? "font-medium" : "text-muted-foreground"}>{label}</span>
      <Money value={value} className={strong ? "font-semibold" : undefined} />
    </div>
  );
}

function ProgressRow({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between text-sm"><span>{label}</span><span className="tabular text-muted-foreground">{pct}%</span></div>
      <Progress value={pct} />
    </div>
  );
}

function Timeline({ id }: { id: string }) {
  const { t } = useT();
  const { data, isLoading } = useQuery({ queryKey: ["po", id, "timeline"], queryFn: () => api<{ at: string; kind: string; label: string }[]>(`/purchase-orders/${id}/timeline`) });
  if (isLoading) return <Skeleton className="h-40" />;
  return (
    <Card>
      <CardContent className="pt-4">
        <ol className="relative flex flex-col gap-4 border-l pl-5">
          {(data ?? []).map((e, i) => (
            <li key={i} className="relative text-sm">
              <span className="absolute top-1 -left-[25px] flex size-3 items-center justify-center rounded-full border-2 border-background bg-primary" aria-hidden />
              <span className="font-medium">{humanize(e.label)}</span>
              <span className="ml-2 text-xs text-muted-foreground">{humanize(e.kind)} · <DateTime value={e.at} /></span>
            </li>
          ))}
          {!data?.length && <li className="text-sm text-muted-foreground"><CheckCircle2 className="mr-1 inline size-4" />{t("po.order.noEvents")}</li>}
        </ol>
      </CardContent>
    </Card>
  );
}
