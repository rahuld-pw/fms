"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ResourceFormDialog, type FieldSpec } from "@/components/shared/resource-form";
import { apiList, api, errorMessage } from "@/lib/client/api";
import { useT } from "@/lib/i18n/client";

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface CrudColumn { key: string; header: string; render?: (row: any) => React.ReactNode; className?: string; hideOnPhone?: boolean }

/**
 * Small settings list (no pagination) with create / edit / delete dialogs.
 * Rows render as a table on desktop and stacked rows on phones.
 */
export function CrudSection({
  title, description, endpoint, columns, fields, editFields, canEdit = true, canDelete = false, defaults, toForm, transform, createLabel, createTitle, editTitle, limit = 200,
}: {
  title: string; description?: string; endpoint: string; columns: CrudColumn[]; fields: FieldSpec[] | ((row: any) => FieldSpec[]); editFields?: FieldSpec[] | ((row: any) => FieldSpec[]);
  canEdit?: boolean; canDelete?: boolean; defaults?: Record<string, unknown>; toForm?: (row: any) => Record<string, unknown>;
  transform?: (v: Record<string, unknown>, editing: boolean) => Record<string, unknown>; createLabel?: string; limit?: number;
  /** Dialog titles, e.g. "Add campus" / "Edit campus". */
  createTitle: string; editTitle: string;
}) {
  const { t } = useT();
  const qc = useQueryClient();
  const base = endpoint.split("?")[0];
  const { data, isLoading } = useQuery({ queryKey: [base, "crud", endpoint], queryFn: () => apiList<any>(`${endpoint}${endpoint.includes("?") ? "&" : "?"}limit=${limit}`) });
  const [editing, setEditing] = useState<any>(null);
  const isEdit = !!editing?.id;
  const specs = (isEdit && editFields) || fields;
  const resolved = typeof specs === "function" ? specs(editing) : specs;
  const remove = async (row: any) => {
    if (!confirm(t("settings.crud.confirmDelete", { name: row.name ?? row.label ?? row.key ?? t("settings.crud.thisItem") }))) return;
    try {
      await api(`${base}/${row.id}`, { method: "DELETE" });
      toast.success(t("ui.deleted"));
      qc.invalidateQueries({ queryKey: [base] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const rows: any[] = data?.data ?? [];
  return (
    <Card>
      <CardHeader className="flex-wrap">
        <div className="min-w-0">
          <CardTitle>{title}</CardTitle>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
        {canEdit && <Button size="xs" variant="outline" onClick={() => setEditing({ ...(defaults ?? {}) })}><Plus /> {createLabel ?? t("ui.add")}</Button>}
      </CardHeader>
      {isLoading ? <div className="p-4"><Skeleton className="h-20" /></div> : rows.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-muted-foreground">{t("ui.nothingHere")}</p>
      ) : (
        <Table>
          <THead>
            <TR>
              {columns.map((c) => <TH key={c.key} className={c.hideOnPhone ? "hidden sm:table-cell" : undefined}>{c.header}</TH>)}
              {canEdit && <TH className="w-20" />}
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.id}>
                {columns.map((c) => <TD key={c.key} className={[c.className, c.hideOnPhone && "hidden sm:table-cell"].filter(Boolean).join(" ")}>{c.render ? c.render(r) : (r[c.key] ?? "—")}</TD>)}
                {canEdit && (
                  <TD className="text-right whitespace-nowrap">
                    <Button size="icon-sm" variant="ghost" aria-label={t("ui.edit")} onClick={() => setEditing({ ...(toForm ? toForm(r) : r), id: r.id })}><Pencil /></Button>
                    {canDelete && <Button size="icon-sm" variant="ghost" aria-label={t("ui.delete")} onClick={() => remove(r)}><Trash2 /></Button>}
                  </TD>
                )}
              </TR>
            ))}
          </TBody>
        </Table>
      )}
      <ResourceFormDialog
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        title={isEdit ? editTitle : createTitle}
        fields={resolved}
        defaultValues={editing ?? undefined}
        endpoint={isEdit ? `${base}/${editing.id}` : base}
        method={isEdit ? "PATCH" : "POST"}
        invalidate={[base]}
        transform={transform ? (v) => transform(v, isEdit) : undefined}
      />
    </Card>
  );
}
