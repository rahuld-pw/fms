"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Copy, MailPlus, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, SheetContent } from "@/components/ui/dialog";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { DateTime } from "@/components/shared/format";
import { Field } from "@/components/shared/fields";
import { EmptyState, PageHeader, Stat } from "@/components/shared/page-header";
import { api, errorMessage } from "@/lib/client/api";
import { useT } from "@/lib/i18n/client";
import type { TFunction } from "@/lib/i18n/translate";
import { cn } from "@/lib/utils/cn";

interface Org {
  id: string; name: string; slug: string; kind: "organisation" | "personal"; status: "active" | "suspended"; plan: string;
  licensed_modules: string[]; enabled_modules: string[]; members: number; owners: string[]; pending_invites: number; created_at: string; notes: string | null;
}
const MODULES = ["facility", "expense", "tasks", "po", "surveys"];
const label = (t: TFunction, m: string) => (MODULES.includes(m) ? t(`modules.${m}`) : m);

/** Purchasing relies on Expenses (budgets, approvals): selecting it selects Expenses too. */
function ModulePicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const { t } = useT();
  const toggle = (m: string) => {
    let next = value.includes(m) ? value.filter((x) => x !== m) : [...value, m];
    if (m === "po" && next.includes("po") && !next.includes("expense")) next = [...next, "expense"];
    if (m === "expense" && !next.includes("expense")) next = next.filter((x) => x !== "po");
    onChange(next);
  };
  return (
    <div className="flex flex-wrap gap-2">
      {MODULES.map((m) => (
        <button key={m} type="button" aria-pressed={value.includes(m)} onClick={() => toggle(m)}
          className={cn("rounded-full border px-3 py-1.5 text-sm", value.includes(m) ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted")}>
          {label(t, m)}
        </button>
      ))}
    </div>
  );
}

function InviteLink({ link }: { link: string }) {
  const { t } = useT();
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm">{t("admin.orgs.inviteEmailed")}</p>
      <div className="flex gap-2">
        <Input readOnly value={link} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
        <Button size="icon" variant="outline" aria-label={t("admin.orgs.copyLink")} onClick={() => { navigator.clipboard.writeText(link); toast.success(t("admin.orgs.copied")); }}><Copy /></Button>
      </div>
    </div>
  );
}

