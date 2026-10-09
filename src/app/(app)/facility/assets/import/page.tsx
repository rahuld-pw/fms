"use client";
import { useState } from "react";
import { CheckCircle2, FileUp } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/shared/page-header";
import { api, errorMessage } from "@/lib/client/api";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils/cn";

const TEMPLATE = "name,campus_code,category_code,subcategory_code,location_code,asset_tag,make,model,serial_number,status,condition,purchase_date,purchase_cost,installed_on,warranty_start,warranty_until,custodian_email\nDell Latitude 5440,MAIN,IT,LAP,A-STF,,Dell,Latitude 5440,SN123,in_use,good,2025-06-10,72000,2025-06-15,2025-06-10,2028-06-09,teacher@greenfield.test\n";

interface Result { created: number; valid_rows: number; errors: { row: number; message: string }[]; dry_run: boolean }

export default function ImportAssetsPage() {
  const { t } = useT();
  const [csv, setCsv] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState<"validate" | "import" | null>(null);
  const run = async (dryRun: boolean) => {
    if (busy) return;
    setBusy(dryRun ? "validate" : "import");
    try {
      const r = await api<Result>("/assets/import", { body: { csv, dry_run: dryRun } });
      setResult(r);
      if (!dryRun && r.created) toast.success(t("facility.assets.import.importedToast", { n: r.created }));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={t("facility.assets.import.title")} breadcrumbs={[{ label: t("facility.assets.title"), href: "/facility/assets" }, { label: t("ui.import") }]} description={t("facility.assets.import.description")} />
      <Card>
        <CardHeader>
          <CardTitle>{t("facility.assets.import.step1")}</CardTitle>
          <Button size="xs" variant="outline" asChild>
            <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`} download="asset-import-template.csv">{t("facility.assets.import.downloadTemplate")}</a>
          </Button>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {t("facility.assets.import.requiredCols")} <code>name</code>, <code>campus_code</code>. {t("facility.assets.import.optionalCols")}
        </CardContent>
      </Card>
      <Card className="mt-4">
        <CardHeader>
          <CardTitle>{t("facility.assets.import.step2")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <label className={cn("flex cursor-pointer items-center gap-2 self-start rounded-md border border-dashed px-4 py-3 text-sm hover:bg-muted", busy && "pointer-events-none opacity-50")}>
            <FileUp className="size-4" /> {t("facility.assets.import.chooseFile")}
            <input type="file" accept=".csv,text/csv" className="hidden" disabled={!!busy} onChange={async (e) => { const f = e.target.files?.[0]; if (f) { setCsv(await f.text()); setResult(null); } }} />
          </label>
          <Textarea value={csv} readOnly={!!busy} onChange={(e) => { setCsv(e.target.value); setResult(null); }} rows={8} className="font-mono text-xs" placeholder={t("facility.assets.import.pastePlaceholder")} />
          <div className="flex gap-2">
            <Button variant="outline" disabled={!csv.trim() || !!busy} loading={busy === "validate"} onClick={() => run(true)}>{t("facility.assets.import.validate")}</Button>
            <Button disabled={!result || result.errors.length > 0 || result.dry_run === false || !!busy} loading={busy === "import"} onClick={() => run(false)}>
              {t("facility.assets.import.importN", { n: result?.valid_rows ?? "" })}
            </Button>
          </div>
          {result && result.errors.length > 0 && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
              <p className="mb-1 font-medium text-destructive">{t("facility.assets.import.rowsNeedFixing", { n: result.errors.length })}</p>
              <ul className="max-h-60 list-disc overflow-y-auto pl-5">
                {result.errors.map((e) => <li key={e.row}>{t("facility.assets.import.rowError", { row: e.row, message: e.message })}</li>)}
              </ul>
            </div>
          )}
          {result && result.errors.length === 0 && result.dry_run && <p className="text-sm text-primary">{t("facility.assets.import.allValid", { n: result.valid_rows })}</p>}
          {result && !result.dry_run && (
            <p className="flex items-center gap-2 text-sm text-primary">
              <CheckCircle2 className="size-4" /> {t("facility.assets.import.imported", { n: result.created })} <Link href="/facility/assets" className="underline">{t("facility.assets.import.viewAssets")}</Link>
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
