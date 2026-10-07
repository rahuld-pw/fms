"use client";
import { useState } from "react";
import { Star } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useMoney } from "@/components/shared/format";
import { Field, ResourcePicker, UserPicker } from "@/components/shared/fields";
import { useAction } from "@/components/shared/resource-form";
import { api, errorMessage } from "@/lib/client/api";
import { cn } from "@/lib/utils/cn";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Props = { open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void };
const today = () => new Date().toISOString().slice(0, 10);

/** Goods receipt: one row per open PO line; posts immediately (draft → posted). */
export function ReceiveDialog({ po, open, onOpenChange, onDone, onAssets }: Props & { po: any; onAssets: (c: AssetCandidate[]) => void }) {
  const open_ = (po.lines ?? []).filter((l: any) => Number(l.received_qty) < Number(l.quantity));
  const [rows, setRows] = useState(() => open_.map((l: any) => {
    const rem = String(Number(l.quantity) - Number(l.received_qty));
    return { po_line_id: l.id, description: l.description, unit: l.unit, remaining: rem, received_qty: rem, accepted_qty: rem, remarks: "" };
  }));
  const [date, setDate] = useState(today());
  const [dn, setDn] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (i: number, p: Record<string, string>) => setRows(rows.map((r: any, j: number) => (j === i ? { ...r, ...p } : r)));
  const save = async () => {
    setBusy(true);
    try {
      const lines = rows.filter((r: any) => Number(r.received_qty) > 0).map((r: any) => ({
        po_line_id: r.po_line_id, received_qty: Number(r.received_qty), accepted_qty: Number(r.accepted_qty), remarks: r.remarks || undefined,
      }));
      if (!lines.length) throw new Error("Enter a received quantity");
      const grn = await api<{ id: string }>("/grns", { body: { po_id: po.id, received_date: date, delivery_note_number: dn || undefined, vehicle_number: vehicle || undefined, lines }, idempotencyKey: crypto.randomUUID() });
      const res = await api<{ asset_candidates: AssetCandidate[] }>(`/grns/${grn.id}/post`, { body: {} });
      toast.success("Goods received");
      onOpenChange(false);
      onDone();
      if (res.asset_candidates?.length) onAssets(res.asset_candidates);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent wide>
        <DialogHeader>
          <DialogTitle>Receive goods</DialogTitle>
          <DialogDescription>Record what arrived. Rejected units (received − accepted) are not billable.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Received on"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Delivery note #"><Input value={dn} onChange={(e) => setDn(e.target.value)} /></Field>
          <Field label="Vehicle #"><Input value={vehicle} onChange={(e) => setVehicle(e.target.value)} /></Field>
        </div>
        <div className="-mx-4 overflow-x-auto sm:mx-0">
          <Table>
            <THead><TR><TH>Line</TH><TH className="w-24">Received</TH><TH className="w-24">Accepted</TH></TR></THead>
            <TBody>
              {rows.map((r: any, i: number) => (
                <TR key={r.po_line_id}>
                  <TD>{r.description}<span className="block text-xs text-muted-foreground">{r.remaining} {r.unit} pending</span></TD>
                  <TD><Input type="number" inputMode="decimal" min="0" max={r.remaining} step="any" value={r.received_qty} onChange={(e) => set(i, { received_qty: e.target.value, accepted_qty: e.target.value })} /></TD>
                  <TD><Input type="number" inputMode="decimal" min="0" max={r.received_qty} step="any" value={r.accepted_qty} onChange={(e) => set(i, { accepted_qty: e.target.value })} /></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
        <DialogFooter><Button loading={busy} onClick={save} disabled={!rows.length}>Post receipt</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface AssetCandidate { grn_line_id: string; description: string; accepted_qty: number; asset_category_id: string | null }

/** After a GRN with asset lines, offer to register them in the asset register. */
export function CreateAssetsDialog({ candidates, onClose }: { candidates: AssetCandidate[]; onClose: () => void }) {
  const [location, setLocation] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [custodian, setCustodian] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const total = candidates.reduce((s, c) => s + Math.floor(Number(c.accepted_qty)), 0);
  const create = async () => {
    setBusy(true);
    try {
      let n = 0;
      for (const c of candidates) {
        const r = await api<{ created: number }>(`/grns/lines/${c.grn_line_id}/assets`, { body: { location_id: location ?? undefined, category_id: category ?? undefined, custodian_id: custodian ?? undefined } });
        n += r.created;
      }
      toast.success(`${n} asset${n === 1 ? "" : "s"} added to the register`);
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={candidates.length > 0} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Register {total} asset{total === 1 ? "" : "s"}?</DialogTitle>
          <DialogDescription>{candidates.map((c) => `${Math.floor(Number(c.accepted_qty))} × ${c.description}`).join(", ")}. Each unit gets its own tag and QR code.</DialogDescription>
        </DialogHeader>
        <Field label="Location"><ResourcePicker endpoint="/locations" value={location} onChange={(v) => setLocation(v as string | null)} placeholder="Optional" /></Field>
        <Field label="Asset category" hint="Defaults to the PO line's category"><ResourcePicker endpoint="/asset-categories" value={category} onChange={(v) => setCategory(v as string | null)} placeholder="Optional" /></Field>
        <Field label="Custodian"><UserPicker value={custodian} onChange={(v) => setCustodian(v as string | null)} placeholder="Leave in stock" /></Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Later</Button>
          <Button loading={busy} onClick={create}>Create assets</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Vendor invoice against the PO; the 3-way match runs on save. */
export function InvoiceDialog({ po, open, onOpenChange, onDone }: Props & { po: any }) {
  const fmt = useMoney();
  const [number, setNumber] = useState("");
  const [date, setDate] = useState(today());
  const [due, setDue] = useState("");
  const [rows, setRows] = useState(() => (po.lines ?? [])
    .filter((l: any) => Number(l.received_qty) > Number(l.invoiced_qty))
    .map((l: any) => {
      const qty = Number(l.received_qty) - Number(l.invoiced_qty);
      const rate = Math.round(Number(l.unit_price) * (1 - Number(l.discount_pct) / 100) * 100) / 100;
      return { po_line_id: l.id, description: l.description, quantity: String(qty), unit_price: String(rate), tax_rate: Number(l.tax_rate) };
    }));
  const set = (i: number, p: Record<string, string>) => setRows(rows.map((r: any, j: number) => (j === i ? { ...r, ...p } : r)));
  const tax = (r: any) => Math.round(Number(r.quantity) * Number(r.unit_price) * r.tax_rate) / 100;
  const total = rows.reduce((s: number, r: any) => s + Number(r.quantity) * Number(r.unit_price) + tax(r), 0);
  const act = useAction<{ match_status: string }>({
    onSuccess: (inv) => {
      if (inv.match_status === "matched") toast.success("Invoice recorded — 3-way match passed");
      else toast.warning(`Invoice recorded — match: ${inv.match_status.replace(/_/g, " ")}`);
      onOpenChange(false);
      onDone();
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent wide>
        <DialogHeader>
          <DialogTitle>Record vendor invoice</DialogTitle>
          <DialogDescription>Quantities default to received but not yet invoiced. Prices are checked against the PO.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Vendor invoice #" required><Input value={number} onChange={(e) => setNumber(e.target.value)} /></Field>
          <Field label="Invoice date" required><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Due date"><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        </div>
        {rows.length === 0 ? (
          <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">Nothing received yet is left to invoice.</p>
        ) : (
          <div className="-mx-4 overflow-x-auto sm:mx-0">
            <Table>
              <THead><TR><TH>Line</TH><TH className="w-24">Qty</TH><TH className="w-28">Rate</TH><TH className="text-right">GST</TH></TR></THead>
              <TBody>
                {rows.map((r: any, i: number) => (
                  <TR key={r.po_line_id}>
                    <TD>{r.description}</TD>
                    <TD><Input type="number" inputMode="decimal" min="0" step="any" value={r.quantity} onChange={(e) => set(i, { quantity: e.target.value })} /></TD>
                    <TD><Input type="number" inputMode="decimal" min="0" step="0.01" value={r.unit_price} onChange={(e) => set(i, { unit_price: e.target.value })} /></TD>
                    <TD className="text-right tabular">{fmt(tax(r))}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        )}
        <DialogFooter className="items-center">
          <span className="mr-auto text-sm">Total <span className="font-semibold tabular">{fmt(total)}</span></span>
          <Button
            disabled={!number.trim() || !rows.length}
            loading={act.isPending}
            onClick={() => act.mutate({
              path: "/invoices",
              body: {
                po_id: po.id, vendor_invoice_number: number.trim(), invoice_date: date, due_date: due || undefined,
                lines: rows.filter((r: any) => Number(r.quantity) > 0).map((r: any) => ({ po_line_id: r.po_line_id, quantity: Number(r.quantity), unit_price: Number(r.unit_price), tax_amount: tax(r) })),
              },
            })}
          >
            Save invoice
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Asks for a reason, then POSTs it (amend / cancel). */
export function ReasonDialog({ title, description, path, cta, destructive, open, onOpenChange, onDone }: Props & { title: string; description: string; path: string; cta: string; destructive?: boolean }) {
  const [reason, setReason] = useState("");
  const act = useAction({ success: "Done", onSuccess: () => { setReason(""); onOpenChange(false); onDone(); } });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
        <Field label="Reason" required><Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <DialogFooter>
          <Button variant={destructive ? "destructive" : "default"} disabled={reason.trim().length < 3} loading={act.isPending} onClick={() => act.mutate({ path, body: { reason: reason.trim() } })}>{cta}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Close the PO and rate the vendor (feeds the vendor's rating). */
export function CloseDialog({ id, open, onOpenChange, onDone }: Props & { id: string }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const act = useAction({ success: "PO closed", onSuccess: () => { onOpenChange(false); onDone(); } });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Close purchase order</DialogTitle><DialogDescription>Releases any remaining budget commitment. Rate the vendor&apos;s performance on this order.</DialogDescription></DialogHeader>
        <div className="flex gap-1" role="radiogroup" aria-label="Vendor rating">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} star${n > 1 ? "s" : ""}`} onClick={() => setRating(n)} className="p-1">
              <Star className={cn("size-7", n <= rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground")} />
            </button>
          ))}
        </div>
        <Field label="Feedback"><Textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
        <DialogFooter>
          <Button loading={act.isPending} onClick={() => act.mutate({ path: `/purchase-orders/${id}/close`, body: { rating: rating || undefined, comment: comment || undefined } })}>Close PO</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
