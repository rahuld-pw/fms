"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Bug, ChevronDown, ChevronRight, Lightbulb, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { NativeSelect, Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { DateTime } from "@/components/shared/format";
import { EmptyState, PageHeader } from "@/components/shared/page-header";
import { api, errorMessage } from "@/lib/client/api";
import { useT } from "@/lib/i18n/client";
import { humanize } from "@/lib/utils/format";

/* eslint-disable @typescript-eslint/no-explicit-any */
const STATUSES = ["new", "triaged", "planned", "in_progress", "done", "wont_fix", "duplicate"];
const OPEN = "new,triaged,planned,in_progress";
const ICON = { bug: Bug, feature: Lightbulb, other: MessageSquare } as const;
const TONE: Record<string, "neutral" | "blue" | "amber" | "green" | "violet" | "red"> = {
  new: "blue", triaged: "violet", planned: "amber", in_progress: "amber", done: "green", wont_fix: "neutral", duplicate: "neutral",
};

export function FeedbackTriage() {
  const { t } = useT();
  const [status, setStatus] = useState(OPEN);
  const [kind, setKind] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "feedback", status, kind],
    queryFn: () => api<any[]>(`/admin/feedback?${new URLSearchParams({ ...(status ? { status } : {}), ...(kind ? { kind } : {}) })}`),
  });
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("admin.feedback.title")} description={t("admin.feedback.description")} />
      <div className="flex flex-wrap gap-2">
        <NativeSelect value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto" aria-label={t("ui.status")}>
          <option value={OPEN}>{t("admin.feedback.open")}</option>
          <option value="">{t("ui.all")}</option>
          {STATUSES.map((s) => <option key={s} value={s}>{t(`status.${s}`, undefined, humanize(s))}</option>)}
        </NativeSelect>
        <NativeSelect value={kind} onChange={(e) => setKind(e.target.value)} className="w-auto" aria-label={t("ui.type")}>
          <option value="">{t("admin.feedback.bugsAndFeatures")}</option>
          <option value="bug">{t("admin.feedback.bugs")}</option>
          <option value="feature">{t("admin.feedback.featureRequests")}</option>
          <option value="other">{t("admin.feedback.other")}</option>
        </NativeSelect>
      </div>
      <Card>
        {isLoading ? <div className="p-4"><Skeleton className="h-40" /></div> : !data?.length ? <div className="p-4"><EmptyState title={t("admin.feedback.emptyTitle")} description={t("admin.feedback.emptyDescription")} /></div> : (
          <ul className="divide-y">{data.map((f) => <Item key={f.id} f={f} />)}</ul>
        )}
      </Card>
    </div>
  );
}

function Item({ f }: { f: any }) {
  const qc = useQueryClient();
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState(f.admin_notes ?? "");
  const Icon = ICON[f.kind as keyof typeof ICON] ?? MessageSquare;
  const [saving, setSaving] = useState<"status" | "notes" | null>(null);
  const save = async (body: Record<string, unknown>) => {
    if (saving) return;
    setSaving("status" in body ? "status" : "notes");
    try {
      await api(`/admin/feedback/${f.id}`, { method: "PATCH", body });
      toast.success(t("admin.feedback.updated"));
      qc.invalidateQueries({ queryKey: ["admin", "feedback"] });
    } catch (e) { toast.error(errorMessage(e)); } finally { setSaving(null); }
  };
  return (
    <li className="px-4 py-3">
      <button type="button" className="flex w-full items-start gap-3 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? <ChevronDown className="mt-0.5 size-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
        <Icon className={f.kind === "bug" ? "mt-0.5 size-4 shrink-0 text-destructive" : "mt-0.5 size-4 shrink-0 text-amber-600"} />
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{f.title}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {f.user?.full_name ?? f.email ?? t("admin.feedback.anonymous")}{f.organisation?.name && ` · ${f.organisation.name}`} · <DateTime value={f.created_at} relative />
          </span>
        </span>
        <Badge tone={TONE[f.status]}>{t(`status.${f.status}`, undefined, humanize(f.status))}</Badge>
      </button>
      {open && (
        <div className="mt-3 ml-7 flex flex-col gap-3 text-sm">
          <p className="whitespace-pre-wrap">{f.description}</p>
          <dl className="grid gap-1 text-xs text-muted-foreground">
            {(f.user?.email ?? f.email) && <div><dt className="inline">{t("admin.feedback.contact")}</dt><dd className="inline"><a className="underline" href={`mailto:${f.user?.email ?? f.email}`}>{f.user?.email ?? f.email}</a></dd></div>}
            {f.page_url && <div className="truncate"><dt className="inline">{t("admin.feedback.page")}</dt><dd className="inline">{f.page_url}</dd></div>}
            {f.user_agent && <div className="truncate"><dt className="inline">{t("admin.feedback.browser")}</dt><dd className="inline">{f.user_agent}</dd></div>}
          </dl>
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect value={f.status} disabled={!!saving} aria-busy={saving === "status" || undefined} onChange={(e) => { void save({ status: e.target.value }); }} className="w-auto" aria-label={t("ui.status")}>
              {STATUSES.map((s) => <option key={s} value={s}>{t(`status.${s}`, undefined, humanize(s))}</option>)}
            </NativeSelect>
            {saving === "status" && <Spinner className="text-muted-foreground" />}
          </div>
          <Textarea rows={2} placeholder={t("admin.feedback.internalNotes")} value={notes} onChange={(e) => setNotes(e.target.value)} />
          {notes !== (f.admin_notes ?? "") && <Button size="sm" className="self-start" disabled={!!saving} loading={saving === "notes"} onClick={() => { void save({ admin_notes: notes || null }); }}>{t("admin.feedback.saveNotes")}</Button>}
        </div>
      )}
    </li>
  );
}
