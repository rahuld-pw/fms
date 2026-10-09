"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { PushToggle } from "@/components/app/push-toggle";
import { useSession } from "@/components/app/session";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/checkbox";
import { Input, NativeSelect } from "@/components/ui/input";
import { Field } from "@/components/shared/fields";
import { LanguageSelect } from "@/components/shared/language-select";
import { PageHeader } from "@/components/shared/page-header";
import { api, errorMessage } from "@/lib/client/api";
import { useT } from "@/lib/i18n/client";
import { supabaseBrowser } from "@/lib/supabase/browser";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Module = "facility" | "expense" | "tasks" | "po" | "surveys";
// `modules`: shown only when the user has at least one of them; none = always shown
const GROUPS: { key: string; types: { type: string; key: string; modules?: Module[] }[] }[] = [
  { key: "general", types: [{ type: "comment.mentioned", key: "mentioned" }, { type: "feedback.updated", key: "feedbackUpdated" }] },
  {
    key: "approvals",
    types: [
      { type: "approval.requested", key: "approvalRequested", modules: ["expense", "po", "facility"] },
      { type: "approval.approved", key: "approvalApproved", modules: ["expense", "po", "facility"] },
      { type: "approval.rejected", key: "approvalRejected", modules: ["expense", "po", "facility"] },
      { type: "reminder.approval_overdue", key: "approvalOverdue", modules: ["expense", "po", "facility"] },
    ],
  },
  {
    key: "facilities",
    types: [
      { type: "issue.assigned", key: "issueAssigned", modules: ["facility"] },
      { type: "issue.status_changed", key: "issueStatusChanged", modules: ["facility"] },
      { type: "issue.escalated", key: "issueEscalated", modules: ["facility"] },
      { type: "work_order.assigned", key: "workOrderAssigned", modules: ["facility"] },
    ],
  },
  {
    key: "tasks",
    types: [
      { type: "task.assigned", key: "taskAssigned", modules: ["tasks"] },
      { type: "task.completed", key: "taskCompleted", modules: ["tasks"] },
      { type: "reminder.task_due", key: "taskDue", modules: ["tasks"] },
    ],
  },
  {
    key: "money",
    types: [
      { type: "expense.paid", key: "expensePaid", modules: ["expense"] },
      { type: "expense.advance_disbursed", key: "advanceDisbursed", modules: ["expense"] },
      { type: "petty_cash.low_balance", key: "pettyCashLow", modules: ["expense"] },
      { type: "grn.posted", key: "grnPosted", modules: ["po"] },
      { type: "po.acknowledged", key: "poAcknowledged", modules: ["po"] },
    ],
  },
];

export function ProfileSettings() {
  const { t } = useT();
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
      toast.success(t("settings.profile.saved"));
      setName(null); setPhone(null);
      router.refresh();
    } catch (e) { toast.error(errorMessage(e)); } finally { setSaving(false); }
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("settings.profile.title")} description={user.email ?? undefined} />
      <Card>
        <CardHeader><CardTitle>{t("settings.profile.details")}</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label={t("settings.profile.fullName")}><Input value={name ?? me?.user?.full_name ?? user.full_name ?? ""} onChange={(e) => setName(e.target.value)} autoComplete="name" /></Field>
          <Field label={t("settings.profile.mobile")} hint={t("settings.profile.mobileHint")}><Input type="tel" inputMode="tel" autoComplete="tel" value={phone ?? me?.user?.phone ?? ""} onChange={(e) => setPhone(e.target.value)} /></Field>
          <Field label={t("settings.profile.appearance")}>
            <NativeSelect value={theme ?? "system"} onChange={(e) => setTheme(e.target.value)}>
              <option value="system">{t("settings.profile.themeSystem")}</option><option value="light">{t("settings.profile.themeLight")}</option><option value="dark">{t("settings.profile.themeDark")}</option>
            </NativeSelect>
          </Field>
          <Field label={t("settings.profile.language")} hint={t("settings.profile.languageHint")}>
            <LanguageSelect compact className="[&_select]:w-full [&_select]:flex-1" />
          </Field>
          <div className="flex items-end justify-end sm:col-span-2"><Button onClick={save} loading={saving} disabled={name === null && phone === null}>{t("ui.save")}</Button></div>
        </CardContent>
      </Card>
      <PasswordCard />
      <Preferences />
    </div>
  );
}

