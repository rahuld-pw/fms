"use client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowRightLeft, Plus, SlidersHorizontal } from "lucide-react";
import { useCan, useSession } from "@/components/app/session";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataTable } from "@/components/shared/data-table";
import { Money } from "@/components/shared/format";
import { PageHeader } from "@/components/shared/page-header";
import { ResourceFormDialog } from "@/components/shared/resource-form";
import { StatusBadge } from "@/components/shared/status";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/utils/cn";
import { humanize } from "@/lib/utils/format";
import { currentFy, useFiscalYears } from "../dashboard";

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function BudgetsPage() {
  const can = useCan();
  const { campuses, departments } = useSession();
  const { data: fys } = useFiscalYears();
  const [fyId, setFyId] = useState<string | null>(null);
  const fy = fyId ?? currentFy(fys)?.id;
  const [dialog, setDialog] = useState<"new" | "category" | "carry" | { amend: any } | null>(null);
  const { data: lines, isLoading } = useQuery({ queryKey: ["/budget-summary", fy], queryFn: () => api<any[]>(`/budget-summary?fiscal_year_id=${fy}`), enabled: !!fy });
  const { data: cats = [] } = useQuery({ queryKey: ["/expense-categories"], queryFn: () => api<any[]>("/expense-categories?limit=200") });
  const name = (list: { id: string; name: string }[], id: string | null) => list.find((x) => x.id === id)?.name ?? "All";
  return (
    <div>
      <PageHeader
        title="Budgets"
        description="Budget lines per fiscal year × campus × department × category, with commitments and actuals."
        actions={
          <>
            {can("budget:manage", {}, "strict") && <Button variant="outline" onClick={() => setDialog("carry")}><ArrowRightLeft /> Carry forward</Button>}
            {can("budget:create") && <Button onClick={() => setDialog("new")}><Plus /> Budget line</Button>}
          </>
        }
      />
      <Tabs defaultValue="lines">
        <TabsList>
          <TabsTrigger value="lines">Budget lines</TabsTrigger>
          <TabsTrigger value="categories">Expense categories</TabsTrigger>
        </TabsList>
        <TabsContent value="lines" className="flex flex-col gap-3">
          <NativeSelect className="w-40" value={fy ?? ""} onChange={(e) => setFyId(e.target.value)} aria-label="Fiscal year">
            {fys?.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </NativeSelect>
          {isLoading ? <Skeleton className="h-60" /> : (
            <Card>
              <Table>
                <THead>
                  <TR>
                    <TH>Campus</TH><TH>Department</TH><TH>Category</TH><TH>Control</TH>
                    <TH className="text-right">Budget</TH><TH className="text-right">Committed</TH><TH className="text-right">Actual</TH><TH className="text-right">Available</TH>
                    <TH className="w-32">Used</TH><TH />
                  </TR>
                </THead>
                <TBody>
                  {lines?.length === 0 && <TR><TD colSpan={10} className="py-8 text-center text-muted-foreground">No budget lines for this year.</TD></TR>}
                  {lines?.map((l) => {
                    const pct = Number(l.utilisation_pct ?? 0);
                    return (
                      <TR key={l.budget_id}>
                        <TD>{name(campuses, l.campus_id)}</TD>
                        <TD>{name(departments, l.department_id)}</TD>
                        <TD className="font-medium">{name(cats, l.category_id)}</TD>
                        <TD><StatusBadge status={l.control_mode === "hard" ? "blocked" : l.control_mode === "soft" ? "warning" : "ok"} label={humanize(l.control_mode)} /></TD>
                        <TD className="text-right"><Money value={l.total_budget} /></TD>
                        <TD className="text-right"><Money value={l.committed_amount} /></TD>
                        <TD className="text-right"><Money value={l.actual_amount} /></TD>
                        <TD className={cn("text-right", Number(l.available_amount) < 0 && "font-medium text-destructive")}><Money value={l.available_amount} /></TD>
                        <TD><div className="flex items-center gap-2"><Progress value={pct} tone={pct > 100 ? "destructive" : pct > Number(l.warning_threshold_pct) ? "warning" : "primary"} /><span className="w-10 text-right text-xs tabular">{l.utilisation_pct ?? 0}%</span></div></TD>
                        <TD>
                          {can("budget:update", { campusId: l.campus_id, departmentId: l.department_id }, "auto") && (
                            <Button size="xs" variant="ghost" onClick={() => setDialog({ amend: l })}><SlidersHorizontal /> Amend</Button>
                          )}
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </Card>
          )}
        </TabsContent>
        <TabsContent value="categories">
          <DataTable
            id="expense-categories"
            endpoint="/expense-categories"
            defaultSort="name"
            columns={[
              { key: "code", header: "Code", className: "font-mono text-xs" },
              { key: "name", header: "Category", pinned: true, render: (r) => <span className="font-medium">{r.name}</span> },
              { key: "gl_code", header: "GL code" },
              { key: "per_claim_limit", header: "Per-claim limit", align: "right", render: (r) => (r.per_claim_limit ? <><Money value={r.per_claim_limit} /> <span className="text-xs text-muted-foreground">({r.limit_mode})</span></> : "—") },
              { key: "receipt_required_above", header: "Receipt above", align: "right", render: (r) => <Money value={r.receipt_required_above} /> },
              { key: "active", header: "Active", render: (r) => (r.active ? "Yes" : "No") },
            ]}
            toolbar={can("budget:manage", {}, "strict") && <Button size="sm" onClick={() => setDialog("category")}><Plus /> Category</Button>}
          />
        </TabsContent>
      </Tabs>
      <ResourceFormDialog
        open={dialog === "new"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="New budget line"
        endpoint="/budgets"
        fields={[
          { name: "fiscal_year_id", label: "Fiscal year", type: "select", required: true, options: (fys ?? []).map((f) => ({ value: f.id, label: f.label })) },
          { name: "category_id", label: "Category", type: "select", required: true, options: cats.map((c) => ({ value: c.id, label: c.name })) },
          { name: "campus_id", label: "Campus", type: "campus", hint: "Leave empty for an org-wide line" },
          { name: "department_id", label: "Department", type: "department", campusField: "campus_id" },
          { name: "allocated_amount", label: "Allocated amount", type: "money", required: true },
          { name: "control_mode", label: "Control", type: "select", required: true, options: [{ value: "soft", label: "Soft (warn when exceeded)" }, { value: "hard", label: "Hard (block when exceeded)" }, { value: "none", label: "None" }] },
          { name: "warning_threshold_pct", label: "Warn at % used", type: "number" },
          { name: "allow_carry_forward", label: "Unused amount can carry forward", type: "switch" },
        ]}
        defaultValues={{ fiscal_year_id: fy, control_mode: "soft", warning_threshold_pct: 90 }}
        invalidate={["/budget-summary"]}
      />
      <ResourceFormDialog
        open={typeof dialog === "object" && dialog !== null}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Request budget amendment"
        description="Increases or decreases go through the budget-amendment approval policy."
        endpoint={typeof dialog === "object" && dialog ? `/budgets/${dialog.amend.budget_id}/amendments` : "/"}
        fields={[
          { name: "amount_delta", label: "Change (use negative to reduce)", type: "number", required: true },
          { name: "reason", label: "Reason", type: "textarea", required: true },
        ]}
        submitLabel="Submit for approval"
        invalidate={["/budget-summary"]}
      />
      <ResourceFormDialog
        open={dialog === "category"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="New expense category"
        endpoint="/expense-categories"
        fields={[
          { name: "name", label: "Name", required: true },
          { name: "code", label: "Code", required: true },
          { name: "gl_code", label: "GL code" },
          { name: "per_claim_limit", label: "Per-claim limit", type: "money" },
          { name: "limit_mode", label: "Limit", type: "select", options: [{ value: "soft", label: "Soft (warn)" }, { value: "hard", label: "Hard (block)" }] },
          { name: "receipt_required_above", label: "Receipt required above", type: "money" },
        ]}
        defaultValues={{ limit_mode: "soft", receipt_required_above: 0 }}
        invalidate={["/expense-categories"]}
      />
      <ResourceFormDialog
        open={dialog === "carry"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Carry forward unused budget"
        description="Creates draft lines in the target year for budget lines that allow carry-forward."
        endpoint="/budgets/carry-forward"
        fields={[
          { name: "from_fiscal_year_id", label: "From", type: "select", required: true, options: (fys ?? []).map((f) => ({ value: f.id, label: f.label })) },
          { name: "to_fiscal_year_id", label: "To", type: "select", required: true, options: (fys ?? []).map((f) => ({ value: f.id, label: f.label })) },
          { name: "percent", label: "Percent of unused", type: "number" },
        ]}
        defaultValues={{ percent: 100 }}
        invalidate={["/budget-summary"]}
      />
    </div>
  );
}
