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
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils/cn";

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function PettyCashPage() {
  const can = useCan();
  const { t } = useT();
  const [ofFloatBefore, ofFloatAfter = ""] = t("expense.pettyCash.ofFloat").split("{amount}");
  const { user, campuses } = useSession();
  const [selected, setSelected] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"fund" | "expense" | "topup" | null>(null);
  const funds = useQuery({ queryKey: ["/petty-cash-funds"], queryFn: () => apiList<any>("/petty-cash-funds?limit=100") });
  const fund = funds.data?.data.find((f) => f.id === selected) ?? funds.data?.data[0];
  const txns = useQuery({ queryKey: ["petty-cash-txns", fund?.id], queryFn: () => api<any[]>(`/petty-cash-funds/${fund!.id}/transactions`), enabled: !!fund });
  const canTopup = fund && can("petty_cash:update", { campusId: fund.campus_id, departmentId: fund.department_id }, "auto");
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={t("expense.pettyCash.title")} description={t("expense.pettyCash.description")} actions={can("petty_cash:create") && <Button variant="outline" onClick={() => setDialog("fund")}><Plus /> {t("expense.pettyCash.newFund")}</Button>} />
      {funds.isLoading && <Skeleton className="h-40" />}
      {funds.data?.data.length === 0 && <EmptyState title={t("expense.pettyCash.emptyTitle")} description={t("expense.pettyCash.emptyDescription")} />}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {funds.data?.data.map((f) => (
          <button key={f.id} onClick={() => setSelected(f.id)} className={cn("rounded-lg border bg-card p-4 text-left transition-colors hover:border-foreground/20", fund?.id === f.id && "border-primary ring-1 ring-primary")}>
            <p className="text-sm font-medium">{f.name}</p>
            <p className="text-xs text-muted-foreground">{f.custodian?.full_name} · {f.campus?.name}</p>
            <p className={cn("mt-2 text-2xl font-semibold tabular", Number(f.balance) <= Number(f.low_balance_threshold) && "text-destructive")}><Money value={f.balance} /></p>
            <Progress value={(Number(f.balance) / Math.max(1, Number(f.float_amount))) * 100} className="mt-2" />
            <p className="mt-1 text-xs text-muted-foreground">{ofFloatBefore}<Money value={f.float_amount} />{ofFloatAfter}</p>
          </button>
        ))}
      </div>
      {fund && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>{t("expense.pettyCash.transactions", { name: fund.name })}</CardTitle>
            <div className="flex gap-2">
              {(fund.custodian_id === user.id || canTopup) && <Button size="sm" onClick={() => setDialog("expense")}><ArrowUpRight /> {t("expense.pettyCash.recordExpense")}</Button>}
              {canTopup && <Button size="sm" variant="outline" onClick={() => setDialog("topup")}><ArrowDownLeft /> {t("expense.pettyCash.topUp")}</Button>}
            </div>
          </CardHeader>
          <CardContent className="divide-y p-0">
            {txns.data?.length === 0 && <p className="p-4 text-sm text-muted-foreground">{t("expense.pettyCash.noTransactions")}</p>}
            {txns.data?.map((tx) => (
              <div key={tx.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                {tx.direction > 0 ? <ArrowDownLeft className="size-4 text-primary" /> : <ArrowUpRight className="size-4 text-muted-foreground" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate">{tx.description}</p>
                  <p className="text-xs text-muted-foreground">{tx.txn_date} · {tx.category?.name ?? t(`enum.txnType.${tx.txn_type}`, undefined, tx.txn_type)} · {tx.creator?.full_name}</p>
                </div>
                <Money value={tx.amount * tx.direction} className={cn(tx.direction > 0 && "text-primary")} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      <ResourceFormDialog
        open={dialog === "fund"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t("expense.pettyCash.newFundTitle")}
        endpoint="/petty-cash-funds"
        fields={[
          { name: "name", label: t("ui.name"), required: true },
          { name: "campus_id", label: t("ui.campus"), type: "campus", required: true },
          { name: "department_id", label: t("ui.department"), type: "department", campusField: "campus_id" },
          { name: "custodian_id", label: t("expense.pettyCash.custodian"), type: "user", required: true },
          { name: "float_amount", label: t("expense.pettyCash.floatAmount"), type: "money", required: true },
          { name: "low_balance_threshold", label: t("expense.pettyCash.alertBelow"), type: "money" },
        ]}
        defaultValues={{ campus_id: campuses.length === 1 ? campuses[0].id : "" }}
        invalidate={["/petty-cash-funds"]}
      />
      {fund && (
        <ResourceFormDialog
          open={dialog === "expense" || dialog === "topup"}
          onOpenChange={(o) => !o && setDialog(null)}
          title={dialog === "topup" ? t("expense.pettyCash.topUpTitle") : t("expense.pettyCash.recordExpenseTitle")}
          endpoint={`/petty-cash-funds/${fund.id}/transactions`}
          fields={[
            { name: "amount", label: t("ui.amount"), type: "money", required: true },
            { name: "txn_date", label: t("ui.date"), type: "date" },
            ...(dialog === "expense" ? [{ name: "category_id", label: t("ui.category"), type: "resource" as const, endpoint: "/expense-categories", required: true }] : []),
            { name: "description", label: t("ui.description"), required: true, full: true },
          ]}
          defaultValues={{ txn_date: new Date().toISOString().slice(0, 10) }}
          transform={(b) => ({ ...b, txn_type: dialog === "topup" ? "topup" : "expense" })}
          invalidate={["/petty-cash-funds", "petty-cash-txns"]}
        />
      )}
    </div>
  );
}
