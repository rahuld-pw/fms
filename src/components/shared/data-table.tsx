"use client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Columns3, Download, Filter, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { apiList } from "@/lib/client/api";
import { cn } from "@/lib/utils/cn";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Row = Record<string, any>;

export interface Column<T extends Row = Row> {
  key: string;
  header: string;
  render?: (row: T) => React.ReactNode;
  /** API field to sort by (defaults to key when sortable). */
  sortKey?: string;
  sortable?: boolean;
  className?: string;
  align?: "left" | "right";
  defaultHidden?: boolean;
  /** Columns that cannot be hidden. */
  pinned?: boolean;
}

export interface FilterDef {
  key: string;
  label: string;
  type: "select" | "multi" | "date-range" | "boolean";
  options?: { value: string; label: string }[];
}

interface Props<T extends Row> {
  id: string;
  endpoint: string;
  columns: Column<T>[];
  filters?: FilterDef[];
  defaultSort?: string;
  searchPlaceholder?: string;
  rowHref?: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** Always-applied query params (e.g. a preset like assignee_id=me). */
  fixed?: Record<string, string>;
  exportable?: boolean;
  toolbar?: React.ReactNode;
  pageSize?: number;
  /** Compact card renderer for phones. */
  mobileCard?: (row: T) => React.ReactNode;
  selectable?: boolean;
  bulkActions?: (selected: T[], clear: () => void) => React.ReactNode;
  empty?: React.ReactNode;
}

const RESERVED = new Set(["page", "sort", "q", "limit"]);

/**
 * Server-side paginated, sortable, filterable table. State lives in the URL so
 * views are shareable and survive reloads; column visibility is remembered
 * per table in localStorage.
 */
