"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Controller, useForm, type FieldValues } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/checkbox";
import { ApiClientError, api, errorMessage } from "@/lib/client/api";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils/cn";
import { CampusSelect, DepartmentSelect, Field, ResourcePicker, UserPicker } from "./fields";
import { FileField } from "./file-field";
import { LocationCascade } from "./location-cascade";

export type FieldType =
  | "text"
  | "textarea"
  | "number"
  | "money"
  | "date"
  | "datetime"
  | "select"
  | "switch"
  | "user"
  | "users"
  | "resource"
  | "resources"
  | "campus"
  | "department"
  | "location"
  | "file"
  | "email";

export interface FieldSpec {
  name: string;
  label: string;
  type?: FieldType;
  required?: boolean;
  options?: { value: string; label: string }[];
  endpoint?: string;
  labelKey?: string;
  hintKey?: string;
  hint?: string;
  placeholder?: string;
  full?: boolean;
  /** For department and location fields: which field holds the campus. */
  campusField?: string;
  /** For resource pickers: extra query string built from the other values (e.g. `&parent_id=…`). */
  extraParams?: (values: FieldValues) => string;
  /** For file fields: the record the uploaded file belongs to. */
  upload?: { entityType: string; entityId: string; kind?: string };
  /** Initial label for pickers when editing. */
  initialLabel?: string | null;
  hidden?: (values: FieldValues) => boolean;
}

/** Converts form values to the API shape (empty strings -> null, numbers parsed, dates to ISO). */
function normalise(fields: FieldSpec[], values: FieldValues) {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.hidden?.(values)) continue;
    let v = values[f.name];
    if (v === "" || v === undefined) v = null;
    if (v !== null && (f.type === "number" || f.type === "money")) v = Number(v);
    if (v !== null && f.type === "datetime") v = new Date(v as string).toISOString();
    out[f.name] = v;
  }
  return out;
}

export function FormFields({ fields, form }: { fields: FieldSpec[]; form: ReturnType<typeof useForm> }) {
  const { register, control, watch, formState } = form;
  const { t } = useT();
  const values = watch();
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {fields
        .filter((f) => !f.hidden?.(values))
        .map((f) => {
          const err = formState.errors[f.name]?.message as string | undefined;
          const id = `f-${f.name}`;
          const type = f.type ?? "text";
          const full = f.full || type === "textarea" || type === "users" || type === "resources";
          let control_: React.ReactNode;
          switch (type) {
            case "textarea":
              control_ = <Textarea id={id} rows={3} placeholder={f.placeholder} {...register(f.name, { required: f.required && t("shared.form.isRequired", { label: f.label }) })} />;
              break;
            case "select":
              control_ = (
                <NativeSelect id={id} {...register(f.name, { required: f.required && t("shared.form.isRequired", { label: f.label }) })}>
                  {!f.required && <option value="">—</option>}
                  {f.options?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </NativeSelect>
              );
              break;
            case "switch":
              control_ = (
                <Controller control={control} name={f.name} render={({ field }) => <Switch id={id} checked={!!field.value} onCheckedChange={field.onChange} />} />
              );
              break;
            case "user":
            case "users":
              control_ = (
                <Controller
                  control={control}
                  name={f.name}
                  rules={{ required: f.required && t("shared.form.isRequired", { label: f.label }) }}
                  render={({ field }) => <UserPicker id={id} multiple={type === "users"} value={field.value} onChange={field.onChange} initialLabel={f.initialLabel} />}
                />
              );
              break;
            case "resource":
            case "resources":
              control_ = (
                <Controller
                  control={control}
                  name={f.name}
                  rules={{ required: f.required && t("shared.form.isRequired", { label: f.label }) }}
                  render={({ field }) => (
                    <ResourcePicker
                      id={id}
                      endpoint={f.endpoint!}
                      labelKey={f.labelKey}
                      hintKey={f.hintKey}
                      multiple={type === "resources"}
                      value={field.value}
                      onChange={field.onChange}
                      placeholder={f.placeholder}
                      initialLabel={f.initialLabel}
                      extraParams={f.extraParams?.(values)}
                    />
                  )}
                />
              );
              break;
            case "campus":
              control_ = (
                <Controller
                  control={control}
                  name={f.name}
                  rules={{ required: f.required && t("shared.form.isRequired", { label: f.label }) }}
                  render={({ field }) => <CampusSelect id={id} value={field.value} onChange={field.onChange} allowEmpty={!f.required} emptyLabel="—" />}
                />
              );
              break;
            case "department":
              control_ = (
                <Controller
                  control={control}
                  name={f.name}
                  render={({ field }) => <DepartmentSelect id={id} value={field.value} onChange={field.onChange} campusId={f.campusField ? values[f.campusField] : undefined} />}
                />
              );
              break;
            case "location":
              control_ = (
                <Controller
                  control={control}
                  name={f.name}
                  render={({ field }) => <LocationCascade id={id} campusId={f.campusField ? values[f.campusField] : undefined} value={field.value} onChange={field.onChange} />}
                />
              );
              break;
            case "file":
              control_ = (
                <Controller
                  control={control}
                  name={f.name}
                  rules={{ required: f.required && t("shared.form.isRequired", { label: f.label }) }}
                  render={({ field }) => <FileField id={id} upload={f.upload!} value={field.value} onChange={field.onChange} />}
                />
              );
              break;
            default:
              control_ = (
                <Input
                  id={id}
                  type={type === "money" || type === "number" ? "number" : type === "date" ? "date" : type === "datetime" ? "datetime-local" : type === "email" ? "email" : "text"}
                  step={type === "money" ? "0.01" : type === "number" ? "any" : undefined}
                  inputMode={type === "money" || type === "number" ? "decimal" : undefined}
                  placeholder={f.placeholder}
                  aria-invalid={!!err}
                  {...register(f.name, { required: f.required && t("shared.form.isRequired", { label: f.label }) })}
                />
              );
          }
          return (
            <Field key={f.name} label={f.label} htmlFor={id} error={err} hint={f.hint} required={f.required} className={cn(full && "sm:col-span-2")}>
              {control_}
            </Field>
          );
        })}
    </div>
  );
}

