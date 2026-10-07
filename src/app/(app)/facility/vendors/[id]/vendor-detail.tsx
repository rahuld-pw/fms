"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Ban, Check, FileCheck2, Link2, Pencil, Plus, Send, ShieldCheck, Star, X } from "lucide-react";
import { toast } from "sonner";
import { useCan } from "@/components/app/session";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ActivityFeed, ApprovalPanel, Attachments, Comments } from "@/components/shared/collaboration";
import { DateTime, DueDate, Money } from "@/components/shared/format";
import { DetailGrid, PageHeader, Stat } from "@/components/shared/page-header";
import { ResourceFormDialog, useAction } from "@/components/shared/resource-form";
import { StatusBadge } from "@/components/shared/status";
import { api } from "@/lib/client/api";
import { humanize } from "@/lib/utils/format";
import { vendorFields } from "../vendor-fields";

/* eslint-disable @typescript-eslint/no-explicit-any */
const STEPS = ["invited", "draft", "submitted", "under_verification", "pending_approval", "approved"];

export function VendorDetail({ id }: { id: string }) {
  const qc = useQueryClient();
  const can = useCan();
  const { data: v, isLoading } = useQuery({ queryKey: ["vendor", id], queryFn: () => api<any>(`/vendors/${id}`) });
  const docs = useQuery({ queryKey: ["vendor-docs", id], queryFn: () => api<any[]>(`/vendors/${id}/documents`) });
  const agreements = useQuery({ queryKey: ["vendor-agreements", id], queryFn: () => api<any[]>(`/vendors/${id}/agreements`) });
  const perf = useQuery({ queryKey: ["vendor-perf", id], queryFn: () => api<any>(`/vendors/${id}/ratings`) });
  const [dialog, setDialog] = useState<"edit" | "doc" | "agreement" | "rate" | "blacklist" | null>(null);
  const refresh = () => {
    for (const k of ["vendor", "vendor-docs", "vendor-agreements", "vendor-perf"]) qc.invalidateQueries({ queryKey: [k, id] });
    qc.invalidateQueries({ queryKey: ["approvals", "vendor", id] });
  };
  const act = useAction({ success: "Done", onSuccess: refresh });
  const link = useAction<{ link: string; email: string }>({
    onSuccess: (r) => {
      navigator.clipboard?.writeText(r.link).catch(() => undefined);
      toast.success(`Link emailed to ${r.email} (also copied to clipboard)`);
    },
  });
  if (isLoading || !v) return <Skeleton className="h-96" />;
  const manage = can("vendor:update");
  const stepIdx = STEPS.indexOf(v.status);
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        breadcrumbs={[{ label: "Vendors", href: "/facility/vendors" }, { label: v.vendor_code ?? v.name }]}
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
                <Button size="sm" variant="outline" onClick={() => act.mutate({ path: `/vendors/${id}/start-verification` })}>
                  <FileCheck2 /> Start verification
                </Button>
              )}
              {["under_verification", "submitted", "rejected"].includes(v.status) && (
                <Button size="sm" onClick={() => act.mutate({ path: `/vendors/${id}/submit-for-approval` })}>
                  <Send /> Send for approval
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => link.mutate({ path: `/vendors/${id}/portal-link`, body: { purpose: STEPS.indexOf(v.status) < 3 ? "onboarding" : "portal" } })}>
                <Link2 /> Portal link
              </Button>
              <Button size="sm" variant="outline" onClick={() => setDialog("edit")}>
                <Pencil /> Edit
              </Button>
              {can("vendor:approve") &&
                (v.status === "blacklisted" ? (
                  <Button size="sm" variant="ghost" onClick={() => act.mutate({ path: `/vendors/${id}/blacklist`, body: { blacklisted: false } })}>Reinstate</Button>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => setDialog("blacklist")}>
                    <Ban /> Blacklist
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
              {i + 1}. {humanize(s)}
            </li>
          ))}
        </ol>
      )}
      {v.status === "blacklisted" && <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">Blacklisted: {v.blacklist_reason}</p>}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Work orders" value={perf.data?.work_orders_total ?? "—"} hint={`${perf.data?.work_orders_completed ?? 0} completed`} />
        <Stat label="On-time completion" value={perf.data?.on_time_pct != null ? `${perf.data.on_time_pct}%` : "—"} />
        <Stat label="Purchase orders" value={perf.data?.purchase_orders_total ?? "—"} />
        <Stat label="Total spend" value={<Money value={perf.data?.spend ?? 0} compact />} />
      </div>
      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="documents">Documents {docs.data?.some((d) => d.verification_status === "pending") ? "•" : ""}</TabsTrigger>
          <TabsTrigger value="agreements">Agreements</TabsTrigger>
          <TabsTrigger value="ratings">Ratings</TabsTrigger>
          <TabsTrigger value="approval">Approval</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>
        <TabsContent value="profile">
          <Card>
            <CardContent className="pt-4">
              <DetailGrid
                items={[
                  { label: "Legal name", value: v.legal_name },
                  { label: "Type", value: humanize(v.vendor_type) },
                  { label: "Contact", value: v.contact_name },
                  { label: "Email", value: v.email },
                  { label: "Phone", value: v.phone },
                  { label: "Website", value: v.website },
                  { label: "Address", value: [v.address, v.city, v.state, v.pincode].filter(Boolean).join(", "), wide: true },
                  { label: "GSTIN", value: v.gstin && <span className="font-mono">{v.gstin}</span> },
                  { label: "PAN", value: v.pan && <span className="font-mono">{v.pan}</span> },
                  { label: "MSME", value: v.msme_number },
                  { label: "Payment terms", value: v.payment_terms_days != null ? `${v.payment_terms_days} days` : null },
                  { label: "Bank", value: v.bank_account_number ? `${v.bank_name ?? ""} · ${v.bank_account_name ?? ""} · ****${String(v.bank_account_number).slice(-4)} · ${v.bank_ifsc}` : null, wide: true },
                  { label: "Verified", value: v.verified_at ? <DateTime value={v.verified_at} /> : null },
                ]}
              />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="documents" className="flex flex-col gap-3">
          <Card className="divide-y">
            {docs.data?.length === 0 && <p className="p-4 text-sm text-muted-foreground">No documents yet.</p>}
            {docs.data?.map((d) => (
              <div key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{humanize(d.doc_type)} {d.doc_number && <span className="font-mono text-xs text-muted-foreground">{d.doc_number}</span>}</p>
                  <p className="text-xs text-muted-foreground">
                    {d.attachment?.file_name ?? "No file"} {d.expires_on && <>· expires <DueDate value={d.expires_on} /></>}
                  </p>
                </div>
                <StatusBadge status={d.verification_status === "pending" ? "pending" : d.verification_status === "verified" ? "approved" : "rejected"} label={humanize(d.verification_status)} />
                {d.attachment && (
                  <Button size="xs" variant="ghost" onClick={async () => window.open((await api<{ url: string }>(`/attachments/${d.attachment.id}/url`)).url, "_blank")}>View</Button>
                )}
                {manage && d.verification_status === "pending" && (
                  <div className="flex gap-1">
                    <Button size="xs" onClick={() => act.mutate({ path: `/vendors/${id}/documents/${d.id}/verify`, body: { verification_status: "verified" } })}><Check /> Verify</Button>
                    <Button size="xs" variant="outline" onClick={() => act.mutate({ path: `/vendors/${id}/documents/${d.id}/verify`, body: { verification_status: "rejected" } })}><X /> Reject</Button>
                  </div>
                )}
              </div>
            ))}
          </Card>
          {manage && <Button size="sm" variant="outline" className="self-start" onClick={() => setDialog("doc")}><Plus /> Add document record</Button>}
          <div>
            <p className="mb-2 text-sm font-medium">Files</p>
            <Attachments entityType="vendor" entityId={id} kind="document" canUpload={manage} />
          </div>
        </TabsContent>
        <TabsContent value="agreements" className="flex flex-col gap-3">
          <Card className="divide-y">
            {agreements.data?.length === 0 && <p className="p-4 text-sm text-muted-foreground">No agreements.</p>}
            {agreements.data?.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{a.title}</p>
                  <p className="text-xs text-muted-foreground">{humanize(a.agreement_type)} · {a.start_date} → {a.end_date ?? "open"} {a.auto_renew && "· auto-renews"}</p>
                </div>
                {a.value && <Money value={a.value} />}
                {a.end_date && <span className="text-xs">ends <DueDate value={a.end_date} done={a.status !== "active"} /></span>}
                <StatusBadge status={a.status} />
              </div>
            ))}
          </Card>
          {manage && <Button size="sm" variant="outline" className="self-start" onClick={() => setDialog("agreement")}><Plus /> Add agreement</Button>}
        </TabsContent>
        <TabsContent value="ratings" className="flex flex-col gap-3">
          {(can("vendor:rate") || manage) && <Button size="sm" variant="outline" className="self-start" onClick={() => setDialog("rate")}><Star /> Rate vendor</Button>}
          <Card className="divide-y">
            {perf.data?.ratings?.length === 0 && <p className="p-4 text-sm text-muted-foreground">No ratings yet.</p>}
            {perf.data?.ratings?.map((r: any) => (
              <div key={r.id} className="px-4 py-3 text-sm">
                <p>
                  <span className="text-amber-500">{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</span>{" "}
                  <span className="text-xs text-muted-foreground">{humanize(r.source_type)} · {r.rater?.full_name} · <DateTime value={r.created_at} relative /></span>
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

      <ResourceFormDialog open={dialog === "edit"} onOpenChange={(o) => !o && setDialog(null)} title="Edit vendor" endpoint={`/vendors/${id}`} method="PATCH" fields={vendorFields} defaultValues={v} onSaved={refresh} />
      <ResourceFormDialog
        open={dialog === "doc"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Add document"
        description="Upload the file in the Files section, then record it here."
        endpoint={`/vendors/${id}/documents`}
        fields={[
          { name: "doc_type", label: "Type", type: "select", required: true, options: ["gst_certificate", "pan_card", "cancelled_cheque", "msme_certificate", "incorporation", "insurance", "license", "agreement", "other"].map((x) => ({ value: x, label: humanize(x) })) },
          { name: "doc_number", label: "Number" },
          { name: "issued_on", label: "Issued on", type: "date" },
          { name: "expires_on", label: "Expires on", type: "date" },
        ]}
        onSaved={refresh}
      />
      <ResourceFormDialog
        open={dialog === "agreement"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Add agreement"
        endpoint={`/vendors/${id}/agreements`}
        fields={[
          { name: "title", label: "Title", required: true, full: true },
          { name: "agreement_type", label: "Type", type: "select", options: ["service", "supply", "nda", "rate_contract", "other"].map((x) => ({ value: x, label: humanize(x) })) },
          { name: "value", label: "Value", type: "money" },
          { name: "start_date", label: "Start", type: "date", required: true },
          { name: "end_date", label: "End", type: "date" },
          { name: "renewal_reminder_days", label: "Remind N days before end", type: "number" },
          { name: "auto_renew", label: "Auto-renews", type: "switch" },
          { name: "notes", label: "Notes", type: "textarea" },
        ]}
        defaultValues={{ agreement_type: "service", renewal_reminder_days: 30 }}
        onSaved={refresh}
      />
      <ResourceFormDialog
        open={dialog === "rate"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Rate vendor"
        endpoint={`/vendors/${id}/ratings`}
        fields={[
          { name: "rating", label: "Overall (1-5)", type: "select", required: true, options: [5, 4, 3, 2, 1].map((n) => ({ value: String(n), label: "★".repeat(n) })) },
          { name: "quality", label: "Quality", type: "select", options: [5, 4, 3, 2, 1].map((n) => ({ value: String(n), label: String(n) })) },
          { name: "timeliness", label: "Timeliness", type: "select", options: [5, 4, 3, 2, 1].map((n) => ({ value: String(n), label: String(n) })) },
          { name: "comment", label: "Comment", type: "textarea" },
        ]}
        transform={(b) => ({ ...b, rating: Number(b.rating), quality: b.quality ? Number(b.quality) : undefined, timeliness: b.timeliness ? Number(b.timeliness) : undefined })}
        onSaved={refresh}
      />
      <BlacklistDialog id={id} open={dialog === "blacklist"} onOpenChange={(o) => !o && setDialog(null)} onDone={refresh} />
    </div>
  );
}

function BlacklistDialog({ id, open, onOpenChange, onDone }: { id: string; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const act = useAction({ success: "Vendor blacklisted", onSuccess: () => { onDone(); onOpenChange(false); } });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Blacklist vendor</DialogTitle>
          <DialogDescription>Blacklisted vendors cannot receive POs, RFQs or work orders, and lose portal access.</DialogDescription>
        </DialogHeader>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" />
        <DialogFooter>
          <Button variant="destructive" disabled={reason.trim().length < 3} loading={act.isPending} onClick={() => act.mutate({ path: `/vendors/${id}/blacklist`, body: { blacklisted: true, reason } })}>
            <ShieldCheck /> Blacklist
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
