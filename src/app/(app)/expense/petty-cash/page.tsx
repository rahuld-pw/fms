"use client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Plus } from "lucide-react";
import { useCan, useSession } from "@/components/app/session";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Money } from "@/components/shared/format";
import { EmptyState, PageHeader } from "@/components/shared/page-header";
import { ResourceFormDialog } from "@/components/shared/resource-form";
import { api, apiList } from "@/lib/client/api";
import { cn } from "@/lib/utils/cn";

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function PettyCashPage() {
  const can = useCan();
  const { user, campuses } = useSession();
  const [selected, setSelected] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"fund" | "expense" | "topup" | null>(null);
  const funds = useQuery({ queryKey: ["/petty-cash-funds"], queryFn: () => apiList<any>("/petty-cash-funds?limit=100") });
  const fund = funds.data?.data.find((f) => f.id === selected) ?? funds.data?.data[0];
  const txns = useQuery({ queryKey: ["petty-cash-txns", fund?.id], queryFn: () => api<any[]>(`/petty-cash-funds/${fund!.id}/transactions`), enabled: !!fund });
  const canTopup = fund && can("petty_cash:update", { campusId: fund.campus_id, departmentId: fund.department_id }, "auto");
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Petty cash" description="Imprest funds held by custodians. Expenses post to budgets automatically." actions={can("petty_cash:create") && <Button variant="outline" onClick={() => setDialog("fund")}><Plus /> New fund</Button>} />
      {funds.isLoading && <Skeleton className="h-40" />}
      {funds.data?.data.length === 0 && <EmptyState title="No petty cash funds" description="Create a fund and assign a custodian." />}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {funds.data?.data.map((f) => (
          <button key={f.id} onClick={() => setSelected(f.id)} className={cn("rounded-lg border bg-card p-4 text-left transition-colors hover:border-foreground/20", fund?.id === f.id && "border-primary ring-1 ring-primary")}>
            <p className="text-sm font-medium">{f.name}</p>
            <p className="text-xs text-muted-foreground">{f.custodian?.full_name} · {f.campus?.name}</p>
            <p className={cn("mt-2 text-2xl font-semibold tabular", Number(f.balance) <= Number(f.low_balance_threshold) && "text-destructive")}><Money value={f.balance} /></p>
            <Progress value={(Number(f.balance) / Math.max(1, Number(f.float_amount))) * 100} className="mt-2" />
            <p className="mt-1 text-xs text-muted-foreground">of <Money value={f.float_amount} /> float</p>
          </button>
        ))}
      </div>
      {fund && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>{fund.name}: transactions</CardTitle>
            <div className="flex gap-2">
              {(fund.custodian_id === user.id || canTopup) && <Button size="sm" onClick={() => setDialog("expense")}><ArrowUpRight /> Record expense</Button>}
              {canTopup && <Button size="sm" variant="outline" onClick={() => setDialog("topup")}><ArrowDownLeft /> Top up</Button>}
            </div>
          </CardHeader>
          <CardContent className="divide-y p-0">
            {txns.data?.length === 0 && <p className="p-4 text-sm text-muted-foreground">No transactions.</p>}
            {txns.data?.map((t) => (
              <div key={t.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                {t.direction > 0 ? <ArrowDownLeft className="size-4 text-primary" /> : <ArrowUpRight className="size-4 text-muted-foreground" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate">{t.description}</p>
                  <p className="text-xs text-muted-foreground">{t.txn_date} · {t.category?.name ?? t.txn_type} · {t.creator?.full_name}</p>
                </div>
                <Money value={t.amount * t.direction} className={cn(t.direction > 0 && "text-primary")} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      <ResourceFormDialog
        open={dialog === "fund"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="New petty cash fund"
        endpoint="/petty-cash-funds"
        fields={[
          { name: "name", label: "Name", required: true },
          { name: "campus_id", label: "Campus", type: "campus", required: true },
          { name: "department_id", label: "Department", type: "department", campusField: "campus_id" },
          { name: "custodian_id", label: "Custodian", type: "user", required: true },
          { name: "float_amount", label: "Float (imprest) amount", type: "money", required: true },
          { name: "low_balance_threshold", label: "Alert below", type: "money" },
        ]}
        defaultValues={{ campus_id: campuses.length === 1 ? campuses[0].id : "" }}
        invalidate={["/petty-cash-funds"]}
      />
      {fund && (
        <ResourceFormDialog
          open={dialog === "expense" || dialog === "topup"}
          onOpenChange={(o) => !o && setDialog(null)}
          title={dialog === "topup" ? "Top up fund" : "Record petty cash expense"}
          endpoint={`/petty-cash-funds/${fund.id}/transactions`}
          fields={[
            { name: "amount", label: "Amount", type: "money", required: true },
            { name: "txn_date", label: "Date", type: "date" },
            ...(dialog === "expense" ? [{ name: "category_id", label: "Category", type: "resource" as const, endpoint: "/expense-categories", required: true }] : []),
            { name: "description", label: "Description", required: true, full: true },
          ]}
          defaultValues={{ txn_date: new Date().toISOString().slice(0, 10) }}
          transform={(b) => ({ ...b, txn_type: dialog === "topup" ? "topup" : "expense" })}
          invalidate={["/petty-cash-funds", "petty-cash-txns"]}
        />
      )}
    </div>
  );
}
