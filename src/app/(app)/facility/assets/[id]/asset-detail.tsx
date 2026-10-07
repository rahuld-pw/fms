"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { ArrowLeftRight, ClipboardList, Pencil, Printer, Trash2, Wrench } from "lucide-react";
import { useCan } from "@/components/app/session";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ActivityFeed, Attachments, Comments } from "@/components/shared/collaboration";
import { DateTime, DueDate, Money } from "@/components/shared/format";
import { CampusSelect, Field, ResourcePicker, UserChip, UserPicker } from "@/components/shared/fields";
import { DetailGrid, PageHeader } from "@/components/shared/page-header";
import { ResourceFormDialog, useAction } from "@/components/shared/resource-form";
import { StatusBadge } from "@/components/shared/status";
import { api, apiList } from "@/lib/client/api";
import { humanize } from "@/lib/utils/format";
import { assetFields } from "../assets-table";
import { printLabels } from "../labels";

/* eslint-disable @typescript-eslint/no-explicit-any */
export function AssetDetail({ id }: { id: string }) {
  const qc = useQueryClient();
  const can = useCan();
  const { data: a, isLoading } = useQuery({ queryKey: ["asset", id], queryFn: () => api<Record<string, any>>(`/assets/${id}`) });
  const dep = useQuery({ queryKey: ["asset-dep", id], queryFn: () => api<any>(`/assets/${id}/depreciation`) });
  const transfers = useQuery({ queryKey: ["asset-transfers", id], queryFn: () => apiList<any>(`/asset-transfers?asset_id=${id}`) });
  const wos = useQuery({ queryKey: ["asset-wos", id], queryFn: () => apiList<any>(`/work-orders?asset_id=${id}&limit=20`) });
  const [edit, setEdit] = useState(false);
  const [transfer, setTransfer] = useState(false);
  const [dispose, setDispose] = useState(false);
  const refresh = () => {
    for (const k of [["asset", id], ["asset-transfers", id], ["asset-dep", id], ["activity", "asset", id]]) qc.invalidateQueries({ queryKey: k });
  };
  if (isLoading || !a) return <Skeleton className="h-96" />;
  const scope = { campusId: a.campus_id, departmentId: a.department_id };
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        breadcrumbs={[{ label: "Assets", href: "/facility/assets" }, { label: a.asset_tag }]}
        title={a.name}
        meta={
          <>
            <span className="font-mono text-sm">{a.asset_tag}</span>
            <StatusBadge status={a.status} />
            {a.condition && <span className="text-xs text-muted-foreground">Condition: {humanize(a.condition)}</span>}
          </>
        }
        actions={
          <>
            <Button size="sm" variant="outline" asChild>
              <Link href={`/facility/issues/new?asset=${a.id}&location=${a.location_id ?? ""}&campus=${a.campus_id}`}>
                <ClipboardList /> Report issue
              </Link>
            </Button>
            {can("asset:update", scope, "auto") && (
              <Button size="sm" variant="outline" onClick={() => setEdit(true)}>
                <Pencil /> Edit
              </Button>
            )}
            {can("asset:transfer", scope, "auto") && a.status !== "disposed" && (
              <Button size="sm" variant="outline" onClick={() => setTransfer(true)}>
                <ArrowLeftRight /> Transfer
              </Button>
            )}
            {can("asset:delete", scope, "auto") && a.status !== "disposed" && (
              <Button size="sm" variant="ghost" onClick={() => setDispose(true)}>
                <Trash2 /> Dispose
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
                  { label: "Category", value: a.category?.name },
                  { label: "Location", value: a.location ? [...a.location.path_names, a.location.name].join(" › ") : a.campus?.name },
                  { label: "Custodian", value: <UserChip name={a.custodian?.full_name} /> },
                  { label: "Make / model", value: [a.make, a.model].filter(Boolean).join(" ") || null },
                  { label: "Serial number", value: a.serial_number },
                  { label: "Purchase date", value: a.purchase_date },
                  { label: "Purchase cost", value: a.purchase_cost ? <Money value={a.purchase_cost} /> : null },
                  { label: "Vendor", value: a.vendor ? <Link className="text-primary hover:underline" href={`/facility/vendors/${a.vendor.id}`}>{a.vendor.name}</Link> : null },
                  { label: "Purchase order", value: a.purchase_order ? <Link className="text-primary hover:underline" href={`/po/orders/${a.purchase_order.id}`}>{a.purchase_order.number}</Link> : null },
                  { label: "GRN", value: a.grn?.number },
                  { label: "Warranty until", value: <DueDate value={a.warranty_until} done={a.status === "disposed"} /> },
                  { label: "AMC", value: a.amc ? <Link className="text-primary hover:underline" href={`/facility/maintenance?tab=amc`}>{a.amc.title} (to {a.amc.end_date})</Link> : null },
                  { label: "Usage meter", value: a.usage_unit ? `${Number(a.usage_meter).toLocaleString("en-IN")} ${a.usage_unit}` : null },
                  { label: "Last verified", value: <DateTime value={a.last_verified_at} dateOnly /> },
                  ...(a.status === "disposed"
                    ? [{ label: "Disposed", value: `${a.disposed_at} · ${humanize(a.disposal_method)} · ${a.disposal_reason ?? ""}`, wide: true }]
                    : []),
                ]}
              />
            </CardContent>
          </Card>
          <Tabs defaultValue="depreciation">
            <TabsList>
              <TabsTrigger value="depreciation">Depreciation</TabsTrigger>
              <TabsTrigger value="maintenance">Maintenance</TabsTrigger>
              <TabsTrigger value="transfers">Transfers</TabsTrigger>
              <TabsTrigger value="files">Documents</TabsTrigger>
              <TabsTrigger value="comments">Notes</TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
            </TabsList>
            <TabsContent value="depreciation">
              {dep.data?.rows?.length ? (
                <Card>
                  <CardHeader>
                    <CardTitle>
                      {dep.data.method === "slm" ? "Straight-line" : dep.data.method === "wdv" ? "Written-down value" : "No depreciation"}
                    </CardTitle>
                    <span className="text-sm">
                      Book value today: <Money value={dep.data.current_value} className="font-semibold" />
                    </span>
                  </CardHeader>
                  <Table>
                    <THead>
                      <TR>
                        <TH>Year</TH>
                        <TH>Period end</TH>
                        <TH className="text-right">Opening</TH>
                        <TH className="text-right">Depreciation</TH>
                        <TH className="text-right">Closing</TH>
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
                <p className="text-sm text-muted-foreground">Add a purchase date and cost to see the depreciation schedule.</p>
              )}
            </TabsContent>
            <TabsContent value="maintenance">
              <Card className="divide-y">
                {wos.data?.data.length === 0 && <p className="p-4 text-sm text-muted-foreground">No work orders yet.</p>}
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
            <CardTitle>QR tag</CardTitle>
            <Button size="xs" variant="outline" onClick={() => printLabels("asset", [id])}>
              <Printer /> Print
            </Button>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/v1/qr/${a.qr_token}/svg`} alt={`QR code for ${a.asset_tag}`} className="size-48 rounded border bg-white p-2" />
            <p className="text-center text-xs text-muted-foreground">Scanning opens this asset and lets anyone report an issue against it.</p>
          </CardContent>
        </Card>
      </div>
      <ResourceFormDialog
        open={edit}
        onOpenChange={setEdit}
        title="Edit asset"
        endpoint={`/assets/${id}`}
        method="PATCH"
        fields={assetFields}
        defaultValues={a}
        onSaved={refresh}
      />
      <TransferDialog asset={a} open={transfer} onOpenChange={setTransfer} onDone={refresh} />
      <DisposeDialog id={id} open={dispose} onOpenChange={setDispose} onDone={refresh} />
    </div>
  );
}

function TransfersList({ rows, onDone }: { rows: any[]; onDone: () => void }) {
  const can = useCan();
  const decide = useAction({ success: "Transfer updated", onSuccess: onDone });
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No transfers.</p>;
  return (
    <Card className="divide-y">
      {rows.map((t) => (
        <div key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
          <div className="min-w-0 flex-1">
            <p>
              {t.from_campus?.name} → {t.to_campus?.name}
              {t.to_location?.name && <> · {t.to_location.name}</>}
              {t.to_custodian?.full_name && <> · to {t.to_custodian.full_name}</>}
            </p>
            <p className="text-xs text-muted-foreground">
              {t.reason} · <DateTime value={t.created_at} relative />
            </p>
          </div>
          <StatusBadge status={t.status} />
          {t.status === "pending" && can("asset:transfer", { campusId: t.to_campus_id }, "auto") && (
            <div className="flex gap-1">
              <Button size="xs" onClick={() => decide.mutate({ path: `/asset-transfers/${t.id}/decide`, body: { status: "completed" } })}>Receive</Button>
              <Button size="xs" variant="outline" onClick={() => decide.mutate({ path: `/asset-transfers/${t.id}/decide`, body: { status: "rejected" } })}>Reject</Button>
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
  const [custodian, setCustodian] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const act = useAction({ success: "Transfer requested", onSuccess: () => { onDone(); onOpenChange(false); } });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Transfer asset</DialogTitle>
          <DialogDescription>The receiving campus confirms the transfer, then the asset moves.</DialogDescription>
        </DialogHeader>
        <Field label="To campus"><CampusSelect value={campus} onChange={setCampus} /></Field>
        <Field label="To location"><ResourcePicker endpoint="/locations" extraParams={campus ? `&campus_id=${campus}` : ""} value={location} onChange={(v) => setLocation(v as string | null)} /></Field>
        <Field label="New custodian"><UserPicker value={custodian} onChange={(v) => setCustodian(v as string | null)} /></Field>
        <Field label="Reason"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={act.isPending} onClick={() => act.mutate({ path: "/asset-transfers", body: { asset_id: asset.id, to_campus_id: campus, to_location_id: location, to_custodian_id: custodian, reason: reason || null } })}>
            Request transfer
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
  const act = useAction({ success: "Asset disposed", onSuccess: () => { onDone(); onOpenChange(false); } });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Dispose asset</DialogTitle>
          <DialogDescription>The asset stays in the register for audit, with status “disposed”.</DialogDescription>
        </DialogHeader>
        <Field label="Method">
          <NativeSelect value={method} onChange={(e) => setMethod(e.target.value)}>
            {["sold", "scrapped", "donated", "written_off", "returned"].map((m) => <option key={m} value={m}>{humanize(m)}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Disposal value"><Input type="number" value={value} onChange={(e) => setValue(e.target.value)} /></Field>
        <Field label="Reason" required><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="destructive" disabled={reason.trim().length < 3} loading={act.isPending} onClick={() => act.mutate({ path: `/assets/${id}/dispose`, body: { disposal_method: method, disposal_value: value ? Number(value) : null, disposal_reason: reason } })}>
            Dispose
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
