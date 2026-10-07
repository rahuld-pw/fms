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
import { humanize } from "@/lib/utils/format";

/* eslint-disable @typescript-eslint/no-explicit-any */
const SCOPE_GROUPS: { label: string; scopes: string[] }[] = [
  { label: "Everything", scopes: ["*"] },
  { label: "Facilities", scopes: ["issue:read", "issue:create", "issue:update", "work_order:read", "work_order:update", "asset:read", "asset:create", "asset:update", "vendor:read", "location:read"] },
  { label: "Expenses", scopes: ["expense:read", "expense:submit", "budget:read"] },
  { label: "Purchasing", scopes: ["requisition:read", "po:read", "po:create", "grn:read", "invoice:read", "invoice:create"] },
  { label: "Tasks", scopes: ["task:read", "task:create", "task:update", "project:read"] },
  { label: "Read-only shortcuts", scopes: ["issue:*", "asset:*", "po:*", "expense:*"] },
];

export function ApiKeysSettings() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["/api-keys"], queryFn: () => apiList<any>("/api-keys?limit=100") });
  const [open, setOpen] = useState(false);
  const revoke = async (k: any) => {
    if (!confirm(`Revoke "${k.name}"? Integrations using it stop working immediately.`)) return;
    try { await api(`/api-keys/${k.id}`, { method: "PATCH", body: { revoked: true } }); toast.success("Key revoked"); qc.invalidateQueries({ queryKey: ["/api-keys"] }); } catch (e) { toast.error(errorMessage(e)); }
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="API keys"
        description="Keys authenticate integrations against /api/v1 with the Authorization: Bearer header. Keys are stored hashed and shown once."
        actions={<>
          <Button variant="outline" asChild><a href="/docs" target="_blank" rel="noreferrer"><BookOpen /> API docs</a></Button>
          <Button onClick={() => setOpen(true)}><Plus /> New key</Button>
        </>}
      />
      <Card>
        {isLoading ? <div className="p-4"><Skeleton className="h-24" /></div> : !data?.data.length ? (
          <CardContent className="pt-4"><EmptyState icon={KeyRound} title="No API keys yet" description="Create a key for your ERP, SIS or automation tools." /></CardContent>
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
                      {k.scopes.join(", ")} · {k.rate_limit_per_minute}/min · last used {k.last_used_at ? <DateTime value={k.last_used_at} relative /> : "never"}
                    </span>
                  </span>
                  {k.revoked_at ? <Badge>Revoked</Badge> : expired ? <Badge tone="amber">Expired</Badge> : <>
                    {k.expires_at && <span className="text-xs text-muted-foreground">expires <DateTime value={k.expires_at} dateOnly /></span>}
                    <Button size="xs" variant="ghost" className="text-destructive" onClick={() => revoke(k)}>Revoke</Button>
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
        <DialogHeader><DialogTitle>{key ? "Copy your key" : "New API key"}</DialogTitle><DialogDescription>{key ? "This is the only time the full key is shown." : "A key can never do more than its scopes allow."}</DialogDescription></DialogHeader>
        {key ? (
          <div className="flex flex-col gap-3">
            <div className="flex gap-2"><Input readOnly value={key} className="font-mono text-xs" onFocus={(e) => e.target.select()} /><Button size="icon" variant="outline" aria-label="Copy key" onClick={() => { navigator.clipboard.writeText(key); toast.success("Copied"); }}><Copy /></Button></div>
            <p className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300"><TriangleAlert className="size-4 shrink-0" /> Store it in a secrets manager. If it leaks, revoke it and create a new one.</p>
            <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{`curl ${typeof window !== "undefined" ? window.location.origin : ""}/api/v1/issues \\\n  -H "Authorization: Bearer ${key.slice(0, 22)}…"`}</pre>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Name" required className="sm:col-span-3"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Tally sync" /></Field>
              <Field label="Rate limit (per minute)"><Input type="number" inputMode="numeric" min="1" max="10000" value={rate} onChange={(e) => setRate(e.target.value)} /></Field>
              <Field label="Expires"><Input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} /></Field>
            </div>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">Scopes</legend>
              {SCOPE_GROUPS.map((g) => (
                <div key={g.label} className="rounded-md border p-2">
                  <p className="mb-1 text-xs font-medium text-muted-foreground">{g.label}</p>
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
        <DialogFooter>{key ? <Button onClick={() => close(false)}>Done</Button> : <Button disabled={name.trim().length < 2 || !scopes.size} loading={busy} onClick={create}>Create key</Button>}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
