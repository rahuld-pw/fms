"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Bug, ChevronDown, ChevronRight, Lightbulb, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { NativeSelect, Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { DateTime } from "@/components/shared/format";
import { EmptyState, PageHeader } from "@/components/shared/page-header";
import { api, errorMessage } from "@/lib/client/api";
import { humanize } from "@/lib/utils/format";

/* eslint-disable @typescript-eslint/no-explicit-any */
const STATUSES = ["new", "triaged", "planned", "in_progress", "done", "wont_fix", "duplicate"];
const OPEN = "new,triaged,planned,in_progress";
const ICON = { bug: Bug, feature: Lightbulb, other: MessageSquare } as const;
const TONE: Record<string, "neutral" | "blue" | "amber" | "green" | "violet" | "red"> = {
  new: "blue", triaged: "violet", planned: "amber", in_progress: "amber", done: "green", wont_fix: "neutral", duplicate: "neutral",
};

export function FeedbackTriage() {
  const [status, setStatus] = useState(OPEN);
  const [kind, setKind] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "feedback", status, kind],
    queryFn: () => api<any[]>(`/admin/feedback?${new URLSearchParams({ ...(status ? { status } : {}), ...(kind ? { kind } : {}) })}`),
  });
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Feedback" description="Bug reports and feature requests from users and visitors." />
      <div className="flex flex-wrap gap-2">
        <NativeSelect value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto" aria-label="Status">
          <option value={OPEN}>Open</option>
          <option value="">All</option>
          {STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
        </NativeSelect>
        <NativeSelect value={kind} onChange={(e) => setKind(e.target.value)} className="w-auto" aria-label="Type">
          <option value="">Bugs and features</option>
          <option value="bug">Bugs</option>
          <option value="feature">Feature requests</option>
          <option value="other">Other</option>
        </NativeSelect>
      </div>
      <Card>
        {isLoading ? <div className="p-4"><Skeleton className="h-40" /></div> : !data?.length ? <div className="p-4"><EmptyState title="Nothing here" description="New reports appear here as they come in." /></div> : (
          <ul className="divide-y">{data.map((f) => <Item key={f.id} f={f} />)}</ul>
        )}
      </Card>
    </div>
  );
}

function Item({ f }: { f: any }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState(f.admin_notes ?? "");
  const Icon = ICON[f.kind as keyof typeof ICON] ?? MessageSquare;
  const save = async (body: Record<string, unknown>) => {
    try {
      await api(`/admin/feedback/${f.id}`, { method: "PATCH", body });
      toast.success("Updated");
      qc.invalidateQueries({ queryKey: ["admin", "feedback"] });
    } catch (e) { toast.error(errorMessage(e)); }
  };
  return (
    <li className="px-4 py-3">
      <button type="button" className="flex w-full items-start gap-3 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? <ChevronDown className="mt-0.5 size-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
        <Icon className={f.kind === "bug" ? "mt-0.5 size-4 shrink-0 text-destructive" : "mt-0.5 size-4 shrink-0 text-amber-600"} />
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{f.title}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {f.user?.full_name ?? f.email ?? "Anonymous"}{f.organisation?.name && ` · ${f.organisation.name}`} · <DateTime value={f.created_at} relative />
          </span>
        </span>
        <Badge tone={TONE[f.status]}>{humanize(f.status)}</Badge>
      </button>
      {open && (
        <div className="mt-3 ml-7 flex flex-col gap-3 text-sm">
          <p className="whitespace-pre-wrap">{f.description}</p>
          <dl className="grid gap-1 text-xs text-muted-foreground">
            {(f.user?.email ?? f.email) && <div><dt className="inline">Contact: </dt><dd className="inline"><a className="underline" href={`mailto:${f.user?.email ?? f.email}`}>{f.user?.email ?? f.email}</a></dd></div>}
            {f.page_url && <div className="truncate"><dt className="inline">Page: </dt><dd className="inline">{f.page_url}</dd></div>}
            {f.user_agent && <div className="truncate"><dt className="inline">Browser: </dt><dd className="inline">{f.user_agent}</dd></div>}
          </dl>
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect value={f.status} onChange={(e) => save({ status: e.target.value })} className="w-auto" aria-label="Status">
              {STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
            </NativeSelect>
          </div>
          <Textarea rows={2} placeholder="Internal notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          {notes !== (f.admin_notes ?? "") && <Button size="sm" className="self-start" onClick={() => save({ admin_notes: notes || null })}>Save notes</Button>}
        </div>
      )}
    </li>
  );
}
