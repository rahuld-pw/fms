"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { useCan, useModule } from "@/components/app/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DateTime, Money } from "@/components/shared/format";
import { Field } from "@/components/shared/fields";
import { PageHeader } from "@/components/shared/page-header";
import { PriorityLabel } from "@/components/shared/status";
import { api, errorMessage } from "@/lib/client/api";
import { humanize } from "@/lib/utils/format";
import { CrudSection } from "../crud-section";

/* eslint-disable @typescript-eslint/no-explicit-any */
const opts = (xs: string[]) => xs.map((v) => ({ value: v, label: humanize(v) }));
const mins = (m: number | null) => (m == null ? "—" : m % 1440 === 0 ? `${m / 1440} d` : m % 60 === 0 ? `${m / 60} h` : `${m} min`);
const ENTITY_TYPES = ["issue", "work_order", "asset", "vendor", "expense_claim", "advance", "requisition", "rfq", "purchase_order", "grn", "invoice", "payment"];
const SERIES_ENTITIES = ENTITY_TYPES.filter((e) => e !== "vendor");

export function ConfigurationSettings() {
  const can = useCan();
  const router = useRouter();
  const params = useSearchParams();
  const facility = useModule("facility");
  const expense = useModule("expense");
  const settings = can("settings:manage", {}, "strict");
  const tabs = [
    settings && { key: "general", label: "Years & numbering" },
    facility && can("issue:configure") && { key: "facility", label: "Facilities" },
    facility && can("asset:configure") && { key: "assets", label: "Assets" },
    expense && can("budget:manage") && { key: "expense", label: "Expense categories" },
    settings && { key: "fields", label: "Custom fields" },
  ].filter(Boolean) as { key: string; label: string }[];
  const tab = params.get("tab") ?? tabs[0]?.key;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Configuration" description="Reference data and rules used across modules." />
      <Tabs value={tab} onValueChange={(t) => router.replace(`?tab=${t}`, { scroll: false })}>
        <TabsList className="max-w-full overflow-x-auto">{tabs.map((t) => <TabsTrigger key={t.key} value={t.key}>{t.label}</TabsTrigger>)}</TabsList>
        <TabsContent value="general" className="flex flex-col gap-4">
          <CrudSection
            title="Fiscal years"
            endpoint="/fiscal-years"
            createLabel="Add year"
            description="Budgets, number series and reports follow the fiscal year (default April–March)."
            columns={[
              { key: "label", header: "Year", render: (r) => <span className="font-medium">{r.label}</span> },
              { key: "start_date", header: "From", render: (r) => <DateTime value={r.start_date} dateOnly /> },
              { key: "end_date", header: "To", render: (r) => <DateTime value={r.end_date} dateOnly /> },
              { key: "is_locked", header: "", render: (r) => r.is_locked && <Badge>Locked</Badge> },
            ]}
            fields={[{ name: "label", label: "Label", required: true, placeholder: "2027-28" }, { name: "start_date", label: "Start", type: "date", required: true }, { name: "end_date", label: "End", type: "date", required: true }]}
            editFields={[{ name: "label", label: "Label", required: true }, { name: "is_locked", label: "Locked (no new postings)", type: "switch" }]}
          />
          <AcademicYears />
          <CrudSection
            title="Number series"
            endpoint="/number-series"
            createLabel="Add series"
            description="Tokens: {prefix} {campus} {fy} {seq}. Per-campus series keep a separate counter per campus."
            columns={[
              { key: "entity_type", header: "Document", render: (r) => humanize(r.entity_type) },
              { key: "format", header: "Format", className: "font-mono text-xs", render: (r) => r.format.replace("{prefix}", r.prefix) },
              { key: "scope", header: "Counter", hideOnPhone: true, render: (r) => [r.fy_code && `FY ${r.fy_code}`, r.campus?.code].filter(Boolean).join(" · ") || "Template" },
              { key: "next_value", header: "Next", hideOnPhone: true, className: "tabular" },
              { key: "flags", header: "", hideOnPhone: true, render: (r) => <span className="flex gap-1">{r.reset_each_fy && <Badge>Resets each FY</Badge>}{r.per_campus && <Badge>Per campus</Badge>}</span> },
            ]}
            fields={[
              { name: "entity_type", label: "Document", type: "select", options: opts(SERIES_ENTITIES), required: true },
              { name: "prefix", label: "Prefix", required: true, placeholder: "PO" },
              { name: "format", label: "Format", placeholder: "{prefix}/{campus}/{fy}/{seq}", full: true },
              { name: "padding", label: "Digits", type: "number" },
              { name: "reset_each_fy", label: "Reset every fiscal year", type: "switch" },
              { name: "per_campus", label: "Separate counter per campus", type: "switch" },
            ]}
            editFields={[
              { name: "prefix", label: "Prefix", required: true },
              { name: "format", label: "Format", full: true },
              { name: "padding", label: "Digits", type: "number" },
              { name: "next_value", label: "Next number", type: "number", hint: "Only move forward to avoid duplicates" },
              { name: "reset_each_fy", label: "Reset every fiscal year", type: "switch" },
              { name: "per_campus", label: "Separate counter per campus", type: "switch" },
            ]}
            defaults={{ format: "{prefix}/{fy}/{seq}", padding: 5, reset_each_fy: true, per_campus: false }}
          />
        </TabsContent>
        <TabsContent value="facility" className="flex flex-col gap-4">
          <CrudSection
            title="SLA policies"
            endpoint="/sla-policies"
            description="Default response and resolution targets by priority. Issue categories can override them."
            columns={[
              { key: "priority", header: "Priority", render: (r) => <PriorityLabel priority={r.priority} /> },
              { key: "response_minutes", header: "Respond within", render: (r) => mins(r.response_minutes) },
              { key: "resolution_minutes", header: "Resolve within", render: (r) => mins(r.resolution_minutes) },
            ]}
            fields={[
              { name: "priority", label: "Priority", type: "select", options: opts(["low", "medium", "high", "critical"]), required: true },
              { name: "response_minutes", label: "Response (minutes)", type: "number", required: true },
              { name: "resolution_minutes", label: "Resolution (minutes)", type: "number", required: true },
            ]}
            editFields={[
              { name: "response_minutes", label: "Response (minutes)", type: "number", required: true },
              { name: "resolution_minutes", label: "Resolution (minutes)", type: "number", required: true },
            ]}
          />
          <CrudSection
            title="Issue categories"
            endpoint="/issue-categories"
            createLabel="Add category"
            canDelete
            columns={[
              { key: "name", header: "Category", render: (r) => <span className="font-medium">{r.name}{!r.active && <Badge className="ml-2">Inactive</Badge>}</span> },
              { key: "default_priority", header: "Priority", render: (r) => <PriorityLabel priority={r.default_priority} /> },
              { key: "resolution_minutes", header: "SLA", hideOnPhone: true, render: (r) => (r.resolution_minutes ? mins(r.resolution_minutes) : "Default") },
              { key: "auto_create", header: "Creates", hideOnPhone: true, render: (r) => (r.auto_create === "none" ? "—" : humanize(r.auto_create)) },
              { key: "public_visible", header: "Public", hideOnPhone: true, render: (r) => (r.public_visible ? "Yes" : "No") },
            ]}
            fields={(row) => [
              { name: "name", label: "Name", required: true },
              { name: "default_priority", label: "Default priority", type: "select", options: opts(["low", "medium", "high", "critical"]), required: true },
              { name: "response_minutes", label: "Response override (min)", type: "number" },
              { name: "resolution_minutes", label: "Resolution override (min)", type: "number" },
              { name: "default_assignee_id", label: "Auto-assign to", type: "user", initialLabel: row?.default_assignee?.full_name },
              { name: "service_category_id", label: "Vendor service", type: "resource", endpoint: "/service-categories" },
              { name: "auto_create", label: "On report, also create", type: "select", options: [{ value: "none", label: "Nothing" }, { value: "work_order", label: "Work order" }, { value: "task", label: "Task" }], required: true },
              { name: "position", label: "Sort order", type: "number" },
              { name: "public_visible", label: "Show on public QR form", type: "switch" },
              { name: "active", label: "Active", type: "switch" },
              { name: "description", label: "Description", type: "textarea" },
            ]}
            defaults={{ default_priority: "medium", auto_create: "none", public_visible: true, active: true, position: 0 }}
          />
          <CrudSection
            title="Vendor service categories"
            endpoint="/service-categories"
            createLabel="Add"
            canDelete
            columns={[{ key: "name", header: "Service" }]}
            fields={[{ name: "name", label: "Name", required: true }]}
          />
        </TabsContent>
        <TabsContent value="assets">
          <CrudSection
            title="Asset categories"
            endpoint="/asset-categories"
            createLabel="Add category"
            description="Code is used in asset tags. SLM = straight line; WDV = written-down value."
            columns={[
              { key: "name", header: "Category", render: (r) => <span className="font-medium">{r.name}</span> },
              { key: "code", header: "Code", className: "font-mono text-xs" },
              { key: "depreciation_method", header: "Depreciation", render: (r) => (r.depreciation_method === "none" ? "None" : r.depreciation_method === "slm" ? `SLM · ${r.useful_life_months ?? "?"} mo` : `WDV · ${Number(r.wdv_rate_percent ?? 0)}%`) },
              { key: "verification_frequency_months", header: "Verify every", hideOnPhone: true, render: (r) => (r.verification_frequency_months ? `${r.verification_frequency_months} mo` : "—") },
            ]}
            fields={[
              { name: "name", label: "Name", required: true },
              { name: "code", label: "Code", required: true, placeholder: "IT" },
              { name: "depreciation_method", label: "Depreciation", type: "select", options: [{ value: "slm", label: "Straight line (SLM)" }, { value: "wdv", label: "Written-down value (WDV)" }, { value: "none", label: "None" }], required: true },
              { name: "useful_life_months", label: "Useful life (months)", type: "number", hidden: (v) => v.depreciation_method !== "slm" },
              { name: "wdv_rate_percent", label: "WDV rate (% per year)", type: "number", hidden: (v) => v.depreciation_method !== "wdv" },
              { name: "salvage_percent", label: "Salvage value (%)", type: "number" },
              { name: "verification_frequency_months", label: "Physical verification every (months)", type: "number" },
            ]}
            defaults={{ depreciation_method: "slm", salvage_percent: 5, useful_life_months: 60 }}
          />
        </TabsContent>
        <TabsContent value="expense">
          <CrudSection
            title="Expense categories"
            endpoint="/expense-categories"
            createLabel="Add category"
            description="Budgets are set per category. Limits apply per claim line."
            columns={[
              { key: "name", header: "Category", render: (r) => <span className="font-medium">{r.name}{!r.active && <Badge className="ml-2">Inactive</Badge>}</span> },
              { key: "code", header: "Code", className: "font-mono text-xs" },
              { key: "gl_code", header: "GL", hideOnPhone: true, className: "font-mono text-xs" },
              { key: "per_claim_limit", header: "Claim limit", hideOnPhone: true, render: (r) => (r.per_claim_limit ? <><Money value={r.per_claim_limit} /> <span className="text-xs text-muted-foreground">{r.limit_mode}</span></> : "—") },
              { key: "applies_to", header: "Used for", hideOnPhone: true, render: (r) => (r.applies_to ?? []).map(humanize).join(", ") },
            ]}
            fields={[
              { name: "name", label: "Name", required: true },
              { name: "code", label: "Code", required: true },
              { name: "gl_code", label: "GL code" },
              { name: "per_claim_limit", label: "Per-claim limit", type: "money" },
              { name: "limit_mode", label: "Limit behaviour", type: "select", options: [{ value: "soft", label: "Warn" }, { value: "hard", label: "Block" }], required: true },
              { name: "receipt_required_above", label: "Receipt required above", type: "money" },
              { name: "active", label: "Active", type: "switch" },
              { name: "description", label: "Description", type: "textarea" },
            ]}
            defaults={{ limit_mode: "soft", active: true }}
          />
        </TabsContent>
        <TabsContent value="fields">
          <CrudSection
            title="Custom fields"
            endpoint="/custom-fields"
            createLabel="Add field"
            description="Extra fields shown on forms and available in the API and CSV exports."
            columns={[
              { key: "label", header: "Field", render: (r) => <span className="font-medium">{r.label}{r.required && <span className="text-destructive"> *</span>}</span> },
              { key: "entity_type", header: "On", render: (r) => humanize(r.entity_type) },
              { key: "field_type", header: "Type", hideOnPhone: true, render: (r) => humanize(r.field_type) },
              { key: "key", header: "API key", hideOnPhone: true, className: "font-mono text-xs" },
            ]}
            fields={[
              { name: "entity_type", label: "Record type", type: "select", options: opts(["issue", "work_order", "asset", "vendor", "expense_claim", "purchase_order", "requisition", "task", "project"]), required: true },
              { name: "label", label: "Label", required: true },
              { name: "key", label: "API key", required: true, placeholder: "warranty_reference", hint: "lowercase_with_underscores" },
              { name: "field_type", label: "Type", type: "select", options: opts(["text", "number", "date", "boolean", "select", "multiselect", "user", "currency"]), required: true },
              { name: "options", label: "Options (one per line)", type: "textarea", hidden: (v) => !["select", "multiselect"].includes(v.field_type) },
              { name: "required", label: "Required", type: "switch" },
              { name: "position", label: "Sort order", type: "number" },
            ]}
            editFields={[
              { name: "label", label: "Label", required: true },
              { name: "options", label: "Options (one per line)", type: "textarea", hidden: (v) => !["select", "multiselect"].includes(v.field_type) },
              { name: "required", label: "Required", type: "switch" },
              { name: "active", label: "Active", type: "switch" },
              { name: "position", label: "Sort order", type: "number" },
            ]}
            defaults={{ field_type: "text", entity_type: "asset", required: false, position: 0 }}
            toForm={(r) => ({ ...r, options: (r.options ?? []).map((o: any) => (typeof o === "string" ? o : o.label)).join("\n") })}
            transform={(v) => ({ ...v, ...(typeof v.options === "string" ? { options: (v.options as string).split("\n").map((s) => s.trim()).filter(Boolean) } : v.options === null ? { options: undefined } : {}) })}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function AcademicYears() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["academic-years"], queryFn: () => api<any[]>("/academic-years") });
  const [label, setLabel] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const add = async () => {
    try {
      await api("/academic-years", { body: { label, start_date: start, end_date: end } });
      toast.success("Academic year added");
      setLabel(""); setStart(""); setEnd("");
      qc.invalidateQueries({ queryKey: ["academic-years"] });
    } catch (e) { toast.error(errorMessage(e)); }
  };
  return (
    <Card>
      <CardHeader><div><CardTitle>Academic years</CardTitle><p className="mt-0.5 text-xs text-muted-foreground">Used for tasks, compliance and reporting by session.</p></div></CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          {(data ?? []).map((y) => <Badge key={y.id}>{y.label} · <DateTime value={y.start_date} dateOnly /> – <DateTime value={y.end_date} dateOnly /></Badge>)}
        </div>
        <div className="grid items-end gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
          <Field label="Label"><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="2027-28" /></Field>
          <Field label="Start"><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="End"><Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
          <Button variant="outline" disabled={!label || !start || !end} onClick={add}><Plus /> Add</Button>
        </div>
      </CardContent>
    </Card>
  );
}
