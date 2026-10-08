"use client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Paperclip } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/components/app/session";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { CampusSelect, DepartmentSelect, Field, ResourcePicker } from "@/components/shared/fields";
import { PageHeader } from "@/components/shared/page-header";
import { api, errorMessage, uploadToSigned } from "@/lib/client/api";
import { useT } from "@/lib/i18n/client";
import { emptyItem, ItemsEditor, toPayload, type ItemDraft } from "../items-editor";

export default function NewClaimPage() {
  const router = useRouter();
  const { t } = useT();
  const { campuses, user } = useSession();
  const [campus, setCampus] = useState<string | null>(campuses.length === 1 ? campuses[0].id : null);
  const [dept, setDept] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState("reimbursement");
  const [advance, setAdvance] = useState<string | null>(null);
  const [items, setItems] = useState<ItemDraft[]>([emptyItem()]);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState<"draft" | "submit" | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const save = async (submit: boolean) => {
    if (busy) return;
    if (!campus) return toast.error(t("expense.newClaim.chooseCampus"));
    setBusy(submit ? "submit" : "draft");
    try {
      const claim = await api<{ id: string; number: string }>("/expense-claims", {
        body: { campus_id: campus, department_id: dept ?? undefined, title, description: description || undefined, claim_type: type, advance_id: advance ?? undefined, items: items.map(toPayload) },
        idempotencyKey: crypto.randomUUID(),
      });
      for (const f of files) {
        const up = await api<{ upload: { url: string } }>("/attachments", { body: { entity_type: "expense_claim", entity_id: claim.id, file_name: f.name, mime_type: f.type || "application/pdf", size_bytes: f.size, kind: "receipt" } });
        await uploadToSigned(up.upload.url, f);
      }
      if (submit) {
        const r = await api<{ status: string; budget_checks: { result: string; message?: string }[] }>(`/expense-claims/${claim.id}/submit`, { body: {} });
        const warn = r.budget_checks.find((b) => b.result === "warning");
        toast.success(r.status === "approved" ? t("expense.newClaim.submittedAutoApproved") : t("expense.newClaim.submittedForApproval"), { description: warn?.message });
      } else toast.success(t("expense.newClaim.draftSaved"));
      router.push(`/expense/claims/${claim.id}`);
    } catch (e) {
      toast.error(errorMessage(e));
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={t("expense.newClaim.title")} breadcrumbs={[{ label: t("expense.claims.breadcrumb"), href: "/expense/claims" }, { label: t("expense.newClaim.breadcrumbNew") }]} description={t("expense.newClaim.claimant", { name: user.full_name ?? "" })} />
      <form onSubmit={(e) => { e.preventDefault(); save(true); }} className="flex flex-col gap-4">
        <Card>
          <CardContent className="grid gap-4 pt-4 sm:grid-cols-2">
            <Field label={t("ui.title")} required className="sm:col-span-2">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} required minLength={3} placeholder={t("expense.newClaim.titlePlaceholder")} />
            </Field>
            <Field label={t("ui.campus")} required><CampusSelect value={campus} onChange={setCampus} /></Field>
            <Field label={t("ui.department")} hint={t("expense.newClaim.departmentHint")}><DepartmentSelect value={dept} onChange={setDept} campusId={campus} /></Field>
            <Field label={t("ui.type")}>
              <NativeSelect value={type} onChange={(e) => setType(e.target.value)}>
                <option value="reimbursement">{t("expense.newClaim.typeReimbursement")}</option>
                <option value="advance_settlement">{t("expense.newClaim.typeAdvanceSettlement")}</option>
                <option value="petty_cash_replenishment">{t("expense.newClaim.typePettyCash")}</option>
              </NativeSelect>
            </Field>
            {type === "advance_settlement" && (
              <Field label={t("expense.newClaim.advance")}>
                <ResourcePicker endpoint="/expense-advances?status=disbursed&user_id=me" labelKey="purpose" hintKey="number" value={advance} onChange={(v) => setAdvance(v as string | null)} />
              </Field>
            )}
            <Field label={t("ui.notes")} className="sm:col-span-2"><Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} /></Field>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t("ui.items")}</CardTitle></CardHeader>
          <CardContent><ItemsEditor items={items} onChange={setItems} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t("expense.newClaim.receipts")}</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-2">
            {files.map((f, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <Paperclip className="size-4 text-muted-foreground" /> {f.name}
                <button type="button" className="ml-auto text-xs text-muted-foreground hover:text-destructive" onClick={() => setFiles(files.filter((_, j) => j !== i))}>{t("ui.remove")}</button>
              </div>
            ))}
            <input ref={fileRef} type="file" multiple accept="image/*,application/pdf" className="hidden" onChange={(e) => setFiles([...files, ...Array.from(e.target.files ?? [])])} />
            <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => fileRef.current?.click()}>
              <Paperclip /> {t("expense.newClaim.addReceipts")}
            </Button>
          </CardContent>
        </Card>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={() => save(false)} loading={busy === "draft"} disabled={!!busy}>{t("expense.newClaim.saveDraft")}</Button>
          <Button type="submit" loading={busy === "submit"} disabled={!!busy}>{t("ui.submitForApproval")}</Button>
        </div>
      </form>
    </div>
  );
}
