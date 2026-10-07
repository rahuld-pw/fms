"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Copy, MailPlus, Search, ShieldPlus, X } from "lucide-react";
import { toast } from "sonner";
import { useCan, useSession } from "@/components/app/session";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, SheetContent } from "@/components/ui/dialog";
import { Input, NativeSelect } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { DateTime } from "@/components/shared/format";
import { CampusSelect, DepartmentSelect, Field, UserPicker } from "@/components/shared/fields";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status";
import { api, errorMessage } from "@/lib/client/api";
import { cn } from "@/lib/utils/cn";

/* eslint-disable @typescript-eslint/no-explicit-any */
interface Role { id: string; key: string; name: string; is_system: boolean }

export function UsersSettings() {
  const can = useCan();
  const manage = can("user:manage", {}, "strict");
  const { campuses, departments } = useSession();
  const { data: members, isLoading } = useQuery({ queryKey: ["members"], queryFn: () => api<any[]>("/members") });
  const { data: roles } = useQuery({ queryKey: ["roles"], queryFn: () => api<Role[]>("/roles") });
  const { data: invites } = useQuery({ queryKey: ["invitations"], queryFn: () => api<any[]>("/invitations"), enabled: manage });
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const scopeLabel = (a: any) =>
    a.scope_type === "campus" ? campuses.find((c) => c.id === a.campus_id)?.name : a.scope_type === "department" ? departments.find((d) => d.id === a.department_id)?.name : null;
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (members ?? []).filter((m) => !s || m.profile?.full_name?.toLowerCase().includes(s) || m.profile?.email?.toLowerCase().includes(s) || m.title?.toLowerCase().includes(s));
  }, [members, q]);
  const pending = (invites ?? []).filter((i) => !i.accepted_at && !i.revoked_at && new Date(i.expires_at) > new Date());
  const member = members?.find((m) => m.id === selected);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Users"
        description="Members, their roles and where those roles apply (organisation, campus or department)."
        actions={manage && <Button onClick={() => setInviteOpen(true)}><MailPlus /> Invite</Button>}
      />
      <div className="relative max-w-sm">
        <Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
        <Input className="pl-8" placeholder="Search name, email or title…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <Card>
        {isLoading ? <div className="p-4"><Skeleton className="h-40" /></div> : (
          <ul className="divide-y">
            {filtered.map((m) => (
              <li key={m.id}>
                <button type="button" className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/50" onClick={() => setSelected(m.id)}>
                  <Avatar name={m.profile?.full_name ?? m.profile?.email} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{m.profile?.full_name ?? m.profile?.email}{m.is_owner && <Badge tone="violet" className="ml-2">Owner</Badge>}</span>
                    <span className="block truncate text-xs text-muted-foreground">{[m.title, m.profile?.email].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span className="hidden max-w-[45%] flex-wrap justify-end gap-1 sm:flex">
                    {(m.roles ?? []).map((a: any) => <Badge key={a.id}>{a.role?.name}{scopeLabel(a) && ` · ${scopeLabel(a)}`}</Badge>)}
                  </span>
                  {m.module_access && <Badge tone="blue" className="hidden sm:inline-flex">{m.module_access.map((x: string) => MODULE_LABELS[x] ?? x).join(", ")} only</Badge>}
                  {m.status !== "active" && <StatusBadge status={m.status} />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {manage && pending.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Pending invitations</CardTitle></CardHeader>
          <CardContent className="flex flex-col divide-y">
            {pending.map((i) => (
              <div key={i.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{i.full_name ? `${i.full_name} · ` : ""}{i.email}<span className="block text-xs text-muted-foreground">{roles?.find((r) => r.id === i.role_id)?.name ?? "No role"} · expires <DateTime value={i.expires_at} relative /></span></span>
                <RevokeInvite id={i.id} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} roles={roles ?? []} />
      <MemberSheet member={member} roles={roles ?? []} manage={manage} onClose={() => setSelected(null)} scopeLabel={scopeLabel} />
    </div>
  );
}

function RevokeInvite({ id }: { id: string }) {
  const qc = useQueryClient();
  return (
    <Button size="xs" variant="ghost" onClick={async () => {
      try { await api(`/invitations/${id}`, { method: "DELETE" }); toast.success("Invitation revoked"); qc.invalidateQueries({ queryKey: ["invitations"] }); } catch (e) { toast.error(errorMessage(e)); }
    }}>Revoke</Button>
  );
}

function ScopeFields({ scope, setScope, campus, setCampus, dept, setDept }: { scope: string; setScope: (s: string) => void; campus: string | null; setCampus: (c: string | null) => void; dept: string | null; setDept: (d: string | null) => void }) {
  return (
    <>
      <Field label="Applies to">
        <NativeSelect value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="org">Whole organisation</option>
          <option value="campus">One campus</option>
          <option value="department">One department</option>
        </NativeSelect>
      </Field>
      {scope !== "org" && <Field label="Campus"><CampusSelect value={campus} onChange={setCampus} /></Field>}
      {scope === "department" && <Field label="Department"><DepartmentSelect value={dept} onChange={setDept} campusId={campus} /></Field>}
    </>
  );
}

function InviteDialog({ open, onOpenChange, roles }: { open: boolean; onOpenChange: (o: boolean) => void; roles: Role[] }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [scope, setScope] = useState("org");
  const [campus, setCampus] = useState<string | null>(null);
  const [dept, setDept] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      const r = await api<{ invite_link: string }>("/invitations", { body: { email, full_name: name || undefined, role_id: role || undefined, scope_type: scope, campus_id: campus ?? undefined, department_id: dept ?? undefined } });
      setLink(r.invite_link);
      qc.invalidateQueries({ queryKey: ["invitations"] });
      toast.success("Invitation sent");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const close = (o: boolean) => { if (!o) { setLink(null); setEmail(""); setName(""); } onOpenChange(o); };
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader><DialogTitle>Invite a user</DialogTitle><DialogDescription>They receive an email link valid for 7 days.</DialogDescription></DialogHeader>
        {link ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm">Invitation sent to <span className="font-medium">{email}</span>. You can also share this link:</p>
            <div className="flex gap-2"><Input readOnly value={link} className="font-mono text-xs" /><Button size="icon" variant="outline" aria-label="Copy link" onClick={() => { navigator.clipboard.writeText(link); toast.success("Copied"); }}><Copy /></Button></div>
          </div>
        ) : (
          <div className="grid gap-3">
            <Field label="Email" required><Input type="email" inputMode="email" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Role">
              <NativeSelect value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="">No role (assign later)</option>
                {roles.filter((r) => r.key !== "owner").map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </NativeSelect>
            </Field>
            {role && <ScopeFields scope={scope} setScope={setScope} campus={campus} setCampus={setCampus} dept={dept} setDept={setDept} />}
          </div>
        )}
        <DialogFooter>{link ? <Button onClick={() => close(false)}>Done</Button> : <Button disabled={!email.includes("@")} loading={busy} onClick={send}>Send invitation</Button>}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MemberSheet({ member, roles, manage, onClose, scopeLabel }: { member: any; roles: Role[]; manage: boolean; onClose: () => void; scopeLabel: (a: any) => string | null | undefined }) {
  const qc = useQueryClient();
  const [role, setRole] = useState("");
  const [scope, setScope] = useState("org");
  const [campus, setCampus] = useState<string | null>(null);
  const [dept, setDept] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["members"] });
  const run = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    try { await fn(); toast.success(msg); refresh(); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  const patch = (body: Record<string, unknown>) => run(() => api(`/members/${member.id}`, { method: "PATCH", body }), "Saved");
  return (
    <Dialog open={!!member} onOpenChange={(o) => !o && onClose()}>
      {member && (
        <SheetContent>
          <div className="flex items-center gap-3">
            <Avatar name={member.profile?.full_name ?? member.profile?.email} size="lg" />
            <div className="min-w-0">
              <DialogTitle className="truncate">{member.profile?.full_name ?? member.profile?.email}</DialogTitle>
              <DialogDescription className="truncate">{member.profile?.email}</DialogDescription>
            </div>
          </div>
          <div className="mt-5 flex flex-col gap-4">
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">Roles</h3>
              {(member.roles ?? []).length === 0 && <p className="text-sm text-muted-foreground">No roles — this user can only see their own items.</p>}
              {(member.roles ?? []).map((a: any) => (
                <div key={a.id} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                  <span className="flex-1">{a.role?.name}<span className="block text-xs text-muted-foreground">{scopeLabel(a) ?? "Whole organisation"}</span></span>
                  {manage && <Button size="icon-sm" variant="ghost" aria-label="Remove role" disabled={busy} onClick={() => run(() => api(`/role-assignments/${a.id}`, { method: "DELETE" }), "Role removed")}><X /></Button>}
                </div>
              ))}
              {manage && (
                <div className="flex flex-col gap-3 rounded-md border border-dashed p-3">
                  <Field label="Add role">
                    <NativeSelect value={role} onChange={(e) => setRole(e.target.value)}>
                      <option value="">Choose a role…</option>
                      {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </NativeSelect>
                  </Field>
                  {role && <ScopeFields scope={scope} setScope={setScope} campus={campus} setCampus={setCampus} dept={dept} setDept={setDept} />}
                  <Button size="sm" variant="outline" className="self-start" disabled={!role || busy} onClick={() => run(async () => {
                    await api("/role-assignments", { body: { user_id: member.user_id, role_id: role, scope_type: scope, campus_id: campus ?? undefined, department_id: dept ?? undefined } });
                    setRole("");
                  }, "Role assigned")}><ShieldPlus /> Assign</Button>
                </div>
              )}
            </section>
            {manage && <ModuleAccess key={`ma-${member.id}`} member={member} onSave={(v) => patch({ module_access: v })} busy={busy} />}
            {manage && (
              <section className="flex flex-col gap-3">
                <h3 className="text-sm font-semibold">Profile in this organisation</h3>
                <MemberFields key={member.id} member={member} onSave={patch} busy={busy} />
                {!member.is_owner && (
                  <Button variant={member.status === "active" ? "destructive" : "outline"} size="sm" className="self-start" disabled={busy}
                    onClick={() => patch({ status: member.status === "active" ? "suspended" : "active" })}>
                    {member.status === "active" ? "Suspend access" : "Reactivate"}
                  </Button>
                )}
              </section>
            )}
          </div>
        </SheetContent>
      )}
    </Dialog>
  );
}

const MODULE_LABELS: Record<string, string> = { facility: "Facilities", expense: "Expenses", tasks: "Tasks", po: "Purchasing" };

/** Per-member module access: all modules the organisation has on, or a chosen subset. */
function ModuleAccess({ member, onSave, busy }: { member: any; onSave: (v: string[] | null) => void; busy: boolean }) {
  const { data: orgModules } = useQuery({ queryKey: ["org", "modules"], queryFn: () => api<{ module: string; enabled: boolean }[]>("/org/modules") });
  const available = (orgModules ?? []).filter((m) => m.enabled).map((m) => m.module).sort();
  const [mode, setMode] = useState<"all" | "some">(member.module_access ? "some" : "all");
  const [chosen, setChosen] = useState<string[]>(member.module_access ?? available);
  const toggle = (m: string) => setChosen(chosen.includes(m) ? chosen.filter((x) => x !== m) : [...chosen, m]);
  const dirty = mode === "all" ? member.module_access !== null : JSON.stringify([...chosen].sort()) !== JSON.stringify([...(member.module_access ?? [])].sort());
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">Module access</h3>
      <p className="text-xs text-muted-foreground">Roles decide what someone can do; module access decides which modules they see at all.</p>
      <NativeSelect value={mode} onChange={(e) => setMode(e.target.value as "all" | "some")} aria-label="Module access">
        <option value="all">All modules the organisation uses</option>
        <option value="some">Only selected modules</option>
      </NativeSelect>
      {mode === "some" && (
        <div className="flex flex-wrap gap-2">
          {available.map((m) => (
            <button key={m} type="button" aria-pressed={chosen.includes(m)} onClick={() => toggle(m)}
              className={cn("rounded-full border px-3 py-1.5 text-sm", chosen.includes(m) ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted")}>
              {MODULE_LABELS[m] ?? m}
            </button>
          ))}
        </div>
      )}
      {dirty && (
        <Button size="sm" className="self-start" disabled={busy || (mode === "some" && chosen.length === 0)} onClick={() => onSave(mode === "all" ? null : chosen)}>
          Save module access
        </Button>
      )}
    </section>
  );
}

function MemberFields({ member, onSave, busy }: { member: any; onSave: (b: Record<string, unknown>) => void; busy: boolean }) {
  const [title, setTitle] = useState(member.title ?? "");
  const [code, setCode] = useState(member.employee_code ?? "");
  const [campus, setCampus] = useState<string | null>(member.campus_id);
  const [dept, setDept] = useState<string | null>(member.department_id);
  const [manager, setManager] = useState<string | null>(member.manager_id);
  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Employee code"><Input value={code} onChange={(e) => setCode(e.target.value)} /></Field>
      </div>
      <Field label="Home campus"><CampusSelect value={campus} onChange={setCampus} allowEmpty emptyLabel="—" /></Field>
      <Field label="Department"><DepartmentSelect value={dept} onChange={setDept} campusId={campus} /></Field>
      <Field label="Reporting manager" hint="Used by 'reporting manager' approval steps"><UserPicker value={manager} onChange={(v) => setManager(v as string | null)} /></Field>
      <Button size="sm" className="self-start" disabled={busy} onClick={() => onSave({ title: title || null, employee_code: code || null, campus_id: campus, department_id: dept, manager_id: manager })}>Save</Button>
    </div>
  );
}
