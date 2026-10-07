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
import { emptyLine, LinesEditor, poLinePayload, type LineDraft } from "../../lines-editor";

export default function NewPoPage() {
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
    if (!campus || !vendor) return toast.error("Choose a campus and vendor");
    if (!lines.length) return toast.error("Add at least one line");
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
        toast.success(r.result?.status === "approved" ? "Submitted and auto-approved" : "Submitted for approval");
      } else toast.success("Draft saved");
      router.push(`/po/orders/${po.id}`);
    } catch (e) {
      toast.error(errorMessage(e));
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="New purchase order" breadcrumbs={[{ label: "Purchase orders", href: "/po/orders" }, { label: "New" }]} />
      <form onSubmit={(e) => { e.preventDefault(); save(true); }} className="flex flex-col gap-4">
        <Card>
          <CardContent className="grid gap-4 pt-4 sm:grid-cols-2">
            <Field label="Vendor" required className="sm:col-span-2">
              <ResourcePicker endpoint="/vendors?status=approved" hintKey="code" value={vendor} onChange={(v) => setVendor(v as string | null)} />
            </Field>
            <Field label="Campus" required hint="PO number series and GST type follow the campus"><CampusSelect value={campus} onChange={setCampus} /></Field>
            <Field label="Department"><DepartmentSelect value={dept} onChange={setDept} campusId={campus} /></Field>
            <Field label="Budget category">
              <ResourcePicker endpoint="/expense-categories" value={category} onChange={(v) => setCategory(v as string | null)} placeholder="Optional" />
            </Field>
            <Field label="Expected delivery"><Input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} /></Field>
            <Field label="Deliver to">
              <ResourcePicker endpoint="/locations" value={location} onChange={(v) => setLocation(v as string | null)} placeholder="Optional" />
            </Field>
            <Field label="Payment terms"><Input value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} /></Field>
            <Field label="Notes to vendor" className="sm:col-span-2"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Lines</CardTitle></CardHeader>
          <CardContent><LinesEditor lines={lines} onChange={setLines} mode="po" /></CardContent>
        </Card>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={() => save(false)} loading={busy === "draft"} disabled={!!busy}>Save draft</Button>
          <Button type="submit" loading={busy === "submit"} disabled={!!busy}>Submit for approval</Button>
        </div>
      </form>
    </div>
  );
}
