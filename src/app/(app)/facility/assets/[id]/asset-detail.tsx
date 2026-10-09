"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { ArrowLeftRight, ClipboardList, FileText, HeartPulse, Pencil, Plus, Printer, ShieldCheck, Trash2, Wrench } from "lucide-react";
import { useCan, useSession } from "@/components/app/session";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ActivityFeed, Attachments, Comments } from "@/components/shared/collaboration";
import { DateTime, DueDate, Money } from "@/components/shared/format";
import { CampusSelect, DepartmentSelect, Field, ResourcePicker, UserChip, UserPicker } from "@/components/shared/fields";
import { FileField } from "@/components/shared/file-field";
import { LocationCascade } from "@/components/shared/location-cascade";
import { DetailGrid, PageHeader } from "@/components/shared/page-header";
import { isActing, ResourceFormDialog, useAction, type FieldSpec } from "@/components/shared/resource-form";
import { StatusBadge } from "@/components/shared/status";
import { api, apiList } from "@/lib/client/api";
import { useT } from "@/lib/i18n/client";
import type { TFunction } from "@/lib/i18n/translate";
import { humanize } from "@/lib/utils/format";
import { amcFields } from "../../maintenance/maintenance-tabs";
import { assetFields } from "../assets-table";
import { printLabels } from "../labels";

