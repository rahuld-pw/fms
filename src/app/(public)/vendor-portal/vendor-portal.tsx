"use client";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { CalendarCheck, CheckCircle2, FileUp, MapPin, Send } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Field } from "@/components/shared/fields";
import { StatusBadge } from "@/components/shared/status";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils/cn";
import { humanize } from "@/lib/utils/format";
import { portal, putSigned } from "./portal-api";

/* eslint-disable @typescript-eslint/no-explicit-any */
const DOC_TYPES = ["gst_certificate", "pan_card", "cancelled_cheque", "msme_certificate", "incorporation", "insurance", "license", "other"];

export function VendorPortal() {
  const { t } = useT();
  const token = useSearchParams().get("token");
  const { data, error, refetch } = useQuery({ queryKey: ["vendor-portal", token], enabled: !!token, retry: false, queryFn: () => portal<any>(token!, "/me") });
  const load = () => void refetch();

  if (!token) return <PortalLogin />;
  if (error) return <div className="flex flex-col gap-4"><Card><CardContent className="py-8 text-center text-sm">{error.message}</CardContent></Card><PortalLogin /></div>;
  if (!data) return <Skeleton className="h-96" />;

  const money = (v: number) => new Intl.NumberFormat(data.organisation.locale ?? "en-IN", { style: "currency", currency: data.organisation.currency ?? "INR" }).format(Number(v));
  const onboarding = data.can_edit_profile;
  const defaultTab = onboarding && ["invited", "draft", "rejected"].includes(data.vendor.status) ? "registration" : data.work_orders.length ? "visits" : data.rfqs.length ? "rfqs" : "orders";
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-xs text-muted-foreground">{t("public.vendor.portalOrg", { org: data.organisation.name })}</p>
        <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold">{data.vendor.name} <StatusBadge status={data.vendor.status} /></h1>
      </div>
      <Tabs defaultValue={defaultTab}>
        <TabsList className="w-full overflow-x-auto">
          {onboarding && <TabsTrigger value="registration">{t("public.vendor.tabRegistration")}</TabsTrigger>}
          <TabsTrigger value="visits">{data.work_orders.length ? t("public.vendor.tabVisitsCount", { n: data.work_orders.length }) : t("public.vendor.tabVisits")}</TabsTrigger>
          <TabsTrigger value="rfqs">{data.rfqs.length ? t("public.vendor.tabQuotesCount", { n: data.rfqs.length }) : t("public.vendor.tabQuotes")}</TabsTrigger>
          <TabsTrigger value="orders">{t("public.vendor.tabOrders")}</TabsTrigger>
        </TabsList>
        {onboarding && <TabsContent value="registration"><Registration token={token} data={data} onChange={load} /></TabsContent>}
        <TabsContent value="visits" className="flex flex-col gap-3">
          {data.work_orders.length === 0 && <Empty text={t("public.vendor.noVisits")} />}
          {data.work_orders.map((w: any) => <VisitCard key={w.id} token={token} wo={w} onChange={load} />)}
        </TabsContent>
        <TabsContent value="rfqs" className="flex flex-col gap-3">
          {data.rfqs.length === 0 && <Empty text={t("public.vendor.noRfqs")} />}
          {data.rfqs.map((r: any) => <RfqCard key={r.id} token={token} rfq={r} money={money} onChange={load} />)}
        </TabsContent>
        <TabsContent value="orders" className="flex flex-col gap-3">
          {data.purchase_orders.length === 0 && <Empty text={t("public.vendor.noOrders")} />}
          {data.purchase_orders.map((p: any) => <OrderCard key={p.id} token={token} po={p} money={money} onChange={load} />)}
        </TabsContent>
      </Tabs>
    </div>
  );
}

const Empty = ({ text }: { text: string }) => <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">{text}</CardContent></Card>;

