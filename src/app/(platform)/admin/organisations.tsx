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
import { cn } from "@/lib/utils/cn";

interface Org {
  id: string; name: string; slug: string; kind: "organisation" | "personal"; status: "active" | "suspended"; plan: string;
  licensed_modules: string[]; enabled_modules: string[]; members: number; owners: string[]; pending_invites: number; created_at: string; notes: string | null;
}
const MODULES = [
  { key: "facility", label: "Facilities" },
  { key: "expense", label: "Expenses" },
  { key: "tasks", label: "Tasks" },
  { key: "po", label: "Purchasing" },
];
const label = (m: string) => MODULES.find((x) => x.key === m)?.label ?? m;

/** Purchasing relies on Expenses (budgets, approvals): selecting it selects Expenses too. */
function ModulePicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const toggle = (m: string) => {
    let next = value.includes(m) ? value.filter((x) => x !== m) : [...value, m];
    if (m === "po" && next.includes("po") && !next.includes("expense")) next = [...next, "expense"];
    if (m === "expense" && !next.includes("expense")) next = next.filter((x) => x !== "po");
    onChange(next);
  };
  return (
    <div className="flex flex-wrap gap-2">
      {MODULES.map((m) => (
        <button key={m.key} type="button" aria-pressed={value.includes(m.key)} onClick={() => toggle(m.key)}
          className={cn("rounded-full border px-3 py-1.5 text-sm", value.includes(m.key) ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted")}>
          {m.label}
        </button>
      ))}
    </div>
  );
}

function InviteLink({ link }: { link: string }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm">Invitation emailed. You can also share this link (valid 14 days):</p>
      <div className="flex gap-2">
        <Input readOnly value={link} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
        <Button size="icon" variant="outline" aria-label="Copy link" onClick={() => { navigator.clipboard.writeText(link); toast.success("Copied"); }}><Copy /></Button>
      </div>
    </div>
  );
}

