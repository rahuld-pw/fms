"use client";
import { useQuery } from "@tanstack/react-query";
import { cloneElement, isValidElement, useEffect, useId, useState } from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { useSession } from "@/components/app/session";
import { Avatar } from "@/components/ui/avatar";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { NativeSelect } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/utils/cn";

export function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  // Associate the label with a single child control when no id was given.
  const autoId = useId();
  let id = htmlFor;
  if (!id && isValidElement<{ id?: string }>(children) && typeof children.type !== "symbol") {
    id = children.props.id ?? autoId;
    if (!children.props.id) children = cloneElement(children, { id });
  }
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={id}>
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export interface Option {
  value: string;
  label: string;
  hint?: string;
}

/**
 * Searchable single/multi select backed by an API endpoint. `endpoint` must
 * accept `q` and return `{ data: [...] }`; `toOption` maps rows to options.
 */
export function AsyncSelect<T>({
  endpoint,
  toOption,
  value,
  onChange,
  placeholder = "Select…",
  multiple,
  disabled,
  id,
  initialLabel,
  extraParams = "",
}: {
  endpoint: string;
  toOption: (row: T) => Option;
  value: string | string[] | null | undefined;
  onChange: (v: string | string[] | null, option?: Option) => void;
  placeholder?: string;
  multiple?: boolean;
  disabled?: boolean;
  id?: string;
  initialLabel?: string | null;
  extraParams?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [labels, setLabels] = useState<Record<string, string>>({});
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 200);
    return () => clearTimeout(t);
  }, [q]);
  const sep = endpoint.includes("?") ? "&" : "?";
  const { data = [], isFetching } = useQuery({
    queryKey: ["picker", endpoint, debounced, extraParams],
    queryFn: ({ signal }) => api<T[]>(`${endpoint}${sep}limit=30&q=${encodeURIComponent(debounced)}${extraParams}`, { signal }),
    enabled: open,
  });
  const options = data.map(toOption);
  const values = multiple ? ((value as string[] | null) ?? []) : value ? [value as string] : [];
  const labelOf = (v: string) => labels[v] ?? options.find((o) => o.value === v)?.label ?? (values.length === 1 && initialLabel ? initialLabel : "Selected");

  const listId = useId();
  const pick = (o: Option) => {
    setLabels((l) => ({ ...l, [o.value]: o.label }));
    if (multiple) {
      const set = new Set(values);
      if (set.has(o.value)) set.delete(o.value);
      else set.add(o.value);
      onChange([...set], o);
    } else {
      onChange(o.value === value ? null : o.value, o);
      setOpen(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-haspopup="listbox"
          disabled={disabled}
          className="flex min-h-9 w-full items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1 text-left text-sm shadow-xs focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none disabled:opacity-50"
        >
          <span className="flex min-w-0 flex-1 flex-wrap gap-1">
            {values.length === 0 && <span className="text-muted-foreground">{placeholder}</span>}
            {!multiple && values[0] && <span className="truncate">{labelOf(values[0])}</span>}
            {multiple &&
              values.map((v) => (
                <span key={v} className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs">
                  {labelOf(v)}
                  <X
                    className="size-3 cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      onChange(values.filter((x) => x !== v));
                    }}
                  />
                </span>
              ))}
          </span>
          {!multiple && values[0] ? (
            <X
              className="size-4 shrink-0 text-muted-foreground hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation();
                onChange(null);
              }}
            />
          ) : (
            <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-64 p-0">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search…" value={q} onValueChange={setQ} />
          <CommandList id={listId}>
            <CommandEmpty>{isFetching ? "Loading…" : "No matches."}</CommandEmpty>
            {options.map((o) => (
              <CommandItem key={o.value} value={o.value} onSelect={() => pick(o)}>
                <Check className={cn("size-4", values.includes(o.value) ? "opacity-100" : "opacity-0")} />
                <span className="truncate">{o.label}</span>
                {o.hint && <span className="ml-auto truncate text-xs text-muted-foreground">{o.hint}</span>}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

interface UserRow {
  id: string;
  full_name: string | null;
  email: string | null;
  title?: string | null;
}

export function UserPicker(props: { value: string | string[] | null | undefined; onChange: (v: string | string[] | null) => void; multiple?: boolean; placeholder?: string; id?: string; initialLabel?: string | null }) {
  return (
    <AsyncSelect<UserRow>
      endpoint="/users/lookup"
      toOption={(u) => ({ value: u.id, label: u.full_name ?? u.email ?? u.id, hint: u.title ?? u.email ?? undefined })}
      placeholder={props.placeholder ?? (props.multiple ? "Add people…" : "Select person…")}
      {...props}
    />
  );
}

/** Generic picker for list endpoints returning `{ data, meta }` with `id` + a label field. */
export function ResourcePicker({
  endpoint,
  labelKey = "name",
  hintKey,
  ...rest
}: {
  endpoint: string;
  labelKey?: string;
  hintKey?: string;
  value: string | string[] | null | undefined;
  onChange: (v: string | string[] | null, option?: Option) => void;
  placeholder?: string;
  multiple?: boolean;
  id?: string;
  initialLabel?: string | null;
  extraParams?: string;
  disabled?: boolean;
}) {
  return (
    <AsyncSelect<Record<string, unknown>>
      endpoint={endpoint}
      toOption={(r) => ({ value: String(r.id), label: String(r[labelKey] ?? r.id), hint: hintKey ? String(r[hintKey] ?? "") : undefined })}
      {...rest}
    />
  );
}

export function UserChip({ name }: { name: string | null | undefined }) {
  if (!name) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Avatar name={name} size="xs" />
      <span className="truncate">{name}</span>
    </span>
  );
}

export function CampusSelect({ value, onChange, id, allowEmpty, emptyLabel = "All campuses" }: { value: string | null | undefined; onChange: (v: string | null) => void; id?: string; allowEmpty?: boolean; emptyLabel?: string }) {
  const { campuses } = useSession();
  return (
    <NativeSelect id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      {(allowEmpty || !value) && <option value="">{allowEmpty ? emptyLabel : "Select campus…"}</option>}
      {campuses.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </NativeSelect>
  );
}

export function DepartmentSelect({ value, onChange, campusId, id }: { value: string | null | undefined; onChange: (v: string | null) => void; campusId?: string | null; id?: string }) {
  const { departments } = useSession();
  const list = departments.filter((d) => !campusId || !d.campus_id || d.campus_id === campusId);
  return (
    <NativeSelect id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">No department</option>
      {list.map((d) => (
        <option key={d.id} value={d.id}>
          {d.name}
        </option>
      ))}
    </NativeSelect>
  );
}
