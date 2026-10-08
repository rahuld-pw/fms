"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Copy, Plus, RefreshCw, RotateCcw, Send, Trash2, Webhook } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { DateTime } from "@/components/shared/format";
import { Field } from "@/components/shared/fields";
import { EmptyState, PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status";
import { api, apiList, errorMessage } from "@/lib/client/api";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils/cn";

/* eslint-disable @typescript-eslint/no-explicit-any */
const SUGGESTED = ["*", "issue.*", "issue.created", "issue.updated", "issue.escalated", "work_order.*", "asset.*", "expense_claim.*", "purchase_order.*", "grn.posted", "payment.recorded", "approval.*", "task.*", "vendor.*"];

export function WebhooksSettings() {
  const { t } = useT();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["/webhooks"], queryFn: () => apiList<any>("/webhooks?limit=100") });
  const [editing, setEditing] = useState<any>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const active = selected ?? data?.data[0]?.id ?? null;
  const [deleting, setDeleting] = useState<string | null>(null);
  const act = async (fn: () => Promise<unknown>, msg: string) => {
    try { await fn(); toast.success(msg); qc.invalidateQueries({ queryKey: ["/webhooks"] }); } catch (e) { toast.error(errorMessage(e)); }
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t("nav./settings/webhooks")}
        description={t("settings.webhooks.description")}
        actions={<Button onClick={() => setEditing({ url: "", description: "", events: ["*"], active: true })}><Plus /> {t("settings.webhooks.newEndpoint")}</Button>}
      />
      {isLoading ? <Skeleton className="h-32" /> : !data?.data.length ? (
        <Card><CardContent className="pt-4"><EmptyState icon={Webhook} title={t("settings.webhooks.emptyTitle")} description={t("settings.webhooks.emptyDescription")} /></CardContent></Card>
      ) : (
        <Card>
          <ul className="divide-y">
            {data.data.map((w) => (
              <li key={w.id} className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm", active === w.id && "bg-muted/40")}>
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setSelected(w.id)}>
                  <span className="block truncate font-mono text-xs">{w.url}</span>
                  <span className="block text-xs text-muted-foreground">{w.description ? `${w.description} · ` : ""}{w.events.join(", ")}</span>
                </button>
                {!w.active ? <Badge>{w.disabled_reason ? t("ui.disabled") : t("settings.webhooks.paused")}</Badge> : w.consecutive_failures > 0 ? <Badge tone="amber">{t(w.consecutive_failures === 1 ? "settings.webhooks.failuresOne" : "settings.webhooks.failuresOther", { n: w.consecutive_failures })}</Badge> : <Badge tone="green">{t("ui.active")}</Badge>}
                <div className="flex gap-1">
                  <Button size="xs" variant="ghost" onClick={() => act(() => api(`/webhooks/${w.id}/test`, { body: {} }), t("settings.webhooks.testQueued"))}><Send /> {t("settings.webhooks.test")}</Button>
                  <Button size="xs" variant="ghost" onClick={() => setEditing(w)}>{t("ui.edit")}</Button>
                  <Button size="xs" variant="ghost" onClick={async () => {
                    if (!confirm(t("settings.webhooks.confirmRotate"))) return;
                    try { const r = await api<{ secret: string }>(`/webhooks/${w.id}/rotate-secret`, { body: {} }); setSecret(r.secret); } catch (e) { toast.error(errorMessage(e)); }
                  }}><RotateCcw /> {t("settings.webhooks.secret")}</Button>
                  <Button size="icon-sm" variant="ghost" aria-label={t("settings.webhooks.deleteEndpoint")} loading={deleting === w.id} onClick={() => {
                    if (!confirm(t("settings.webhooks.confirmDelete"))) return;
                    setDeleting(w.id);
                    void act(() => api(`/webhooks/${w.id}`, { method: "DELETE" }), t("settings.webhooks.deleted")).finally(() => setDeleting(null));
                  }}>{deleting !== w.id && <Trash2 />}</Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {active && <Deliveries id={active} />}
      {editing && <EndpointDialog endpoint={editing} onClose={() => setEditing(null)} onSecret={setSecret} />}
      <Dialog open={!!secret} onOpenChange={(o) => !o && setSecret(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("settings.webhooks.secretTitle")}</DialogTitle><DialogDescription>{t("settings.webhooks.secretDescription")}</DialogDescription></DialogHeader>
          <div className="flex gap-2"><Input readOnly value={secret ?? ""} className="font-mono text-xs" /><Button size="icon" variant="outline" aria-label={t("settings.webhooks.copySecret")} onClick={() => { navigator.clipboard.writeText(secret ?? ""); toast.success(t("ui.copied")); }}><Copy /></Button></div>
          <DialogFooter><Button onClick={() => setSecret(null)}>{t("ui.done")}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EndpointDialog({ endpoint, onClose, onSecret }: { endpoint: any; onClose: () => void; onSecret: (s: string) => void }) {
  const { t } = useT();
  const qc = useQueryClient();
  const [url, setUrl] = useState(endpoint.url);
  const [description, setDescription] = useState(endpoint.description ?? "");
  const [events, setEvents] = useState<string[]>(endpoint.events ?? ["*"]);
  const [custom, setCustom] = useState("");
  const [active, setActive] = useState(endpoint.active !== false);
  const [busy, setBusy] = useState(false);
  const toggle = (e: string) => setEvents(events.includes(e) ? events.filter((x) => x !== e) : [...events, e]);
  const save = async () => {
    setBusy(true);
    try {
      const body = { url, description: description || null, events, active };
      if (endpoint.id) await api(`/webhooks/${endpoint.id}`, { method: "PATCH", body });
      else {
        const r = await api<{ id: string }>("/webhooks", { body });
        const full = await api<{ secret: string }>(`/webhooks/${r.id}`);
        onSecret(full.secret);
      }
      toast.success(t("settings.webhooks.saved"));
      qc.invalidateQueries({ queryKey: ["/webhooks"] });
      onClose();
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{endpoint.id ? t("settings.webhooks.editTitle") : t("settings.webhooks.newEndpoint")}</DialogTitle><DialogDescription>{t("settings.webhooks.dialogDescription")}</DialogDescription></DialogHeader>
        <Field label={t("settings.webhooks.url")} required><Input type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/hooks/campus-ops" /></Field>
        <Field label={t("ui.description")}><Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <Field label={t("settings.webhooks.events")}>
          <div className="flex flex-wrap gap-1.5">
            {[...new Set([...SUGGESTED, ...events])].map((e) => (
              <button key={e} type="button" onClick={() => toggle(e)} aria-pressed={events.includes(e)}
                className={cn("rounded-full border px-2 py-0.5 font-mono text-xs", events.includes(e) ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted")}>{e}</button>
            ))}
          </div>
        </Field>
        <div className="flex gap-2">
          <Input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder={t("settings.webhooks.otherEvent")} className="font-mono text-xs" />
          <Button variant="outline" size="sm" disabled={!/^[a-z_]+\.(\*|[a-z_]+)$/.test(custom)} onClick={() => { setEvents([...events, custom]); setCustom(""); }}>{t("ui.add")}</Button>
        </div>
        <label className="flex items-center gap-2 text-sm"><Switch checked={active} onCheckedChange={setActive} /> {t("ui.active")}</label>
        <DialogFooter><Button disabled={!url.startsWith("http") || !events.length} loading={busy} onClick={save}>{t("ui.save")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Deliveries({ id }: { id: string }) {
  const { t } = useT();
  const qc = useQueryClient();
  const { data, isLoading, refetch, isFetching } = useQuery({ queryKey: ["/webhooks", id, "deliveries"], queryFn: () => api<any[]>(`/webhooks/${id}/deliveries`) });
  const retry = async (d: any) => {
    try { await api(`/webhooks/deliveries/${d.id}/retry`, { body: {} }); toast.success(t("settings.webhooks.retryQueued")); qc.invalidateQueries({ queryKey: ["/webhooks", id, "deliveries"] }); } catch (e) { toast.error(errorMessage(e)); }
  };
  return (
    <Card>
      <CardHeader><CardTitle>{t("settings.webhooks.recentDeliveries")}</CardTitle><Button size="icon-sm" variant="ghost" aria-label={t("ui.refresh")} onClick={() => refetch()} disabled={isFetching}><RefreshCw className={cn(isFetching && "animate-spin")} /></Button></CardHeader>
      {isLoading ? <div className="p-4"><Skeleton className="h-24" /></div> : !data?.length ? <CardContent className="text-sm text-muted-foreground">{t("settings.webhooks.noDeliveries")}</CardContent> : (
        <Table>
          <THead><TR><TH>{t("settings.webhooks.event")}</TH><TH>{t("ui.status")}</TH><TH className="hidden sm:table-cell">{t("settings.webhooks.attempts")}</TH><TH className="hidden sm:table-cell">{t("settings.webhooks.response")}</TH><TH>{t("settings.webhooks.when")}</TH><TH /></TR></THead>
          <TBody>
            {data.map((d) => (
              <TR key={d.id}>
                <TD className="font-mono text-xs">{d.event?.event_type}</TD>
                <TD><StatusBadge status={d.status} /></TD>
                <TD className="hidden tabular sm:table-cell">{d.attempt_count}/{d.max_attempts}</TD>
                <TD className="hidden max-w-56 truncate text-xs text-muted-foreground sm:table-cell" title={d.last_error ?? ""}>{d.last_status_code ?? "—"}{d.last_error && ` · ${d.last_error}`}</TD>
                <TD className="whitespace-nowrap text-xs"><DateTime value={d.delivered_at ?? d.created_at} relative /></TD>
                <TD>{["failed", "dead"].includes(d.status) && <Button size="xs" variant="ghost" onClick={() => retry(d)}>{t("ui.retry")}</Button>}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  );
}
