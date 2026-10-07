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
import { humanize } from "@/lib/utils/format";
import { ItemsEditor, toPayload, type ItemDraft } from "../items-editor";

/* eslint-disable @typescript-eslint/no-explicit-any */
export function ClaimDetail({ id }: { id: string }) {
  const qc = useQueryClient();
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
      toast.success(r.status === "approved" ? "Auto-approved" : "Submitted for approval", { description: warn?.message });
      refresh();
    },
  });
  const cancel = useAction({ success: "Claim cancelled", onSuccess: refresh });
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
      toast.success("Items saved");
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
        breadcrumbs={[{ label: "Claims", href: "/expense/claims" }, { label: c.number }]}
        title={c.title}
        meta={
          <>
            <StatusBadge status={c.status} />
            <span className="text-sm text-muted-foreground">{humanize(c.claim_type)}</span>
            <Money value={c.total_amount} className="text-sm font-semibold" />
          </>
        }
        actions={
          <>
            {canEdit && (
              <>
                <Button size="sm" onClick={() => submit.mutate({ path: `/expense-claims/${id}/submit` })} loading={submit.isPending} disabled={!!editing}>
                  <Send /> {c.status === "rejected" ? "Resubmit" : "Submit"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => cancel.mutate({ path: `/expense-claims/${id}/cancel` })}>
                  <XCircle /> Cancel claim
                </Button>
              </>
            )}
            {canPay && (
              <Button size="sm" onClick={() => setPayOpen(true)}>
                <Banknote /> Mark reimbursed
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
              <CardTitle>Items</CardTitle>
              {canEdit && !editing && (
                <Button size="xs" variant="outline" onClick={() => setEditing(c.items.map((i: any) => ({ id: i.id, category_id: i.category_id, expense_date: i.expense_date, description: i.description, merchant: i.merchant ?? "", amount: String(i.amount), tax_amount: String(i.tax_amount) })))}>
                  <Pencil /> Edit items
                </Button>
              )}
            </CardHeader>
            {editing ? (
              <CardContent className="flex flex-col gap-3">
                <ItemsEditor items={editing} onChange={setEditing} />
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => setEditing(null)}>Discard</Button>
                  <Button size="sm" onClick={saveItems} loading={savingItems}>Save items</Button>
                </div>
              </CardContent>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Date</TH>
                    <TH>Description</TH>
                    <TH>Category</TH>
                    <TH className="text-right">Amount</TH>
                    <TH className="text-right">Tax</TH>
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
                    <TD colSpan={3} className="text-right font-medium">Total</TD>
                    <TD colSpan={2} className="text-right font-semibold"><Money value={c.total_amount} /></TD>
                  </TR>
                </TBody>
              </Table>
            )}
          </Card>
          <Tabs defaultValue="approval">
            <TabsList>
              <TabsTrigger value="approval">Approval</TabsTrigger>
              <TabsTrigger value="receipts">Receipts</TabsTrigger>
              <TabsTrigger value="comments">Comments</TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
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
                { label: "Claimant", value: <UserChip name={c.claimant?.full_name} />, wide: true },
                { label: "Campus", value: c.campus?.name },
                { label: "Department", value: c.department?.name },
                { label: "Submitted", value: <DateTime value={c.submitted_at} /> },
                { label: "Approved", value: <DateTime value={c.approved_at} /> },
                { label: "Paid", value: <DateTime value={c.paid_at} /> },
                { label: "Payment ref", value: c.payment_reference ? `${humanize(c.payment_method)} · ${c.payment_reference}` : null },
                ...(c.advance ? [{ label: "Settles advance", value: `${c.advance.number} (${c.advance.amount})`, wide: true }] : []),
                ...(c.description ? [{ label: "Notes", value: c.description, wide: true }] : []),
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
  const act = useAction({ success: "Marked as reimbursed", onSuccess: () => { onDone(); onOpenChange(false); } });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record reimbursement</DialogTitle>
          <DialogDescription>The claimant is notified.</DialogDescription>
        </DialogHeader>
        <Field label="Method">
          <NativeSelect value={method} onChange={(e) => setMethod(e.target.value)}>
            {["bank_transfer", "upi", "cheque", "cash", "payroll"].map((m) => <option key={m} value={m}>{humanize(m)}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Reference (UTR / cheque no.)" required><Input value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
        <DialogFooter>
          <Button disabled={!reference.trim()} loading={act.isPending} onClick={() => act.mutate({ path: `/expense-claims/${id}/pay`, body: { reference, method } })}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
