"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Ban, Check, FileCheck2, Link2, Pencil, Plus, Send, ShieldCheck, Star, X } from "lucide-react";
import { toast } from "sonner";
import { useCan, useSession } from "@/components/app/session";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ActivityFeed, ApprovalPanel, Attachments, Comments } from "@/components/shared/collaboration";
import { DateTime, DueDate, Money } from "@/components/shared/format";
import { DetailGrid, PageHeader, Stat } from "@/components/shared/page-header";
import { isActing, ResourceFormDialog, useAction } from "@/components/shared/resource-form";
import { StatusBadge } from "@/components/shared/status";
import { api } from "@/lib/client/api";
import { useT } from "@/lib/i18n/client";
import { humanize } from "@/lib/utils/format";
import { vendorFields } from "../vendor-fields";

/* eslint-disable @typescript-eslint/no-explicit-any */
const STEPS = ["invited", "draft", "submitted", "under_verification", "pending_approval", "approved"];

export function VendorDetail({ id }: { id: string }) {
  const { t } = useT();
  const qc = useQueryClient();
  const can = useCan();
  const { campuses } = useSession();
  const { data: v, isLoading } = useQuery({ queryKey: ["vendor", id], queryFn: () => api<any>(`/vendors/${id}`) });
  const docs = useQuery({ queryKey: ["vendor-docs", id], queryFn: () => api<any[]>(`/vendors/${id}/documents`) });
  const agreements = useQuery({ queryKey: ["vendor-agreements", id], queryFn: () => api<any[]>(`/vendors/${id}/agreements`) });
  const perf = useQuery({ queryKey: ["vendor-perf", id], queryFn: () => api<any>(`/vendors/${id}/ratings`) });
  const [dialog, setDialog] = useState<"edit" | "doc" | "agreement" | "rate" | "blacklist" | null>(null);
  const refresh = () => {
    for (const k of ["vendor", "vendor-docs", "vendor-agreements", "vendor-perf"]) qc.invalidateQueries({ queryKey: [k, id] });
    qc.invalidateQueries({ queryKey: ["approvals", "vendor", id] });
  };
  const act = useAction({ success: t("ui.done"), onSuccess: refresh });
  const link = useAction<{ link: string; email: string }>({
    onSuccess: (r) => {
      navigator.clipboard?.writeText(r.link).catch(() => undefined);
      toast.success(t("facility.vendors.detail.linkEmailed", { email: r.email }));
    },
  });
  if (isLoading || !v) return <Skeleton className="h-96" />;
  const manage = can("vendor:update");
  const stepIdx = STEPS.indexOf(v.status);
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        breadcrumbs={[{ label: t("facility.vendors.title"), href: "/facility/vendors" }, { label: v.vendor_code ?? v.name }]}
        title={v.name}
        meta={
          <>
            <StatusBadge status={v.status} />
            {v.vendor_code && <span className="font-mono text-xs">{v.vendor_code}</span>}
            {v.rating_avg && (
              <span className="inline-flex items-center gap-1 text-sm">
                <Star className="size-4 fill-amber-400 text-amber-400" /> {Number(v.rating_avg).toFixed(1)} ({v.rating_count})
              </span>
            )}
          </>
        }
        actions={
          manage && (
            <>
              {["submitted", "draft", "invited"].includes(v.status) && (
                <Button size="sm" variant="outline" disabled={act.isPending} loading={isActing(act, `/vendors/${id}/start-verification`)} onClick={() => act.mutate({ path: `/vendors/${id}/start-verification` })}>
                  <FileCheck2 /> {t("facility.vendors.detail.startVerification")}
                </Button>
              )}
              {["under_verification", "submitted", "rejected"].includes(v.status) && (
                <Button size="sm" disabled={act.isPending} loading={isActing(act, `/vendors/${id}/submit-for-approval`)} onClick={() => act.mutate({ path: `/vendors/${id}/submit-for-approval` })}>
                  <Send /> {t("facility.vendors.detail.sendForApproval")}
                </Button>
              )}
              <Button size="sm" variant="outline" loading={link.isPending} onClick={() => link.mutate({ path: `/vendors/${id}/portal-link`, body: { purpose: STEPS.indexOf(v.status) < 3 ? "onboarding" : "portal" } })}>
                <Link2 /> {t("facility.vendors.detail.portalLink")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setDialog("edit")}>
                <Pencil /> {t("ui.edit")}
              </Button>
              {can("vendor:approve") &&
                (v.status === "blacklisted" ? (
                  <Button size="sm" variant="ghost" disabled={act.isPending} loading={isActing(act, `/vendors/${id}/blacklist`)} onClick={() => act.mutate({ path: `/vendors/${id}/blacklist`, body: { blacklisted: false } })}>{t("facility.vendors.detail.reinstate")}</Button>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => setDialog("blacklist")}>
                    <Ban /> {t("facility.vendors.detail.blacklist")}
                  </Button>
                ))}
            </>
          )
        }
      />
      {stepIdx >= 0 && v.status !== "approved" && (
        <ol className="mb-4 flex flex-wrap gap-1 text-xs">
          {STEPS.map((s, i) => (
            <li key={s} className={`rounded-full px-2.5 py-1 ${i < stepIdx ? "bg-accent text-accent-foreground" : i === stepIdx ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
              {t("facility.vendors.detail.step", { n: i + 1, label: t(`status.${s}`, undefined, humanize(s)) })}
            </li>
          ))}
        </ol>
      )}
      {v.status === "blacklisted" && <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{t("facility.vendors.detail.blacklistedReason", { reason: v.blacklist_reason ?? "" })}</p>}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t("facility.workOrders.title")} value={perf.data?.work_orders_total ?? "—"} hint={t("facility.vendors.detail.completedN", { n: perf.data?.work_orders_completed ?? 0 })} />
        <Stat label={t("facility.vendors.detail.onTime")} value={perf.data?.on_time_pct != null ? `${perf.data.on_time_pct}%` : "—"} />
        <Stat label={t("facility.vendors.detail.purchaseOrders")} value={perf.data?.purchase_orders_total ?? "—"} />
        <Stat label={t("facility.vendors.detail.totalSpend")} value={<Money value={perf.data?.spend ?? 0} compact />} />
      </div>
      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">{t("facility.vendors.detail.tabProfile")}</TabsTrigger>
          <TabsTrigger value="contract">{t("facility.vendors.detail.tabContract")}</TabsTrigger>
          <TabsTrigger value="documents">{t("facility.assets.detail.documents")} {docs.data?.some((d) => d.verification_status === "pending") ? "•" : ""}</TabsTrigger>
          <TabsTrigger value="agreements">{t("facility.vendors.detail.tabAgreements")}</TabsTrigger>
          <TabsTrigger value="ratings">{t("facility.vendors.detail.tabRatings")}</TabsTrigger>
          <TabsTrigger value="approval">{t("facility.vendors.detail.tabApproval")}</TabsTrigger>
          <TabsTrigger value="notes">{t("ui.notes")}</TabsTrigger>
          <TabsTrigger value="history">{t("ui.history")}</TabsTrigger>
        </TabsList>
        <TabsContent value="profile">
          <Card>
            <CardContent className="pt-4">
              <DetailGrid
                items={[
                  { label: t("facility.vendors.fields.legalName"), value: v.legal_name },
                  { label: t("ui.type"), value: v.vendor_type ? t(`enum.vendorType.${v.vendor_type}`, undefined, humanize(v.vendor_type)) : humanize(v.vendor_type) },
                  { label: t("ui.category"), value: v.category?.name },
                  { label: t("facility.vendors.fields.campusesServed"), value: v.campus_ids?.length ? v.campus_ids.map((c: string) => campuses.find((x) => x.id === c)?.name).filter(Boolean).join(", ") : t("facility.vendors.allCampuses") },
                  { label: t("facility.vendors.fields.serviceArea"), value: v.service_area },
                  { label: t("facility.vendors.contact"), value: v.contact_name },
                  { label: t("ui.email"), value: v.email },
                  { label: t("ui.phone"), value: v.phone },
                  { label: t("facility.vendors.detail.website"), value: v.website },
                  { label: t("facility.vendors.fields.address"), value: [v.address, v.city, v.state, v.pincode].filter(Boolean).join(", "), wide: true },
                  { label: t("facility.vendors.fields.gstin"), value: v.gstin && <span className="font-mono">{v.gstin}</span> },
                  { label: t("facility.vendors.fields.pan"), value: v.pan && <span className="font-mono">{v.pan}</span> },
                  { label: t("facility.vendors.detail.msme"), value: v.msme_number },
                  { label: t("facility.vendors.detail.paymentTerms"), value: v.payment_terms_days != null ? t("facility.vendors.detail.days", { n: v.payment_terms_days }) : null },
                  { label: t("facility.vendors.fields.bank"), value: v.bank_account_number ? `${v.bank_name ?? ""} · ${v.bank_account_name ?? ""} · ****${String(v.bank_account_number).slice(-4)} · ${v.bank_ifsc}` : null, wide: true },
                  { label: t("status.verified"), value: v.verified_at ? <DateTime value={v.verified_at} /> : null },
                ]}
              />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="contract">
          <Card>
            <CardContent className="pt-4">
              <DetailGrid
                items={[
                  { label: t("facility.vendors.fields.contractType"), value: v.contract_type ? t(`enum.vendorContractType.${v.contract_type}`, undefined, humanize(v.contract_type)) : null },
                  { label: t("facility.vendors.fields.contractValue"), value: v.contract_value != null ? <Money value={v.contract_value} /> : null },
                  { label: t("facility.vendors.fields.contractStart"), value: v.contract_start },
                  { label: t("facility.vendors.fields.contractEnd"), value: v.contract_end ? <DueDate value={v.contract_end} done={["inactive", "blacklisted"].includes(v.status)} /> : null },
                  { label: t("facility.vendors.fields.slaResponse"), value: v.sla_response_hours != null ? t("facility.vendors.detail.hoursN", { n: Number(v.sla_response_hours) }) : null },
                  { label: t("facility.vendors.fields.slaResolution"), value: v.sla_resolution_hours != null ? t("facility.vendors.detail.hoursN", { n: Number(v.sla_resolution_hours) }) : null },
                  { label: t("facility.vendors.fields.slaTerms"), value: v.sla_terms && <span className="whitespace-pre-wrap">{v.sla_terms}</span>, wide: true },
                  { label: t("facility.vendors.fields.penaltyTerms"), value: v.penalty_terms && <span className="whitespace-pre-wrap">{v.penalty_terms}</span>, wide: true },
                ]}
              />
              {!v.contract_type && !v.contract_end && !v.sla_response_hours && <p className="mt-2 text-sm text-muted-foreground">{t("facility.vendors.detail.noContract")}</p>}
              {manage && <Button size="sm" variant="outline" className="mt-3" onClick={() => setDialog("edit")}><Pencil /> {t("facility.vendors.detail.editContract")}</Button>}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="documents" className="flex flex-col gap-3">
          <Card className="divide-y">
            {docs.data?.length === 0 && <p className="p-4 text-sm text-muted-foreground">{t("facility.vendors.detail.noDocuments")}</p>}
            {docs.data?.map((d) => (
              <div key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{d.doc_type ? t(`enum.docType.${d.doc_type}`, undefined, humanize(d.doc_type)) : humanize(d.doc_type)}{d.title && <span className="font-normal"> · {d.title}</span>} {d.doc_number && <span className="font-mono text-xs text-muted-foreground">{d.doc_number}</span>}</p>
                  <p className="text-xs text-muted-foreground">
                    {d.attachment?.file_name ?? t("facility.vendors.detail.noFile")} {d.expires_on && <>· {t("facility.vendors.detail.expires")} <DueDate value={d.expires_on} /></>}
                  </p>
                </div>
                <StatusBadge status={d.verification_status === "pending" ? "pending" : d.verification_status === "verified" ? "approved" : "rejected"} label={d.verification_status ? t(`status.${d.verification_status}`, undefined, humanize(d.verification_status)) : humanize(d.verification_status)} />
                {d.attachment && (
                  <Button size="xs" variant="ghost" onClick={async () => window.open((await api<{ url: string }>(`/attachments/${d.attachment.id}/url`)).url, "_blank")}>{t("ui.view")}</Button>
                )}
                {manage && d.verification_status === "pending" && (
                  <div className="flex gap-1">
                    <Button size="xs" disabled={act.isPending} loading={isActing(act, `/vendors/${id}/documents/${d.id}/verify`, { verification_status: "verified" })} onClick={() => act.mutate({ path: `/vendors/${id}/documents/${d.id}/verify`, body: { verification_status: "verified" } })}><Check /> {t("facility.workOrders.detail.verify")}</Button>
                    <Button size="xs" variant="outline" disabled={act.isPending} loading={isActing(act, `/vendors/${id}/documents/${d.id}/verify`, { verification_status: "rejected" })} onClick={() => act.mutate({ path: `/vendors/${id}/documents/${d.id}/verify`, body: { verification_status: "rejected" } })}><X /> {t("ui.reject")}</Button>
                  </div>
                )}
              </div>
            ))}
          </Card>
          {manage && <Button size="sm" variant="outline" className="self-start" onClick={() => setDialog("doc")}><Plus /> {t("facility.vendors.detail.addDocRecord")}</Button>}
          <div>
            <p className="mb-2 text-sm font-medium">{t("ui.files")}</p>
            <Attachments entityType="vendor" entityId={id} kind="document" canUpload={manage} />
          </div>
        </TabsContent>
        <TabsContent value="agreements" className="flex flex-col gap-3">
          <Card className="divide-y">
            {agreements.data?.length === 0 && <p className="p-4 text-sm text-muted-foreground">{t("facility.vendors.detail.noAgreements")}</p>}
            {agreements.data?.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{a.title}</p>
                  <p className="text-xs text-muted-foreground">{a.agreement_type ? t(`enum.agreementType.${a.agreement_type}`, undefined, humanize(a.agreement_type)) : humanize(a.agreement_type)} · {a.start_date} → {a.end_date ?? t("facility.vendors.detail.openEnded")} {a.auto_renew && `· ${t("facility.vendors.detail.autoRenewsLower")}`}</p>
                </div>
                {a.value && <Money value={a.value} />}
                {a.end_date && <span className="text-xs">{t("facility.vendors.detail.ends")} <DueDate value={a.end_date} done={a.status !== "active"} /></span>}
                <StatusBadge status={a.status} />
              </div>
            ))}
          </Card>
          {manage && <Button size="sm" variant="outline" className="self-start" onClick={() => setDialog("agreement")}><Plus /> {t("facility.vendors.detail.addAgreement")}</Button>}
        </TabsContent>
        <TabsContent value="ratings" className="flex flex-col gap-3">
          {(can("vendor:rate") || manage) && <Button size="sm" variant="outline" className="self-start" onClick={() => setDialog("rate")}><Star /> {t("facility.vendors.detail.rateVendor")}</Button>}
          <Card className="divide-y">
            {perf.data?.ratings?.length === 0 && <p className="p-4 text-sm text-muted-foreground">{t("facility.vendors.detail.noRatings")}</p>}
            {perf.data?.ratings?.map((r: any) => (
              <div key={r.id} className="px-4 py-3 text-sm">
                <p>
                  <span className="text-amber-500">{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</span>{" "}
                  <span className="text-xs text-muted-foreground">{r.source_type ? t(`enum.sourceType.${r.source_type}`, undefined, humanize(r.source_type)) : humanize(r.source_type)} · {r.rater?.full_name} · <DateTime value={r.created_at} relative /></span>
                </p>
                {r.comment && <p className="mt-0.5">{r.comment}</p>}
              </div>
            ))}
          </Card>
        </TabsContent>
        <TabsContent value="approval">
          <ApprovalPanel entityType="vendor" entityId={id} onDecided={refresh} />
        </TabsContent>
        <TabsContent value="notes"><Comments entityType="vendor" entityId={id} /></TabsContent>
        <TabsContent value="history"><ActivityFeed entityType="vendor" entityId={id} /></TabsContent>
      </Tabs>

      <ResourceFormDialog open={dialog === "edit"} onOpenChange={(o) => !o && setDialog(null)} title={t("facility.vendors.detail.editTitle")} endpoint={`/vendors/${id}`} method="PATCH" fields={vendorFields(t)} defaultValues={v} onSaved={refresh} />
      <ResourceFormDialog
        open={dialog === "doc"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t("facility.vendors.detail.addDocTitle")}
        description={t("facility.vendors.detail.addDocDesc")}
        endpoint={`/vendors/${id}/documents`}
        fields={[
          { name: "doc_type", label: t("ui.type"), type: "select", required: true, options: ["gst_certificate", "pan_card", "cancelled_cheque", "msme_certificate", "incorporation", "insurance", "license", "agreement", "contract", "sla", "work_completion", "other"].map((x) => ({ value: x, label: t(`enum.docType.${x}`, undefined, humanize(x)) })) },
          { name: "title", label: t("ui.title") },
          { name: "doc_number", label: t("ui.number") },
          { name: "attachment_id", label: t("facility.vendors.detail.docFile"), type: "file", upload: { entityType: "vendor", entityId: id, kind: "document" } },
          { name: "issued_on", label: t("facility.vendors.detail.issuedOn"), type: "date" },
          { name: "expires_on", label: t("facility.vendors.detail.expiresOn"), type: "date" },
        ]}
        onSaved={refresh}
      />
      <ResourceFormDialog
        open={dialog === "agreement"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t("facility.vendors.detail.addAgreement")}
        endpoint={`/vendors/${id}/agreements`}
        fields={[
          { name: "title", label: t("ui.title"), required: true, full: true },
          { name: "agreement_type", label: t("ui.type"), type: "select", options: ["service", "supply", "nda", "rate_contract", "other"].map((x) => ({ value: x, label: t(`enum.agreementType.${x}`, undefined, humanize(x)) })) },
          { name: "value", label: t("facility.maintenance.amc.colValue"), type: "money" },
          { name: "start_date", label: t("facility.maintenance.amc.start"), type: "date", required: true },
          { name: "end_date", label: t("facility.maintenance.amc.end"), type: "date" },
          { name: "renewal_reminder_days", label: t("facility.maintenance.amc.remindBeforeEnd"), type: "number" },
          { name: "auto_renew", label: t("facility.vendors.detail.autoRenews"), type: "switch" },
          { name: "notes", label: t("ui.notes"), type: "textarea" },
        ]}
        defaultValues={{ agreement_type: "service", renewal_reminder_days: 30 }}
        onSaved={refresh}
      />
      <ResourceFormDialog
        open={dialog === "rate"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t("facility.vendors.detail.rateVendor")}
        endpoint={`/vendors/${id}/ratings`}
        fields={[
          { name: "rating", label: t("facility.vendors.detail.overall"), type: "select", required: true, options: [5, 4, 3, 2, 1].map((n) => ({ value: String(n), label: "★".repeat(n) })) },
          { name: "quality", label: t("facility.vendors.detail.quality"), type: "select", options: [5, 4, 3, 2, 1].map((n) => ({ value: String(n), label: String(n) })) },
          { name: "timeliness", label: t("facility.vendors.detail.timeliness"), type: "select", options: [5, 4, 3, 2, 1].map((n) => ({ value: String(n), label: String(n) })) },
          { name: "comment", label: t("ui.comment"), type: "textarea" },
        ]}
        transform={(b) => ({ ...b, rating: Number(b.rating), quality: b.quality ? Number(b.quality) : undefined, timeliness: b.timeliness ? Number(b.timeliness) : undefined })}
        onSaved={refresh}
      />
      <BlacklistDialog id={id} open={dialog === "blacklist"} onOpenChange={(o) => !o && setDialog(null)} onDone={refresh} />
    </div>
  );
}

function BlacklistDialog({ id, open, onOpenChange, onDone }: { id: string; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const { t } = useT();
  const [reason, setReason] = useState("");
  const act = useAction({ success: t("facility.vendors.detail.blacklistedToast"), onSuccess: () => { onDone(); onOpenChange(false); } });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("facility.vendors.detail.blacklistTitle")}</DialogTitle>
          <DialogDescription>{t("facility.vendors.detail.blacklistDesc")}</DialogDescription>
        </DialogHeader>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("facility.assets.detail.reason")} />
        <DialogFooter>
          <Button variant="destructive" disabled={reason.trim().length < 3} loading={act.isPending} onClick={() => act.mutate({ path: `/vendors/${id}/blacklist`, body: { blacklisted: true, reason } })}>
            <ShieldCheck /> {t("facility.vendors.detail.blacklist")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