function PortalLogin() {
  const { t } = useT();
  const [email, setEmail] = useState("");
  const [org, setOrg] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await fetch("/api/v1/portal/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, org_slug: org }) }).catch(() => null);
    setBusy(false);
    setSent(true);
  };
  return (
    <Card>
      <CardHeader><CardTitle>{t("public.vendor.signInTitle")}</CardTitle></CardHeader>
      <CardContent>
        {sent ? <p className="text-sm">{t("public.vendor.linkSent")}</p> : (
          <form onSubmit={send} className="flex flex-col gap-3">
            <Field label={t("public.vendor.registeredEmail")}><Input type="email" inputMode="email" autoCapitalize="none" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <Field label={t("public.vendor.orgCode")} hint={t("public.vendor.orgCodeHint")}><Input required value={org} autoCapitalize="none" onChange={(e) => setOrg(e.target.value.toLowerCase())} /></Field>
            <Button type="submit" size="lg" loading={busy}>{t("public.vendor.emailLink")}</Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function Registration({ token, data, onChange }: { token: string; data: any; onChange: () => void }) {
  const { t } = useT();
  const v = data.vendor;
  const [form, setForm] = useState<Record<string, any>>(() => ({ ...v, service_category_ids: v.service_category_ids ?? [] }));
  const [busy, setBusy] = useState<string | null>(null);
  const set = (k: string, val: unknown) => setForm({ ...form, [k]: val });
  const keys = ["name", "legal_name", "contact_name", "phone", "website", "address", "city", "state", "pincode", "gstin", "pan", "msme_number", "bank_account_name", "bank_account_number", "bank_ifsc", "bank_name"];
  const save = async () => {
    setBusy("save");
    try {
      const body: Record<string, unknown> = { service_category_ids: form.service_category_ids };
      for (const k of keys) body[k] = form[k] === "" ? null : form[k];
      await portal(token, "/profile", body, "PATCH");
      toast.success(t("public.vendor.detailsSaved"));
      onChange();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };
  const submit = async () => {
    setBusy("submit");
    try { await save(); await portal(token, "/submit", {}); toast.success(t("public.vendor.submittedForVerification")); onChange(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };
  const text = (k: string, label: string, props: React.ComponentProps<typeof Input> = {}) => (
    <Field label={label}><Input value={form[k] ?? ""} onChange={(e) => set(k, e.target.value)} {...props} /></Field>
  );
  const locked = !["invited", "draft", "rejected"].includes(v.status);
  return (
    <div className="flex flex-col gap-4">
      {locked && <p className="rounded-md border bg-background p-3 text-sm">{t("public.vendor.lockedBefore")} <b>{t(`status.${v.status}`, undefined, humanize(v.status))}</b>{t("public.vendor.lockedAfter")}</p>}
      <Card>
        <CardHeader><CardTitle>{t("public.vendor.businessDetails")}</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {text("name", t("public.vendor.tradeName"))}
          {text("legal_name", t("public.vendor.legalName"))}
          {text("contact_name", t("public.vendor.contactPerson"), { autoComplete: "name" })}
          {text("phone", t("public.vendor.phone"), { type: "tel", inputMode: "tel", autoComplete: "tel" })}
          {text("gstin", t("public.vendor.gstin"), { autoCapitalize: "characters", className: "font-mono uppercase" })}
          {text("pan", t("public.vendor.pan"), { autoCapitalize: "characters", className: "font-mono uppercase" })}
          {text("msme_number", t("public.vendor.msme"))}
          {text("website", t("public.vendor.website"), { type: "url", inputMode: "url" })}
          <Field label={t("public.vendor.address")} className="sm:col-span-2"><Textarea rows={2} value={form.address ?? ""} onChange={(e) => set("address", e.target.value)} /></Field>
          {text("city", t("public.vendor.city"))}
          <div className="grid grid-cols-2 gap-3">{text("state", t("public.vendor.state"))}{text("pincode", t("public.vendor.pin"), { inputMode: "numeric" })}</div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>{t("public.vendor.services")}</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {data.service_categories.map((c: any) => {
            const on = form.service_category_ids.includes(c.id);
            return (
              <button key={c.id} type="button" aria-pressed={on} onClick={() => set("service_category_ids", on ? form.service_category_ids.filter((x: string) => x !== c.id) : [...form.service_category_ids, c.id])}
                className={cn("rounded-full border px-3 py-1.5 text-sm", on ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted")}>{c.name}</button>
            );
          })}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>{t("public.vendor.bankAccount")}</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {text("bank_account_name", t("public.vendor.accountHolder"))}
          {text("bank_name", t("public.vendor.bank"))}
          {text("bank_account_number", t("public.vendor.accountNumber"), { inputMode: "numeric", className: "font-mono" })}
          {text("bank_ifsc", t("public.vendor.ifsc"), { autoCapitalize: "characters", className: "font-mono uppercase" })}
        </CardContent>
      </Card>
      <Documents token={token} docs={data.documents} onChange={onChange} />
      {!locked && (
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" size="lg" onClick={save} loading={busy === "save"} disabled={!!busy}>{t("public.vendor.saveDraft")}</Button>
          <Button size="lg" onClick={submit} loading={busy === "submit"} disabled={!!busy}><Send /> {t("public.vendor.submitForVerification")}</Button>
        </div>
      )}
    </div>
  );
}

function Documents({ token, docs, onChange }: { token: string; docs: any[]; onChange: () => void }) {
  const { t } = useT();
  const [type, setType] = useState("gst_certificate");
  const [number, setNumber] = useState("");
  const [expires, setExpires] = useState("");
  const [busy, setBusy] = useState(false);
  const upload = async (file: File) => {
    setBusy(true);
    try {
      const r = await portal<{ upload: { url: string } }>(token, "/documents", { doc_type: type, doc_number: number || undefined, expires_on: expires || undefined, file_name: file.name, mime_type: file.type || "application/pdf", size_bytes: file.size });
      await putSigned(r.upload.url, file);
      toast.success(t("public.vendor.documentUploaded"));
      setNumber(""); setExpires("");
      onChange();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Card>
      <CardHeader><CardTitle>{t("public.vendor.documents")}</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-3">
        {docs.map((d) => (
          <div key={d.id} className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="size-4 text-muted-foreground" />
            <span className="flex-1">{t(`enum.docType.${d.doc_type}`, undefined, humanize(d.doc_type))}{d.doc_number && <span className="text-muted-foreground"> · {d.doc_number}</span>}</span>
            <StatusBadge status={d.verification_status} />
          </div>
        ))}
        <div className="grid gap-2 rounded-md border border-dashed p-3 sm:grid-cols-3">
          <Field label={t("public.vendor.type")}><NativeSelect value={type} onChange={(e) => setType(e.target.value)}>{DOC_TYPES.map((d) => <option key={d} value={d}>{t(`enum.docType.${d}`, undefined, humanize(d))}</option>)}</NativeSelect></Field>
          <Field label={t("public.vendor.number")}><Input value={number} onChange={(e) => setNumber(e.target.value)} /></Field>
          <Field label={t("public.vendor.validUntil")}><Input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} /></Field>
          <label className={cn("inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md border bg-background text-sm font-medium hover:bg-muted sm:col-span-3", busy && "pointer-events-none opacity-50")}>
            <FileUp className="size-4" /> {busy ? t("public.vendor.uploading") : t("public.vendor.chooseFile")}
            <input type="file" accept="application/pdf,image/*" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
          </label>
        </div>
      </CardContent>
    </Card>
  );
}

function VisitCard({ token, wo, onChange }: { token: string; wo: any; onChange: () => void }) {
  const { t } = useT();
  const [mode, setMode] = useState<"reschedule" | "report" | null>(null);
  const [when, setWhen] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(true);
    try { await portal(token, `/work-orders/${wo.id}/booking`, { action, note: note || undefined, ...extra }); toast.success(t("public.vendor.updated")); setMode(null); onChange(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  const report = async (file: File) => {
    setBusy(true);
    try {
      const r = await portal<{ upload: { url: string } }>(token, `/work-orders/${wo.id}/report`, { notes: note || undefined, file_name: file.name, mime_type: file.type || "application/pdf", size_bytes: file.size });
      await putSigned(r.upload.url, file);
      await portal(token, `/work-orders/${wo.id}/booking`, { action: "complete", note: note || undefined });
      toast.success(t("public.vendor.reportUploaded"));
      setMode(null);
      onChange();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-4">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-xs text-muted-foreground">{wo.number}</p>
            <p className="font-medium">{wo.title}</p>
            <p className="flex items-center gap-1 text-xs text-muted-foreground"><MapPin className="size-3" /> {wo.campus?.name}{wo.location && ` · ${[...(wo.location.path_names ?? []), wo.location.name].join(" / ")}`}</p>
          </div>
          <StatusBadge status={wo.vendor_booking_status ?? "requested"} />
        </div>
        {wo.scheduled_for && <p className="flex items-center gap-1.5 text-sm"><CalendarCheck className="size-4 text-muted-foreground" /> {new Date(wo.scheduled_for).toLocaleString(undefined, { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</p>}
        {mode === "reschedule" && <Field label={t("public.vendor.proposedTime")}><Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>}
        {mode && <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={mode === "report" ? t("public.vendor.workDonePlaceholder") : t("public.vendor.notePlaceholder")} />}
        {mode === "report" ? (
          <label className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md bg-primary text-sm font-medium text-primary-foreground">
            <FileUp className="size-4" /> {busy ? t("public.vendor.uploading") : t("public.vendor.uploadAndDone")}
            <input type="file" accept="application/pdf,image/*" capture="environment" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void report(f); }} />
          </label>
        ) : mode === "reschedule" ? (
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={() => setMode(null)}>{t("public.vendor.back")}</Button>
            <Button loading={busy} disabled={!when} onClick={() => act("reschedule", { scheduled_for: new Date(when).toISOString() })}>{t("public.vendor.proposeTime")}</Button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Button loading={busy} onClick={() => act("confirm")}>{t("public.vendor.confirm")}</Button>
            <Button variant="outline" onClick={() => setMode("reschedule")}>{t("public.vendor.reschedule")}</Button>
            <Button variant="outline" onClick={() => setMode("report")}>{t("public.vendor.uploadReport")}</Button>
            <Button variant="ghost" className="text-destructive" onClick={() => confirm(t("public.vendor.confirmDecline")) && act("decline")}>{t("public.vendor.decline")}</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RfqCard({ token, rfq, money, onChange }: { token: string; rfq: any; money: (v: number) => string; onChange: () => void }) {
  const { t } = useT();
  const lines: any[] = rfq.requisition?.lines ?? [];
  const [rates, setRates] = useState<Record<string, { price: string; tax: string }>>({});
  const [delivery, setDelivery] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [terms, setTerms] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const total = lines.reduce((s, l) => s + Number(l.quantity) * Number(rates[l.id]?.price || 0) * (1 + Number(rates[l.id]?.tax ?? 18) / 100), 0);
  const submit = async () => {
    setBusy(true);
    try {
      await portal(token, `/rfqs/${rfq.id}/quote`, {
        delivery_days: delivery ? Number(delivery) : undefined, valid_until: validUntil || undefined, payment_terms: terms || undefined,
        lines: lines.map((l) => ({ requisition_line_id: l.id, description: l.description, quantity: Number(l.quantity), unit_price: Number(rates[l.id]?.price || 0), tax_rate: Number(rates[l.id]?.tax ?? 18) })),
      });
      toast.success(t("public.vendor.quoteSubmitted"));
      setDone(true);
      onChange();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Card>
      <CardHeader className="flex-wrap">
        <div><CardTitle>{rfq.title}</CardTitle><p className="font-mono text-xs text-muted-foreground">{rfq.number}{rfq.due_date && t("public.vendor.due", { date: rfq.due_date })}</p></div>
        {done && <Badge tone="green">{t("public.vendor.submitted")}</Badge>}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {rfq.terms && <p className="text-sm whitespace-pre-wrap text-muted-foreground">{rfq.terms}</p>}
        {lines.map((l) => (
          <div key={l.id} className="grid grid-cols-[1fr_7rem_5rem] items-end gap-2 border-b pb-3 last:border-0">
            <div className="text-sm"><p className="font-medium">{l.description}</p><p className="text-xs text-muted-foreground">{Number(l.quantity)} {l.unit}</p></div>
            <Field label={t("public.vendor.rateExclGst")}><Input type="number" inputMode="decimal" min="0" step="0.01" value={rates[l.id]?.price ?? ""} onChange={(e) => setRates({ ...rates, [l.id]: { tax: rates[l.id]?.tax ?? "18", price: e.target.value } })} /></Field>
            <Field label={t("public.vendor.gstPercent")}><NativeSelect value={rates[l.id]?.tax ?? "18"} onChange={(e) => setRates({ ...rates, [l.id]: { price: rates[l.id]?.price ?? "", tax: e.target.value } })}>{["0", "5", "12", "18", "28"].map((g) => <option key={g}>{g}</option>)}</NativeSelect></Field>
          </div>
        ))}
        <div className="grid grid-cols-2 gap-2">
          <Field label={t("public.vendor.deliveryDays")}><Input type="number" inputMode="numeric" min="0" value={delivery} onChange={(e) => setDelivery(e.target.value)} /></Field>
          <Field label={t("public.vendor.validUntil")}><Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} /></Field>
        </div>
        <Field label={t("public.vendor.paymentTermsNotes")}><Textarea rows={2} value={terms} onChange={(e) => setTerms(e.target.value)} /></Field>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm">{t("public.vendor.total")} <b className="tabular">{money(total)}</b></span>
          <Button loading={busy} disabled={lines.some((l) => !rates[l.id]?.price)} onClick={submit}><Send /> {t("public.vendor.submitQuote")}</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function OrderCard({ token, po, money, onChange }: { token: string; po: any; money: (v: number) => string; onChange: () => void }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<any>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    setOpen(!open);
    if (!detail) try { setDetail(await portal(token, `/purchase-orders/${po.id}`)); } catch (e) { toast.error((e as Error).message); }
  };
  const ack = async () => {
    setBusy(true);
    try { await portal(token, `/purchase-orders/${po.id}/acknowledge`, { name }); toast.success(t("public.vendor.orderAcknowledged")); onChange(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Card>
      <button type="button" className="flex w-full items-center gap-3 p-4 text-left" onClick={toggle} aria-expanded={open}>
        <div className="min-w-0 flex-1"><p className="font-mono text-sm">{po.number}{po.version > 1 && t("public.vendor.rev", { n: po.version })}</p><p className="text-xs text-muted-foreground">{po.expected_delivery ? t("public.vendor.orderedDeliverBy", { date: po.order_date, by: po.expected_delivery }) : t("public.vendor.ordered", { date: po.order_date })}</p></div>
        <div className="flex flex-col items-end gap-1"><span className="text-sm font-medium tabular">{money(po.total)}</span><StatusBadge status={po.status} /></div>
      </button>
      {open && (
        <CardContent className="flex flex-col gap-3 border-t pt-3">
          {!detail ? <Skeleton className="h-24" /> : (
            <>
              <p className="text-xs text-muted-foreground">{t("public.vendor.deliverTo", { campus: `${detail.campus?.name ?? ""}${detail.campus?.address ? `, ${detail.campus.address}` : ""}` })}{detail.campus?.gstin && t("public.vendor.gstinSuffix", { gstin: detail.campus.gstin })}</p>
              <ul className="flex flex-col divide-y text-sm">
                {[...detail.lines].sort((a: any, b: any) => a.line_no - b.line_no).map((l: any) => (
                  <li key={l.line_no} className="flex justify-between gap-2 py-2">
                    <span>{l.description}<span className="block text-xs text-muted-foreground">{Number(l.quantity)} {l.unit} × {money(l.unit_price)} · {t("public.vendor.lineGst", { rate: Number(l.tax_rate) })}{Number(l.received_qty) > 0 && t("public.vendor.received", { n: Number(l.received_qty) })}</span></span>
                    <span className="tabular">{money(l.line_total)}</span>
                  </li>
                ))}
              </ul>
              {detail.payment_terms && <p className="text-xs text-muted-foreground">{t("public.vendor.payment", { terms: detail.payment_terms })}</p>}
              {po.status === "sent" && !po.vendor_ack_at && (
                <div className="flex flex-col gap-2 rounded-md border border-dashed p-3">
                  <Field label={t("public.vendor.yourName")} hint={t("public.vendor.yourNameHint")}><Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></Field>
                  <Button loading={busy} disabled={name.trim().length < 2} onClick={ack}><CheckCircle2 /> {t("public.vendor.acknowledgeOrder")}</Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}
