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
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils/cn";
import { humanize } from "@/lib/utils/format";
import { currentFy, useFiscalYears } from "../dashboard";

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function BudgetsPage() {
  const can = useCan();
  const { t } = useT();
  const { campuses, departments } = useSession();
  const { data: fys } = useFiscalYears();
  const [fyId, setFyId] = useState<string | null>(null);
  const fy = fyId ?? currentFy(fys)?.id;
  const [dialog, setDialog] = useState<"new" | "category" | "carry" | { amend: any } | null>(null);
  const { data: lines, isLoading } = useQuery({ queryKey: ["/budget-summary", fy], queryFn: () => api<any[]>(`/budget-summary?fiscal_year_id=${fy}`), enabled: !!fy });
  const { data: cats = [] } = useQuery({ queryKey: ["/expense-categories"], queryFn: () => api<any[]>("/expense-categories?limit=200") });
  const name = (list: { id: string; name: string }[], id: string | null) => list.find((x) => x.id === id)?.name ?? t("ui.all");
  return (
    <div>
      <PageHeader
        title={t("expense.budgets.title")}
        description={t("expense.budgets.description")}
        actions={
          <>
            {can("budget:manage", {}, "strict") && <Button variant="outline" onClick={() => setDialog("carry")}><ArrowRightLeft /> {t("expense.budgets.carryForward")}</Button>}
            {can("budget:create") && <Button onClick={() => setDialog("new")}><Plus /> {t("expense.budgets.budgetLine")}</Button>}
          </>
        }
      />
      <Tabs defaultValue="lines">
        <TabsList>
          <TabsTrigger value="lines">{t("expense.budgets.tabLines")}</TabsTrigger>
          <TabsTrigger value="categories">{t("expense.budgets.tabCategories")}</TabsTrigger>
        </TabsList>
        <TabsContent value="lines" className="flex flex-col gap-3">
          <NativeSelect className="w-40" value={fy ?? ""} onChange={(e) => setFyId(e.target.value)} aria-label={t("expense.dashboard.fiscalYear")}>
            {fys?.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </NativeSelect>
          {isLoading ? <Skeleton className="h-60" /> : (
            <Card>
              <Table>
                <THead>
                  <TR>
                    <TH>{t("ui.campus")}</TH><TH>{t("ui.department")}</TH><TH>{t("ui.category")}</TH><TH>{t("expense.budgets.control")}</TH>
                    <TH className="text-right">{t("ui.budget")}</TH><TH className="text-right">{t("expense.dashboard.committed")}</TH><TH className="text-right">{t("expense.dashboard.actual")}</TH><TH className="text-right">{t("expense.dashboard.available")}</TH>
                    <TH className="w-32">{t("expense.dashboard.used")}</TH><TH />
                  </TR>
                </THead>
                <TBody>
                  {lines?.length === 0 && <TR><TD colSpan={10} className="py-8 text-center text-muted-foreground">{t("expense.budgets.noLines")}</TD></TR>}
                  {lines?.map((l) => {
                    const pct = Number(l.utilisation_pct ?? 0);
                    return (
                      <TR key={l.budget_id}>
                        <TD>{name(campuses, l.campus_id)}</TD>
                        <TD>{name(departments, l.department_id)}</TD>
                        <TD className="font-medium">{name(cats, l.category_id)}</TD>
                        <TD><StatusBadge status={l.control_mode === "hard" ? "blocked" : l.control_mode === "soft" ? "warning" : "ok"} label={t(`enum.controlMode.${l.control_mode}`, undefined, humanize(l.control_mode))} /></TD>
                        <TD className="text-right"><Money value={l.total_budget} /></TD>
                        <TD className="text-right"><Money value={l.committed_amount} /></TD>
                        <TD className="text-right"><Money value={l.actual_amount} /></TD>
                        <TD className={cn("text-right", Number(l.available_amount) < 0 && "font-medium text-destructive")}><Money value={l.available_amount} /></TD>
                        <TD><div className="flex items-center gap-2"><Progress value={pct} tone={pct > 100 ? "destructive" : pct > Number(l.warning_threshold_pct) ? "warning" : "primary"} /><span className="w-10 text-right text-xs tabular">{l.utilisation_pct ?? 0}%</span></div></TD>
                        <TD>
                          {can("budget:update", { campusId: l.campus_id, departmentId: l.department_id }, "auto") && (
                            <Button size="xs" variant="ghost" onClick={() => setDialog({ amend: l })}><SlidersHorizontal /> {t("expense.budgets.amend")}</Button>
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
              { key: "code", header: t("ui.code"), className: "font-mono text-xs" },
              { key: "name", header: t("ui.category"), pinned: true, render: (r) => <span className="font-medium">{r.name}</span> },
              { key: "gl_code", header: t("expense.budgets.glCode") },
              { key: "per_claim_limit", header: t("expense.budgets.perClaimLimit"), align: "right", render: (r) => (r.per_claim_limit ? <><Money value={r.per_claim_limit} /> <span className="text-xs text-muted-foreground">({t(`enum.limitMode.${r.limit_mode}`, undefined, r.limit_mode)})</span></> : "—") },
              { key: "receipt_required_above", header: t("expense.budgets.receiptAbove"), align: "right", render: (r) => <Money value={r.receipt_required_above} /> },
              { key: "active", header: t("ui.active"), render: (r) => (r.active ? t("ui.yes") : t("ui.no")) },
            ]}
            toolbar={can("budget:manage", {}, "strict") && <Button size="sm" onClick={() => setDialog("category")}><Plus /> {t("expense.budgets.categoryButton")}</Button>}
          />
        </TabsContent>
      </Tabs>
      <ResourceFormDialog
        open={dialog === "new"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t("expense.budgets.newLineTitle")}
        endpoint="/budgets"
        fields={[
          { name: "fiscal_year_id", label: t("expense.dashboard.fiscalYear"), type: "select", required: true, options: (fys ?? []).map((f) => ({ value: f.id, label: f.label })) },
          { name: "category_id", label: t("ui.category"), type: "select", required: true, options: cats.map((c) => ({ value: c.id, label: c.name })) },
          { name: "campus_id", label: t("ui.campus"), type: "campus", hint: t("expense.budgets.campusHint") },
          { name: "department_id", label: t("ui.department"), type: "department", campusField: "campus_id" },
          { name: "allocated_amount", label: t("expense.budgets.allocatedAmount"), type: "money", required: true },
          { name: "control_mode", label: t("expense.budgets.control"), type: "select", required: true, options: [{ value: "soft", label: t("expense.budgets.controlSoft") }, { value: "hard", label: t("expense.budgets.controlHard") }, { value: "none", label: t("ui.none") }] },
          { name: "warning_threshold_pct", label: t("expense.budgets.warnAt"), type: "number" },
          { name: "allow_carry_forward", label: t("expense.budgets.allowCarryForward"), type: "switch" },
        ]}
        defaultValues={{ fiscal_year_id: fy, control_mode: "soft", warning_threshold_pct: 90 }}
        invalidate={["/budget-summary"]}
      />
      <ResourceFormDialog
        open={typeof dialog === "object" && dialog !== null}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t("expense.budgets.amendTitle")}
        description={t("expense.budgets.amendDescription")}
        endpoint={typeof dialog === "object" && dialog ? `/budgets/${dialog.amend.budget_id}/amendments` : "/"}
        fields={[
          { name: "amount_delta", label: t("expense.budgets.amountDelta"), type: "number", required: true },
          { name: "reason", label: t("expense.budgets.reason"), type: "textarea", required: true },
        ]}
        submitLabel={t("ui.submitForApproval")}
        invalidate={["/budget-summary"]}
      />
      <ResourceFormDialog
        open={dialog === "category"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t("expense.budgets.newCategoryTitle")}
        endpoint="/expense-categories"
        fields={[
          { name: "name", label: t("ui.name"), required: true },
          { name: "code", label: t("ui.code"), required: true },
          { name: "gl_code", label: t("expense.budgets.glCode") },
          { name: "per_claim_limit", label: t("expense.budgets.perClaimLimit"), type: "money" },
          { name: "limit_mode", label: t("expense.budgets.limit"), type: "select", options: [{ value: "soft", label: t("expense.budgets.limitSoft") }, { value: "hard", label: t("expense.budgets.limitHard") }] },
          { name: "receipt_required_above", label: t("expense.budgets.receiptRequiredAbove"), type: "money" },
        ]}
        defaultValues={{ limit_mode: "soft", receipt_required_above: 0 }}
        invalidate={["/expense-categories"]}
      />
      <ResourceFormDialog
        open={dialog === "carry"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t("expense.budgets.carryTitle")}
        description={t("expense.budgets.carryDescription")}
        endpoint="/budgets/carry-forward"
        fields={[
          { name: "from_fiscal_year_id", label: t("ui.from"), type: "select", required: true, options: (fys ?? []).map((f) => ({ value: f.id, label: f.label })) },
          { name: "to_fiscal_year_id", label: t("ui.to"), type: "select", required: true, options: (fys ?? []).map((f) => ({ value: f.id, label: f.label })) },
          { name: "percent", label: t("expense.budgets.percentUnused"), type: "number" },
        ]}
        defaultValues={{ percent: 100 }}
        invalidate={["/budget-summary"]}
      />
    </div>
  );
}
