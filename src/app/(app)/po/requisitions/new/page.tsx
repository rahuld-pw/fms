"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { useSession } from "@/components/app/session";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { CampusSelect, DepartmentSelect, Field, ResourcePicker } from "@/components/shared/fields";
import { PageHeader } from "@/components/shared/page-header";
import { api, errorMessage } from "@/lib/client/api";
import { useT } from "@/lib/i18n/client";
import { emptyLine, LinesEditor, reqLinePayload, type LineDraft } from "../../lines-editor";

export default function NewRequisitionPage() {
  const { t } = useT();
  const router = useRouter();
  const { campuses, user } = useSession();
  const [campus, setCampus] = useState<string | null>(campuses.length === 1 ? campuses[0].id : null);
  const [dept, setDept] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [justification, setJustification] = useState("");
  const [neededBy, setNeededBy] = useState("");
  const [priority, setPriority] = useState("medium");
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [busy, setBusy] = useState<"draft" | "submit" | null>(null);

  const save = async (submit: boolean) => {
    if (busy) return;
    if (!campus) return toast.error(t("po.newRequisition.chooseCampus"));
    if (!lines.length) return toast.error(t("po.common.addOneLine"));
    setBusy(submit ? "submit" : "draft");
    try {
      const req = await api<{ id: string }>("/requisitions", {
        body: {
          campus_id: campus, department_id: dept ?? undefined, category_id: category ?? undefined, title, priority,
          justification: justification || undefined, needed_by: neededBy || undefined, lines: lines.map(reqLinePayload),
        },
        idempotencyKey: crypto.randomUUID(),
      });
      if (submit) {
        const r = await api<{ status: string; budget_check?: { result: string; message?: string } }>(`/requisitions/${req.id}/submit`, { body: {} });
        toast.success(r.status === "approved" ? t("po.common.submittedAutoApproved") : t("po.common.submittedForApproval"), {
          description: r.budget_check?.result === "warning" ? r.budget_check.message : undefined,
        });
      } else toast.success(t("po.common.draftSaved"));
      router.push(`/po/requisitions/${req.id}`);
    } catch (e) {
      toast.error(errorMessage(e));
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={t("po.newRequisition.title")} breadcrumbs={[{ label: t("po.common.requisitions"), href: "/po/requisitions" }, { label: t("po.common.new") }]} description={t("po.newRequisition.requestedBy", { name: user.full_name ?? "" })} />
      <form onSubmit={(e) => { e.preventDefault(); save(true); }} className="flex flex-col gap-4">
        <Card>
          <CardContent className="grid gap-4 pt-4 sm:grid-cols-2">
            <Field label={t("ui.title")} required className="sm:col-span-2">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} required minLength={3} placeholder={t("po.newRequisition.titlePlaceholder")} />
            </Field>
            <Field label={t("ui.campus")} required><CampusSelect value={campus} onChange={setCampus} /></Field>
            <Field label={t("ui.department")} hint={t("po.newRequisition.departmentHint")}><DepartmentSelect value={dept} onChange={setDept} campusId={campus} /></Field>
            <Field label={t("po.common.budgetCategory")}>
              <ResourcePicker endpoint="/expense-categories" value={category} onChange={(v) => setCategory(v as string | null)} placeholder={t("ui.optional")} />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label={t("po.common.neededBy")}><Input type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} /></Field>
              <Field label={t("ui.priority")}>
                <NativeSelect value={priority} onChange={(e) => setPriority(e.target.value)}>
                  {["low", "medium", "high", "urgent"].map((p) => <option key={p} value={p}>{t(`priority.${p}`, undefined, p[0].toUpperCase() + p.slice(1))}</option>)}
                </NativeSelect>
              </Field>
            </div>
            <Field label={t("po.newRequisition.justification")} className="sm:col-span-2">
              <Textarea value={justification} onChange={(e) => setJustification(e.target.value)} rows={2} placeholder={t("po.newRequisition.justificationPlaceholder")} />
            </Field>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t("ui.lines")}</CardTitle></CardHeader>
          <CardContent><LinesEditor lines={lines} onChange={setLines} mode="requisition" /></CardContent>
        </Card>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={() => save(false)} loading={busy === "draft"} disabled={!!busy}>{t("po.common.saveDraft")}</Button>
          <Button type="submit" loading={busy === "submit"} disabled={!!busy}>{t("ui.submitForApproval")}</Button>
        </div>
      </form>
    </div>
  );
}