/**
 * Create/edit dialog for any API resource. Server-side Zod validation errors
 * are mapped back onto the matching fields.
 */
export function ResourceFormDialog<T = Record<string, unknown>>({
  open,
  onOpenChange,
  title,
  description,
  fields,
  defaultValues,
  endpoint,
  method = "POST",
  submitLabel,
  invalidate = [],
  transform,
  onSaved,
  wide,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  fields: FieldSpec[];
  defaultValues?: Record<string, unknown>;
  endpoint: string;
  method?: "POST" | "PATCH" | "PUT";
  submitLabel?: string;
  invalidate?: string[];
  transform?: (values: Record<string, unknown>) => Record<string, unknown>;
  onSaved?: (row: T) => void;
  wide?: boolean;
}) {
  const qc = useQueryClient();
  const { t } = useT();
  const form = useForm({ defaultValues: defaultValues as FieldValues, values: open ? (defaultValues as FieldValues) : undefined });
  const save = useMutation({
    mutationFn: (values: FieldValues) => {
      let body = normalise(fields, values);
      if (method === "POST") body = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== null));
      if (transform) body = transform(body);
      return api<T>(endpoint, { method, body, idempotencyKey: method === "POST" ? crypto.randomUUID() : undefined });
    },
    onSuccess: (row) => {
      toast.success(t("ui.saved"));
      for (const k of invalidate) qc.invalidateQueries({ queryKey: [k] });
      onOpenChange(false);
      form.reset();
      onSaved?.(row);
    },
    onError: (e) => {
      if (e instanceof ApiClientError && Array.isArray(e.details)) {
        for (const d of e.details as { path: string; message: string }[]) {
          if (fields.some((f) => f.name === d.path)) form.setError(d.path, { message: d.message });
        }
      }
      toast.error(errorMessage(e));
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent wide={wide ?? fields.length > 6}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : <DialogDescription className="sr-only">{title}</DialogDescription>}
        </DialogHeader>
        <form onSubmit={form.handleSubmit((v) => {
          if (!save.isPending) save.mutate(v);
        })} className="flex flex-col gap-5">
          <FormFields fields={fields} form={form as never} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("ui.cancel")}
            </Button>
            <Button type="submit" loading={save.isPending}>
              {submitLabel ?? t("ui.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Small helper for action buttons that POST to an endpoint with toast feedback. */
export function useAction<T = unknown>(opts: { invalidate?: string[]; success?: string; onSuccess?: (r: T) => void } = {}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, body, method }: { path: string; body?: unknown; method?: string }) => api<T>(path, { method: method ?? "POST", body: body ?? {} }),
    onSuccess: (r) => {
      if (opts.success) toast.success(opts.success);
      for (const k of opts.invalidate ?? []) qc.invalidateQueries({ queryKey: [k] });
      opts.onSuccess?.(r);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

/**
 * True while a `useAction` mutation is running for `path` (and, when given, with
 * these body fields), so only the clicked button of a shared action spins.
 */
export function isActing(action: { isPending: boolean; variables?: { path: string; body?: unknown } }, path: string, body?: Record<string, unknown>) {
  if (!action.isPending || action.variables?.path !== path) return false;
  if (!body) return true;
  const sent = (action.variables.body ?? {}) as Record<string, unknown>;
  return Object.entries(body).every(([k, v]) => sent[k] === v);
}
