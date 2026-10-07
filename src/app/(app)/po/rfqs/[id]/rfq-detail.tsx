"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Award, CheckCircle2, Clock, Plus, Star } from "lucide-react";
import { useCan } from "@/components/app/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ActivityFeed, Comments } from "@/components/shared/collaboration";
import { DateTime, Money, useMoney } from "@/components/shared/format";
import { Field, ResourcePicker } from "@/components/shared/fields";
import { DetailGrid, EmptyState, PageHeader } from "@/components/shared/page-header";
import { useAction } from "@/components/shared/resource-form";
import { StatusBadge } from "@/components/shared/status";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/utils/cn";

/* eslint-disable @typescript-eslint/no-explicit-any */
interface CompRow {
  quote_id: string; vendor_id: string; vendor_name: string; requisition_line_id: string | null; description: string; quantity: number;
  unit_price: number; tax_rate: number; line_total: number; quote_total: number; delivery_days: number | null; is_lowest_line: boolean;
  is_lowest_total: boolean; rating_avg: number | null;
}

export function RfqDetail({ id }: { id: string }) {
  const qc = useQueryClient();
  const router = useRouter();
  const can = useCan();
  const { data: rfq, isLoading } = useQuery({ queryKey: ["rfq", id], queryFn: () => api<any>(`/rfqs/${id}`) });
  const { data: comp } = useQuery({ queryKey: ["rfq", id, "comparison"], queryFn: () => api<CompRow[]>(`/rfqs/${id}/comparison`) });
  const [quoteFor, setQuoteFor] = useState<string | null>(null);
  const [awarding, setAwarding] = useState<any>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["rfq", id] });

  const matrix = useMemo(() => {
    const vendors = new Map<string, { quote_id: string; name: string; total: number; delivery: number | null; lowest: boolean; rating: number | null }>();
    const lines = new Map<string, { description: string; quantity: number; cells: Map<string, CompRow> }>();
    for (const r of comp ?? []) {
      vendors.set(r.vendor_id, { quote_id: r.quote_id, name: r.vendor_name, total: r.quote_total, delivery: r.delivery_days, lowest: r.is_lowest_total, rating: r.rating_avg });
      const key = r.requisition_line_id ?? r.description;
      if (!lines.has(key)) lines.set(key, { description: r.description, quantity: r.quantity, cells: new Map() });
      lines.get(key)!.cells.set(r.vendor_id, r);
    }
    return { vendors: [...vendors.entries()], lines: [...lines.values()] };
  }, [comp]);

  if (isLoading || !rfq) return <Skeleton className="h-96" />;
  const scope = { campusId: rfq.campus_id, departmentId: rfq.department_id };
  const open = ["draft", "sent"].includes(rfq.status);
  const canQuote = open && can("rfq:update", scope, "auto");
  const canAward = open && can("rfq:award", scope, "auto");
  const quoteByVendor = new Map((rfq.quotes ?? []).map((q: any) => [q.vendor_id, q]));

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        breadcrumbs={[{ label: "Requisitions", href: "/po/requisitions" }, ...(rfq.requisition ? [{ label: rfq.requisition.number, href: `/po/requisitions/${rfq.requisition.id}` }] : []), { label: rfq.number }]}
        title={rfq.title}
        meta={<><StatusBadge status={rfq.status} />{rfq.due_date && <span className="text-sm text-muted-foreground">Due <DateTime value={rfq.due_date} dateOnly /></span>}</>}
        actions={canQuote && <Button size="sm" variant="outline" onClick={() => setQuoteFor("")}><Plus /> Record quote</Button>}
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader><CardTitle>Quote comparison</CardTitle></CardHeader>
            {matrix.vendors.length === 0 ? (
              <CardContent><EmptyState icon={Clock} title="No quotes yet" description="Quotes appear here as vendors respond through the portal or you record them." /></CardContent>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <THead>
                    <TR>
                      <TH className="min-w-48">Line</TH>
                      {matrix.vendors.map(([vid, v]) => (
                        <TH key={vid} className="min-w-36 text-right">
                          <span className="block">{v.name}</span>
                          {v.rating != null && <span className="inline-flex items-center gap-0.5 text-xs font-normal text-muted-foreground"><Star className="size-3" /> {Number(v.rating).toFixed(1)}</span>}
                        </TH>
                      ))}
                    </TR>
                  </THead>
                  <TBody>
                    {matrix.lines.map((l, i) => (
                      <TR key={i}>
                        <TD>{l.description}<span className="block text-xs text-muted-foreground">Qty {Number(l.quantity)}</span></TD>
                        {matrix.vendors.map(([vid]) => {
                          const c = l.cells.get(vid);
                          return (
                            <TD key={vid} className={cn("text-right", c?.is_lowest_line && "bg-primary/5")}>
                              {c ? (
                                <>
                                  <Money value={c.unit_price} className={cn(c.is_lowest_line && "font-semibold text-primary")} />
                                  <span className="block text-xs text-muted-foreground">GST {Number(c.tax_rate)}%</span>
                                </>
                              ) : <span className="text-muted-foreground">—</span>}
                            </TD>
                          );
                        })}
                      </TR>
                    ))}
                    <TR>
                      <TD className="font-medium">Total incl. GST</TD>
                      {matrix.vendors.map(([vid, v]) => (
                        <TD key={vid} className="text-right">
                          <Money value={v.total} className={cn("font-semibold", v.lowest && "text-primary")} />
                          {v.lowest && <Badge tone="green" className="ml-1">Lowest</Badge>}
                        </TD>
                      ))}
                    </TR>
                    <TR>
                      <TD className="text-muted-foreground">Delivery</TD>
                      {matrix.vendors.map(([vid, v]) => <TD key={vid} className="text-right text-muted-foreground">{v.delivery != null ? `${v.delivery} days` : "—"}</TD>)}
                    </TR>
                    {canAward && (
                      <TR>
                        <TD />
                        {matrix.vendors.map(([vid, v]) => (
                          <TD key={vid} className="text-right">
                            <Button size="xs" variant={v.lowest ? "default" : "outline"} onClick={() => setAwarding({ quote_id: v.quote_id, name: v.name, total: v.total, lowest: v.lowest })}>
                              <Award /> Award
                            </Button>
                          </TD>
                        ))}
                      </TR>
                    )}
                  </TBody>
                </Table>
              </div>
            )}
          </Card>
          <Tabs defaultValue="comments">
            <TabsList>
              <TabsTrigger value="comments">Comments</TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
            </TabsList>
            <TabsContent value="comments"><Comments entityType="rfq" entityId={id} /></TabsContent>
            <TabsContent value="history"><ActivityFeed entityType="rfq" entityId={id} /></TabsContent>
          </Tabs>
        </div>
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader><CardTitle>Invited vendors</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              {(rfq.vendors ?? []).map((v: any) => {
                const q: any = quoteByVendor.get(v.vendor_id);
                return (
                  <div key={v.vendor_id} className="flex items-center gap-2">
                    {v.responded_at ? <CheckCircle2 className="size-4 text-primary" /> : <Clock className="size-4 text-muted-foreground" />}
                    <Link href={`/facility/vendors/${v.vendor_id}`} className="flex-1 truncate hover:underline">{v.vendor?.name}</Link>
                    {q ? <StatusBadge status={q.status} /> : v.declined ? <Badge tone="neutral">Declined</Badge> : canQuote && (
                      <Button size="xs" variant="ghost" onClick={() => setQuoteFor(v.vendor_id)}>Enter quote</Button>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <DetailGrid items={[
                { label: "Created", value: <DateTime value={rfq.created_at} /> },
                { label: "Due", value: <DateTime value={rfq.due_date} dateOnly /> },
                ...(rfq.terms ? [{ label: "Terms", value: <span className="whitespace-pre-wrap">{rfq.terms}</span>, wide: true }] : []),
              ]} />
            </CardContent>
          </Card>
        </div>
      </div>
      {quoteFor !== null && (
        <QuoteDialog rfq={rfq} vendorId={quoteFor} existing={quoteFor ? (quoteByVendor.get(quoteFor) as any) : undefined} onClose={() => setQuoteFor(null)} onDone={() => { setQuoteFor(null); refresh(); }} />
      )}
      <AwardDialog award={awarding} onClose={() => setAwarding(null)} onDone={(poId) => router.push(`/po/orders/${poId}`)} />
    </div>
  );
}

function QuoteDialog({ rfq, vendorId, existing, onClose, onDone }: { rfq: any; vendorId: string; existing?: any; onClose: () => void; onDone: () => void }) {
  const fmt = useMoney();
  const reqLines: any[] = [...(rfq.requisition?.lines ?? [])].sort((a, b) => a.position - b.position);
  const [vendor, setVendor] = useState(vendorId);
  const [ref, setRef] = useState(existing?.quote_reference ?? "");
  const [validUntil, setValidUntil] = useState(existing?.valid_until ?? "");
  const [delivery, setDelivery] = useState(existing?.delivery_days != null ? String(existing.delivery_days) : "");
  const [terms, setTerms] = useState(existing?.payment_terms ?? "");
  const [lines, setLines] = useState(
    reqLines.map((l) => {
      const prev = existing?.lines?.find((x: any) => x.requisition_line_id === l.id);
      return { requisition_line_id: l.id, description: l.description, quantity: String(l.quantity), unit_price: prev ? String(prev.unit_price) : "", tax_rate: prev ? String(Number(prev.tax_rate)) : "18" };
    }),
  );
  const act = useAction({ success: "Quote recorded", onSuccess: onDone });
  const total = lines.reduce((s, l) => s + Number(l.quantity) * Number(l.unit_price || 0) * (1 + Number(l.tax_rate) / 100), 0);
  const set = (i: number, p: Partial<(typeof lines)[number]>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...p } : l)));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent wide>
        <DialogHeader>
          <DialogTitle>Record quote</DialogTitle>
          <DialogDescription>Enter the vendor&apos;s rates per line. Recording again replaces the previous quote.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Vendor" required>
            <NativeSelect value={vendor} onChange={(e) => setVendor(e.target.value)}>
              <option value="">Choose…</option>
              {(rfq.vendors ?? []).map((v: any) => <option key={v.vendor_id} value={v.vendor_id}>{v.vendor?.name}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Quote reference"><Input value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
          <Field label="Valid until"><Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} /></Field>
          <Field label="Delivery (days)"><Input type="number" min="0" value={delivery} onChange={(e) => setDelivery(e.target.value)} /></Field>
          <Field label="Payment terms" className="sm:col-span-2"><Textarea rows={2} value={terms} onChange={(e) => setTerms(e.target.value)} /></Field>
        </div>
        <Table>
          <THead><TR><TH>Line</TH><TH className="w-20 text-right">Qty</TH><TH className="w-32">Rate</TH><TH className="w-24">GST %</TH></TR></THead>
          <TBody>
            {lines.map((l, i) => (
              <TR key={l.requisition_line_id}>
                <TD>{l.description}</TD>
                <TD className="text-right tabular">{Number(l.quantity)}</TD>
                <TD><Input type="number" step="0.01" min="0" inputMode="decimal" value={l.unit_price} onChange={(e) => set(i, { unit_price: e.target.value })} /></TD>
                <TD>
                  <NativeSelect value={l.tax_rate} onChange={(e) => set(i, { tax_rate: e.target.value })}>
                    {["0", "5", "12", "18", "28"].map((g) => <option key={g} value={g}>{g}</option>)}
                  </NativeSelect>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        <DialogFooter className="items-center">
          <span className="mr-auto text-sm">Total incl. GST <span className="font-semibold tabular">{fmt(total)}</span></span>
          <Button
            disabled={!vendor || lines.some((l) => l.unit_price === "")}
            loading={act.isPending}
            onClick={() => act.mutate({
              path: `/rfqs/${rfq.id}/quotes`,
              body: {
                vendor_id: vendor, quote_reference: ref || undefined, valid_until: validUntil || undefined, delivery_days: delivery ? Number(delivery) : undefined,
                payment_terms: terms || undefined,
                lines: lines.map((l) => ({ requisition_line_id: l.requisition_line_id, description: l.description, quantity: Number(l.quantity), unit_price: Number(l.unit_price), tax_rate: Number(l.tax_rate) })),
              },
            })}
          >
            Save quote
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AwardDialog({ award, onClose, onDone }: { award: { quote_id: string; name: string; total: number; lowest: boolean } | null; onClose: () => void; onDone: (poId: string) => void }) {
  const [category, setCategory] = useState<string | null>(null);
  const act = useAction<{ id: string }>({ success: "Quote awarded — draft PO created", onSuccess: (po) => onDone(po.id) });
  return (
    <Dialog open={!!award} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Award to {award?.name}</DialogTitle>
          <DialogDescription>
            Other quotes are rejected and a draft purchase order is created at <Money value={award?.total} />.
            {award && !award.lowest && " This is not the lowest quote — add a justification in the comments."}
          </DialogDescription>
        </DialogHeader>
        <Field label="Budget category" hint="Defaults to the requisition's category">
          <ResourcePicker endpoint="/expense-categories" value={category} onChange={(v) => setCategory(v as string | null)} placeholder="Optional" />
        </Field>
        <DialogFooter>
          <Button loading={act.isPending} onClick={() => award && act.mutate({ path: `/quotes/${award.quote_id}/award`, body: { category_id: category ?? undefined } })}>
            <Award /> Award and create PO
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
