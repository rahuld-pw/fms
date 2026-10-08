"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { useSession } from "@/components/app/session";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { CampusSelect, DepartmentSelect, Field, ResourcePicker } from "@/components/shared/fields";
import { PageHeader } from "@/components/shared/page-header";
import { api, errorMessage } from "@/lib/client/api";
import { useT } from "@/lib/i18n/client";
import { emptyLine, LinesEditor, poLinePayload, type LineDraft } from "../../lines-editor";

export default function NewPoPage() {
  const { t } = useT();
  const router = useRouter();
  const { campuses } = useSession();
  const [campus, setCampus] = useState<string | null>(campuses.length === 1 ? campuses[0].id : null);
  const [dept, setDept] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [vendor, setVendor] = useState<string | null>(null);
  const [location, setLocation] = useState<string | null>(null);
  const [expected, setExpected] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("30 days from invoice");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [busy, setBusy] = useState<"draft" | "submit" | null>(null);

  const save = async (submit: boolean) => {
    if (!campus || !vendor) return toast.error(t("po.newOrder.chooseCampusVendor"));
    if (!lines.length) return toast.error(t("po.common.addOneLine"));
    setBusy(submit ? "submit" : "draft");
    try {
      const po = await api<{ id: string }>("/purchase-orders", {
        body: {
          campus_id: campus, department_id: dept ?? undefined, category_id: category ?? undefined, vendor_id: vendor,
          delivery_location_id: location ?? undefined, expected_delivery: expected || undefined, payment_terms: paymentTerms || undefined,
          notes: notes || undefined, lines: lines.map(poLinePayload),
        },
        idempotencyKey: crypto.randomUUID(),
      });
      if (submit) {
        const r = await api<{ result: { status: string } }>(`/purchase-orders/${po.id}/submit`, { body: {} });
        toast.success(r.result?.status === "approved" ? t("po.common.submittedAutoApproved") : t("po.common.submittedForApproval"));
      } else toast.success(t("po.common.draftSaved"));
      router.push(`/po/orders/${po.id}`);
    } catch (e) {
      toast.error(errorMessage(e));
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={t("po.newOrder.title")} breadcrumbs={[{ label: t("po.common.purchaseOrders"), href: "/po/orders" }, { label: t("po.common.new") }]} />
      <form onSubmit={(e) => { e.preventDefault(); save(true); }} className="flex flex-col gap-4">
        <Card>
          <CardContent className="grid gap-4 pt-4 sm:grid-cols-2">
            <Field label={t("ui.vendor")} required className="sm:col-span-2">
              <ResourcePicker endpoint="/vendors?status=approved" hintKey="code" value={vendor} onChange={(v) => setVendor(v as string | null)} />
            </Field>
            <Field label={t("ui.campus")} required hint={t("po.newOrder.campusHint")}><CampusSelect value={campus} onChange={setCampus} /></Field>
            <Field label={t("ui.department")}><DepartmentSelect value={dept} onChange={setDept} campusId={campus} /></Field>
            <Field label={t("po.common.budgetCategory")}>
              <ResourcePicker endpoint="/expense-categories" value={category} onChange={(v) => setCategory(v as string | null)} placeholder={t("ui.optional")} />
            </Field>
            <Field label={t("po.common.expectedDelivery")}><Input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} /></Field>
            <Field label={t("po.newOrder.deliverTo")}>
              <ResourcePicker endpoint="/locations" value={location} onChange={(v) => setLocation(v as string | null)} placeholder={t("ui.optional")} />
            </Field>
            <Field label={t("po.common.paymentTerms")}><Input value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} /></Field>
            <Field label={t("po.newOrder.notesToVendor")} className="sm:col-span-2"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t("ui.lines")}</CardTitle></CardHeader>
          <CardContent><LinesEditor lines={lines} onChange={setLines} mode="po" /></CardContent>
        </Card>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={() => save(false)} loading={busy === "draft"} disabled={!!busy}>{t("po.common.saveDraft")}</Button>
          <Button type="submit" loading={busy === "submit"} disabled={!!busy}>{t("ui.submitForApproval")}</Button>
        </div>
      </form>
    </div>
  );
}