/* eslint-disable @typescript-eslint/no-explicit-any */
export function AssetDetail({ id }: { id: string }) {
  const { t } = useT();
  const qc = useQueryClient();
  const can = useCan();
  const { user } = useSession();
  const { data: a, isLoading } = useQuery({ queryKey: ["asset", id], queryFn: () => api<Record<string, any>>(`/assets/${id}`) });
  const dep = useQuery({ queryKey: ["asset-dep", id], queryFn: () => api<any>(`/assets/${id}/depreciation`) });
  const transfers = useQuery({ queryKey: ["asset-transfers", id], queryFn: () => apiList<any>(`/asset-transfers?asset_id=${id}`) });
  const wos = useQuery({ queryKey: ["asset-wos", id], queryFn: () => apiList<any>(`/work-orders?asset_id=${id}&limit=20`) });
  const [edit, setEdit] = useState(false);
  const [transfer, setTransfer] = useState(false);
  const [dispose, setDispose] = useState(false);
  const [dialog, setDialog] = useState<"condition" | "amc" | "warranty" | null>(null);
  const warranties = useQuery({ queryKey: ["asset-warranties", id], queryFn: () => api<any[]>(`/assets/${id}/warranties`) });
  const conditions = useQuery({ queryKey: ["asset-conditions", id], queryFn: () => api<any[]>(`/assets/${id}/conditions`) });
  const refresh = () => {
    for (const k of [["asset", id], ["asset-transfers", id], ["asset-dep", id], ["activity", "asset", id], ["asset-warranties", id], ["asset-conditions", id]]) qc.invalidateQueries({ queryKey: k });
  };
  if (isLoading || !a) return <Skeleton className="h-96" />;
  const scope = { campusId: a.campus_id, departmentId: a.department_id };
  const canUpdate = can("asset:update", scope, "auto");
  const canCondition = canUpdate || a.custodian_id === user.id;
  const today = new Date().toISOString().slice(0, 10);
  const coveredUntil = [a.warranty_until, ...(warranties.data ?? []).map((w) => w.end_date)].filter(Boolean).sort().pop() ?? null;
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        breadcrumbs={[{ label: t("facility.assets.title"), href: "/facility/assets" }, { label: a.asset_tag }]}
        title={a.name}
        meta={
          <>
            <span className="font-mono text-sm">{a.asset_tag}</span>
            <StatusBadge status={a.status} />
            {a.condition && <span className="text-xs text-muted-foreground">{t("facility.assets.detail.condition", { value: t(`enum.assetCondition.${a.condition}`, undefined, humanize(a.condition)) })}</span>}
          </>
        }
        actions={
          <>
            <Button size="sm" variant="outline" asChild>
              <Link href={`/facility/issues/new?asset=${a.id}&location=${a.location_id ?? ""}&campus=${a.campus_id}`}>
                <ClipboardList /> {t("facility.issues.report")}
              </Link>
            </Button>
            {canCondition && a.status !== "disposed" && (
              <Button size="sm" variant="outline" onClick={() => setDialog("condition")}>
                <HeartPulse /> {t("facility.assets.cond.update")}
              </Button>
            )}
            {canUpdate && (
              <Button size="sm" variant="outline" onClick={() => setEdit(true)}>
                <Pencil /> {t("ui.edit")}
              </Button>
            )}
            {can("asset:transfer", scope, "auto") && a.status !== "disposed" && (
              <Button size="sm" variant="outline" onClick={() => setTransfer(true)}>
                <ArrowLeftRight /> {t("facility.assets.detail.transfer")}
              </Button>
            )}
            {can("asset:delete", scope, "auto") && a.status !== "disposed" && (
              <Button size="sm" variant="ghost" onClick={() => setDispose(true)}>
                <Trash2 /> {t("facility.assets.detail.dispose")}
              </Button>
            )}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardContent className="pt-4">
              <DetailGrid
                items={[
                  { label: t("ui.category"), value: [a.category?.name, a.subcategory?.name].filter(Boolean).join(" › ") || null },
                  { label: t("ui.location"), value: [a.campus?.name, ...(a.location ? [...a.location.path_names, a.location.name] : [])].join(" › "), wide: true },
                  { label: t("facility.assets.custodian"), value: <UserChip name={a.custodian?.full_name} /> },
                  { label: t("facility.assets.colMakeModel"), value: [a.make, a.model].filter(Boolean).join(" ") || null },
                  { label: t("facility.assets.serialNumber"), value: a.serial_number },
                  { label: t("facility.assets.purchaseDate"), value: a.purchase_date },
                  { label: t("facility.assets.purchaseCost"), value: a.purchase_cost ? <Money value={a.purchase_cost} /> : null },
                  { label: t("ui.vendor"), value: a.vendor ? <Link className="text-primary hover:underline" href={`/facility/vendors/${a.vendor.id}`}>{a.vendor.name}</Link> : null },
                  { label: t("facility.assets.detail.purchaseOrder"), value: a.purchase_order ? <Link className="text-primary hover:underline" href={`/po/orders/${a.purchase_order.id}`}>{a.purchase_order.number}</Link> : null },
                  { label: t("facility.assets.detail.grn"), value: a.grn?.number },
                  { label: t("facility.assets.installedOn"), value: a.installed_on },
                  { label: t("facility.assets.warranty"), value: a.warranty_until ? <span>{a.warranty_start ? `${a.warranty_start} → ` : ""}<DueDate value={a.warranty_until} done={a.status === "disposed"} /></span> : null },
                  { label: t("facility.assets.coveredUntil"), value: coveredUntil && coveredUntil !== a.warranty_until ? <DueDate value={coveredUntil} done={a.status === "disposed"} /> : null },
                  {
                    label: t("facility.assets.detail.amc"),
                    value: (
                      <span className="inline-flex flex-wrap items-center gap-2">
                        {a.amc ? <Link className="text-primary hover:underline" href={`/facility/maintenance?tab=amc`}>{t("facility.assets.detail.amcValue", { title: a.amc.title, date: a.amc.end_date })}</Link> : <span className="text-muted-foreground">—</span>}
                        {canUpdate && a.status !== "disposed" && <Button size="xs" variant="outline" onClick={() => setDialog("amc")}>{a.amc ? t("ui.edit") : t("facility.assets.amc.add")}</Button>}
                      </span>
                    ),
                  },
                  { label: t("facility.assets.detail.usageMeter"), value: a.usage_unit ? `${Number(a.usage_meter).toLocaleString("en-IN")} ${a.usage_unit}` : null },
                  { label: t("facility.assets.detail.lastVerified"), value: <DateTime value={a.last_verified_at} dateOnly /> },
                  ...(a.status === "disposed"
                    ? [{ label: t("status.disposed"), value: `${a.disposed_at} · ${a.disposal_method ? t(`enum.disposalMethod.${a.disposal_method}`, undefined, humanize(a.disposal_method)) : humanize(a.disposal_method)} · ${a.disposal_reason ?? ""}`, wide: true }]
                    : []),
                ]}
              />
            </CardContent>
          </Card>
          <Tabs defaultValue="depreciation">
            <TabsList>
              <TabsTrigger value="depreciation">{t("facility.assets.detail.depreciation")}</TabsTrigger>
              <TabsTrigger value="warranty">{t("facility.assets.warranties")}</TabsTrigger>
              <TabsTrigger value="condition">{t("facility.assets.condition")}</TabsTrigger>
              <TabsTrigger value="maintenance">{t("facility.maintenance.title")}</TabsTrigger>
              <TabsTrigger value="transfers">{t("facility.assets.detail.transfers")}</TabsTrigger>
              <TabsTrigger value="files">{t("facility.assets.detail.documents")}</TabsTrigger>
              <TabsTrigger value="comments">{t("ui.notes")}</TabsTrigger>
              <TabsTrigger value="history">{t("ui.history")}</TabsTrigger>
            </TabsList>
            <TabsContent value="depreciation">
              {dep.data?.rows?.length ? (
                <Card>
                  <CardHeader>
                    <CardTitle>
                      {dep.data.method === "slm" ? t("facility.assets.detail.slm") : dep.data.method === "wdv" ? t("facility.assets.detail.wdv") : t("facility.assets.detail.noDepreciation")}
                    </CardTitle>
                    <span className="text-sm">
                      {t("facility.assets.detail.bookValue")} <Money value={dep.data.current_value} className="font-semibold" />
                    </span>
                  </CardHeader>
                  <Table>
                    <THead>
                      <TR>
                        <TH>{t("facility.assets.detail.year")}</TH>
                        <TH>{t("facility.assets.detail.periodEnd")}</TH>
                        <TH className="text-right">{t("facility.assets.detail.opening")}</TH>
                        <TH className="text-right">{t("facility.assets.detail.depreciation")}</TH>
                        <TH className="text-right">{t("facility.assets.detail.closing")}</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {dep.data.rows.map((r: any) => (
                        <TR key={r.year}>
                          <TD>{r.year}</TD>
                          <TD>{r.period_end}</TD>
                          <TD className="text-right"><Money value={r.opening} /></TD>
                          <TD className="text-right"><Money value={r.depreciation} /></TD>
                          <TD className="text-right"><Money value={r.closing} /></TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </Card>
              ) : (
                <p className="text-sm text-muted-foreground">{t("facility.assets.detail.noDepHint")}</p>
              )}
            </TabsContent>
            <TabsContent value="warranty" className="flex flex-col gap-3">
              <WarrantyList asset={a} rows={warranties.data ?? []} today={today} canEdit={canUpdate} onDone={refresh} />
              {canUpdate && <Button size="sm" variant="outline" className="self-start" onClick={() => setDialog("warranty")}><Plus /> {t("facility.assets.warrantyAdd")}</Button>}
            </TabsContent>
            <TabsContent value="condition" className="flex flex-col gap-3">
              <ConditionList rows={conditions.data ?? []} />
              {canCondition && a.status !== "disposed" && <Button size="sm" variant="outline" className="self-start" onClick={() => setDialog("condition")}><HeartPulse /> {t("facility.assets.cond.update")}</Button>}
            </TabsContent>
            <TabsContent value="maintenance">
              <Card className="divide-y">
                {wos.data?.data.length === 0 && <p className="p-4 text-sm text-muted-foreground">{t("facility.assets.detail.noWorkOrders")}</p>}
                {wos.data?.data.map((w: any) => (
                  <Link key={w.id} href={`/facility/work-orders/${w.id}`} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted/40">
                    <Wrench className="size-4 text-muted-foreground" />
                    <span className="font-mono text-xs text-muted-foreground">{w.number}</span>
                    <span className="min-w-0 flex-1 truncate">{w.title}</span>
                    <StatusBadge status={w.status} />
                  </Link>
                ))}
              </Card>
            </TabsContent>
            <TabsContent value="transfers">
              <TransfersList rows={transfers.data?.data ?? []} onDone={refresh} />
            </TabsContent>
            <TabsContent value="files">
              <Attachments entityType="asset" entityId={id} kind="document" canUpload={can("asset:update", scope, "auto")} />
            </TabsContent>
            <TabsContent value="comments">
              <Comments entityType="asset" entityId={id} />
            </TabsContent>
            <TabsContent value="history">
              <ActivityFeed entityType="asset" entityId={id} />
            </TabsContent>
          </Tabs>
        </div>
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>{t("facility.assets.detail.qrTag")}</CardTitle>
            <Button size="xs" variant="outline" onClick={() => printLabels("asset", [id])}>
              <Printer /> {t("ui.print")}
            </Button>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/v1/qr/${a.qr_token}/svg`} alt={t("facility.assets.detail.qrAlt", { tag: a.asset_tag })} className="size-48 rounded border bg-white p-2" />
            <p className="text-center text-xs text-muted-foreground">{t("facility.assets.detail.qrHint")}</p>
          </CardContent>
        </Card>
      </div>
      <ResourceFormDialog
        open={edit}
        onOpenChange={setEdit}
        title={t("facility.assets.detail.editTitle")}
        endpoint={`/assets/${id}`}
        method="PATCH"
        fields={assetFields(t)}
        defaultValues={a}
        onSaved={refresh}
      />
      <TransferDialog asset={a} open={transfer} onOpenChange={setTransfer} onDone={refresh} />
      <ConditionDialog asset={a} open={dialog === "condition"} onOpenChange={(o) => !o && setDialog(null)} onDone={refresh} />
      <AmcDialog asset={a} open={dialog === "amc"} onOpenChange={(o) => !o && setDialog(null)} onDone={refresh} />
      <ResourceFormDialog
        open={dialog === "warranty"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t("facility.assets.warrantyAdd")}
        description={t("facility.assets.warrantyAddDesc")}
        endpoint={`/assets/${id}/warranties`}
        fields={warrantyFields(t, id)}
        defaultValues={{ warranty_type: "extended", start_date: a.warranty_until ?? undefined }}
        onSaved={refresh}
      />
      <DisposeDialog id={id} open={dispose} onOpenChange={setDispose} onDone={refresh} />
    </div>
  );
}

function TransfersList({ rows, onDone }: { rows: any[]; onDone: () => void }) {
  const { t } = useT();
  const can = useCan();
  const decide = useAction({ success: t("facility.assets.detail.transferUpdated"), onSuccess: onDone });
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{t("facility.assets.detail.noTransfers")}</p>;
  return (
    <Card className="divide-y">
      {rows.map((tr) => (
        <div key={tr.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
          <div className="min-w-0 flex-1">
            <p>
              {[tr.from_campus?.name, ...(tr.from_location ? [...tr.from_location.path_names, tr.from_location.name] : [])].join(" › ")}
              {" → "}
              {[tr.to_campus?.name, ...(tr.to_location ? [...tr.to_location.path_names, tr.to_location.name] : [])].join(" › ")}
              {tr.to_custodian?.full_name && <> · {t("facility.assets.detail.toCustodian", { name: tr.to_custodian.full_name })}</>}
            </p>
            <p className="text-xs text-muted-foreground">
              {[tr.reason, tr.requester?.full_name && t("facility.assets.transfer.requestedBy", { name: tr.requester.full_name }), tr.decider?.full_name && t("facility.assets.transfer.decidedBy", { name: tr.decider.full_name })].filter(Boolean).join(" · ")} · <DateTime value={tr.created_at} relative />
            </p>
          </div>
          <StatusBadge status={tr.status} />
          {tr.status === "pending" && can("asset:transfer", { campusId: tr.to_campus_id }, "auto") && (
            <div className="flex gap-1">
              <Button size="xs" disabled={decide.isPending} loading={isActing(decide, `/asset-transfers/${tr.id}/decide`, { status: "completed" })} onClick={() => decide.mutate({ path: `/asset-transfers/${tr.id}/decide`, body: { status: "completed" } })}>{t("facility.assets.detail.receive")}</Button>
              <Button size="xs" variant="outline" disabled={decide.isPending} loading={isActing(decide, `/asset-transfers/${tr.id}/decide`, { status: "rejected" })} onClick={() => decide.mutate({ path: `/asset-transfers/${tr.id}/decide`, body: { status: "rejected" } })}>{t("ui.reject")}</Button>
            </div>
          )}
        </div>
      ))}
    </Card>
  );
}

function TransferDialog({ asset, open, onOpenChange, onDone }: { asset: any; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [campus, setCampus] = useState<string | null>(asset.campus_id);
  const [location, setLocation] = useState<string | null>(null);
  const [department, setDepartment] = useState<string | null>(null);
  const [custodian, setCustodian] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const { t } = useT();
  const act = useAction({ success: t("facility.assets.detail.transferRequested"), onSuccess: () => { onDone(); onOpenChange(false); } });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("facility.assets.detail.transferTitle")}</DialogTitle>
          <DialogDescription>{t("facility.assets.detail.transferDesc")}</DialogDescription>
        </DialogHeader>
        <Field label={t("facility.assets.detail.toCampus")}><CampusSelect value={campus} onChange={setCampus} /></Field>
        <Field label={t("facility.assets.detail.toLocation")}><LocationCascade campusId={campus} value={location} onChange={setLocation} /></Field>
        <Field label={t("ui.department")}><DepartmentSelect value={department} onChange={setDepartment} campusId={campus ?? undefined} /></Field>
        <Field label={t("facility.assets.detail.newCustodian")}><UserPicker value={custodian} onChange={(v) => setCustodian(v as string | null)} /></Field>
        <Field label={t("facility.assets.detail.reason")}><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("ui.cancel")}</Button>
          <Button loading={act.isPending} onClick={() => act.mutate({ path: "/asset-transfers", body: { asset_id: asset.id, to_campus_id: campus, to_location_id: location, to_department_id: department, to_custodian_id: custodian, reason: reason || null } })}>
            {t("facility.assets.detail.requestTransfer")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DisposeDialog({ id, open, onOpenChange, onDone }: { id: string; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [method, setMethod] = useState("scrapped");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const { t } = useT();
  const act = useAction({ success: t("facility.assets.detail.disposed"), onSuccess: () => { onDone(); onOpenChange(false); } });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("facility.assets.detail.disposeTitle")}</DialogTitle>
          <DialogDescription>{t("facility.assets.detail.disposeDesc")}</DialogDescription>
        </DialogHeader>
        <Field label={t("facility.assets.detail.method")}>
          <NativeSelect value={method} onChange={(e) => setMethod(e.target.value)}>
            {["sold", "scrapped", "donated", "written_off", "returned"].map((m) => <option key={m} value={m}>{t(`enum.disposalMethod.${m}`, undefined, humanize(m))}</option>)}
          </NativeSelect>
        </Field>
        <Field label={t("facility.assets.detail.disposalValue")}><Input type="number" value={value} onChange={(e) => setValue(e.target.value)} /></Field>
        <Field label={t("facility.assets.detail.reason")} required><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("ui.cancel")}</Button>
          <Button variant="destructive" disabled={reason.trim().length < 3} loading={act.isPending} onClick={() => act.mutate({ path: `/assets/${id}/dispose`, body: { disposal_method: method, disposal_value: value ? Number(value) : null, disposal_reason: reason } })}>
            {t("facility.assets.detail.dispose")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const CONDITIONS = ["new", "good", "fair", "poor", "damaged"];
const WARRANTY_TYPES = ["extended", "additional", "manufacturer", "insurance", "other"];

const warrantyFields = (t: TFunction, assetId: string): FieldSpec[] => [
  { name: "warranty_type", label: t("ui.type"), type: "select", required: true, options: WARRANTY_TYPES.map((w) => ({ value: w, label: t(`enum.warrantyType.${w}`, undefined, humanize(w)) })) },
  { name: "provider", label: t("facility.assets.warrantyProvider"), placeholder: t("facility.assets.warrantyProviderHint") },
  { name: "vendor_id", label: t("facility.assets.warrantyBoughtFrom"), type: "resource", endpoint: "/vendors" },
  { name: "reference_number", label: t("facility.assets.warrantyRef") },
  { name: "start_date", label: t("facility.maintenance.amc.start"), type: "date", required: true },
  { name: "end_date", label: t("facility.maintenance.amc.end"), type: "date", required: true },
  { name: "cost", label: t("ui.cost"), type: "money" },
  { name: "attachment_id", label: t("facility.assets.warrantyDoc"), type: "file", upload: { entityType: "asset", entityId: assetId, kind: "warranty" } },
  { name: "coverage", label: t("facility.maintenance.amc.coverage"), type: "textarea" },
];

async function openAttachment(id: string) {
  window.open((await api<{ url: string }>(`/attachments/${id}/url`)).url, "_blank", "noopener");
}

function WarrantyList({ asset, rows, today, canEdit, onDone }: { asset: any; rows: any[]; today: string; canEdit: boolean; onDone: () => void }) {
  const { t } = useT();
  const remove = useAction({ success: t("ui.done"), onSuccess: onDone });
  const base = asset.warranty_until
    ? [{ id: "base", warranty_type: "manufacturer", provider: asset.make ?? asset.vendor?.name, start_date: asset.warranty_start ?? asset.purchase_date, end_date: asset.warranty_until, base: true }]
    : [];
  const all = [...base, ...rows];
  if (all.length === 0) return <p className="text-sm text-muted-foreground">{t("facility.assets.noWarranty")}</p>;
  return (
    <Card className="divide-y">
      {all.map((w) => (
        <div key={w.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
          <ShieldCheck className={w.end_date >= today ? "size-4 text-emerald-600" : "size-4 text-muted-foreground"} />
          <div className="min-w-0 flex-1">
            <p className="font-medium">
              {w.base ? t("facility.assets.baseWarranty") : t(`enum.warrantyType.${w.warranty_type}`, undefined, humanize(w.warranty_type))}
              {w.provider && <span className="font-normal text-muted-foreground"> · {w.provider}</span>}
              {w.reference_number && <span className="font-mono text-xs text-muted-foreground"> · {w.reference_number}</span>}
            </p>
            <p className="text-xs text-muted-foreground">
              {w.start_date ?? "—"} → <DueDate value={w.end_date} done={asset.status === "disposed"} />
              {w.vendor?.name && <> · {w.vendor.name}</>}
              {w.cost != null && <> · <Money value={w.cost} /></>}
            </p>
            {w.coverage && <p className="mt-0.5 text-xs">{w.coverage}</p>}
          </div>
          {w.attachment && (
            <Button size="xs" variant="ghost" onClick={() => openAttachment(w.attachment.id)}><FileText /> {t("ui.view")}</Button>
          )}
          {canEdit && !w.base && (
            <Button size="xs" variant="ghost" aria-label={t("ui.remove")} loading={isActing(remove, `/assets/${asset.id}/warranties/${w.id}`)} disabled={remove.isPending} onClick={() => remove.mutate({ path: `/assets/${asset.id}/warranties/${w.id}`, method: "DELETE" })}>
              <Trash2 />
            </Button>
          )}
        </div>
      ))}
    </Card>
  );
}

function ConditionList({ rows }: { rows: any[] }) {
  const { t } = useT();
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{t("facility.assets.cond.none")}</p>;
  return (
    <Card className="divide-y">
      {rows.map((r) => (
        <div key={r.id} className="flex flex-wrap items-start gap-3 px-4 py-3 text-sm">
          <div className="min-w-0 flex-1">
            <p className="font-medium">
              {r.previous_condition && r.previous_condition !== r.condition && <span className="text-muted-foreground line-through">{t(`enum.assetCondition.${r.previous_condition}`, undefined, humanize(r.previous_condition))}</span>}
              {r.previous_condition && r.previous_condition !== r.condition && " → "}
              {t(`enum.assetCondition.${r.condition}`, undefined, humanize(r.condition))}
            </p>
            {r.notes && <p className="whitespace-pre-wrap">{r.notes}</p>}
            <p className="text-xs text-muted-foreground">{r.recorder?.full_name} · <DateTime value={r.recorded_at} /></p>
          </div>
          {r.attachment && <Button size="xs" variant="ghost" onClick={() => openAttachment(r.attachment.id)}><FileText /> {t("ui.view")}</Button>}
        </div>
      ))}
    </Card>
  );
}

function ConditionDialog({ asset, open, onOpenChange, onDone }: { asset: any; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const { t } = useT();
  const [condition, setCondition] = useState<string>(asset.condition ?? "good");
  const [notes, setNotes] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const act = useAction({
    success: t("facility.assets.cond.saved"),
    onSuccess: () => { setNotes(""); setPhoto(null); onDone(); onOpenChange(false); },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("facility.assets.cond.update")}</DialogTitle>
          <DialogDescription>{t("facility.assets.cond.desc")}</DialogDescription>
        </DialogHeader>
        <Field label={t("facility.assets.condition")} required>
          <NativeSelect value={condition} onChange={(e) => setCondition(e.target.value)}>
            {CONDITIONS.map((c) => <option key={c} value={c}>{t(`enum.assetCondition.${c}`, undefined, humanize(c))}</option>)}
          </NativeSelect>
        </Field>
        <Field label={t("ui.notes")}><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("facility.assets.cond.notesHint")} /></Field>
        <Field label={t("facility.assets.cond.photo")}><FileField upload={{ entityType: "asset", entityId: asset.id, kind: "condition" }} value={photo} onChange={setPhoto} /></Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("ui.cancel")}</Button>
          <Button loading={act.isPending} onClick={() => act.mutate({ path: `/assets/${asset.id}/conditions`, body: { condition, notes: notes.trim() || null, attachment_id: photo } })}>{t("ui.save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AmcDialog({ asset, open, onOpenChange, onDone }: { asset: any; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const { t } = useT();
  const can = useCan();
  const [amc, setAmc] = useState<string | null>(asset.amc_contract_id ?? null);
  const [creating, setCreating] = useState(false);
  const act = useAction({ success: t("ui.saved"), onSuccess: () => { onDone(); onOpenChange(false); } });
  const link = (id: string | null) => act.mutate({ path: `/assets/${asset.id}/amc`, method: "PUT", body: { amc_contract_id: id } });
  return (
    <>
      <Dialog open={open && !creating} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("facility.assets.amc.title")}</DialogTitle>
            <DialogDescription>{t("facility.assets.amc.desc")}</DialogDescription>
          </DialogHeader>
          <Field label={t("facility.assets.amc.existing")}>
            <ResourcePicker endpoint="/amc-contracts" labelKey="title" hintKey="end_date" extraParams={`&status=active&campus_id=${asset.campus_id}`} value={amc} onChange={(v) => setAmc(v as string | null)} initialLabel={asset.amc?.title} />
          </Field>
          {can("amc:create", { campusId: asset.campus_id }, "auto") && (
            <Button variant="link" className="self-start px-0" onClick={() => setCreating(true)}><Plus /> {t("facility.assets.amc.new")}</Button>
          )}
          <DialogFooter>
            {asset.amc_contract_id && <Button variant="ghost" className="mr-auto" disabled={act.isPending} onClick={() => link(null)}>{t("facility.assets.amc.remove")}</Button>}
            <Button variant="outline" onClick={() => onOpenChange(false)}>{t("ui.cancel")}</Button>
            <Button disabled={!amc || amc === asset.amc_contract_id} loading={act.isPending} onClick={() => link(amc)}>{t("ui.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ResourceFormDialog
        open={open && creating}
        onOpenChange={(o) => { if (!o) { setCreating(false); onOpenChange(false); } }}
        title={t("facility.maintenance.amc.newTitle")}
        endpoint="/amc-contracts"
        fields={amcFields(t)}
        defaultValues={{ title: `AMC · ${asset.name}`, vendor_id: asset.vendor_id ?? undefined, campus_id: asset.campus_id, contract_type: "comprehensive", renewal_reminder_days: 45, visits_included: 4 }}
        invalidate={["/amc-contracts"]}
        onSaved={(r: { id: string }) => { setCreating(false); link(r.id); }}
      />
    </>
  );
}