export function Organisations() {
  const { t } = useT();
  const [kind, setKind] = useState<"organisation" | "personal">("organisation");
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ["admin", "orgs"], queryFn: () => api<Org[]>("/admin/organisations") });
  const all = useMemo(() => data ?? [], [data]);
  const rows = useMemo(
    () => all.filter((o) => o.kind === kind && (!q || `${o.name} ${o.slug} ${o.owners.join(" ")}`.toLowerCase().includes(q.toLowerCase()))),
    [all, kind, q],
  );
  const orgs = all.filter((o) => o.kind === "organisation");
  const org = all.find((o) => o.id === selected);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("admin.orgs.title")} description={t("admin.orgs.description")}
        actions={<Button onClick={() => setCreating(true)}><Plus /> {t("admin.orgs.newOrganisation")}</Button>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t("admin.orgs.statOrganisations")} value={orgs.length} />
        <Stat label={t("admin.orgs.statActive")} value={orgs.filter((o) => o.status === "active").length} />
        <Stat label={t("admin.orgs.statAwaitingAdmin")} value={orgs.filter((o) => o.owners.length === 0).length} tone={orgs.some((o) => o.owners.length === 0) ? "warning" : "default"} />
        <Stat label={t("admin.orgs.statWorkspaces")} value={all.filter((o) => o.kind === "personal").length} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <NativeSelect value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className="w-auto" aria-label={t("ui.type")}>
          <option value="organisation">{t("admin.orgs.kindOrganisations")}</option>
          <option value="personal">{t("admin.orgs.kindWorkspaces")}</option>
        </NativeSelect>
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
          <Input className="pl-8" placeholder={t("admin.orgs.searchPlaceholder")} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <Card>
        {isLoading ? <div className="p-4"><Skeleton className="h-40" /></div> : rows.length === 0 ? (
          <div className="p-4"><EmptyState title={kind === "organisation" ? t("admin.orgs.emptyOrgsTitle") : t("admin.orgs.emptyWorkspacesTitle")} description={kind === "organisation" ? t("admin.orgs.emptyOrgsDescription") : t("admin.orgs.emptyWorkspacesDescription")} /></div>
        ) : (
          <ul className="divide-y">
            {rows.map((o) => (
              <li key={o.id}>
                <button type="button" onClick={() => setSelected(o.id)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left hover:bg-muted/40">
                  <span className="min-w-0 basis-full sm:basis-0 sm:flex-1">
                    <span className="block truncate font-medium">{o.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {o.slug} · {t(o.members === 1 ? "admin.orgs.membersOne" : "admin.orgs.membersOther", { n: o.members })} · {o.owners.length ? o.owners.join(", ") : o.pending_invites ? t("admin.orgs.adminInvited") : t("admin.orgs.noAdminYet")}
                    </span>
                  </span>
                  <span className="flex flex-wrap gap-1">{o.licensed_modules.map((m) => <Badge key={m}>{label(t, m)}</Badge>)}</span>
                  {o.status === "suspended" ? <Badge tone="red">{t("admin.orgs.suspended")}</Badge> : o.owners.length === 0 && o.kind === "organisation" ? <Badge tone="amber">{t("admin.orgs.pendingAdmin")}</Badge> : <Badge tone="green">{t("admin.orgs.active")}</Badge>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <CreateOrgDialog open={creating} onOpenChange={setCreating} />
      <Dialog open={!!org} onOpenChange={(o) => !o && setSelected(null)}>{org && <OrgSheet key={org.id} org={org} />}</Dialog>
    </div>
  );
}

function CreateOrgDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const { t } = useT();
  const empty = { name: "", slug: "", admin_email: "", admin_name: "", campus_name: "Main Campus", campus_code: "MAIN", timezone: "Asia/Kolkata", currency: "INR", plan: "standard" };
  const [f, setF] = useState(empty);
  const [modules, setModules] = useState(["facility", "expense", "tasks", "po", "surveys"]);
  const [slugTouched, setSlugTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const set = (k: keyof typeof empty, v: string) => setF((x) => ({ ...x, [k]: v }));
  const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  const close = (o: boolean) => { if (!o) { setF(empty); setLink(null); setSlugTouched(false); } onOpenChange(o); };
  const create = async () => {
    setBusy(true);
    try {
      const r = await api<{ invite_link: string }>("/admin/organisations", { body: { ...f, admin_name: f.admin_name || undefined, modules } });
      setLink(r.invite_link);
      qc.invalidateQueries({ queryKey: ["admin", "orgs"] });
      toast.success(t("admin.orgs.created"));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent wide className="max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("admin.orgs.newOrganisation")}</DialogTitle>
          <DialogDescription>{t("admin.orgs.createDescription")}</DialogDescription>
        </DialogHeader>
        {link ? <InviteLink link={link} /> : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("admin.orgs.orgName")} required className="sm:col-span-2">
              <Input value={f.name} onChange={(e) => { set("name", e.target.value); if (!slugTouched) set("slug", slugify(e.target.value)); }} placeholder={t("admin.orgs.orgNamePlaceholder")} />
            </Field>
            <Field label={t("admin.orgs.slug")} required hint={t("admin.orgs.slugHint")}>
              <Input value={f.slug} onChange={(e) => { setSlugTouched(true); set("slug", slugify(e.target.value)); }} className="font-mono" />
            </Field>
            <Field label={t("admin.orgs.plan")}><Input value={f.plan} onChange={(e) => set("plan", e.target.value)} /></Field>
            <Field label={t("admin.orgs.firstAdminEmail")} required><Input type="email" inputMode="email" autoCapitalize="none" value={f.admin_email} onChange={(e) => set("admin_email", e.target.value)} /></Field>
            <Field label={t("admin.orgs.firstAdminName")}><Input value={f.admin_name} onChange={(e) => set("admin_name", e.target.value)} /></Field>
            <Field label={t("admin.orgs.licensedModules")} className="sm:col-span-2" hint={t("admin.orgs.licensedModulesHint")}>
              <ModulePicker value={modules} onChange={setModules} />
            </Field>
            <Field label={t("admin.orgs.firstCampus")}><Input value={f.campus_name} onChange={(e) => set("campus_name", e.target.value)} /></Field>
            <Field label={t("admin.orgs.campusCode")} hint={t("admin.orgs.campusCodeHint")}><Input value={f.campus_code} onChange={(e) => set("campus_code", e.target.value.toUpperCase())} maxLength={8} className="font-mono" /></Field>
            <Field label={t("admin.orgs.timeZone")}><NativeSelect value={f.timezone} onChange={(e) => set("timezone", e.target.value)}>{["Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Asia/Kathmandu", "Asia/Dhaka", "Europe/London", "UTC"].map((z) => <option key={z}>{z}</option>)}</NativeSelect></Field>
            <Field label={t("admin.orgs.currency")}><Input value={f.currency} maxLength={3} onChange={(e) => set("currency", e.target.value.toUpperCase())} /></Field>
          </div>
        )}
        <DialogFooter>
          {link ? <Button onClick={() => close(false)}>{t("admin.orgs.done")}</Button> : (
            <Button loading={busy} disabled={f.name.trim().length < 2 || f.slug.length < 2 || !f.admin_email.includes("@") || !modules.length} onClick={create}>{t("admin.orgs.createAndInvite")}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OrgSheet({ org }: { org: Org }) {
  const qc = useQueryClient();
  const { t } = useT();
  const [modules, setModules] = useState(org.licensed_modules);
  const [plan, setPlan] = useState(org.plan);
  const [notes, setNotes] = useState(org.notes ?? "");
  const [email, setEmail] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    try { await fn(); toast.success(msg); qc.invalidateQueries({ queryKey: ["admin", "orgs"] }); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  const patch = (body: Record<string, unknown>, msg: string) => run(() => api(`/admin/organisations/${org.id}`, { method: "PATCH", body }), msg);
  const licenceDirty = [...modules].sort().join() !== [...org.licensed_modules].sort().join() || plan !== org.plan || notes !== (org.notes ?? "");
  return (
    <SheetContent>
      <DialogTitle className="pr-8">{org.name}</DialogTitle>
      <DialogDescription>{t("admin.orgs.createdOn", { slug: org.slug })} <DateTime value={org.created_at} dateOnly /></DialogDescription>
      <div className="mt-5 flex flex-col gap-5">
        <section className="flex flex-col gap-2 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">{t("admin.orgs.members")}</span><span>{org.members}</span></div>
          <div className="flex justify-between gap-4"><span className="shrink-0 text-muted-foreground">{t("admin.orgs.admins")}</span><span className="min-w-0 text-right break-all">{org.owners.join(", ") || "—"}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">{t("admin.orgs.pendingInvitations")}</span><span>{org.pending_invites}</span></div>
          <div className="flex justify-between gap-4"><span className="shrink-0 text-muted-foreground">{t("admin.orgs.modulesOn")}</span><span className="min-w-0 text-right">{org.enabled_modules.map((m) => label(t, m)).join(", ") || "—"}</span></div>
        </section>
        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold">{t("admin.orgs.licence")}</h3>
          <ModulePicker value={modules} onChange={setModules} />
          <Field label={t("admin.orgs.plan")}><Input value={plan} onChange={(e) => setPlan(e.target.value)} /></Field>
          <Field label={t("admin.orgs.internalNotes")}><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          {licenceDirty && (
            <Button size="sm" className="self-start" disabled={busy || !modules.length} onClick={() => patch({ licensed_modules: modules, plan, notes }, t("admin.orgs.licenceUpdated"))}>{t("admin.orgs.saveLicence")}</Button>
          )}
          <p className="text-xs text-muted-foreground">{t("admin.orgs.removeModuleNote")}</p>
        </section>
        {org.kind === "organisation" && (
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">{t("admin.orgs.inviteAdmin")}</h3>
            {link ? <InviteLink link={link} /> : (
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input type="email" inputMode="email" autoCapitalize="none" placeholder={t("admin.orgs.inviteEmailPlaceholder")} value={email} onChange={(e) => setEmail(e.target.value)} />
                <Button variant="outline" disabled={busy || !email.includes("@")} onClick={() => run(async () => {
                  const r = await api<{ invite_link: string }>(`/admin/organisations/${org.id}/owner-invitations`, { body: { email } });
                  setLink(r.invite_link);
                }, t("admin.orgs.invitationSent"))}><MailPlus /> {t("admin.orgs.invite")}</Button>
              </div>
            )}
          </section>
        )}
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">{t("admin.orgs.status")}</h3>
          {org.status === "active" ? (
            <>
              <p className="text-xs text-muted-foreground">{t("admin.orgs.suspendNote")}</p>
              <Button variant="destructive" size="sm" className="self-start" disabled={busy} onClick={() => confirm(t("admin.orgs.confirmSuspend", { name: org.name })) && patch({ status: "suspended" }, t("admin.orgs.orgSuspended"))}>{t("admin.orgs.suspendOrg")}</Button>
            </>
          ) : (
            <Button size="sm" className="self-start" disabled={busy} onClick={() => patch({ status: "active" }, t("admin.orgs.orgReactivated"))}>{t("admin.orgs.reactivateOrg")}</Button>
          )}
        </section>
      </div>
    </SheetContent>
  );
}
