"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { useSession } from "@/components/app/session";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { CampusSelect, Field } from "@/components/shared/fields";
import { api, errorMessage } from "@/lib/client/api";
import { useT } from "@/lib/i18n/client";

export interface SurveyForm {
  id?: string;
  title: string;
  description: string | null;
  kind: "nps" | "csat";
  question: string;
  follow_up: string | null;
  audience: "members" | "public" | "both";
  status: "draft" | "active" | "closed";
  anonymous: boolean;
  campus_id: string | null;
  closes_at: string | null;
}

export function SurveyDialog({ open, onOpenChange, survey }: { open: boolean; onOpenChange: (o: boolean) => void; survey?: SurveyForm }) {
  const { t } = useT();
  const { org } = useSession();
  const qc = useQueryClient();
  const router = useRouter();
  const defaults = (kind: "nps" | "csat"): Pick<SurveyForm, "question" | "follow_up"> => ({
    question: kind === "nps" ? t("surveys.form.npsQuestion", { org: org.name }) : t("surveys.form.csatQuestion"),
    follow_up: t("surveys.form.followUpDefault"),
  });
  const blank: SurveyForm = { title: "", description: null, kind: "nps", ...defaults("nps"), audience: "members", status: "active", anonymous: false, campus_id: null, closes_at: null };
  const [f, setF] = useState<SurveyForm>(survey ?? blank);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof SurveyForm>(k: K, v: SurveyForm[K]) => setF((x) => ({ ...x, [k]: v }));
  const setKind = (kind: "nps" | "csat") =>
    setF((x) => {
      const wasDefault = x.question === defaults(x.kind).question;
      return { ...x, kind, ...(wasDefault ? { question: defaults(kind).question } : {}) };
    });
  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const body = { ...f, id: undefined, closes_at: f.closes_at ? new Date(`${f.closes_at.slice(0, 10)}T23:59:59`).toISOString() : null };
      const res = await api<{ id: string }>(survey?.id ? `/surveys/${survey.id}` : "/surveys", { method: survey?.id ? "PATCH" : "POST", body });
      toast.success(survey?.id ? t("surveys.form.saved") : t("surveys.form.created"));
      qc.invalidateQueries({ queryKey: ["surveys"] });
      qc.invalidateQueries({ queryKey: ["survey", res.id] });
      onOpenChange(false);
      if (!survey?.id) router.push(`/surveys/${res.id}`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o && !survey) setF(blank); }}>
      <DialogContent wide>
        <DialogHeader>
          <DialogTitle>{survey?.id ? t("surveys.form.editTitle") : t("surveys.form.newTitle")}</DialogTitle>
          <DialogDescription>{t("surveys.form.description")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("surveys.form.title")} required className="sm:col-span-2">
            <Input value={f.title} maxLength={200} placeholder={t("surveys.form.titlePlaceholder")} onChange={(e) => set("title", e.target.value)} />
          </Field>
          <Field label={t("surveys.form.kind")} className="sm:col-span-2">
            <div className="grid gap-2 sm:grid-cols-2">
              {(["nps", "csat"] as const).map((k) => (
                <button key={k} type="button" onClick={() => setKind(k)} aria-pressed={f.kind === k}
                  className={`rounded-md border p-3 text-left text-sm ${f.kind === k ? "border-primary ring-2 ring-primary/20" : "hover:bg-muted/50"}`}>
                  <span className="block font-medium">{t(`enum.surveyKind.${k}`)}</span>
                  <span className="block text-xs text-muted-foreground">{t(`surveys.form.${k}Help`)}</span>
                </button>
              ))}
            </div>
          </Field>
          <Field label={t("surveys.form.question")} required className="sm:col-span-2">
            <Textarea rows={2} value={f.question} maxLength={500} onChange={(e) => set("question", e.target.value)} />
          </Field>
          <Field label={t("surveys.form.followUp")} hint={t("surveys.form.followUpHint")} className="sm:col-span-2">
            <Input value={f.follow_up ?? ""} maxLength={500} onChange={(e) => set("follow_up", e.target.value || null)} />
          </Field>
          <Field label={t("surveys.form.audience")} hint={t(`surveys.form.audienceHint.${f.audience}`)}>
            <NativeSelect value={f.audience} onChange={(e) => set("audience", e.target.value as SurveyForm["audience"])}>
              {(["members", "public", "both"] as const).map((a) => <option key={a} value={a}>{t(`enum.surveyAudience.${a}`)}</option>)}
            </NativeSelect>
          </Field>
          <Field label={t("ui.campus")} hint={t("surveys.form.campusHint")}>
            <CampusSelect value={f.campus_id} onChange={(v) => set("campus_id", v)} allowEmpty />
          </Field>
          <Field label={t("ui.status")}>
            <NativeSelect value={f.status} onChange={(e) => set("status", e.target.value as SurveyForm["status"])}>
              {(["draft", "active", "closed"] as const).map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
            </NativeSelect>
          </Field>
          <Field label={t("surveys.form.closesOn")} hint={t("surveys.form.closesOnHint")}>
            <Input type="date" value={f.closes_at?.slice(0, 10) ?? ""} onChange={(e) => set("closes_at", e.target.value || null)} />
          </Field>
          <label className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm sm:col-span-2">
            <span className="min-w-0">{t("surveys.form.anonymous")}<span className="block text-xs text-muted-foreground">{t("surveys.form.anonymousHint")}</span></span>
            <Switch checked={f.anonymous} onCheckedChange={(c) => set("anonymous", c)} />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("ui.cancel")}</Button>
          <Button loading={saving} disabled={f.title.trim().length < 2 || f.question.trim().length < 5} onClick={save}>{survey?.id ? t("ui.saveChanges") : t("surveys.form.create")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
