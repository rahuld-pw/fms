"use client";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { useMoney } from "@/components/shared/format";
import { ResourcePicker } from "@/components/shared/fields";
import { useT } from "@/lib/i18n/client";

export interface LineDraft {
  id?: string;
  item_id: string | null;
  description: string;
  quantity: string;
  unit: string;
  unit_price: string;
  tax_rate: string;
  discount_pct: string;
  hsn_sac: string;
  is_asset: boolean;
}

export const emptyLine = (): LineDraft => ({ item_id: null, description: "", quantity: "1", unit: "nos", unit_price: "", tax_rate: "18", discount_pct: "0", hsn_sac: "", is_asset: false });
const GST = ["0", "5", "12", "18", "28"];

/** Line editor for requisitions (estimates, no tax) and purchase orders (GST, discount). */
export function LinesEditor({ lines, onChange, mode }: { lines: LineDraft[]; onChange: (l: LineDraft[]) => void; mode: "requisition" | "po" }) {
  const { t } = useT();
  const fmt = useMoney();
  const set = (i: number, p: Partial<LineDraft>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const lineTotal = (l: LineDraft) => {
    const base = (Number(l.quantity) || 0) * (Number(l.unit_price) || 0) * (1 - (Number(l.discount_pct) || 0) / 100);
    return mode === "po" ? base * (1 + (Number(l.tax_rate) || 0) / 100) : base;
  };
  const total = lines.reduce((s, l) => s + lineTotal(l), 0);
  return (
    <div className="flex flex-col gap-3">
      {lines.map((l, i) => (
        <div key={i} className="grid grid-cols-2 gap-2 rounded-md border p-3 sm:grid-cols-12 sm:items-end">
          <label className="col-span-2 text-xs text-muted-foreground sm:col-span-3">
            {t("po.lines.catalogueItem")}
            <ResourcePicker
              endpoint="/items"
              hintKey="sku"
              value={l.item_id}
              onChange={async (v, o) => {
                set(i, { item_id: (v as string) ?? null, description: l.description || o?.label || "" });
                if (v) {
                  const res = await fetch(`/api/v1/items/${v}`).then((r) => r.json());
                  const it = res.data;
                  if (it) set(i, { item_id: v as string, description: l.description || it.name, unit: it.unit, unit_price: l.unit_price || String(it.last_price ?? ""), tax_rate: String(Number(it.gst_rate)), hsn_sac: it.hsn_sac ?? "", is_asset: it.is_asset });
                }
              }}
              placeholder={t("ui.optional")}
            />
          </label>
          <label className="col-span-2 text-xs text-muted-foreground sm:col-span-3">
            {t("ui.description")}
            <Input value={l.description} onChange={(e) => set(i, { description: e.target.value })} required />
          </label>
          <label className="text-xs text-muted-foreground">
            {t("ui.qty")}
            <Input type="number" step="any" min="0.001" inputMode="decimal" value={l.quantity} onChange={(e) => set(i, { quantity: e.target.value })} required />
          </label>
          <label className="text-xs text-muted-foreground">
            {t("ui.unit")}
            <Input value={l.unit} onChange={(e) => set(i, { unit: e.target.value })} />
          </label>
          <label className="text-xs text-muted-foreground sm:col-span-2">
            {mode === "po" ? t("ui.rate") : t("po.common.estRate")}
            <Input type="number" step="0.01" min="0" inputMode="decimal" value={l.unit_price} onChange={(e) => set(i, { unit_price: e.target.value })} required />
          </label>
          {mode === "po" && (
            <label className="text-xs text-muted-foreground">
              {t("po.common.gstPct")}
              <NativeSelect value={l.tax_rate} onChange={(e) => set(i, { tax_rate: e.target.value })}>
                {GST.map((g) => <option key={g} value={g}>{g}</option>)}
              </NativeSelect>
            </label>
          )}
          <div className="flex items-center justify-between gap-2 sm:col-span-1 sm:flex-col sm:items-end">
            <span className="text-xs font-medium tabular">{fmt(lineTotal(l))}</span>
            <Button type="button" variant="ghost" size="icon-sm" onClick={() => onChange(lines.filter((_, j) => j !== i))} aria-label={t("po.lines.removeLine")}><Trash2 /></Button>
          </div>
        </div>
      ))}
      <div className="flex items-center justify-between">
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...lines, emptyLine()])}><Plus /> {t("ui.addLine")}</Button>
        <span className="text-sm">{mode === "po" ? t("po.common.totalInclGst") : t("po.common.estimatedTotal")} <span className="font-semibold tabular">{fmt(total)}</span></span>
      </div>
    </div>
  );
}

export const reqLinePayload = (l: LineDraft) => ({ item_id: l.item_id ?? undefined, description: l.description, quantity: Number(l.quantity), unit: l.unit || "nos", estimated_unit_price: Number(l.unit_price || 0) });
export const poLinePayload = (l: LineDraft) => ({
  item_id: l.item_id ?? undefined, description: l.description, quantity: Number(l.quantity), unit: l.unit || "nos", unit_price: Number(l.unit_price || 0),
  tax_rate: Number(l.tax_rate), discount_pct: Number(l.discount_pct || 0), hsn_sac: l.hsn_sac || undefined, is_asset: l.is_asset,
});
