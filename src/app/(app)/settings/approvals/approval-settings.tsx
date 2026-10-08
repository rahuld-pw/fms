"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowDown, ArrowUp, GitBranch, Plus, Trash2, UserRoundCog, Zap } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/components/app/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { DateTime, Money } from "@/components/shared/format";
import { Field, ResourcePicker, UserPicker } from "@/components/shared/fields";
import { EmptyState, PageHeader } from "@/components/shared/page-header";
import { api, apiList, errorMessage } from "@/lib/client/api";
import { useT } from "@/lib/i18n/client";
import { humanize } from "@/lib/utils/format";

/* eslint-disable @typescript-eslint/no-explicit-any */
const ENTITIES = [
  { entity: "expense_claim", module: "expense", label: "expenseClaim" },
  { entity: "expense_advance", module: "expense", label: "expenseAdvance" },
  { entity: "budget_amendment", module: "expense", label: "budgetAmendment" },
  { entity: "requisition", module: "po", label: "requisition" },
  { entity: "purchase_order", module: "po", label: "purchaseOrder" },
  { entity: "vendor", module: "facility", label: "vendor" },
] as const;
const APPROVER_TYPES = [
  { value: "role", label: "role" },
  { value: "user", label: "user" },
  { value: "permission", label: "permission" },
  { value: "department_head", label: "departmentHead" },
  { value: "reporting_manager", label: "reportingManager" },
];

interface Step { name: string; approver_type: string; role_id: string | null; user_id: string | null; permission_key: string | null; scope_mode: string; required_approvals: number; amount_min: string; sla_hours: string; userLabel?: string }
interface Conditions { amount_min?: number; amount_max?: number; category_ids?: string[]; department_ids?: string[]; campus_ids?: string[] }

const emptyStep = (name: string): Step => ({ name, approver_type: "role", role_id: null, user_id: null, permission_key: null, scope_mode: "entity", required_approvals: 1, amount_min: "", sla_hours: "48" });

