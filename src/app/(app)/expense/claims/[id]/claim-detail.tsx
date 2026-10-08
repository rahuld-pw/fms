"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AlertTriangle, Banknote, Pencil, Send, XCircle } from "lucide-react";
import { toast } from "sonner";
import { useCan, useSession } from "@/components/app/session";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, NativeSelect } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ActivityFeed, ApprovalPanel, Attachments, Comments } from "@/components/shared/collaboration";
import { DateTime, Money } from "@/components/shared/format";
import { Field, UserChip } from "@/components/shared/fields";
import { DetailGrid, PageHeader } from "@/components/shared/page-header";
import { useAction } from "@/components/shared/resource-form";
import { StatusBadge } from "@/components/shared/status";
import { api, errorMessage } from "@/lib/client/api";
import { useT } from "@/lib/i18n/client";
import { humanize } from "@/lib/utils/format";
import { ItemsEditor, toPayload, type ItemDraft } from "../items-editor";

/* eslint-disable @typescript-eslint/no-explicit-any */
export function ClaimDetail({ id }: { id: string }) {
  const qc = useQueryClient();
  const { t } = useT();
  const can = useCan();
  const { user } = useSession();
  const { data: c, isLoading } = useQuery({ queryKey: ["claim", id], queryFn: () => api<any>(`/expense-claims/${id}`) });
  const [editing, setEditing] = useState<ItemDraft[] | null>(null);
  const [savingItems, setSavingItems] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["claim", id] });
    qc.invalidateQueries({ queryKey: ["approvals", "expense_claim", id] });
    qc.invalidateQueries({ queryKey: ["activity", "expense_claim", id] });
  };
  const submit = useAction<{ status: string; budget_checks: { result: string; message?: string }[] }>({
    onSuccess: (r) => {
      const warn = r.budget_checks?.find((b) => b.result === "warning");
      toast.success(r.status === "approved" ? t("expense.claimDetail.autoApproved") : t("expense.claimDetail.submittedForApproval"), { description: warn?.message });
      refresh();
    },
  });
  const cancel = useAction({ success: t("expense.claimDetail.cancelled"), onSuccess: refresh });
  if (isLoading || !c) return <Skeleton className="h-96" />;

  const mine = c.claimant_id === user.id || c.created_by === user.id;
  const draft = ["draft", "rejected"].includes(c.status);
  const canEdit = draft && (mine || can("expense:update", { campusId: c.campus_id, departmentId: c.department_id }, "auto"));
  const canPay = c.status === "approved" && can("expense:pay", { campusId: c.campus_id, departmentId: c.department_id }, "auto");

  const saveItems = async () => {
    if (!editing) return;
    setSavingItems(true);
    try {
      const existing = new Set((c.items ?? []).map((i: any) => i.id));
      const kept = new Set(editing.filter((i) => i.id).map((i) => i.id));
      for (const old of existing) if (!kept.has(old as string)) await api(`/expense-claims/${id}/items/${old}`, { method: "DELETE" });
      for (const it of editing) {
        if (it.id) await api(`/expense-claims/${id}/items/${it.id}`, { method: "PATCH", body: toPayload(it) });
        else await api(`/expense-claims/${id}/items`, { body: toPayload(it) });
      }
      toast.success(t("expense.claimDetail.itemsSaved"));
      setEditing(null);
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSavingItems(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        breadcrumbs={[{ label: t("expense.claims.breadcrumb"), href: "/expense/claims" }, { label: c.number }]}
        title={c.title}
        meta={
          <>
            <StatusBadge status={c.status} />
            <span className="text-sm text-muted-foreground">{t(`enum.claimType.${c.claim_type}`, undefined, humanize(c.claim_type))}</span>
            <Money value={c.total_amount} className="text-sm font-semibold" />
          </>
        }
        actions={
          <>
            {canEdit && (
              <>
                <Button size="sm" onClick={() => submit.mutate({ path: `/expense-claims/${id}/submit` })} loading={submit.isPending} disabled={!!editing}>
                  <Send /> {c.status === "rejected" ? t("expense.claimDetail.resubmit") : t("ui.submit")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => cancel.mutate({ path: `/expense-claims/${id}/cancel` })}>
                  <XCircle /> {t("expense.claimDetail.cancelClaim")}
                </Button>
              </>
            )}
            {canPay && (
              <Button size="sm" onClick={() => setPayOpen(true)}>
                <Banknote /> {t("expense.claimDetail.markReimbursed")}
              </Button>
            )}
          </>
        }
      />
      {(c.budget_checks ?? []).filter((b: any) => b.result === "warning").map((b: any, i: number) => (
        <p key={i} className="mb-3 flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle className="size-4" /> {b.message}
        </p>
      ))}
      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("ui.items")}</CardTitle>
              {canEdit && !editing && (
                <Button size="xs" variant="outline" onClick={() => setEditing(c.items.map((i: any) => ({ id: i.id, category_id: i.category_id, expense_date: i.expense_date, description: i.description, merchant: i.merchant ?? "", amount: String(i.amount), tax_amount: String(i.tax_amount) })))}>
                  <Pencil /> {t("expense.claimDetail.editItems")}
                </Button>
              )}
            </CardHeader>
            {editing ? (
              <CardContent className="flex flex-col gap-3">
                <ItemsEditor items={editing} onChange={setEditing} />
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => setEditing(null)}>{t("expense.claimDetail.discard")}</Button>
                  <Button size="sm" onClick={saveItems} loading={savingItems}>{t("expense.claimDetail.saveItems")}</Button>
                </div>
              </CardContent>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>{t("ui.date")}</TH>
                    <TH>{t("ui.description")}</TH>
                    <TH>{t("ui.category")}</TH>
                    <TH className="text-right">{t("ui.amount")}</TH>
                    <TH className="text-right">{t("ui.tax")}</TH>
                  </TR>
                </THead>
                <TBody>
                  {c.items.map((i: any) => (
                    <TR key={i.id}>
                      <TD className="whitespace-nowrap">{i.expense_date}</TD>
                      <TD>
                        {i.description}
                        {i.merchant && <span className="block text-xs text-muted-foreground">{i.merchant}</span>}
                      </TD>
                      <TD>{i.category?.name}</TD>
                      <TD className="text-right"><Money value={i.amount} /></TD>
                      <TD className="text-right"><Money value={i.tax_amount} /></TD>
                    </TR>
                  ))}
                  <TR>
                    <TD colSpan={3} className="text-right font-medium">{t("ui.total")}</TD>
                    <TD colSpan={2} className="text-right font-semibold"><Money value={c.total_amount} /></TD>
                  </TR>
                </TBody>
              </Table>
            )}
          </Card>
          <Tabs defaultValue="approval">
            <TabsList>
              <TabsTrigger value="approval">{t("expense.claimDetail.tabApproval")}</TabsTrigger>
              <TabsTrigger value="receipts">{t("expense.claimDetail.tabReceipts")}</TabsTrigger>
              <TabsTrigger value="comments">{t("ui.comments")}</TabsTrigger>
              <TabsTrigger value="history">{t("ui.history")}</TabsTrigger>
            </TabsList>
            <TabsContent value="approval"><ApprovalPanel entityType="expense_claim" entityId={id} onDecided={refresh} /></TabsContent>
            <TabsContent value="receipts"><Attachments entityType="expense_claim" entityId={id} kind="receipt" canUpload={canEdit} /></TabsContent>
            <TabsContent value="comments"><Comments entityType="expense_claim" entityId={id} /></TabsContent>
            <TabsContent value="history"><ActivityFeed entityType="expense_claim" entityId={id} /></TabsContent>
          </Tabs>
        </div>
        <Card className="h-fit">
          <CardContent className="pt-4">
            <DetailGrid
              items={[
                { label: t("expense.claimDetail.claimant"), value: <UserChip name={c.claimant?.full_name} />, wide: true },
                { label: t("ui.campus"), value: c.campus?.name },
                { label: t("ui.department"), value: c.department?.name },
                { label: t("expense.claimDetail.submitted"), value: <DateTime value={c.submitted_at} /> },
                { label: t("expense.claimDetail.approved"), value: <DateTime value={c.approved_at} /> },
                { label: t("expense.claimDetail.paid"), value: <DateTime value={c.paid_at} /> },
                { label: t("expense.claimDetail.paymentRef"), value: c.payment_reference ? `${t(`enum.paymentMethod.${c.payment_method}`, undefined, humanize(c.payment_method))} · ${c.payment_reference}` : null },
                ...(c.advance ? [{ label: t("expense.claimDetail.settlesAdvance"), value: `${c.advance.number} (${c.advance.amount})`, wide: true }] : []),
                ...(c.description ? [{ label: t("ui.notes"), value: c.description, wide: true }] : []),
              ]}
            />
          </CardContent>
        </Card>
      </div>
      <PayDialog id={id} open={payOpen} onOpenChange={setPayOpen} onDone={refresh} />
    </div>
  );
}

function PayDialog({ id, open, onOpenChange, onDone }: { id: string; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [reference, setReference] = useState("");
  const [method, setMethod] = useState("bank_transfer");
  const { t } = useT();
  const act = useAction({ success: t("expense.claimDetail.markedReimbursed"), onSuccess: () => { onDone(); onOpenChange(false); } });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("expense.claimDetail.payTitle")}</DialogTitle>
          <DialogDescription>{t("expense.claimDetail.payDescription")}</DialogDescription>
        </DialogHeader>
        <Field label={t("expense.claimDetail.method")}>
          <NativeSelect value={method} onChange={(e) => setMethod(e.target.value)}>
            {["bank_transfer", "upi", "cheque", "cash", "payroll"].map((m) => <option key={m} value={m}>{t(`enum.paymentMethod.${m}`, undefined, humanize(m))}</option>)}
          </NativeSelect>
        </Field>
        <Field label={t("expense.claimDetail.reference")} required><Input value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
        <DialogFooter>
          <Button disabled={!reference.trim()} loading={act.isPending} onClick={() => act.mutate({ path: `/expense-claims/${id}/pay`, body: { reference, method } })}>{t("ui.save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
