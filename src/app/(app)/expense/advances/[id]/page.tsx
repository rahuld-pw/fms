"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { use, useState } from "react";
import { Banknote, Send } from "lucide-react";
import { useCan, useSession } from "@/components/app/session";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ApprovalPanel, Comments } from "@/components/shared/collaboration";
import { DateTime, Money } from "@/components/shared/format";
import { UserChip } from "@/components/shared/fields";
import { DetailGrid, PageHeader } from "@/components/shared/page-header";
import { useAction } from "@/components/shared/resource-form";
import { StatusBadge } from "@/components/shared/status";
import { api } from "@/lib/client/api";
import { useT } from "@/lib/i18n/client";

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function AdvancePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const { t } = useT();
  const can = useCan();
  const { user } = useSession();
  const { data: a, isLoading } = useQuery({ queryKey: ["advance", id], queryFn: () => api<any>(`/expense-advances/${id}`) });
  const [ref, setRef] = useState("");
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["advance", id] });
    qc.invalidateQueries({ queryKey: ["approvals", "expense_advance", id] });
  };
  const act = useAction({ success: t("ui.done"), onSuccess: refresh });
  if (isLoading || !a) return <Skeleton className="h-64" />;
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        breadcrumbs={[{ label: t("expense.advances.title"), href: "/expense/advances" }, { label: a.number }]}
        title={a.purpose}
        meta={<><StatusBadge status={a.status} /><Money value={a.amount} className="text-sm font-semibold" /></>}
        actions={a.status === "draft" && a.user_id === user.id && <Button size="sm" loading={act.isPending} onClick={() => act.mutate({ path: `/expense-advances/${id}/submit` })}><Send /> {t("ui.submit")}</Button>}
      />
      <div className="grid gap-4 md:grid-cols-[1fr_300px]">
        <div className="flex flex-col gap-4">
          <ApprovalPanel entityType="expense_advance" entityId={id} onDecided={refresh} />
          {a.status === "approved" && can("expense:pay", { campusId: a.campus_id, departmentId: a.department_id }, "auto") && (
            <Card>
              <CardContent className="flex flex-col gap-2 pt-4 sm:flex-row">
                <Input placeholder={t("expense.advances.disbursementReference")} value={ref} onChange={(e) => setRef(e.target.value)} />
                <Button disabled={!ref} loading={act.isPending} onClick={() => act.mutate({ path: `/expense-advances/${id}/disburse`, body: { reference: ref } })}><Banknote /> {t("expense.advances.disburse")}</Button>
              </CardContent>
            </Card>
          )}
          <Comments entityType="expense_advance" entityId={id} />
        </div>
        <Card className="h-fit">
          <CardContent className="pt-4">
            <DetailGrid items={[
              { label: t("expense.advances.requestedBy"), value: <UserChip name={a.user?.full_name} />, wide: true },
              { label: t("ui.campus"), value: a.campus?.name },
              { label: t("expense.advances.neededBy"), value: a.needed_by },
              { label: t("expense.advances.settled"), value: <Money value={a.settled_amount} /> },
              { label: t("expense.advances.disbursed"), value: <DateTime value={a.disbursed_at} /> },
              { label: t("expense.advances.reference"), value: a.disbursement_reference },
            ]} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