export function ApprovalSettings() {
  const { t } = useT();
  const { data: policies, isLoading } = useQuery({ queryKey: ["/approval-policies", "all"], queryFn: () => apiList<any>("/approval-policies?limit=200&sort=priority") });
  const { data: roles } = useQuery({ queryKey: ["roles"], queryFn: () => api<{ id: string; name: string }[]>("/roles") });
  const [editing, setEditing] = useState<any>(null);
  const byEntity = (e: string) => (policies?.data ?? []).filter((p) => p.entity_type === e);
  const roleName = (id: string | null) => roles?.find((r) => r.id === id)?.name ?? t("settings.approvals.roleFallback");
  const describe = (s: any) =>
    s.approver_type === "role" ? roleName(s.role_id) : s.approver_type === "permission" ? t("settings.approvals.holderOf", { permission: s.permission_key }) : s.approver_type === "user" ? t("settings.approvals.namedPerson") : t(`enum.approverType.${s.approver_type}`, undefined, humanize(s.approver_type));

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t("nav./settings/approvals")}
        description={t("settings.approvals.description")}
        actions={<Button onClick={() => setEditing({ entity_type: "expense_claim", module: "expense", priority: 100, active: true, conditions: {}, steps: [] })}><Plus /> {t("settings.approvals.newPolicy")}</Button>}
      />
      {isLoading ? <Skeleton className="h-64" /> : ENTITIES.map((e) => (
        <Card key={e.entity}>
          <CardHeader><CardTitle>{t(`settings.approvals.entities.${e.label}`)}</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-2">
            {byEntity(e.entity).length === 0 && <p className="text-sm text-muted-foreground">{t("settings.approvals.noPolicy")}</p>}
            {byEntity(e.entity).map((p) => (
              <button key={p.id} type="button" onClick={() => setEditing(p)} className="flex flex-col gap-2 rounded-md border p-3 text-left hover:bg-muted/40">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{p.name}</span>
                  <Badge>{t("settings.approvals.priorityN", { n: p.priority })}</Badge>
                  {!p.active && <Badge tone="neutral">{t("ui.inactive")}</Badge>}
                  {p.auto_approve && <Badge tone="green"><Zap className="size-3" /> {t("settings.approvals.autoApprove")}</Badge>}
                  <span className="text-xs text-muted-foreground">
                    {[p.conditions?.amount_min != null && <>{t("settings.approvals.from")} <Money value={p.conditions.amount_min} /></>, p.conditions?.amount_max != null && <>{t("settings.approvals.upTo")} <Money value={p.conditions.amount_max} /></>]
                      .filter(Boolean).map((x, i) => <span key={i}>{i > 0 && " "}{x}</span>)}
                  </span>
                </div>
                {!p.auto_approve && (
                  <ol className="flex flex-wrap items-center gap-1.5 text-xs">
                    {[...(p.steps ?? [])].sort((a: any, b: any) => a.step_order - b.step_order).map((s: any, i: number) => (
                      <li key={s.id} className="flex items-center gap-1.5">
                        {i > 0 && <span className="text-muted-foreground">→</span>}
                        <span className="rounded bg-muted px-1.5 py-0.5">{s.name}{describe(s).toLowerCase() !== s.name.toLowerCase() && `: ${describe(s)}`}{s.required_approvals > 1 && ` ×${s.required_approvals}`}{s.conditions?.amount_min != null && <> (≥ <Money value={s.conditions.amount_min} compact />)</>}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </button>
            ))}
          </CardContent>
        </Card>
      ))}
      <Delegations />
      {editing && <PolicyDialog policy={editing} roles={roles ?? []} onClose={() => setEditing(null)} />}
    </div>
  );
}

function PolicyDialog({ policy, roles, onClose }: { policy: any; roles: { id: string; name: string }[]; onClose: () => void }) {
  const { t } = useT();
  const qc = useQueryClient();
  const isNew = !policy.id;
  const c: Conditions = policy.conditions ?? {};
  const [name, setName] = useState(policy.name ?? "");
  const [description, setDescription] = useState(policy.description ?? "");
  const [entity, setEntity] = useState(policy.entity_type);
  const [priority, setPriority] = useState(String(policy.priority ?? 100));
  const [amountMin, setAmountMin] = useState(c.amount_min != null ? String(c.amount_min) : "");
  const [amountMax, setAmountMax] = useState(c.amount_max != null ? String(c.amount_max) : "");
  const [categories, setCategories] = useState<string[]>(c.category_ids ?? []);
  const [depts, setDepts] = useState<string[]>(c.department_ids ?? []);
  const [autoApprove, setAutoApprove] = useState(!!policy.auto_approve);
  const [selfApproval, setSelfApproval] = useState(!!policy.allow_self_approval);
  const [active, setActive] = useState(policy.active !== false);
  const [steps, setSteps] = useState<Step[]>(() => [...(policy.steps ?? [])].sort((a, b) => a.step_order - b.step_order).map((s: any) => ({
    name: s.name, approver_type: s.approver_type, role_id: s.role_id, user_id: s.user_id, permission_key: s.permission_key, scope_mode: s.scope_mode,
    required_approvals: s.required_approvals, amount_min: s.conditions?.amount_min != null ? String(s.conditions.amount_min) : "", sla_hours: s.sla_hours ? String(s.sla_hours) : "",
  })));
  const [saving, setSaving] = useState(false);
  const { departments } = useSession();
  const set = (i: number, p: Partial<Step>) => setSteps(steps.map((s, j) => (j === i ? { ...s, ...p } : s)));
  const move = (i: number, d: number) => { const n = [...steps]; [n[i], n[i + d]] = [n[i + d], n[i]]; setSteps(n); };
  const conditions = (): Conditions => ({
    ...(amountMin ? { amount_min: Number(amountMin) } : {}), ...(amountMax ? { amount_max: Number(amountMax) } : {}),
    ...(categories.length ? { category_ids: categories } : {}), ...(depts.length ? { department_ids: depts } : {}),
  });
  const save = async () => {
    setSaving(true);
    try {
      const body = { name, description: description || null, priority: Number(priority), conditions: conditions(), auto_approve: autoApprove, allow_self_approval: selfApproval, active };
      const ent = ENTITIES.find((e) => e.entity === entity)!;
      const saved = isNew
        ? await api<{ id: string }>("/approval-policies", { body: { ...body, entity_type: entity, module: ent.module } })
        : await api<{ id: string }>(`/approval-policies/${policy.id}`, { method: "PATCH", body });
      await api(`/approval-policies/${saved.id}/steps`, {
        method: "PUT",
        body: {
          steps: autoApprove ? [] : steps.map((s, i) => ({
            step_order: i + 1, name: s.name, approver_type: s.approver_type, role_id: s.approver_type === "role" ? s.role_id : null, user_id: s.approver_type === "user" ? s.user_id : null,
            permission_key: s.approver_type === "permission" ? s.permission_key : null, scope_mode: s.scope_mode, required_approvals: Number(s.required_approvals) || 1,
            conditions: s.amount_min ? { amount_min: Number(s.amount_min) } : {}, sla_hours: s.sla_hours ? Number(s.sla_hours) : null,
          })),
        },
      });
      toast.success(t("settings.approvals.saved"));
      qc.invalidateQueries({ queryKey: ["/approval-policies"] });
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  const [removing, setRemoving] = useState(false);
  const remove = async () => {
    if (removing || !confirm(t("settings.approvals.confirmDelete"))) return;
    setRemoving(true);
    try { await api(`/approval-policies/${policy.id}`, { method: "DELETE" }); toast.success(t("settings.approvals.deleted")); qc.invalidateQueries({ queryKey: ["/approval-policies"] }); onClose(); } catch (e) { toast.error(errorMessage(e)); } finally { setRemoving(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent wide className="max-h-[92dvh] overflow-y-auto">
        <DialogHeader><DialogTitle>{isNew ? t("settings.approvals.newTitle") : t("settings.approvals.editTitle")}</DialogTitle><DialogDescription>{t("settings.approvals.dialogDescription")}</DialogDescription></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("ui.name")} required><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label={t("settings.approvals.appliesTo")}>
            <NativeSelect value={entity} disabled={!isNew} onChange={(e) => setEntity(e.target.value)}>{ENTITIES.map((e) => <option key={e.entity} value={e.entity}>{t(`settings.approvals.entities.${e.label}`)}</option>)}</NativeSelect>
          </Field>
          <Field label={t("ui.description")} className="sm:col-span-2"><Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
          <Field label={t("ui.priority")} hint={t("settings.approvals.priorityHint")}><Input type="number" inputMode="numeric" value={priority} onChange={(e) => setPriority(e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("settings.approvals.amountFrom")}><Input type="number" inputMode="decimal" min="0" value={amountMin} onChange={(e) => setAmountMin(e.target.value)} placeholder={t("settings.approvals.any")} /></Field>
            <Field label={t("settings.approvals.amountUpTo")}><Input type="number" inputMode="decimal" min="0" value={amountMax} onChange={(e) => setAmountMax(e.target.value)} placeholder={t("settings.approvals.any")} /></Field>
          </div>
          <Field label={t("settings.approvals.onlyCategories")}><ResourcePicker endpoint="/expense-categories" multiple value={categories} onChange={(v) => setCategories((v as string[]) ?? [])} placeholder={t("settings.approvals.allCategories")} /></Field>
          <Field label={t("settings.approvals.onlyDepartments")}>
            <NativeSelect multiple value={depts} onChange={(e) => setDepts(Array.from(e.target.selectedOptions).map((o) => o.value))} className="h-20">
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </NativeSelect>
          </Field>
          <div className="flex flex-col gap-2 sm:col-span-2 sm:flex-row sm:gap-6">
            <label className="flex items-center gap-2 text-sm"><Switch checked={autoApprove} onCheckedChange={setAutoApprove} /> {t("settings.approvals.autoApproveNoSteps")}</label>
            <label className="flex items-center gap-2 text-sm"><Switch checked={selfApproval} onCheckedChange={setSelfApproval} /> {t("settings.approvals.allowSelf")}</label>
            <label className="flex items-center gap-2 text-sm"><Switch checked={active} onCheckedChange={setActive} /> {t("ui.active")}</label>
          </div>
        </div>
        {!autoApprove && (
          <div className="flex flex-col gap-2">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold"><GitBranch className="size-4" /> {t("settings.approvals.steps")}</h3>
            {steps.map((s, i) => (
              <div key={i} className="grid gap-2 rounded-md border p-3 sm:grid-cols-6">
                <div className="flex items-end gap-1 sm:col-span-6">
                  <span className="mb-2 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">{i + 1}</span>
                  <Field label={t("settings.approvals.stepName")} className="flex-1"><Input value={s.name} onChange={(e) => set(i, { name: e.target.value })} /></Field>
                  <Button size="icon-sm" variant="ghost" className="mb-0.5" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t("settings.approvals.moveUp")}><ArrowUp /></Button>
                  <Button size="icon-sm" variant="ghost" className="mb-0.5" disabled={i === steps.length - 1} onClick={() => move(i, 1)} aria-label={t("settings.approvals.moveDown")}><ArrowDown /></Button>
                  <Button size="icon-sm" variant="ghost" className="mb-0.5" onClick={() => setSteps(steps.filter((_, j) => j !== i))} aria-label={t("settings.approvals.removeStep")}><Trash2 /></Button>
                </div>
                <Field label={t("ui.approver")} className="sm:col-span-3">
                  <NativeSelect value={s.approver_type} onChange={(e) => set(i, { approver_type: e.target.value })}>{APPROVER_TYPES.map((a) => <option key={a.value} value={a.value}>{t(`settings.approvals.approverTypes.${a.label}`)}</option>)}</NativeSelect>
                </Field>
                <div className="sm:col-span-3">
                  {s.approver_type === "role" && (
                    <Field label={t("ui.role")}><NativeSelect value={s.role_id ?? ""} onChange={(e) => set(i, { role_id: e.target.value || null })}><option value="">{t("settings.approvals.choose")}</option>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</NativeSelect></Field>
                  )}
                  {s.approver_type === "user" && <Field label={t("settings.approvals.person")}><UserPicker value={s.user_id} onChange={(v) => set(i, { user_id: v as string | null })} /></Field>}
                  {s.approver_type === "permission" && <Field label={t("settings.approvals.permission")}><Input value={s.permission_key ?? ""} placeholder={t("settings.approvals.permissionPlaceholder")} onChange={(e) => set(i, { permission_key: e.target.value })} className="font-mono" /></Field>}
                </div>
                {["role", "permission"].includes(s.approver_type) && (
                  <Field label={t("settings.approvals.where")} className="sm:col-span-2">
                    <NativeSelect value={s.scope_mode} onChange={(e) => set(i, { scope_mode: e.target.value })}>
                      <option value="entity">{t("settings.approvals.scopeEntity")}</option>
                      <option value="org">{t("settings.approvals.scopeOrg")}</option>
                    </NativeSelect>
                  </Field>
                )}
                <Field label={t("settings.approvals.approvalsNeeded")} className="sm:col-span-1"><Input type="number" inputMode="numeric" min="1" value={s.required_approvals} onChange={(e) => set(i, { required_approvals: Number(e.target.value) })} /></Field>
                <Field label={t("settings.approvals.onlyFromAmount")} className="sm:col-span-2"><Input type="number" inputMode="decimal" min="0" placeholder={t("settings.approvals.always")} value={s.amount_min} onChange={(e) => set(i, { amount_min: e.target.value })} /></Field>
                <Field label={t("settings.approvals.slaHours")} className="sm:col-span-1"><Input type="number" inputMode="numeric" min="1" value={s.sla_hours} onChange={(e) => set(i, { sla_hours: e.target.value })} /></Field>
              </div>
            ))}
            <Button size="sm" variant="outline" className="self-start" onClick={() => setSteps([...steps, emptyStep(t("settings.approvals.levelN", { n: steps.length + 1 }))])}><Plus /> {t("settings.approvals.addStep")}</Button>
          </div>
        )}
        <DialogFooter className="gap-2">
          {!isNew && <Button variant="ghost" className="mr-auto text-destructive" loading={removing} disabled={saving} onClick={() => { void remove(); }}>{!removing && <Trash2 />} {t("ui.delete")}</Button>}
          <Button variant="outline" onClick={onClose}>{t("ui.cancel")}</Button>
          <Button onClick={save} loading={saving} disabled={removing || !name.trim() || (!autoApprove && steps.length === 0)}>{t("settings.approvals.savePolicy")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Delegations() {
  const { t } = useT();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["/approval-delegations"], queryFn: () => apiList<any>("/approval-delegations?limit=100") });
  const [open, setOpen] = useState(false);
  const [delegator, setDelegator] = useState<string | null>(null);
  const [delegate, setDelegate] = useState<string | null>(null);
  const [ends, setEnds] = useState("");
  const [module, setModule] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const now = new Date();
  const rows = (data?.data ?? []).filter((d) => !d.revoked_at && new Date(d.ends_at) > now);
  const create = async () => {
    setBusy(true);
    try {
      await api("/approval-delegations", { body: { delegator_id: delegator ?? undefined, delegate_id: delegate, ends_at: new Date(`${ends}T23:59:59`).toISOString(), module: module || null, reason: reason || null } });
      toast.success(t("settings.approvals.delegations.created"));
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["/approval-delegations"] });
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  const revoke = async (id: string) => {
    try { await api(`/approval-delegations/${id}`, { method: "PATCH", body: { revoked_at: new Date().toISOString() } }); toast.success(t("settings.approvals.delegations.revoked")); qc.invalidateQueries({ queryKey: ["/approval-delegations"] }); } catch (e) { toast.error(errorMessage(e)); }
  };
  return (
    <Card>
      <CardHeader>
        <div><CardTitle>{t("settings.approvals.delegations.title")}</CardTitle><p className="mt-0.5 text-xs text-muted-foreground">{t("settings.approvals.delegations.description")}</p></div>
        <Button size="xs" variant="outline" onClick={() => setOpen(true)}><UserRoundCog /> {t("settings.approvals.delegations.delegate")}</Button>
      </CardHeader>
      <CardContent className="flex flex-col divide-y">
        {rows.length === 0 && <EmptyState title={t("settings.approvals.delegations.none")} />}
        {rows.map((d) => (
          <div key={d.id} className="flex items-center gap-3 py-2 text-sm">
            <span className="flex-1">{d.delegator?.full_name} → <span className="font-medium">{d.delegate?.full_name}</span>
              <span className="block text-xs text-muted-foreground">{d.module ? t(`enum.module.${d.module}`, undefined, humanize(d.module)) : t("settings.approvals.delegations.allModules")} · {t("settings.approvals.delegations.until")} <DateTime value={d.ends_at} dateOnly />{d.reason && ` · ${d.reason}`}</span>
            </span>
            <Button size="xs" variant="ghost" onClick={() => revoke(d.id)}>{t("settings.approvals.delegations.revoke")}</Button>
          </div>
        ))}
      </CardContent>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("settings.approvals.delegations.dialogTitle")}</DialogTitle><DialogDescription>{t("settings.approvals.delegations.dialogDescription")}</DialogDescription></DialogHeader>
          <Field label={t("ui.from")}><UserPicker value={delegator} onChange={(v) => setDelegator(v as string | null)} placeholder={t("settings.approvals.delegations.me")} /></Field>
          <Field label={t("ui.to")} required><UserPicker value={delegate} onChange={(v) => setDelegate(v as string | null)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("settings.approvals.delegations.until_")} required><Input type="date" value={ends} onChange={(e) => setEnds(e.target.value)} /></Field>
            <Field label={t("settings.approvals.delegations.module")}><NativeSelect value={module} onChange={(e) => setModule(e.target.value)}><option value="">{t("ui.all")}</option><option value="expense">{t("modules.expense")}</option><option value="po">{t("modules.po")}</option><option value="facility">{t("modules.facility")}</option></NativeSelect></Field>
          </div>
          <Field label={t("settings.approvals.delegations.reason")}><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("settings.approvals.delegations.reasonPlaceholder")} /></Field>
          <DialogFooter><Button disabled={!delegate || !ends} loading={busy} onClick={create}>{t("settings.approvals.delegations.create")}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