export function DataTable<T extends Row>(props: Props<T>) {
  const { id, endpoint, columns, filters = [], defaultSort, fixed = {}, pageSize = 25 } = props;
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const page = Number(params.get("page") ?? 1);
  const sort = params.get("sort") ?? defaultSort ?? "";
  const q = params.get("q") ?? "";
  const [search, setSearch] = useState(q);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(columns.filter((c) => c.defaultHidden).map((c) => c.key)));
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      const saved = localStorage.getItem(`dt:${id}:hidden`);
      if (saved) setHidden(new Set(JSON.parse(saved)));
    } catch {
      /* storage unavailable */
    }
  }, [id]);
  useEffect(() => setSearch(q), [q]);

  const setParams = (patch: Record<string, string | null>, resetPage = true) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    if (resetPage) next.delete("page");
    router.replace(`${pathname}${next.toString() ? `?${next}` : ""}`, { scroll: false });
  };

  // debounce search into the URL
  useEffect(() => {
    if (search === q) return;
    const t = setTimeout(() => setParams({ q: search || null }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const apiQuery = useMemo(() => {
    const p = new URLSearchParams();
    p.set("page", String(page));
    p.set("limit", String(pageSize));
    if (sort) p.set("sort", sort);
    if (q) p.set("q", q);
    for (const [k, v] of params.entries()) if (!RESERVED.has(k) && v) p.set(k, v);
    for (const [k, v] of Object.entries(fixed)) p.set(k, v);
    return p.toString();
  }, [page, pageSize, sort, q, params, fixed]);

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: [endpoint, apiQuery],
    queryFn: ({ signal }) => apiList<T>(`${endpoint}?${apiQuery}`, signal),
    placeholderData: keepPreviousData,
  });

  const rows = data?.data ?? [];
  const total = data?.meta.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const visibleCols = columns.filter((c) => c.pinned || !hidden.has(c.key));
  const activeFilters = filters.filter((f) => params.get(f.key) || params.get(`${f.key}_from`) || params.get(`${f.key}_to`));

  const toggleHidden = (key: string) => {
    const next = new Set(hidden);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setHidden(next);
    try {
      localStorage.setItem(`dt:${id}:hidden`, JSON.stringify([...next]));
    } catch {
      /* ignore */
    }
  };

  const toggleSort = (col: Column<T>) => {
    const field = col.sortKey ?? col.key;
    const next = sort === field ? `-${field}` : sort === `-${field}` ? "" : field;
    setParams({ sort: next || null });
  };

  const exportHref = useMemo(() => {
    const p = new URLSearchParams(apiQuery);
    p.delete("page");
    p.delete("limit");
    return `/api/v1${endpoint}/export?${p}`;
  }, [apiQuery, endpoint]);

  const selectedRows = rows.filter((r) => selected.has(r.id));
  const go = (row: T) => {
    if (props.onRowClick) props.onRowClick(row);
    else if (props.rowHref) router.push(props.rowHref(row));
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={props.searchPlaceholder ?? "Search…"}
            className="pl-8"
            aria-label="Search"
          />
        </div>
        {filters.map((f) => (
          <FilterControl key={f.key} def={f} params={params} onChange={setParams} />
        ))}
        {activeFilters.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setParams(Object.fromEntries(filters.flatMap((f) => [[f.key, null], [`${f.key}_from`, null], [`${f.key}_to`, null]])))}
          >
            <X /> Clear
          </Button>
        )}
        <div className="ml-auto flex items-center gap-2">
          {isFetching && !isLoading && <span className="size-3 animate-spin rounded-full border-2 border-muted-foreground/40 border-r-transparent" />}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" aria-label="Columns">
                <Columns3 />
                <span className="hidden sm:inline">Columns</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>Show columns</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {columns
                .filter((c) => !c.pinned)
                .map((c) => (
                  <DropdownMenuCheckboxItem key={c.key} checked={!hidden.has(c.key)} onCheckedChange={() => toggleHidden(c.key)} onSelect={(e) => e.preventDefault()}>
                    {c.header}
                  </DropdownMenuCheckboxItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {props.exportable !== false && (
            <Button variant="outline" size="sm" asChild>
              <a href={exportHref} download>
                <Download />
                <span className="hidden sm:inline">Export</span>
              </a>
            </Button>
          )}
          {props.toolbar}
        </div>
      </div>

      {props.selectable && selectedRows.length > 0 && props.bulkActions && (
        <div className="flex items-center gap-2 rounded-md border bg-accent/40 px-3 py-2 text-sm">
          <span className="font-medium">{selectedRows.length} selected</span>
          <div className="ml-auto flex gap-2">{props.bulkActions(selectedRows, () => setSelected(new Set()))}</div>
        </div>
      )}

      {/* Phones: compact cards when provided */}
      {props.mobileCard && (
        <div className="flex flex-col gap-2 md:hidden">
          {isLoading
            ? Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20" />)
            : rows.map((r) => (
                <button key={r.id} onClick={() => go(r)} className="rounded-lg border bg-card p-3 text-left active:bg-muted">
                  {props.mobileCard!(r)}
                </button>
              ))}
        </div>
      )}

      <div className={cn("overflow-hidden rounded-lg border bg-card", props.mobileCard && "hidden md:block")}>
        <Table>
          <THead>
            <TR>
              {props.selectable && (
                <TH className="w-8">
                  <Checkbox
                    aria-label="Select all"
                    checked={rows.length > 0 && rows.every((r) => selected.has(r.id))}
                    onCheckedChange={(v) => setSelected(v ? new Set(rows.map((r) => r.id)) : new Set())}
                  />
                </TH>
              )}
              {visibleCols.map((c) => {
                const field = c.sortKey ?? c.key;
                const dir = sort === field ? "asc" : sort === `-${field}` ? "desc" : null;
                return (
                  <TH key={c.key} className={cn(c.align === "right" && "text-right", c.className)} aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : undefined}>
                    {c.sortable ? (
                      <button onClick={() => toggleSort(c)} className={cn("inline-flex items-center gap-1 hover:text-foreground", dir && "text-foreground")}>
                        {c.header}
                        {dir === "asc" ? <ArrowUp className="size-3" /> : dir === "desc" ? <ArrowDown className="size-3" /> : <ArrowUpDown className="size-3 opacity-40" />}
                      </button>
                    ) : (
                      c.header
                    )}
                  </TH>
                );
              })}
            </TR>
          </THead>
          <TBody>
            {isLoading &&
              Array.from({ length: 8 }).map((_, i) => (
                <TR key={i}>
                  {props.selectable && <TD />}
                  {visibleCols.map((c) => (
                    <TD key={c.key}>
                      <Skeleton className="h-4 w-full max-w-40" />
                    </TD>
                  ))}
                </TR>
              ))}
            {!isLoading &&
              rows.map((r) => (
                <TR key={r.id} data-clickable={!!(props.rowHref || props.onRowClick)} onClick={() => go(r)}>
                  {props.selectable && (
                    <TD onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        aria-label="Select row"
                        checked={selected.has(r.id)}
                        onCheckedChange={(v) => {
                          const next = new Set(selected);
                          if (v) next.add(r.id);
                          else next.delete(r.id);
                          setSelected(next);
                        }}
                      />
                    </TD>
                  )}
                  {visibleCols.map((c) => (
                    <TD key={c.key} className={cn(c.align === "right" && "text-right", c.className)}>
                      {c.render ? c.render(r) : (r[c.key] ?? <span className="text-muted-foreground">—</span>)}
                    </TD>
                  ))}
                </TR>
              ))}
          </TBody>
        </Table>
        {!isLoading && rows.length === 0 && (
          <div className="px-4 py-12 text-center text-sm text-muted-foreground">
            {error ? `Could not load: ${(error as Error).message}` : (props.empty ?? "Nothing here yet.")}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {total > 0 ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total.toLocaleString("en-IN")}` : "0 results"}
        </span>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon-sm" disabled={page <= 1} onClick={() => setParams({ page: String(page - 1) }, false)} aria-label="Previous page">
            <ChevronLeft />
          </Button>
          <span className="px-2">
            Page {page} of {pages}
          </span>
          <Button variant="outline" size="icon-sm" disabled={page >= pages} onClick={() => setParams({ page: String(page + 1) }, false)} aria-label="Next page">
            <ChevronRight />
          </Button>
        </div>
      </div>
    </div>
  );
}

function FilterControl({ def, params, onChange }: { def: FilterDef; params: URLSearchParams; onChange: (p: Record<string, string | null>) => void }) {
  const value = params.get(def.key) ?? "";
  if (def.type === "select" || def.type === "boolean") {
    const options = def.type === "boolean" ? [{ value: "true", label: "Yes" }, { value: "false", label: "No" }] : (def.options ?? []);
    const current = options.find((o) => o.value === value);
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant={value ? "secondary" : "outline"} size="sm">
            <Filter className="opacity-60" />
            {def.label}
            {current && <span className="max-w-28 truncate font-normal text-muted-foreground">: {current.label}</span>}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
          {options.map((o) => (
            <DropdownMenuCheckboxItem key={o.value} checked={value === o.value} onCheckedChange={(c) => onChange({ [def.key]: c ? o.value : null })}>
              {o.label}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }
  if (def.type === "multi") {
    const selected = new Set(value ? value.split(",") : []);
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant={selected.size ? "secondary" : "outline"} size="sm">
            <Filter className="opacity-60" />
            {def.label}
            {selected.size > 0 && <span className="rounded bg-background px-1 text-[11px]">{selected.size}</span>}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
          {(def.options ?? []).map((o) => (
            <DropdownMenuCheckboxItem
              key={o.value}
              checked={selected.has(o.value)}
              onSelect={(e) => e.preventDefault()}
              onCheckedChange={(c) => {
                const next = new Set(selected);
                if (c) next.add(o.value);
                else next.delete(o.value);
                onChange({ [def.key]: [...next].join(",") || null });
              }}
            >
              {o.label}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }
  // date range
  const from = params.get(`${def.key}_from`) ?? "";
  const to = params.get(`${def.key}_to`) ?? "";
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant={from || to ? "secondary" : "outline"} size="sm">
          <Filter className="opacity-60" />
          {def.label}
          {(from || to) && <span className="font-normal text-muted-foreground">: {from || "…"} → {to || "…"}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="flex w-64 flex-col gap-2">
        <label className="text-xs text-muted-foreground">
          From
          <Input type="date" value={from.slice(0, 10)} onChange={(e) => onChange({ [`${def.key}_from`]: e.target.value || null })} />
        </label>
        <label className="text-xs text-muted-foreground">
          To
          <Input type="date" value={to.slice(0, 10)} onChange={(e) => onChange({ [`${def.key}_to`]: e.target.value ? `${e.target.value}T23:59:59` : null })} />
        </label>
      </PopoverContent>
    </Popover>
  );
}