function PasswordCard() {
  const { t } = useT();
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const { error } = await supabaseBrowser().auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(t("settings.profile.password.updated"));
    setPw(""); setConfirm("");
  };
  return (
    <Card>
      <CardHeader><div><CardTitle>{t("settings.profile.password.title")}</CardTitle><p className="mt-0.5 text-xs text-muted-foreground">{t("settings.profile.password.description")}</p></div></CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <Field label={t("settings.profile.password.newPassword")}><Input type="password" autoComplete="new-password" minLength={8} value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
        <Field label={t("settings.profile.password.confirm")}><Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
        <Button variant="outline" onClick={save} loading={busy} disabled={pw.length < 8 || pw !== confirm}>{t("settings.profile.password.update")}</Button>
      </CardContent>
    </Card>
  );
}

function Preferences() {
  const { t } = useT();
  const { modules } = useSession();
  const qc = useQueryClient();
  // only alerts for modules this person can use in the current organisation
  const groups = GROUPS.map((g) => ({ ...g, types: g.types.filter((n) => !n.modules || n.modules.some((m) => modules.includes(m))) })).filter((g) => g.types.length);
  const { data } = useQuery({ queryKey: ["notification-preferences"], queryFn: () => api<{ type: string; in_app: boolean; email: boolean }[]>("/notifications/preferences") });
  const pref = (type: string) => data?.find((p) => p.type === type) ?? data?.find((p) => p.type === "*") ?? { type, in_app: true, email: true };
  // types whose preference is being saved: their switches stay disabled until it lands
  const [saving, setSaving] = useState<string[]>([]);
  const update = async (type: string, patch: Partial<{ in_app: boolean; email: boolean }>) => {
    if (saving.includes(type)) return;
    const cur = pref(type);
    setSaving((s) => [...s, type]);
    try {
      await api("/notifications/preferences", { method: "PUT", body: { preferences: [{ type, in_app: cur.in_app, email: cur.email, ...patch }] } });
      await qc.invalidateQueries({ queryKey: ["notification-preferences"] });
    } catch (e) { toast.error(errorMessage(e)); } finally { setSaving((s) => s.filter((x) => x !== type)); }
  };
  return (
    <Card>
      <CardHeader><CardTitle>{t("settings.profile.notifications.title")}</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-4">
        <PushToggle />
        <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 gap-y-2 text-sm">
          <span />
          <span className="text-xs font-medium text-muted-foreground">{t("settings.profile.notifications.inApp")}</span>
          <span className="text-xs font-medium text-muted-foreground">{t("settings.profile.notifications.email")}</span>
          {groups.map((g) => [
            <span key={g.key} className="col-span-3 mt-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t(`settings.profile.notifications.groups.${g.key}`)}</span>,
            ...g.types.flatMap((n) => {
              const label = t(`settings.profile.notifications.types.${n.key}`);
              return [
                <span key={`${n.type}-l`}>{label}</span>,
                <Switch key={`${n.type}-a`} disabled={saving.includes(n.type)} aria-busy={saving.includes(n.type) || undefined} checked={pref(n.type).in_app} onCheckedChange={(c) => update(n.type, { in_app: c })} aria-label={t("settings.profile.notifications.inAppAria", { label })} />,
                <Switch key={`${n.type}-e`} disabled={saving.includes(n.type)} aria-busy={saving.includes(n.type) || undefined} checked={pref(n.type).email} onCheckedChange={(c) => update(n.type, { email: c })} aria-label={t("settings.profile.notifications.emailAria", { label })} />,
              ];
            }),
          ])}
        </div>
      </CardContent>
    </Card>
  );
}
