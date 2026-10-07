"use client";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Banknote, CheckCircle2, RefreshCw, ShieldAlert, XCircle } from "lucide-react";
import { useCan } from "@/components/app/session";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ActivityFeed, Attachments, Comments } from "@/components/shared/collaboration";
import { DateTime, Money } from "@/components/shared/format";
import { Field, UserChip } from "@/components/shared/fields";
import { DetailGrid, PageHeader } from "@/components/shared/page-header";
import { useAction } from "@/components/shared/resource-form";
import { StatusBadge } from "@/components/shared/status";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/utils/cn";
import { humanize } from "@/lib/utils/format";

/* eslint-disable @typescript-eslint/no-explicit-any */
export function InvoiceDetail({ id }: { id: string }) {
  const qc = useQueryClient();
  const can = useCan();
  const { data: inv, isLoading } = useQuery({ queryKey: ["invoice", id], queryFn: () => api<any>(`/invoices/${id}`) });
  const [dialog, setDialog] = useState<"approve" | "pay" | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["invoice", id] });
  const rematch = useAction({ success: "3-way match re-run", onSuccess: refresh });
  if (isLoading || !inv) return <Skeleton className="h-96" />;

  const scope = { campusId: inv.campus_id };
  const matched = ["matched", "override"].includes(inv.match_status);
  const canApprove = inv.status === "received" && can("invoice:approve", scope, "auto");
  const canOverride = can("invoice:override", scope, "auto");
  const canPay = ["approved", "partially_paid"].includes(inv.status) && can("payment:create", scope, "auto");
  const outstanding = Number(inv.total) - Number(inv.amount_paid);
  const matchLines: any[] = inv.match_details?.lines ?? [];

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        breadcrumbs={[{ label: "Invoices", href: "/po/invoices" }, { label: inv.vendor_invoice_number }]}
        title={`${inv.vendor?.name} · ${inv.vendor_invoice_number}`}
        meta={<><StatusBadge status={inv.status} /><StatusBadge status={inv.match_status} label={`Match: ${humanize(inv.match_status)}`} /><Money value={inv.total} className="text-sm font-semibold" /></>}
        actions={
          <>
            {inv.status === "received" && <Button size="sm" variant="outline" onClick={() => rematch.mutate({ path: `/invoices/${id}/match` })} loading={rematch.isPending}><RefreshCw /> Re-run match</Button>}
            {canApprove && (matched || canOverride) && (
              <Button size="sm" variant={matched ? "default" : "outline"} onClick={() => setDialog("approve")}>
                {matched ? <CheckCircle2 /> : <ShieldAlert />} {matched ? "Approve for payment" : "Override & approve"}
              </Button>
            )}
            {canPay && <Button size="sm" onClick={() => setDialog("pay")}><Banknote /> Record payment</Button>}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader><CardTitle>3-way match</CardTitle>{inv.match_details?.checked_at && <span className="text-xs text-muted-foreground">Checked <DateTime value={inv.match_details.checked_at} relative /></span>}</CardHeader>
            <div className="overflow-x-auto">
              <Table>
                <THead>
                  <TR>
                    <TH>Line</TH>
                    <TH className="hidden text-right sm:table-cell">Ordered</TH>
                    <TH className="text-right">Received</TH>
                    <TH className="text-right">Invoiced</TH>
                    <TH className="text-right">PO rate</TH>
                    <TH className="text-right">Billed rate</TH>
                    <TH>Result</TH>
                  </TR>
                </THead>
                <TBody>
                  {matchLines.map((l) => {
                    const qtyBad = ["qty_mismatch", "over_billed"].includes(l.result);
                    const priceBad = l.result === "price_mismatch";
                    return (
                      <TR key={l.po_line_id}>
                        <TD>{l.description}</TD>
                        <TD className="hidden text-right tabular sm:table-cell">{Number(l.ordered_qty)}</TD>
                        <TD className="text-right tabular">{Number(l.received_qty)}</TD>
                        <TD className={cn("text-right tabular", qtyBad && "font-semibold text-destructive")}>
                          {Number(l.invoiced_qty)}{Number(l.previously_invoiced_qty) > 0 && <span className="block text-xs font-normal text-muted-foreground">+{Number(l.previously_invoiced_qty)} earlier</span>}
                        </TD>
                        <TD className="text-right"><Money value={l.po_unit_price} /></TD>
                        <TD className={cn("text-right", priceBad && "font-semibold text-destructive")}><Money value={l.invoiced_unit_price} /></TD>
                        <TD>{l.result === "matched" ? <CheckCircle2 className="size-4 text-primary" aria-label="Matched" /> : <span className="inline-flex items-center gap-1 text-xs text-destructive"><XCircle className="size-4" /> {humanize(l.result)}</span>}</TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </div>
            {inv.override_reason && <CardContent className="border-t pt-3 text-sm"><span className="font-medium">Override:</span> {inv.override_reason}</CardContent>}
          </Card>
          <Card>
            <CardHeader><CardTitle>Payments</CardTitle><span className="text-sm">Outstanding <Money value={outstanding} className="font-semibold" /></span></CardHeader>
            {inv.payments?.length ? (
              <Table>
                <THead><TR><TH>Ref</TH><TH>Paid on</TH><TH className="hidden sm:table-cell">Method</TH><TH className="hidden text-right sm:table-cell">TDS</TH><TH className="text-right">Amount</TH></TR></THead>
                <TBody>
                  {inv.payments.map((p: any) => (
                    <TR key={p.id}>
                      <TD className="font-mono text-xs">{p.number}{p.reference && <span className="block text-muted-foreground">{p.reference}</span>}</TD>
                      <TD className="whitespace-nowrap"><DateTime value={p.paid_on} dateOnly /><span className="block text-xs text-muted-foreground sm:hidden">{p.method?.toUpperCase()}</span></TD>
                      <TD className="hidden sm:table-cell">{p.method?.toUpperCase()}</TD>
                      <TD className="hidden text-right sm:table-cell"><Money value={p.tds_amount} /></TD>
                      <TD className="whitespace-nowrap text-right font-medium"><Money value={p.amount} /></TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            ) : <CardContent className="text-sm text-muted-foreground">No payments yet.</CardContent>}
          </Card>
          <Tabs defaultValue="files">
            <TabsList>
              <TabsTrigger value="files">Invoice copy</TabsTrigger>
              <TabsTrigger value="comments">Comments</TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
            </TabsList>
            <TabsContent value="files"><Attachments entityType="vendor_invoice" entityId={id} /></TabsContent>
            <TabsContent value="comments"><Comments entityType="vendor_invoice" entityId={id} /></TabsContent>
            <TabsContent value="history"><ActivityFeed entityType="vendor_invoice" entityId={id} /></TabsContent>
          </Tabs>
        </div>
        <Card className="h-fit">
          <CardContent className="pt-4">
            <DetailGrid
              items={[
                { label: "Vendor", value: <Link className="hover:underline" href={`/facility/vendors/${inv.vendor_id}`}>{inv.vendor?.name}</Link>, wide: true },
                { label: "Purchase order", value: <Link className="font-mono text-xs hover:underline" href={`/po/orders/${inv.po_id}`}>{inv.po?.number}</Link>, wide: true },
                { label: "Invoice date", value: <DateTime value={inv.invoice_date} dateOnly /> },
                { label: "Due", value: <DateTime value={inv.due_date} dateOnly /> },
                { label: "Subtotal", value: <Money value={inv.subtotal} /> },
                { label: "GST", value: <Money value={inv.tax_total} /> },
                { label: "Approved by", value: <UserChip name={inv.approver?.full_name} /> },
                { label: "Approved", value: <DateTime value={inv.approved_at} /> },
                { label: "Internal ref", value: <span className="font-mono text-xs">{inv.number}</span> },
              ]}
            />
          </CardContent>
        </Card>
      </div>
      <ApproveDialog id={id} override={!matched} open={dialog === "approve"} onOpenChange={(o) => !o && setDialog(null)} onDone={refresh} />
      <PaymentDialog id={id} outstanding={outstanding} open={dialog === "pay"} onOpenChange={(o) => !o && setDialog(null)} onDone={refresh} />
    </div>
  );
}

type DProps = { id: string; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void };

function ApproveDialog({ id, override, open, onOpenChange, onDone }: DProps & { override: boolean }) {
  const [reason, setReason] = useState("");
  const act = useAction({ success: "Invoice approved for payment", onSuccess: () => { onOpenChange(false); onDone(); } });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{override ? "Override 3-way match" : "Approve for payment"}</DialogTitle>
          <DialogDescription>{override ? "The invoice does not match the PO and receipts. Explain why it should be paid anyway; this is recorded in the audit log." : "Moves the amount from committed to actual spend against the budget."}</DialogDescription>
        </DialogHeader>
        {override && <Field label="Override reason" required><Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>}
        <DialogFooter>
          <Button disabled={override && reason.trim().length < 5} loading={act.isPending} onClick={() => act.mutate({ path: `/invoices/${id}/approve`, body: override ? { override_reason: reason.trim() } : {} })}>Approve</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PaymentDialog({ id, outstanding, open, onOpenChange, onDone }: DProps & { outstanding: number }) {
  const [amount, setAmount] = useState(String(outstanding));
  const [tds, setTds] = useState("0");
  const [method, setMethod] = useState("neft");
  const [reference, setReference] = useState("");
  const [paidOn, setPaidOn] = useState(() => new Date().toISOString().slice(0, 10));
  const act = useAction({ success: "Payment recorded", onSuccess: () => { onOpenChange(false); onDone(); } });
  return (
    <Dialog open={open} onOpenChange={(o) => { if (o) setAmount(String(outstanding)); onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Record payment</DialogTitle><DialogDescription>Outstanding: <Money value={outstanding} /></DialogDescription></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Amount" required><Input type="number" inputMode="decimal" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Field label="TDS deducted"><Input type="number" inputMode="decimal" step="0.01" min="0" value={tds} onChange={(e) => setTds(e.target.value)} /></Field>
          <Field label="Method">
            <NativeSelect value={method} onChange={(e) => setMethod(e.target.value)}>
              {["neft", "rtgs", "imps", "upi", "cheque", "cash", "other"].map((m) => <option key={m} value={m}>{m.toUpperCase()}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Paid on"><Input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></Field>
          <Field label="Reference (UTR / cheque no.)" className="sm:col-span-2"><Input value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
        </div>
        <DialogFooter>
          <Button disabled={!(Number(amount) > 0)} loading={act.isPending}
            onClick={() => act.mutate({ path: `/invoices/${id}/payments`, body: { amount: Number(amount), tds_amount: Number(tds || 0), method, reference: reference || undefined, paid_on: paidOn } })}>
            Save payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
