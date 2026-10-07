"use client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { BudgetBars, ColumnChart } from "@/components/shared/charts";
import { Money, useMoney } from "@/components/shared/format";
import { Stat } from "@/components/shared/page-header";
import { api, apiList } from "@/lib/client/api";
import { cn } from "@/lib/utils/cn";

interface FY { id: string; label: string; start_date: string; end_date: string }
interface Group { group_id: string | null; group_name: string; total_budget: number; committed: number; actual: number; available: number; utilisation_pct: number | null }

export function useFiscalYears() {
  return useQuery({ queryKey: ["fiscal-years"], queryFn: () => apiList<FY>("/fiscal-years?limit=20").then((r) => r.data) });
}
export function currentFy(fys: FY[] | undefined) {
  const today = new Date().toISOString().slice(0, 10);
  return fys?.find((f) => f.start_date <= today && f.end_date >= today) ?? fys?.[0];
}

export function ExpenseDashboard() {
  const fmt = useMoney();
  const { data: fys } = useFiscalYears();
  const [fyId, setFyId] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<"department" | "category" | "campus">("department");
  const fy = fyId ?? currentFy(fys)?.id;
  const { data, isLoading } = useQuery({
    queryKey: ["expense-dashboard", fy, groupBy],
    queryFn: () => api<{ groups: Group[]; monthly: { month: string; committed: number | null; actual: number | null }[] }>(`/expense/dashboard?fiscal_year_id=${fy}&group_by=${groupBy}`),
    enabled: !!fy,
  });
  const totals = (data?.groups ?? []).reduce(
    (t, g) => ({ budget: t.budget + Number(g.total_budget), committed: t.committed + Number(g.committed), actual: t.actual + Number(g.actual) }),
    { budget: 0, committed: 0, actual: 0 },
  );
  const available = totals.budget - totals.committed - totals.actual;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <NativeSelect className="w-40" value={fy ?? ""} onChange={(e) => setFyId(e.target.value)} aria-label="Fiscal year">
          {fys?.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
        </NativeSelect>
        <div className="flex rounded-md border p-0.5" role="tablist" aria-label="Group by">
          {(["department", "category", "campus"] as const).map((g) => (
            <button key={g} role="tab" aria-selected={groupBy === g} onClick={() => setGroupBy(g)} className={cn("rounded px-2.5 py-1 text-sm capitalize", groupBy === g ? "bg-muted font-medium" : "text-muted-foreground")}>
              {g}
            </button>
          ))}
        </div>
        <Button variant="outline" size="sm" className="ml-auto" asChild>
          <a href={`/api/v1/budget-summary/export?fiscal_year_id=${fy}`}><Download /> Export</a>
        </Button>
      </div>
      {isLoading || !data ? (
        <Skeleton className="h-64" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Total budget" value={<Money value={totals.budget} compact />} />
            <Stat label="Committed (open POs)" value={<Money value={totals.committed} compact />} />
            <Stat label="Actual spend" value={<Money value={totals.actual} compact />} hint={totals.budget ? `${Math.round((totals.actual / totals.budget) * 100)}% of budget` : undefined} />
            <Stat label="Available" value={<Money value={available} compact />} tone={available < 0 ? "danger" : "good"} />
          </div>
          <div className="grid gap-4 lg:grid-cols-5">
            <Card className="lg:col-span-3">
              <CardHeader>
                <div>
                  <CardTitle>Budget utilisation by {groupBy}</CardTitle>
                  <CardDescription>Hover a row for amounts. The tick marks the budget.</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <BudgetBars
                  format={(v) => fmt(v)}
                  rows={data.groups.map((g) => ({ id: g.group_id ?? g.group_name, label: g.group_name, total: Number(g.total_budget), committed: Number(g.committed), actual: Number(g.actual) }))}
                />
              </CardContent>
            </Card>
            <Card className="lg:col-span-2">
              <CardHeader>
                <div>
                  <CardTitle>Monthly spend</CardTitle>
                  <CardDescription>Actual and new commitments per month</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <ColumnChart
                  ariaLabel="Monthly actual spend and commitments"
                  data={data.monthly.map((m) => ({ month: m.month, actual: Number(m.actual ?? 0), committed: Number(m.committed ?? 0) }))}
                  x="month"
                  series={[
                    { key: "actual", label: "Actual", color: "var(--chart-1)" },
                    { key: "committed", label: "Committed", color: "var(--chart-2)" },
                  ]}
                  formatX={(d) => new Date(d).toLocaleDateString("en-IN", { month: "short" })}
                  formatY={(v) => fmt(v, true)}
                />
              </CardContent>
            </Card>
          </div>
          <Card>
            <Table>
              <THead>
                <TR>
                  <TH className="capitalize">{groupBy}</TH>
                  <TH className="text-right">Budget</TH>
                  <TH className="text-right">Committed</TH>
                  <TH className="text-right">Actual</TH>
                  <TH className="text-right">Available</TH>
                  <TH className="text-right">Used</TH>
                </TR>
              </THead>
              <TBody>
                {data.groups.map((g) => (
                  <TR key={g.group_id ?? g.group_name}>
                    <TD className="font-medium">{g.group_name}</TD>
                    <TD className="text-right"><Money value={g.total_budget} /></TD>
                    <TD className="text-right"><Money value={g.committed} /></TD>
                    <TD className="text-right"><Money value={g.actual} /></TD>
                    <TD className={cn("text-right", Number(g.available) < 0 && "font-medium text-destructive")}><Money value={g.available} /></TD>
                    <TD className="text-right">{g.utilisation_pct === null ? "—" : `${g.utilisation_pct}%`}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>
        </>
      )}
    </div>
  );
}