export function Organisations() {
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
      <PageHeader title="Organisations" description="Schools and institutes on the platform, their licensed modules and first administrators."
        actions={<Button onClick={() => setCreating(true)}><Plus /> New organisation</Button>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Organisations" value={orgs.length} />
        <Stat label="Active" value={orgs.filter((o) => o.status === "active").length} />
        <Stat label="Awaiting first admin" value={orgs.filter((o) => o.owners.length === 0).length} tone={orgs.some((o) => o.owners.length === 0) ? "warning" : "default"} />
        <Stat label="Personal workspaces" value={all.filter((o) => o.kind === "personal").length} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <NativeSelect value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className="w-auto" aria-label="Type">
          <option value="organisation">Organisations</option>
          <option value="personal">Personal workspaces (public sign-ups)</option>
        </NativeSelect>
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search name, slug or admin email" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <Card>
        {isLoading ? <div className="p-4"><Skeleton className="h-40" /></div> : rows.length === 0 ? (
          <div className="p-4"><EmptyState title={kind === "organisation" ? "No organisations yet" : "No personal workspaces yet"} description={kind === "organisation" ? "Create one and invite its first administrator." : "They appear when people sign up on their own."} /></div>
        ) : (
          <ul className="divide-y">
            {rows.map((o) => (
              <li key={o.id}>
                <button type="button" onClick={() => setSelected(o.id)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left hover:bg-muted/40">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{o.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {o.slug} · {o.members} member{o.members === 1 ? "" : "s"} · {o.owners.length ? o.owners.join(", ") : o.pending_invites ? "admin invited" : "no admin yet"}
                    </span>
                  </span>
                  <span className="flex flex-wrap gap-1">{o.licensed_modules.map((m) => <Badge key={m}>{label(m)}</Badge>)}</span>
                  {o.status === "suspended" ? <Badge tone="red">Suspended</Badge> : o.owners.length === 0 && o.kind === "organisation" ? <Badge tone="amber">Pending admin</Badge> : <Badge tone="green">Active</Badge>}
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
  const empty = { name: "", slug: "", admin_email: "", admin_name: "", campus_name: "Main Campus", campus_code: "MAIN", timezone: "Asia/Kolkata", currency: "INR", plan: "standard" };
  const [f, setF] = useState(empty);
  const [modules, setModules] = useState(["facility", "expense", "tasks", "po"]);
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
      toast.success("Organisation created");
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
          <DialogTitle>New organisation</DialogTitle>
          <DialogDescription>The first administrator receives an invitation and becomes the organisation&apos;s owner.</DialogDescription>
        </DialogHeader>
        {link ? <InviteLink link={link} /> : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Organisation name" required className="sm:col-span-2">
              <Input value={f.name} onChange={(e) => { set("name", e.target.value); if (!slugTouched) set("slug", slugify(e.target.value)); }} placeholder="e.g. Sunrise Public School" />
            </Field>
            <Field label="URL name (slug)" required hint="Lowercase letters, numbers and dashes">
              <Input value={f.slug} onChange={(e) => { setSlugTouched(true); set("slug", slugify(e.target.value)); }} className="font-mono" />
            </Field>
            <Field label="Plan"><Input value={f.plan} onChange={(e) => set("plan", e.target.value)} /></Field>
            <Field label="First admin email" required><Input type="email" inputMode="email" autoCapitalize="none" value={f.admin_email} onChange={(e) => set("admin_email", e.target.value)} /></Field>
            <Field label="First admin name"><Input value={f.admin_name} onChange={(e) => set("admin_name", e.target.value)} /></Field>
            <Field label="Licensed modules" className="sm:col-span-2" hint="Purchasing includes Expenses (budgets and approvals)">
              <ModulePicker value={modules} onChange={setModules} />
            </Field>
            <Field label="First campus / branch"><Input value={f.campus_name} onChange={(e) => set("campus_name", e.target.value)} /></Field>
            <Field label="Campus code" hint="Used in document numbers"><Input value={f.campus_code} onChange={(e) => set("campus_code", e.target.value.toUpperCase())} maxLength={8} className="font-mono" /></Field>
            <Field label="Time zone"><NativeSelect value={f.timezone} onChange={(e) => set("timezone", e.target.value)}>{["Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Asia/Kathmandu", "Asia/Dhaka", "Europe/London", "UTC"].map((z) => <option key={z}>{z}</option>)}</NativeSelect></Field>
            <Field label="Currency"><Input value={f.currency} maxLength={3} onChange={(e) => set("currency", e.target.value.toUpperCase())} /></Field>
          </div>
        )}
        <DialogFooter>
          {link ? <Button onClick={() => close(false)}>Done</Button> : (
            <Button loading={busy} disabled={f.name.trim().length < 2 || f.slug.length < 2 || !f.admin_email.includes("@") || !modules.length} onClick={create}>Create and invite admin</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OrgSheet({ org }: { org: Org }) {
  const qc = useQueryClient();
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
      <DialogDescription>{org.slug} · created <DateTime value={org.created_at} dateOnly /></DialogDescription>
      <div className="mt-5 flex flex-col gap-5">
        <section className="flex flex-col gap-2 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">Members</span><span>{org.members}</span></div>
          <div className="flex justify-between gap-4"><span className="text-muted-foreground">Admins</span><span className="text-right">{org.owners.join(", ") || "—"}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Pending invitations</span><span>{org.pending_invites}</span></div>
          <div className="flex justify-between gap-4"><span className="text-muted-foreground">Modules switched on</span><span className="text-right">{org.enabled_modules.map(label).join(", ") || "—"}</span></div>
        </section>
        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold">Licence</h3>
          <ModulePicker value={modules} onChange={setModules} />
          <Field label="Plan"><Input value={plan} onChange={(e) => setPlan(e.target.value)} /></Field>
          <Field label="Internal notes"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          {licenceDirty && (
            <Button size="sm" className="self-start" disabled={busy || !modules.length} onClick={() => patch({ licensed_modules: modules, plan, notes }, "Licence updated")}>Save licence</Button>
          )}
          <p className="text-xs text-muted-foreground">Removing a module switches it off for the organisation; its data is kept.</p>
        </section>
        {org.kind === "organisation" && (
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">Invite an administrator</h3>
            {link ? <InviteLink link={link} /> : (
              <div className="flex gap-2">
                <Input type="email" inputMode="email" autoCapitalize="none" placeholder="admin@school.edu.in" value={email} onChange={(e) => setEmail(e.target.value)} />
                <Button variant="outline" disabled={busy || !email.includes("@")} onClick={() => run(async () => {
                  const r = await api<{ invite_link: string }>(`/admin/organisations/${org.id}/owner-invitations`, { body: { email } });
                  setLink(r.invite_link);
                }, "Invitation sent")}><MailPlus /> Invite</Button>
              </div>
            )}
          </section>
        )}
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Status</h3>
          {org.status === "active" ? (
            <>
              <p className="text-xs text-muted-foreground">Suspending blocks every member immediately. Nothing is deleted.</p>
              <Button variant="destructive" size="sm" className="self-start" disabled={busy} onClick={() => confirm(`Suspend ${org.name}?`) && patch({ status: "suspended" }, "Organisation suspended")}>Suspend organisation</Button>
            </>
          ) : (
            <Button size="sm" className="self-start" disabled={busy} onClick={() => patch({ status: "active" }, "Organisation reactivated")}>Reactivate organisation</Button>
          )}
        </section>
      </div>
    </SheetContent>
  );
}
