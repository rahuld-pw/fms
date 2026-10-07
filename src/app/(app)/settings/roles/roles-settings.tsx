"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Copy, Lock, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useCan } from "@/components/app/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input, Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Field } from "@/components/shared/fields";
import { PageHeader } from "@/components/shared/page-header";
import { api, errorMessage } from "@/lib/client/api";
import { cn } from "@/lib/utils/cn";
import { humanize } from "@/lib/utils/format";

interface Role { id: string; key: string; name: string; description: string | null; is_system: boolean; role_permissions: { permission_key: string }[] }
interface Permission { key: string; resource: string; action: string; module: string | null; description: string | null }
interface Draft { id?: string; key: string; name: string; description: string; permissions: Set<string> }

const MODULE_LABEL: Record<string, string> = { core: "Organisation & platform", facility: "Facilities", expense: "Expenses", tasks: "Tasks", po: "Purchasing" };

export function RolesSettings() {
  const qc = useQueryClient();
  const can = useCan();
  const manage = can("role:manage", {}, "strict");
  const { data: roles, isLoading } = useQuery({ queryKey: ["roles"], queryFn: () => api<Role[]>("/roles") });
  const { data: perms } = useQuery({ queryKey: ["permissions"], queryFn: () => api<Permission[]>("/permissions") });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const selected = roles?.find((r) => r.id === (selectedId ?? roles?.[0]?.id));
  const grouped = useMemo(() => {
    const g = new Map<string, Map<string, Permission[]>>();
    for (const p of perms ?? []) {
      const m = p.module ?? "core";
      if (!g.has(m)) g.set(m, new Map());
      const byRes = g.get(m)!;
      if (!byRes.has(p.resource)) byRes.set(p.resource, []);
      byRes.get(p.resource)!.push(p);
    }
    return [...g.entries()].sort(([a], [b]) => (a === "core" ? -1 : b === "core" ? 1 : a.localeCompare(b)));
  }, [perms]);

  const editing = draft !== null;
  const shown = editing ? draft.permissions : new Set(selected?.role_permissions.map((p) => p.permission_key) ?? []);
  const superuser = !editing && selected && ["owner", "admin"].includes(selected.key);
  const toggle = (keys: string[], on: boolean) => {
    if (!draft) return;
    const next = new Set(draft.permissions);
    for (const k of keys) if (on) next.add(k); else next.delete(k);
    setDraft({ ...draft, permissions: next });
  };
  const startCopy = (r: Role) => setDraft({ key: `${r.key}_custom`, name: `${r.name} (custom)`, description: r.description ?? "", permissions: new Set(r.role_permissions.map((p) => p.permission_key)) });
  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const body = { key: draft.key, name: draft.name, description: draft.description || null, permissions: [...draft.permissions] };
      const r = await api<{ id: string }>(draft.id ? `/roles/${draft.id}` : "/roles", { method: draft.id ? "PUT" : "POST", body });
      toast.success("Role saved");
      await qc.invalidateQueries({ queryKey: ["roles"] });
      setSelectedId(r?.id ?? draft.id ?? null);
      setDraft(null);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  const remove = async (r: Role) => {
    if (!confirm(`Delete role "${r.name}"? Users lose the permissions it grants.`)) return;
    try {
      await api(`/roles/${r.id}`, { method: "DELETE" });
      toast.success("Role deleted");
      setSelectedId(null);
      qc.invalidateQueries({ queryKey: ["roles"] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  if (isLoading) return <Skeleton className="h-96" />;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Roles"
        description="A role is a set of permissions. Assign roles to users at organisation, campus or department scope on the Users page."
        actions={manage && <Button onClick={() => setDraft({ key: "", name: "", description: "", permissions: new Set() })}><Plus /> New role</Button>}
      />
      <div className="grid gap-4 md:grid-cols-[220px_1fr]">
        <Card className="h-fit min-w-0">
          <ul className="flex gap-1 overflow-x-auto p-2 md:flex-col">
            {roles?.map((r) => (
              <li key={r.id} className="shrink-0">
                <button type="button" onClick={() => { setDraft(null); setSelectedId(r.id); }}
                  className={cn("flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-muted", !editing && selected?.id === r.id && "bg-muted font-medium")}>
                  <span className="flex-1 truncate">{r.name}</span>
                  {r.is_system && <Lock className="size-3 text-muted-foreground" aria-label="System role" />}
                </button>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="min-w-0">
          <CardHeader className="flex-wrap">
            {editing ? <CardTitle>{draft.id ? "Edit role" : "New role"}</CardTitle> : (
              <div className="min-w-0">
                <CardTitle>{selected?.name} {selected?.is_system && <Badge className="ml-1">System</Badge>}</CardTitle>
                {selected?.description && <p className="mt-0.5 text-sm text-muted-foreground">{selected.description}</p>}
              </div>
            )}
            {manage && !editing && selected && (
              <div className="flex gap-1">
                <Button size="xs" variant="outline" onClick={() => startCopy(selected)}><Copy /> Duplicate</Button>
                {!selected.is_system && <>
                  <Button size="xs" variant="outline" onClick={() => setDraft({ id: selected.id, key: selected.key, name: selected.name, description: selected.description ?? "", permissions: new Set(selected.role_permissions.map((p) => p.permission_key)) })}>Edit</Button>
                  <Button size="icon-sm" variant="ghost" aria-label="Delete role" onClick={() => remove(selected)}><Trash2 /></Button>
                </>}
              </div>
            )}
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {editing && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Name" required><Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value, key: draft.id ? draft.key : e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 48) })} /></Field>
                <Field label="Key" hint="Stable identifier"><Input value={draft.key} disabled={!!draft.id} onChange={(e) => setDraft({ ...draft, key: e.target.value })} className="font-mono" /></Field>
                <Field label="Description" className="sm:col-span-2"><Textarea rows={2} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></Field>
              </div>
            )}
            {superuser ? (
              <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">This role has every permission, including ones added in future.</p>
            ) : grouped.map(([module, byRes]) => (
              <fieldset key={module} className="flex flex-col gap-2">
                <legend className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{MODULE_LABEL[module] ?? humanize(module)}</legend>
                <div className="flex flex-col divide-y rounded-md border">
                  {[...byRes.entries()].map(([resource, list]) => {
                    const keys = list.map((p) => p.key);
                    const all = keys.every((k) => shown.has(k));
                    return (
                      <div key={resource} className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-start">
                        <label className="flex w-40 shrink-0 items-center gap-2 text-sm font-medium">
                          {editing && <Checkbox checked={all} onCheckedChange={(c) => toggle(keys, !!c)} aria-label={`All ${resource} permissions`} />}
                          {humanize(resource)}
                        </label>
                        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                          {list.map((p) => (
                            <label key={p.key} title={p.description ?? p.key} className={cn("flex items-center gap-1.5 text-sm", !editing && !shown.has(p.key) && "text-muted-foreground/60 line-through decoration-muted-foreground/30")}>
                              {editing ? <Checkbox checked={shown.has(p.key)} onCheckedChange={(c) => toggle([p.key], !!c)} /> : <span className={cn("size-1.5 rounded-full", shown.has(p.key) ? "bg-primary" : "bg-muted-foreground/30")} />}
                              {humanize(p.action)}
                            </label>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </fieldset>
            ))}
            {editing && (
              <div className="sticky bottom-20 flex justify-end gap-2 rounded-md bg-background/90 py-2 backdrop-blur md:bottom-0">
                <Button variant="outline" onClick={() => setDraft(null)}>Cancel</Button>
                <Button onClick={save} loading={saving} disabled={!draft.name.trim() || !/^[a-z0-9_]{2,48}$/.test(draft.key)}>Save role ({draft.permissions.size})</Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
