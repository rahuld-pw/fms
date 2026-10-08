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
import { useT } from "@/lib/i18n/client";
import type { TFunction } from "@/lib/i18n/translate";
import { humanize } from "@/lib/utils/format";
import { CrudSection } from "../crud-section";

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Select options for stored values, labelled from enum.<field>.<value> (or priority.<value>). */
const opts = (t: TFunction, prefix: string, xs: string[]) => xs.map((v) => ({ value: v, label: t(`${prefix}.${v}`, undefined, humanize(v)) }));
const mins = (t: TFunction, m: number | null) =>
  m == null ? "—" : m % 1440 === 0 ? t("settings.config.days", { n: m / 1440 }) : m % 60 === 0 ? t("settings.config.hours", { n: m / 60 }) : t("settings.config.minutes", { n: m });
const ENTITY_TYPES = ["issue", "work_order", "asset", "vendor", "expense_claim", "advance", "requisition", "rfq", "purchase_order", "grn", "invoice", "payment"];
const SERIES_ENTITIES = ENTITY_TYPES.filter((e) => e !== "vendor");

export function ConfigurationSettings() {
  const { t } = useT();
  const can = useCan();
  const router = useRouter();
  const params = useSearchParams();
  const facility = useModule("facility");
  const expense = useModule("expense");
  const settings = can("settings:manage", {}, "strict");
  const tabs = [
    settings && { key: "general", label: t("settings.config.tabs.general") },
    facility && can("issue:configure") && { key: "facility", label: t("settings.config.tabs.facility") },
    facility && can("asset:configure") && { key: "assets", label: t("settings.config.tabs.assets") },
    expense && can("budget:manage") && { key: "expense", label: t("settings.config.tabs.expense") },
    settings && { key: "fields", label: t("settings.config.tabs.fields") },
  ].filter(Boolean) as { key: string; label: string }[];
  const tab = params.get("tab") ?? tabs[0]?.key;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("nav./settings/configuration")} description={t("settings.config.description")} />
      <Tabs value={tab} onValueChange={(v) => router.replace(`?tab=${v}`, { scroll: false })}>
        <TabsList className="max-w-full overflow-x-auto">{tabs.map((x) => <TabsTrigger key={x.key} value={x.key}>{x.label}</TabsTrigger>)}</TabsList>
        <TabsContent value="general" className="flex flex-col gap-4">
          <CrudSection
            title={t("settings.config.fiscalYears.title")}
            endpoint="/fiscal-years"
            createLabel={t("settings.config.fiscalYears.add")}
            createTitle={t("settings.config.fiscalYears.createTitle")}
            editTitle={t("settings.config.fiscalYears.editTitle")}
            description={t("settings.config.fiscalYears.description")}
            columns={[
              { key: "label", header: t("settings.config.fiscalYears.colYear"), render: (r) => <span className="font-medium">{r.label}</span> },
              { key: "start_date", header: t("ui.from"), render: (r) => <DateTime value={r.start_date} dateOnly /> },
              { key: "end_date", header: t("ui.to"), render: (r) => <DateTime value={r.end_date} dateOnly /> },
              { key: "is_locked", header: "", render: (r) => r.is_locked && <Badge>{t("settings.config.fiscalYears.locked")}</Badge> },
            ]}
            fields={[{ name: "label", label: t("settings.config.fiscalYears.label"), required: true, placeholder: "2027-28" }, { name: "start_date", label: t("settings.config.fiscalYears.start"), type: "date", required: true }, { name: "end_date", label: t("settings.config.fiscalYears.end"), type: "date", required: true }]}
            editFields={[{ name: "label", label: t("settings.config.fiscalYears.label"), required: true }, { name: "is_locked", label: t("settings.config.fiscalYears.lockedField"), type: "switch" }]}
          />
          <AcademicYears />
          <CrudSection
            title={t("settings.config.numberSeries.title")}
            endpoint="/number-series"
            createLabel={t("settings.config.numberSeries.add")}
            createTitle={t("settings.config.numberSeries.createTitle")}
            editTitle={t("settings.config.numberSeries.editTitle")}
            description={t("settings.config.numberSeries.description")}
            columns={[
              { key: "entity_type", header: t("settings.config.numberSeries.document"), render: (r) => t(`enum.entityType.${r.entity_type}`, undefined, humanize(r.entity_type)) },
              { key: "format", header: t("settings.config.numberSeries.format"), className: "font-mono text-xs", render: (r) => r.format.replace("{prefix}", r.prefix) },
              { key: "scope", header: t("settings.config.numberSeries.counter"), hideOnPhone: true, render: (r) => [r.fy_code && t("settings.config.numberSeries.fy", { code: r.fy_code }), r.campus?.code].filter(Boolean).join(" · ") || t("settings.config.numberSeries.template") },
              { key: "next_value", header: t("settings.config.numberSeries.next"), hideOnPhone: true, className: "tabular" },
              { key: "flags", header: "", hideOnPhone: true, render: (r) => <span className="flex gap-1">{r.reset_each_fy && <Badge>{t("settings.config.numberSeries.resetsEachFy")}</Badge>}{r.per_campus && <Badge>{t("settings.config.numberSeries.perCampus")}</Badge>}</span> },
            ]}
            fields={[
              { name: "entity_type", label: t("settings.config.numberSeries.document"), type: "select", options: opts(t, "enum.entityType", SERIES_ENTITIES), required: true },
              { name: "prefix", label: t("settings.config.numberSeries.prefix"), required: true, placeholder: "PO" },
              { name: "format", label: t("settings.config.numberSeries.format"), placeholder: "{prefix}/{campus}/{fy}/{seq}", full: true },
              { name: "padding", label: t("settings.config.numberSeries.digits"), type: "number" },
              { name: "reset_each_fy", label: t("settings.config.numberSeries.resetEachFy"), type: "switch" },
              { name: "per_campus", label: t("settings.config.numberSeries.perCampusField"), type: "switch" },
            ]}
            editFields={[
              { name: "prefix", label: t("settings.config.numberSeries.prefix"), required: true },
              { name: "format", label: t("settings.config.numberSeries.format"), full: true },
              { name: "padding", label: t("settings.config.numberSeries.digits"), type: "number" },
              { name: "next_value", label: t("settings.config.numberSeries.nextNumber"), type: "number", hint: t("settings.config.numberSeries.nextNumberHint") },
              { name: "reset_each_fy", label: t("settings.config.numberSeries.resetEachFy"), type: "switch" },
              { name: "per_campus", label: t("settings.config.numberSeries.perCampusField"), type: "switch" },
            ]}
            defaults={{ format: "{prefix}/{fy}/{seq}", padding: 5, reset_each_fy: true, per_campus: false }}
          />
        </TabsContent>
        <TabsContent value="facility" className="flex flex-col gap-4">
          <CrudSection
            title={t("settings.config.sla.title")}
            endpoint="/sla-policies"
            createTitle={t("settings.config.sla.createTitle")}
            editTitle={t("settings.config.sla.editTitle")}
            description={t("settings.config.sla.description")}
            columns={[
              { key: "priority", header: t("ui.priority"), render: (r) => <PriorityLabel priority={r.priority} /> },
              { key: "response_minutes", header: t("settings.config.sla.respondWithin"), render: (r) => mins(t, r.response_minutes) },
              { key: "resolution_minutes", header: t("settings.config.sla.resolveWithin"), render: (r) => mins(t, r.resolution_minutes) },
            ]}
            fields={[
              { name: "priority", label: t("ui.priority"), type: "select", options: opts(t, "priority", ["low", "medium", "high", "critical"]), required: true },
              { name: "response_minutes", label: t("settings.config.sla.response"), type: "number", required: true },
              { name: "resolution_minutes", label: t("settings.config.sla.resolution"), type: "number", required: true },
            ]}
            editFields={[
              { name: "response_minutes", label: t("settings.config.sla.response"), type: "number", required: true },
              { name: "resolution_minutes", label: t("settings.config.sla.resolution"), type: "number", required: true },
            ]}
          />
          <CrudSection
            title={t("settings.config.issueCategories.title")}
            endpoint="/issue-categories"
            createLabel={t("settings.config.issueCategories.add")}
            createTitle={t("settings.config.issueCategories.createTitle")}
            editTitle={t("settings.config.issueCategories.editTitle")}
            canDelete
            columns={[
              { key: "name", header: t("ui.category"), render: (r) => <span className="font-medium">{r.name}{!r.active && <Badge className="ml-2">{t("ui.inactive")}</Badge>}</span> },
              { key: "default_priority", header: t("ui.priority"), render: (r) => <PriorityLabel priority={r.default_priority} /> },
              { key: "resolution_minutes", header: t("settings.config.issueCategories.sla"), hideOnPhone: true, render: (r) => (r.resolution_minutes ? mins(t, r.resolution_minutes) : t("settings.config.issueCategories.default")) },
              { key: "auto_create", header: t("settings.config.issueCategories.creates"), hideOnPhone: true, render: (r) => (r.auto_create === "none" ? "—" : r.auto_create === "work_order" ? t("settings.config.issueCategories.workOrder") : r.auto_create === "task" ? t("settings.config.issueCategories.task") : humanize(r.auto_create)) },
              { key: "public_visible", header: t("settings.config.issueCategories.public"), hideOnPhone: true, render: (r) => (r.public_visible ? t("ui.yes") : t("ui.no")) },
            ]}
            fields={(row) => [
              { name: "name", label: t("ui.name"), required: true },
              { name: "default_priority", label: t("settings.config.issueCategories.defaultPriority"), type: "select", options: opts(t, "priority", ["low", "medium", "high", "critical"]), required: true },
              { name: "response_minutes", label: t("settings.config.issueCategories.responseOverride"), type: "number" },
              { name: "resolution_minutes", label: t("settings.config.issueCategories.resolutionOverride"), type: "number" },
              { name: "default_assignee_id", label: t("settings.config.issueCategories.autoAssign"), type: "user", initialLabel: row?.default_assignee?.full_name },
              { name: "service_category_id", label: t("settings.config.issueCategories.vendorService"), type: "resource", endpoint: "/service-categories" },
              { name: "auto_create", label: t("settings.config.issueCategories.autoCreate"), type: "select", options: [{ value: "none", label: t("settings.config.issueCategories.nothing") }, { value: "work_order", label: t("settings.config.issueCategories.workOrder") }, { value: "task", label: t("settings.config.issueCategories.task") }], required: true },
              { name: "position", label: t("settings.config.issueCategories.sortOrder"), type: "number" },
              { name: "public_visible", label: t("settings.config.issueCategories.publicVisible"), type: "switch" },
              { name: "active", label: t("ui.active"), type: "switch" },
              { name: "description", label: t("ui.description"), type: "textarea" },
            ]}
            defaults={{ default_priority: "medium", auto_create: "none", public_visible: true, active: true, position: 0 }}
          />
          <CrudSection
            title={t("settings.config.serviceCategories.title")}
            endpoint="/service-categories"
            createLabel={t("ui.add")}
            createTitle={t("settings.config.serviceCategories.createTitle")}
            editTitle={t("settings.config.serviceCategories.editTitle")}
            canDelete
            columns={[{ key: "name", header: t("settings.config.serviceCategories.service") }]}
            fields={[{ name: "name", label: t("ui.name"), required: true }]}
          />
        </TabsContent>
        <TabsContent value="assets">
          <CrudSection
            title={t("settings.config.assetCategories.title")}
            endpoint="/asset-categories"
            createLabel={t("settings.config.assetCategories.add")}
            createTitle={t("settings.config.assetCategories.createTitle")}
            editTitle={t("settings.config.assetCategories.editTitle")}
            description={t("settings.config.assetCategories.description")}
            columns={[
              { key: "name", header: t("ui.category"), render: (r) => <span className="font-medium">{r.name}</span> },
              { key: "code", header: t("ui.code"), className: "font-mono text-xs" },
              { key: "depreciation_method", header: t("settings.config.assetCategories.depreciation"), render: (r) => (r.depreciation_method === "none" ? t("ui.none") : r.depreciation_method === "slm" ? t("settings.config.assetCategories.slmSummary", { months: r.useful_life_months ?? "?" }) : t("settings.config.assetCategories.wdvSummary", { rate: Number(r.wdv_rate_percent ?? 0) })) },
              { key: "verification_frequency_months", header: t("settings.config.assetCategories.verifyEvery"), hideOnPhone: true, render: (r) => (r.verification_frequency_months ? t("settings.config.months", { n: r.verification_frequency_months }) : "—") },
            ]}
            fields={[
              { name: "name", label: t("ui.name"), required: true },
              { name: "code", label: t("ui.code"), required: true, placeholder: "IT" },
              { name: "depreciation_method", label: t("settings.config.assetCategories.depreciation"), type: "select", options: [{ value: "slm", label: t("settings.config.assetCategories.slm") }, { value: "wdv", label: t("settings.config.assetCategories.wdv") }, { value: "none", label: t("ui.none") }], required: true },
              { name: "useful_life_months", label: t("settings.config.assetCategories.usefulLife"), type: "number", hidden: (v) => v.depreciation_method !== "slm" },
              { name: "wdv_rate_percent", label: t("settings.config.assetCategories.wdvRate"), type: "number", hidden: (v) => v.depreciation_method !== "wdv" },
              { name: "salvage_percent", label: t("settings.config.assetCategories.salvage"), type: "number" },
              { name: "verification_frequency_months", label: t("settings.config.assetCategories.verification"), type: "number" },
            ]}
            defaults={{ depreciation_method: "slm", salvage_percent: 5, useful_life_months: 60 }}
          />
        </TabsContent>
        <TabsContent value="expense">
          <CrudSection
            title={t("settings.config.expenseCategories.title")}
            endpoint="/expense-categories"
            createLabel={t("settings.config.expenseCategories.add")}
            createTitle={t("settings.config.expenseCategories.createTitle")}
            editTitle={t("settings.config.expenseCategories.editTitle")}
            description={t("settings.config.expenseCategories.description")}
            columns={[
              { key: "name", header: t("ui.category"), render: (r) => <span className="font-medium">{r.name}{!r.active && <Badge className="ml-2">{t("ui.inactive")}</Badge>}</span> },
              { key: "code", header: t("ui.code"), className: "font-mono text-xs" },
              { key: "gl_code", header: t("settings.config.expenseCategories.gl"), hideOnPhone: true, className: "font-mono text-xs" },
              { key: "per_claim_limit", header: t("settings.config.expenseCategories.claimLimit"), hideOnPhone: true, render: (r) => (r.per_claim_limit ? <><Money value={r.per_claim_limit} /> <span className="text-xs text-muted-foreground">{t(`enum.limitMode.${r.limit_mode}`, undefined, r.limit_mode)}</span></> : "—") },
              { key: "applies_to", header: t("settings.config.expenseCategories.usedFor"), hideOnPhone: true, render: (r) => (r.applies_to ?? []).map((x: string) => t(`enum.module.${x}`, undefined, humanize(x))).join(", ") },
            ]}
            fields={[
              { name: "name", label: t("ui.name"), required: true },
              { name: "code", label: t("ui.code"), required: true },
              { name: "gl_code", label: t("settings.config.expenseCategories.glCode") },
              { name: "per_claim_limit", label: t("settings.config.expenseCategories.perClaimLimit"), type: "money" },
              { name: "limit_mode", label: t("settings.config.expenseCategories.limitBehaviour"), type: "select", options: [{ value: "soft", label: t("settings.config.expenseCategories.warn") }, { value: "hard", label: t("settings.config.expenseCategories.block") }], required: true },
              { name: "receipt_required_above", label: t("settings.config.expenseCategories.receiptAbove"), type: "money" },
              { name: "active", label: t("ui.active"), type: "switch" },
              { name: "description", label: t("ui.description"), type: "textarea" },
            ]}
            defaults={{ limit_mode: "soft", active: true }}
          />
        </TabsContent>
        <TabsContent value="fields">
          <CrudSection
            title={t("settings.config.customFields.title")}
            endpoint="/custom-fields"
            createLabel={t("settings.config.customFields.add")}
            createTitle={t("settings.config.customFields.createTitle")}
            editTitle={t("settings.config.customFields.editTitle")}
            description={t("settings.config.customFields.description")}
            columns={[
              { key: "label", header: t("settings.config.customFields.field"), render: (r) => <span className="font-medium">{r.label}{r.required && <span className="text-destructive"> *</span>}</span> },
              { key: "entity_type", header: t("settings.config.customFields.on"), render: (r) => t(`enum.entityType.${r.entity_type}`, undefined, humanize(r.entity_type)) },
              { key: "field_type", header: t("ui.type"), hideOnPhone: true, render: (r) => t(`enum.fieldType.${r.field_type}`, undefined, humanize(r.field_type)) },
              { key: "key", header: t("settings.config.customFields.apiKey"), hideOnPhone: true, className: "font-mono text-xs" },
            ]}
            fields={[
              { name: "entity_type", label: t("settings.config.customFields.recordType"), type: "select", options: opts(t, "enum.entityType", ["issue", "work_order", "asset", "vendor", "expense_claim", "purchase_order", "requisition", "task", "project"]), required: true },
              { name: "label", label: t("settings.config.customFields.label"), required: true },
              { name: "key", label: t("settings.config.customFields.apiKey"), required: true, placeholder: "warranty_reference", hint: "lowercase_with_underscores" },
              { name: "field_type", label: t("ui.type"), type: "select", options: opts(t, "enum.fieldType", ["text", "number", "date", "boolean", "select", "multiselect", "user", "currency"]), required: true },
              { name: "options", label: t("settings.config.customFields.options"), type: "textarea", hidden: (v) => !["select", "multiselect"].includes(v.field_type) },
              { name: "required", label: t("ui.required"), type: "switch" },
              { name: "position", label: t("settings.config.issueCategories.sortOrder"), type: "number" },
            ]}
            editFields={[
              { name: "label", label: t("settings.config.customFields.label"), required: true },
              { name: "options", label: t("settings.config.customFields.options"), type: "textarea", hidden: (v) => !["select", "multiselect"].includes(v.field_type) },
              { name: "required", label: t("ui.required"), type: "switch" },
              { name: "active", label: t("ui.active"), type: "switch" },
              { name: "position", label: t("settings.config.issueCategories.sortOrder"), type: "number" },
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
  const { t } = useT();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["academic-years"], queryFn: () => api<any[]>("/academic-years") });
  const [label, setLabel] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const add = async () => {
    try {
      await api("/academic-years", { body: { label, start_date: start, end_date: end } });
      toast.success(t("settings.config.academicYears.added"));
      setLabel(""); setStart(""); setEnd("");
      qc.invalidateQueries({ queryKey: ["academic-years"] });
    } catch (e) { toast.error(errorMessage(e)); }
  };
  return (
    <Card>
      <CardHeader><div><CardTitle>{t("settings.config.academicYears.title")}</CardTitle><p className="mt-0.5 text-xs text-muted-foreground">{t("settings.config.academicYears.description")}</p></div></CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          {(data ?? []).map((y) => <Badge key={y.id}>{y.label} · <DateTime value={y.start_date} dateOnly /> – <DateTime value={y.end_date} dateOnly /></Badge>)}
        </div>
        <div className="grid items-end gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
          <Field label={t("settings.config.fiscalYears.label")}><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="2027-28" /></Field>
          <Field label={t("settings.config.fiscalYears.start")}><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label={t("settings.config.fiscalYears.end")}><Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
          <Button variant="outline" disabled={!label || !start || !end} onClick={add}><Plus /> {t("ui.add")}</Button>
        </div>
      </CardContent>
    </Card>
  );
}
