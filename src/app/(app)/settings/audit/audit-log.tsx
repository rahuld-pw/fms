"use client";
import { useInfiniteQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { DateTime } from "@/components/shared/format";
import { UserChip } from "@/components/shared/fields";
import { PageHeader } from "@/components/shared/page-header";
import { entityHref } from "@/app/(app)/home-widgets";
import { api } from "@/lib/client/api";
import { humanize } from "@/lib/utils/format";

/* eslint-disable @typescript-eslint/no-explicit-any */
const TYPES = ["", "issue", "work_order", "asset", "vendor", "expense_claim", "expense_advance", "budget", "requisition", "purchase_order", "vendor_invoice", "task", "project", "role", "org_member", "approval_policy", "api_key", "webhook_endpoint"];

export function AuditLog() {
  const [type, setType] = useState("");
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ["activity", "audit", type],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) => api<any[]>(`/activity?limit=50${type ? `&entity_type=${type}` : ""}${pageParam ? `&before=${pageParam}` : ""}`),
    getNextPageParam: (last) => (last.length === 50 ? last[last.length - 1].id : undefined),
  });
  const rows = data?.pages.flat() ?? [];
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Audit log" description="Every create, update, delete and workflow action, with who did it and what changed. Entries cannot be edited." />
      <NativeSelect value={type} onChange={(e) => setType(e.target.value)} className="max-w-56" aria-label="Record type">
        {TYPES.map((t) => <option key={t} value={t}>{t ? humanize(t) : "All record types"}</option>)}
      </NativeSelect>
      <Card>
        {isLoading ? <div className="p-4"><Skeleton className="h-64" /></div> : (
          <ul className="divide-y">
            {rows.map((r) => <Entry key={r.id} r={r} />)}
            {rows.length === 0 && <li className="p-4 text-sm text-muted-foreground">No entries.</li>}
          </ul>
        )}
      </Card>
      {hasNextPage && <Button variant="outline" className="self-center" onClick={() => fetchNextPage()} loading={isFetchingNextPage}>Load more</Button>}
    </div>
  );
}

function Entry({ r }: { r: any }) {
  const [open, setOpen] = useState(false);
  const changes = r.changes && typeof r.changes === "object" ? Object.entries(r.changes as Record<string, any>) : [];
  const href = entityHref(r.entity_type, r.entity_id);
  return (
    <li className="px-4 py-2.5 text-sm">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <button type="button" className="text-muted-foreground disabled:opacity-0" disabled={!changes.length} onClick={() => setOpen(!open)} aria-label="Show changes" aria-expanded={open}>
          {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </button>
        <UserChip name={r.actor?.full_name ?? (r.actor_type === "api_key" ? "API key" : "System")} />
        <span className="text-muted-foreground">{humanize(r.action)}</span>
        {href ? <Link href={href} className="font-medium hover:underline">{humanize(r.entity_type)}</Link> : <span className="font-medium">{humanize(r.entity_type)}</span>}
        {r.metadata?.number && <span className="font-mono text-xs">{r.metadata.number}</span>}
        <span className="ml-auto text-xs text-muted-foreground"><DateTime value={r.created_at} /></span>
      </div>
      {open && (
        <div className="mt-2 ml-6 overflow-x-auto rounded-md bg-muted/50 p-2">
          <table className="text-xs">
            <tbody>
              {changes.map(([k, v]) => (
                <tr key={k} className="align-top">
                  <td className="pr-3 font-medium whitespace-nowrap">{humanize(k)}</td>
                  <td className="pr-2 text-muted-foreground line-through">{fmt(v?.old ?? (Array.isArray(v) ? v[0] : undefined))}</td>
                  <td>{fmt(v?.new ?? (Array.isArray(v) ? v[1] : v))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </li>
  );
}

const fmt = (v: unknown) => (v == null ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));
