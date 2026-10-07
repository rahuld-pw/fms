"use client";
import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { useMoney } from "@/components/shared/format";
import { api } from "@/lib/client/api";

export interface ItemDraft {
  id?: string;
  category_id: string;
  expense_date: string;
  description: string;
  merchant: string;
  amount: string;
  tax_amount: string;
}

export const emptyItem = (): ItemDraft => ({ category_id: "", expense_date: new Date().toISOString().slice(0, 10), description: "", merchant: "", amount: "", tax_amount: "" });

export function useExpenseCategories() {
  return useQuery({
    queryKey: ["expense-categories", "active"],
    queryFn: () => api<{ id: string; name: string; code: string; per_claim_limit: number | null; limit_mode: string; receipt_required_above: number | null }[]>("/expense-categories?active=true&limit=200"),
  });
}

/** Line-item editor used when creating and editing draft claims (cards on phones, rows on desktop). */
export function ItemsEditor({ items, onChange }: { items: ItemDraft[]; onChange: (items: ItemDraft[]) => void }) {
  const { data: cats = [] } = useExpenseCategories();
  const fmt = useMoney();
  const set = (i: number, patch: Partial<ItemDraft>) => onChange(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const total = items.reduce((s, i) => s + (Number(i.amount) || 0) + (Number(i.tax_amount) || 0), 0);
  return (
    <div className="flex flex-col gap-3">
      {items.map((it, i) => {
        const cat = cats.find((c) => c.id === it.category_id);
        const lineTotal = (Number(it.amount) || 0) + (Number(it.tax_amount) || 0);
        const overLimit = cat?.per_claim_limit && lineTotal > Number(cat.per_claim_limit);
        return (
          <div key={i} className="grid grid-cols-2 gap-2 rounded-md border p-3 sm:grid-cols-[1.2fr_0.9fr_1.6fr_1fr_0.8fr_0.7fr_auto] sm:items-end sm:border-0 sm:p-0">
            <label className="col-span-2 text-xs text-muted-foreground sm:col-span-1">
              Category
              <NativeSelect value={it.category_id} onChange={(e) => set(i, { category_id: e.target.value })} required>
                <option value="">Select…</option>
                {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </NativeSelect>
            </label>
            <label className="text-xs text-muted-foreground">
              Date
              <Input type="date" value={it.expense_date} onChange={(e) => set(i, { expense_date: e.target.value })} required />
            </label>
            <label className="col-span-2 text-xs text-muted-foreground sm:col-span-1">
              Description
              <Input value={it.description} onChange={(e) => set(i, { description: e.target.value })} required />
            </label>
            <label className="text-xs text-muted-foreground">
              Merchant
              <Input value={it.merchant} onChange={(e) => set(i, { merchant: e.target.value })} />
            </label>
            <label className="text-xs text-muted-foreground">
              Amount
              <Input type="number" step="0.01" min="0.01" inputMode="decimal" value={it.amount} onChange={(e) => set(i, { amount: e.target.value })} required />
            </label>
            <label className="text-xs text-muted-foreground">
              Tax
              <Input type="number" step="0.01" min="0" inputMode="decimal" value={it.tax_amount} onChange={(e) => set(i, { tax_amount: e.target.value })} />
            </label>
            <Button type="button" variant="ghost" size="icon-sm" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label="Remove item" className="justify-self-end">
              <Trash2 />
            </Button>
            {overLimit && (
              <p className="col-span-full text-xs text-amber-600">
                Above the {cat!.name} per-claim limit of {fmt(cat!.per_claim_limit)} ({cat!.limit_mode === "hard" ? "will be blocked" : "warning only"}).
              </p>
            )}
          </div>
        );
      })}
      <div className="flex items-center justify-between">
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...items, emptyItem()])}>
          <Plus /> Add item
        </Button>
        <span className="text-sm">
          Total <span className="font-semibold tabular">{fmt(total)}</span>
        </span>
      </div>
    </div>
  );
}

export const toPayload = (it: ItemDraft) => ({
  category_id: it.category_id,
  expense_date: it.expense_date,
  description: it.description,
  merchant: it.merchant || null,
  amount: Number(it.amount),
  tax_amount: Number(it.tax_amount || 0),
});
