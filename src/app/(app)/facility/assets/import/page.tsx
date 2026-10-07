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

const TEMPLATE = "name,campus_code,category_code,location_code,asset_tag,make,model,serial_number,status,purchase_date,purchase_cost,warranty_until,custodian_email\nDell Latitude 5440,MAIN,IT,A-STF,,Dell,Latitude 5440,SN123,in_use,2025-06-10,72000,2028-06-09,teacher@greenfield.test\n";

interface Result { created: number; valid_rows: number; errors: { row: number; message: string }[]; dry_run: boolean }

export default function ImportAssetsPage() {
  const [csv, setCsv] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (dryRun: boolean) => {
    setBusy(true);
    try {
      const r = await api<Result>("/assets/import", { body: { csv, dry_run: dryRun } });
      setResult(r);
      if (!dryRun && r.created) toast.success(`${r.created} assets imported`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Import assets" breadcrumbs={[{ label: "Assets", href: "/facility/assets" }, { label: "Import" }]} description="Upload a CSV. Every row is validated first; nothing is written until all rows pass." />
      <Card>
        <CardHeader>
          <CardTitle>1. Prepare your CSV</CardTitle>
          <Button size="xs" variant="outline" asChild>
            <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`} download="asset-import-template.csv">Download template</a>
          </Button>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Required: <code>name</code>, <code>campus_code</code>. Optional: category_code, location_code, asset_tag (auto if blank), make, model, serial_number, status, purchase_date (YYYY-MM-DD), purchase_cost, warranty_until, custodian_email.
        </CardContent>
      </Card>
      <Card className="mt-4">
        <CardHeader>
          <CardTitle>2. Upload or paste</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <label className="flex cursor-pointer items-center gap-2 self-start rounded-md border border-dashed px-4 py-3 text-sm hover:bg-muted">
            <FileUp className="size-4" /> Choose CSV file
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { setCsv(await f.text()); setResult(null); } }} />
          </label>
          <Textarea value={csv} onChange={(e) => { setCsv(e.target.value); setResult(null); }} rows={8} className="font-mono text-xs" placeholder="…or paste CSV here" />
          <div className="flex gap-2">
            <Button variant="outline" disabled={!csv.trim()} loading={busy} onClick={() => run(true)}>Validate</Button>
            <Button disabled={!result || result.errors.length > 0 || result.dry_run === false} loading={busy} onClick={() => run(false)}>
              Import {result?.valid_rows ?? ""} assets
            </Button>
          </div>
          {result && result.errors.length > 0 && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
              <p className="mb-1 font-medium text-destructive">{result.errors.length} rows need fixing</p>
              <ul className="max-h-60 list-disc overflow-y-auto pl-5">
                {result.errors.map((e) => <li key={e.row}>Row {e.row}: {e.message}</li>)}
              </ul>
            </div>
          )}
          {result && result.errors.length === 0 && result.dry_run && <p className="text-sm text-primary">All {result.valid_rows} rows are valid. Ready to import.</p>}
          {result && !result.dry_run && (
            <p className="flex items-center gap-2 text-sm text-primary">
              <CheckCircle2 className="size-4" /> Imported {result.created} assets. <Link href="/facility/assets" className="underline">View assets</Link>
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
