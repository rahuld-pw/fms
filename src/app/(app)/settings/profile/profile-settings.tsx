"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { useSession } from "@/components/app/session";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/checkbox";
import { Input, NativeSelect } from "@/components/ui/input";
import { Field } from "@/components/shared/fields";
import { PageHeader } from "@/components/shared/page-header";
import { api, errorMessage } from "@/lib/client/api";
import { supabaseBrowser } from "@/lib/supabase/browser";

/* eslint-disable @typescript-eslint/no-explicit-any */
const GROUPS: { label: string; types: { type: string; label: string }[] }[] = [
  { label: "Approvals", types: [{ type: "approval.requested", label: "Something needs my approval" }, { type: "approval.approved", label: "My request was approved" }, { type: "approval.rejected", label: "My request was rejected" }, { type: "reminder.approval_overdue", label: "Approval overdue reminders" }] },
  { label: "Facilities", types: [{ type: "issue.assigned", label: "Issue assigned to me" }, { type: "issue.status_changed", label: "Status of an issue I reported" }, { type: "issue.escalated", label: "Escalations" }, { type: "work_order.assigned", label: "Work order assigned to me" }] },
  { label: "Tasks", types: [{ type: "task.assigned", label: "Task assigned to me" }, { type: "task.completed", label: "Task I follow completed" }, { type: "reminder.task_due", label: "Due date reminders" }, { type: "comment.mentioned", label: "Someone @mentions me" }] },
  { label: "Money", types: [{ type: "expense.paid", label: "My claim was reimbursed" }, { type: "expense.advance_disbursed", label: "Advance disbursed" }, { type: "grn.posted", label: "Goods received on my PO" }, { type: "po.acknowledged", label: "Vendor acknowledged my PO" }, { type: "petty_cash.low_balance", label: "Petty cash running low" }] },
];

export function ProfileSettings() {
  const { user } = useSession();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => api<any>("/me") });
  const [name, setName] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await api("/me", { method: "PATCH", body: { full_name: name ?? me?.user?.full_name ?? user.full_name, phone: (phone ?? me?.user?.phone) || null } });
      toast.success("Profile saved");
      setName(null); setPhone(null);
      router.refresh();
    } catch (e) { toast.error(errorMessage(e)); } finally { setSaving(false); }
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="My profile" description={user.email ?? undefined} />
      <Card>
        <CardHeader><CardTitle>Details</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name"><Input value={name ?? me?.user?.full_name ?? user.full_name ?? ""} onChange={(e) => setName(e.target.value)} autoComplete="name" /></Field>
          <Field label="Mobile" hint="For WhatsApp/SMS alerts where enabled"><Input type="tel" inputMode="tel" autoComplete="tel" value={phone ?? me?.user?.phone ?? ""} onChange={(e) => setPhone(e.target.value)} /></Field>
          <Field label="Appearance">
            <NativeSelect value={theme ?? "system"} onChange={(e) => setTheme(e.target.value)}>
              <option value="system">Match device</option><option value="light">Light</option><option value="dark">Dark</option>
            </NativeSelect>
          </Field>
          <div className="flex items-end justify-end"><Button onClick={save} loading={saving} disabled={name === null && phone === null}>Save</Button></div>
        </CardContent>
      </Card>
      <PasswordCard />
      <Preferences />
    </div>
  );
}

function PasswordCard() {
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const { error } = await supabaseBrowser().auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Password updated");
    setPw(""); setConfirm("");
  };
  return (
    <Card>
      <CardHeader><div><CardTitle>Password</CardTitle><p className="mt-0.5 text-xs text-muted-foreground">You can always sign in with an emailed code instead. Set a password to sign in without email.</p></div></CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <Field label="New password"><Input type="password" autoComplete="new-password" minLength={8} value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
        <Field label="Confirm"><Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
        <Button variant="outline" onClick={save} loading={busy} disabled={pw.length < 8 || pw !== confirm}>Update password</Button>
      </CardContent>
    </Card>
  );
}

function Preferences() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["notification-preferences"], queryFn: () => api<{ type: string; in_app: boolean; email: boolean }[]>("/notifications/preferences") });
  const pref = (type: string) => data?.find((p) => p.type === type) ?? data?.find((p) => p.type === "*") ?? { type, in_app: true, email: true };
  const update = async (type: string, patch: Partial<{ in_app: boolean; email: boolean }>) => {
    const cur = pref(type);
    try {
      await api("/notifications/preferences", { method: "PUT", body: { preferences: [{ type, in_app: cur.in_app, email: cur.email, ...patch }] } });
      qc.invalidateQueries({ queryKey: ["notification-preferences"] });
    } catch (e) { toast.error(errorMessage(e)); }
  };
  return (
    <Card>
      <CardHeader><CardTitle>Notifications</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 gap-y-2 text-sm">
          <span />
          <span className="text-xs font-medium text-muted-foreground">In app</span>
          <span className="text-xs font-medium text-muted-foreground">Email</span>
          {GROUPS.map((g) => [
            <span key={g.label} className="col-span-3 mt-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{g.label}</span>,
            ...g.types.flatMap((t) => [
              <span key={`${t.type}-l`}>{t.label}</span>,
              <Switch key={`${t.type}-a`} checked={pref(t.type).in_app} onCheckedChange={(c) => update(t.type, { in_app: c })} aria-label={`${t.label} in app`} />,
              <Switch key={`${t.type}-e`} checked={pref(t.type).email} onCheckedChange={(c) => update(t.type, { email: c })} aria-label={`${t.label} by email`} />,
            ]),
          ])}
        </div>
      </CardContent>
    </Card>
  );
}
