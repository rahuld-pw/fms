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
import { emptyLine, LinesEditor, reqLinePayload, type LineDraft } from "../../lines-editor";

export default function NewRequisitionPage() {
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
    if (!campus) return toast.error("Choose a campus");
    if (!lines.length) return toast.error("Add at least one line");
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
        toast.success(r.status === "approved" ? "Submitted and auto-approved" : "Submitted for approval", {
          description: r.budget_check?.result === "warning" ? r.budget_check.message : undefined,
        });
      } else toast.success("Draft saved");
      router.push(`/po/requisitions/${req.id}`);
    } catch (e) {
      toast.error(errorMessage(e));
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="New requisition" breadcrumbs={[{ label: "Requisitions", href: "/po/requisitions" }, { label: "New" }]} description={`Requested by ${user.full_name}`} />
      <form onSubmit={(e) => { e.preventDefault(); save(true); }} className="flex flex-col gap-4">
        <Card>
          <CardContent className="grid gap-4 pt-4 sm:grid-cols-2">
            <Field label="Title" required className="sm:col-span-2">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} required minLength={3} placeholder="e.g. Lab glassware for Grade 11" />
            </Field>
            <Field label="Campus" required><CampusSelect value={campus} onChange={setCampus} /></Field>
            <Field label="Department" hint="Budget and approvals follow the department"><DepartmentSelect value={dept} onChange={setDept} campusId={campus} /></Field>
            <Field label="Budget category">
              <ResourcePicker endpoint="/expense-categories" value={category} onChange={(v) => setCategory(v as string | null)} placeholder="Optional" />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Needed by"><Input type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} /></Field>
              <Field label="Priority">
                <NativeSelect value={priority} onChange={(e) => setPriority(e.target.value)}>
                  {["low", "medium", "high", "urgent"].map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
                </NativeSelect>
              </Field>
            </div>
            <Field label="Justification" className="sm:col-span-2">
              <Textarea value={justification} onChange={(e) => setJustification(e.target.value)} rows={2} placeholder="Why is this needed?" />
            </Field>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Lines</CardTitle></CardHeader>
          <CardContent><LinesEditor lines={lines} onChange={setLines} mode="requisition" /></CardContent>
        </Card>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={() => save(false)} loading={busy === "draft"} disabled={!!busy}>Save draft</Button>
          <Button type="submit" loading={busy === "submit"} disabled={!!busy}>Submit for approval</Button>
        </div>
      </form>
    </div>
  );
}
