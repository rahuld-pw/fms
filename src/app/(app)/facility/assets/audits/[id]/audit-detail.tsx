"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NativeSelect, Textarea } from "@/components/ui/input";
import { Field } from "@/components/shared/fields";
import { LocationCascade } from "@/components/shared/location-cascade";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader, Stat } from "@/components/shared/page-header";
import { QrScanner } from "@/components/shared/qr-scanner";
import { isActing, useAction } from "@/components/shared/resource-form";
import { StatusBadge } from "@/components/shared/status";
import { api, errorMessage } from "@/lib/client/api";
import { useT } from "@/lib/i18n/client";
import { humanize } from "@/lib/utils/format";

/* eslint-disable @typescript-eslint/no-explicit-any */
export function AuditDetail({ id }: { id: string }) {
  const { t } = useT();
  const qc = useQueryClient();
  const audit = useQuery({ queryKey: ["audit", id], queryFn: () => api<any>(`/asset-audits/${id}`) });
  const items = useQuery({ queryKey: ["audit-items", id], queryFn: () => api<any[]>(`/asset-audits/${id}/items`) });
  const [filter, setFilter] = useState<string>("pending");
  const [detail, setDetail] = useState<any | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["audit-items", id] });
  const mark = useAction({ onSuccess: refresh });
  const complete = useAction({ success: t("facility.assets.audits.detail.completed"), onSuccess: () => qc.invalidateQueries({ queryKey: ["audit", id] }) });
  const onScan = useCallback(
    async (token: string) => {
      try {
        const r = await api<any>(`/asset-audits/${id}/verify`, { body: { qr_token: token, result: "found" } });
        toast.success(t("facility.assets.audits.detail.found", { tag: r.asset?.asset_tag, name: r.asset?.name }));
        refresh();
      } catch (e) {
        toast.error(errorMessage(e));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id],
  );
  const counts = useMemo(() => {
    const c: Record<string, number> = { pending: 0, found: 0, missing: 0, damaged: 0, relocated: 0 };
    for (const i of items.data ?? []) c[i.result] = (c[i.result] ?? 0) + 1;
    return c;
  }, [items.data]);
  if (audit.isLoading || !audit.data) return <Skeleton className="h-96" />;
  const total = items.data?.length ?? 0;
  const done = total - counts.pending;
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        breadcrumbs={[{ label: t("facility.assets.auditsLabel"), href: "/facility/assets/audits" }, { label: audit.data.name }]}
        title={audit.data.name}
        meta={<StatusBadge status={audit.data.status} />}
        actions={
          audit.data.status !== "completed" && (
            <Button size="sm" onClick={() => complete.mutate({ path: `/asset-audits/${id}`, method: "PATCH", body: { status: "completed" } })} disabled={counts.pending > 0} loading={complete.isPending}>
              {t("facility.assets.audits.detail.complete")}
            </Button>
          )
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={t("facility.assets.audits.detail.verified")} value={`${done} / ${total}`} hint={<Progress value={total ? (done / total) * 100 : 0} className="mt-1" />} />
        <Stat label={t("facility.assets.audits.detail.statFound")} value={counts.found} tone="good" />
        <Stat label={t("facility.assets.audits.detail.statMissing")} value={counts.missing} tone={counts.missing ? "danger" : "default"} />
        <Stat label={t("facility.assets.audits.detail.statDamaged")} value={counts.damaged + counts.relocated} />
      </div>
      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        {audit.data.status !== "completed" && (
          <Card className="h-fit">
            <CardHeader>
              <CardTitle>{t("facility.assets.audits.detail.scan")}</CardTitle>
            </CardHeader>
            <CardContent>
              <QrScanner onScan={onScan} />
            </CardContent>
          </Card>
        )}
        <div>
          <Tabs value={filter} onValueChange={setFilter}>
            <TabsList>
              {["pending", "found", "missing", "damaged", "relocated"].map((k) => (
                <TabsTrigger key={k} value={k} className="capitalize">
                  {t(`enum.auditResult.${k}`, undefined, humanize(k))} <span className="text-xs text-muted-foreground">{counts[k]}</span>
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value={filter}>
              <Card className="divide-y">
                {(items.data ?? [])
                  .filter((i) => i.result === filter)
                  .map((i) => (
                    <div key={i.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm">
                      <span className="font-mono text-xs">{i.asset?.asset_tag}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{i.asset?.name}</span>
                        {(i.condition || i.notes || i.found_location) && (
                          <span className="block truncate text-xs text-muted-foreground">
                            {[i.condition && t(`enum.assetCondition.${i.condition}`, undefined, humanize(i.condition)), i.found_location && t("facility.assets.audits.detail.foundAt", { place: i.found_location.name }), i.notes, i.verifier?.full_name].filter(Boolean).join(" · ")}
                          </span>
                        )}
                      </span>
                      <span className="text-xs text-muted-foreground">{i.asset?.location?.name}</span>
                      {audit.data.status !== "completed" && (
                        <div className="flex gap-1">
                          {["found", "missing", "damaged"].filter((r) => r !== i.result).map((r) => (
                            <Button key={r} size="xs" variant={r === "found" ? "default" : "outline"} disabled={mark.isPending} loading={isActing(mark, `/asset-audits/${id}/verify`, { asset_id: i.asset_id, result: r })} onClick={() => mark.mutate({ path: `/asset-audits/${id}/verify`, body: { asset_id: i.asset_id, result: r } })}>
                              {t(`enum.auditResult.${r}`, undefined, r)}
                            </Button>
                          ))}
                          <Button size="xs" variant="ghost" onClick={() => setDetail(i)}>{t("facility.assets.audits.detail.details")}</Button>
                        </div>
                      )}
                    </div>
                  ))}
                {(items.data ?? []).filter((i) => i.result === filter).length === 0 && <p className="p-4 text-sm text-muted-foreground">{t("facility.assets.audits.detail.none")}</p>}
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
      {detail && <VerifyDialog auditId={id} campusId={audit.data.campus_id} item={detail} onClose={() => setDetail(null)} onDone={refresh} />}
    </div>
  );
}

const RESULTS = ["found", "missing", "damaged", "relocated"];
const CONDITIONS = ["new", "good", "fair", "poor", "damaged"];

function VerifyDialog({ auditId, campusId, item, onClose, onDone }: { auditId: string; campusId: string; item: any; onClose: () => void; onDone: () => void }) {
  const { t } = useT();
  const [result, setResult] = useState<string>(item.result === "pending" ? "found" : item.result);
  const [condition, setCondition] = useState<string>(item.condition ?? "");
  const [location, setLocation] = useState<string | null>(item.found_location_id ?? null);
  const [notes, setNotes] = useState<string>(item.notes ?? "");
  const act = useAction({ success: t("ui.saved"), onSuccess: () => { onDone(); onClose(); } });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{item.asset?.asset_tag} · {item.asset?.name}</DialogTitle>
          <DialogDescription>{t("facility.assets.audits.detail.detailsDesc")}</DialogDescription>
        </DialogHeader>
        <Field label={t("facility.assets.audits.detail.result")} required>
          <NativeSelect value={result} onChange={(e) => setResult(e.target.value)}>
            {RESULTS.map((r) => <option key={r} value={r}>{t(`enum.auditResult.${r}`, undefined, humanize(r))}</option>)}
          </NativeSelect>
        </Field>
        {result !== "missing" && (
          <Field label={t("facility.assets.condition")}>
            <NativeSelect value={condition} onChange={(e) => setCondition(e.target.value)}>
              <option value="">—</option>
              {CONDITIONS.map((c) => <option key={c} value={c}>{t(`enum.assetCondition.${c}`, undefined, humanize(c))}</option>)}
            </NativeSelect>
          </Field>
        )}
        {result === "relocated" && (
          <Field label={t("facility.assets.audits.detail.foundLocation")} required>
            <LocationCascade campusId={campusId} value={location} onChange={setLocation} />
          </Field>
        )}
        <Field label={t("ui.notes")}><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("ui.cancel")}</Button>
          <Button
            disabled={result === "relocated" && !location}
            loading={act.isPending}
            onClick={() => act.mutate({ path: `/asset-audits/${auditId}/verify`, body: { asset_id: item.asset_id, result, condition: condition || null, found_location_id: result === "relocated" ? location : null, notes: notes.trim() || null } })}
          >
            {t("ui.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
