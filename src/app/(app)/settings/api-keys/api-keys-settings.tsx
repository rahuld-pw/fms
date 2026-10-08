"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { BookOpen, Copy, KeyRound, Plus, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { DateTime } from "@/components/shared/format";
import { Field } from "@/components/shared/fields";
import { EmptyState, PageHeader } from "@/components/shared/page-header";
import { api, apiList, errorMessage } from "@/lib/client/api";
import { useT } from "@/lib/i18n/client";
import { humanize } from "@/lib/utils/format";

/* eslint-disable @typescript-eslint/no-explicit-any */
const SCOPE_GROUPS: { label: string; scopes: string[] }[] = [
  { label: "everything", scopes: ["*"] },
  { label: "facilities", scopes: ["issue:read", "issue:create", "issue:update", "work_order:read", "work_order:update", "asset:read", "asset:create", "asset:update", "vendor:read", "location:read"] },
  { label: "expenses", scopes: ["expense:read", "expense:submit", "budget:read"] },
  { label: "purchasing", scopes: ["requisition:read", "po:read", "po:create", "grn:read", "invoice:read", "invoice:create"] },
  { label: "tasks", scopes: ["task:read", "task:create", "task:update", "project:read"] },
  { label: "readOnly", scopes: ["issue:*", "asset:*", "po:*", "expense:*"] },
];

export function ApiKeysSettings() {
  const { t } = useT();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["/api-keys"], queryFn: () => apiList<any>("/api-keys?limit=100") });
  const [open, setOpen] = useState(false);
  const revoke = async (k: any) => {
    if (!confirm(t("settings.apiKeys.confirmRevoke", { name: k.name }))) return;
    try { await api(`/api-keys/${k.id}`, { method: "PATCH", body: { revoked: true } }); toast.success(t("settings.apiKeys.revoked")); qc.invalidateQueries({ queryKey: ["/api-keys"] }); } catch (e) { toast.error(errorMessage(e)); }
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t("nav./settings/api-keys")}
        description={t("settings.apiKeys.description")}
        actions={<>
          <Button variant="outline" asChild><a href="/docs" target="_blank" rel="noreferrer"><BookOpen /> {t("settings.apiKeys.docs")}</a></Button>
          <Button onClick={() => setOpen(true)}><Plus /> {t("settings.apiKeys.newKey")}</Button>
        </>}
      />
      <Card>
        {isLoading ? <div className="p-4"><Skeleton className="h-24" /></div> : !data?.data.length ? (
          <CardContent className="pt-4"><EmptyState icon={KeyRound} title={t("settings.apiKeys.emptyTitle")} description={t("settings.apiKeys.emptyDescription")} /></CardContent>
        ) : (
          <ul className="divide-y">
            {data.data.map((k) => {
              const expired = k.expires_at && new Date(k.expires_at) < new Date();
              return (
                <li key={k.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
                  <KeyRound className="size-4 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{k.name}</span> <code className="ml-1 text-xs text-muted-foreground">co_live_{k.prefix}_…</code>
                    <span className="block text-xs text-muted-foreground">
                      {k.scopes.join(", ")} · {t("settings.apiKeys.perMinute", { n: k.rate_limit_per_minute })} · {t("settings.apiKeys.lastUsed")} {k.last_used_at ? <DateTime value={k.last_used_at} relative /> : t("settings.apiKeys.never")}
                    </span>
                  </span>
                  {k.revoked_at ? <Badge>{t("settings.apiKeys.revokedBadge")}</Badge> : expired ? <Badge tone="amber">{t("status.expired")}</Badge> : <>
                    {k.expires_at && <span className="text-xs text-muted-foreground">{t("settings.apiKeys.expires")} <DateTime value={k.expires_at} dateOnly /></span>}
                    <Button size="xs" variant="ghost" className="text-destructive" onClick={() => revoke(k)}>{t("settings.apiKeys.revoke")}</Button>
                  </>}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <CreateKeyDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}

function CreateKeyDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useT();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<Set<string>>(new Set(["issue:read"]));
  const [rate, setRate] = useState("120");
  const [expires, setExpires] = useState("");
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toggle = (s: string, on: boolean) => { const n = new Set(scopes); if (on) n.add(s); else n.delete(s); setScopes(n); };
  const create = async () => {
    setBusy(true);
    try {
      const r = await api<{ key: string }>("/api-keys", { body: { name, scopes: [...scopes], rate_limit_per_minute: Number(rate), expires_at: expires ? new Date(`${expires}T23:59:59`).toISOString() : null } });
      setKey(r.key);
      qc.invalidateQueries({ queryKey: ["/api-keys"] });
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  const close = (o: boolean) => { if (!o) { setKey(null); setName(""); } onOpenChange(o); };
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent wide className="max-h-[92dvh] overflow-y-auto">
        <DialogHeader><DialogTitle>{key ? t("settings.apiKeys.copyTitle") : t("settings.apiKeys.newTitle")}</DialogTitle><DialogDescription>{key ? t("settings.apiKeys.copyDescription") : t("settings.apiKeys.newDescription")}</DialogDescription></DialogHeader>
        {key ? (
          <div className="flex flex-col gap-3">
            <div className="flex gap-2"><Input readOnly value={key} className="font-mono text-xs" onFocus={(e) => e.target.select()} /><Button size="icon" variant="outline" aria-label={t("settings.apiKeys.copyKey")} onClick={() => { navigator.clipboard.writeText(key); toast.success(t("ui.copied")); }}><Copy /></Button></div>
            <p className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300"><TriangleAlert className="size-4 shrink-0" /> {t("settings.apiKeys.storeWarning")}</p>
            <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{`curl ${typeof window !== "undefined" ? window.location.origin : ""}/api/v1/issues \\\n  -H "Authorization: Bearer ${key.slice(0, 22)}…"`}</pre>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={t("ui.name")} required className="sm:col-span-3"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("settings.apiKeys.namePlaceholder")} /></Field>
              <Field label={t("settings.apiKeys.rateLimit")}><Input type="number" inputMode="numeric" min="1" max="10000" value={rate} onChange={(e) => setRate(e.target.value)} /></Field>
              <Field label={t("settings.apiKeys.expiresField")}><Input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} /></Field>
            </div>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">{t("settings.apiKeys.scopes")}</legend>
              {SCOPE_GROUPS.map((g) => (
                <div key={g.label} className="rounded-md border p-2">
                  <p className="mb-1 text-xs font-medium text-muted-foreground">{t(`settings.apiKeys.groups.${g.label}`)}</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                    {g.scopes.map((s) => (
                      <label key={s} className="flex items-center gap-1.5 text-sm">
                        <Checkbox checked={scopes.has(s)} onCheckedChange={(c) => toggle(s, !!c)} />
                        <span className="font-mono text-xs">{s}</span>
                        <span className="sr-only">{humanize(s)}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </fieldset>
          </div>
        )}
        <DialogFooter>{key ? <Button onClick={() => close(false)}>{t("ui.done")}</Button> : <Button disabled={name.trim().length < 2 || !scopes.size} loading={busy} onClick={create}>{t("settings.apiKeys.createKey")}</Button>}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
