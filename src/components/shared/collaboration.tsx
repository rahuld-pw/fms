"use client";
import { useT } from "@/lib/i18n/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { AtSign, Check, Download, FileText, ImageIcon, Lock, Paperclip, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/components/app/session";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, errorMessage, uploadToSigned } from "@/lib/client/api";
import { formatDateTime, humanize, relativeTime } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";
import { DateTime } from "./format";
import { UserPicker } from "./fields";
import { StatusBadge } from "./status";

interface Comment {
  id: string;
  body: string;
  created_at: string;
  is_internal: boolean;
  author_label: string | null;
  author: { id: string; full_name: string | null } | null;
}

export function Comments({ entityType, entityId, allowInternal }: { entityType: string; entityId: string; allowInternal?: boolean }) {
  const { locale } = useT();
  const qc = useQueryClient();
  const key = ["comments", entityType, entityId];
  const [body, setBody] = useState("");
  const [mentions, setMentions] = useState<string[]>([]);
  const [showMention, setShowMention] = useState(false);
  const [internal, setInternal] = useState(false);
  const { user } = useSession();
  const { data = [] } = useQuery({ queryKey: key, queryFn: () => api<Comment[]>(`/comments?entity_type=${entityType}&entity_id=${entityId}`) });
  const add = useMutation({
    mutationFn: () => api<Comment>("/comments", { body: { entity_type: entityType, entity_id: entityId, body, mentions, is_internal: internal } }),
    onMutate: async () => {
      const optimistic: Comment = {
        id: `tmp-${Date.now()}`, body, created_at: new Date().toISOString(), is_internal: internal, author_label: null,
        author: { id: user.id, full_name: user.full_name },
      };
      qc.setQueryData<Comment[]>(key, (old = []) => [...old, optimistic]);
      setBody("");
      setMentions([]);
      setShowMention(false);
    },
    onError: (e) => {
      toast.error(errorMessage(e));
      qc.invalidateQueries({ queryKey: key });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
  return (
    <div className="flex flex-col gap-4">
      {data.length === 0 && <p className="text-sm text-muted-foreground">No comments yet.</p>}
      <ul className="flex flex-col gap-4">
        {data.map((c) => (
          <li key={c.id} className="flex gap-2.5">
            <Avatar name={c.author?.full_name ?? c.author_label ?? "?"} size="sm" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
                <span className="font-medium text-foreground">{c.author?.full_name ?? c.author_label}</span>
                <span className="text-muted-foreground" title={c.created_at}>{relativeTime(c.created_at, locale)}</span>
                {c.is_internal && (
                  <span className="inline-flex items-center gap-0.5 text-amber-600">
                    <Lock className="size-3" /> internal
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-sm whitespace-pre-wrap">{c.body}</p>
            </div>
          </li>
        ))}
      </ul>
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (body.trim()) add.mutate();
        }}
      >
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write a comment…" rows={3} aria-label="Comment" />
        {showMention && <UserPicker multiple value={mentions} onChange={(v) => setMentions((v as string[]) ?? [])} placeholder="Mention people (they'll be notified)" />}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => setShowMention((s) => !s)}>
            <AtSign /> Mention{mentions.length ? ` (${mentions.length})` : ""}
          </Button>
          {allowInternal && (
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Checkbox checked={internal} onCheckedChange={(v) => setInternal(!!v)} /> Internal note (hidden from reporter/vendor)
            </label>
          )}
          <Button type="submit" size="sm" className="ml-auto" disabled={!body.trim()} loading={add.isPending}>
            Comment
          </Button>
        </div>
      </form>
    </div>
  );
}

interface Attachment {
  id: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  kind: string | null;
  created_at: string;
}

export function Attachments({ entityType, entityId, kind, canUpload = true }: { entityType: string; entityId: string; kind?: string; canUpload?: boolean }) {
  const qc = useQueryClient();
  const key = ["attachments", entityType, entityId];
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const { data = [] } = useQuery({ queryKey: key, queryFn: () => api<Attachment[]>(`/attachments?entity_type=${entityType}&entity_id=${entityId}`) });
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        const res = await api<{ upload: { url: string } }>("/attachments", {
          body: { entity_type: entityType, entity_id: entityId, file_name: file.name, mime_type: file.type || "application/octet-stream", size_bytes: file.size, kind },
        });
        await uploadToSigned(res.upload.url, file);
      }
      toast.success(files.length > 1 ? `${files.length} files uploaded` : "File uploaded");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
      qc.invalidateQueries({ queryKey: key });
      if (input.current) input.current.value = "";
    }
  };
  const open = async (a: Attachment, download = false) => {
    try {
      const { url } = await api<{ url: string }>(`/attachments/${a.id}/url${download ? "?download=true" : ""}`);
      window.open(url, "_blank", "noopener");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const remove = useMutation({
    mutationFn: (id: string) => api(`/attachments/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="flex flex-col gap-2">
      {data.length === 0 && <p className="text-sm text-muted-foreground">No files.</p>}
      <ul className="flex flex-col divide-y rounded-md border empty:hidden">
        {data.map((a) => (
          <li key={a.id} className="flex items-center gap-2 px-3 py-2 text-sm">
            {a.mime_type?.startsWith("image/") ? <ImageIcon className="size-4 text-muted-foreground" /> : <FileText className="size-4 text-muted-foreground" />}
            <button className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => open(a)}>
              {a.file_name}
            </button>
            <span className="hidden text-xs text-muted-foreground sm:inline">{a.size_bytes ? `${Math.ceil(a.size_bytes / 1024)} KB` : ""}</span>
            <Button variant="ghost" size="icon-sm" onClick={() => open(a, true)} aria-label="Download">
              <Download />
            </Button>
            {canUpload && (
              <Button variant="ghost" size="icon-sm" onClick={() => remove.mutate(a.id)} aria-label="Remove">
                <Trash2 />
              </Button>
            )}
          </li>
        ))}
      </ul>
      {canUpload && (
        <>
          <input ref={input} type="file" multiple className="hidden" onChange={(e) => upload(e.target.files)} accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt" capture={undefined} />
          <Button variant="outline" size="sm" className="self-start" onClick={() => input.current?.click()} loading={busy}>
            {busy ? <Upload /> : <Paperclip />} Attach files
          </Button>
        </>
      )}
    </div>
  );
}

interface Activity {
  id: number;
  action: string;
  actor_type: string;
  changes: Record<string, [unknown, unknown]> | null;
  metadata: Record<string, unknown>;
  created_at: string;
  actor: { full_name: string | null } | null;
}

const HIDDEN_FIELDS = new Set(["number", "search_vector", "position", "path_names", "approval_request_id", "budget_checks", "match_details"]);

export function ActivityFeed({ entityType, entityId }: { entityType: string; entityId: string }) {
  const { org } = useSession();
  const { data = [], isLoading } = useQuery({
    queryKey: ["activity", entityType, entityId],
    queryFn: () => api<Activity[]>(`/activity?entity_type=${entityType}&entity_id=${entityId}&limit=100`),
  });
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (data.length === 0) return <p className="text-sm text-muted-foreground">No activity.</p>;
  return (
    <ol className="relative flex flex-col gap-3 border-l pl-4">
      {data.map((a) => (
        <li key={a.id} className="relative text-sm">
          <span className="absolute top-1.5 -left-[21px] size-2 rounded-full bg-border ring-4 ring-background" />
          <div>
            <span className="font-medium">{a.actor?.full_name ?? (a.actor_type === "system" ? "System" : a.actor_type === "anonymous" ? "Anonymous" : "API")}</span>{" "}
            <span className="text-muted-foreground">{describe(a)}</span>
          </div>
          {a.changes && (
            <ul className="mt-1 flex flex-col gap-0.5 text-xs text-muted-foreground">
              {Object.entries(a.changes)
                .filter(([k]) => !HIDDEN_FIELDS.has(k))
                .slice(0, 6)
                .map(([k, [from, to]]) => (
                  <li key={k}>
                    {humanize(k)}: <span className="line-through opacity-70">{fmt(from)}</span> → <span className="text-foreground">{fmt(to)}</span>
                  </li>
                ))}
            </ul>
          )}
          <time className="text-xs text-muted-foreground">{formatDateTime(a.created_at, org.timezone)}</time>
        </li>
      ))}
    </ol>
  );
}

function describe(a: Activity) {
  switch (a.action) {
    case "created": return "created this";
    case "status_changed": return `changed status to ${humanize(String(a.changes?.status?.[1] ?? ""))}`;
    case "commented": return "commented";
    case "deleted": return "deleted this";
    case "escalated": return `escalated (level ${String(a.metadata?.level ?? "")})`;
    default: return humanize(a.action).toLowerCase();
  }
}

function fmt(v: unknown) {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "string" && /^[0-9a-f-]{36}$/.test(v)) return "…" + v.slice(-4);
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return new Date(v).toLocaleString("en-IN");
  if (typeof v === "object") return JSON.stringify(v).slice(0, 60);
  return String(v).slice(0, 80);
}

interface ApprovalRequest {
  id: string;
  status: string;
  title: string;
  submitted_at: string;
  decided_at: string | null;
  auto_approved: boolean;
  amount: number | null;
  requester: { id: string; full_name: string | null } | null;
  steps: { id: string; step_order: number; name: string; status: string; approver_type: string; required_approvals: number; due_at: string | null; note: string | null }[];
  actions: { id: string; action: string; comment: string | null; created_at: string; step_id: string | null; actor: { full_name: string | null } | null; on_behalf_of: string | null }[];
}

/** Approval history and actions for any entity routed through the approval engine. */
export function ApprovalPanel({ entityType, entityId, onDecided }: { entityType: string; entityId: string; onDecided?: () => void }) {
  const qc = useQueryClient();
  const { user } = useSession();
  const { data = [] } = useQuery({
    queryKey: ["approvals", entityType, entityId],
    queryFn: () => api<ApprovalRequest[]>(`/approvals/for/${entityType}/${entityId}`),
  });
  const { data: inbox = [] } = useQuery({ queryKey: ["approvals-inbox"], queryFn: () => api<{ id: string }[]>("/approvals/inbox") });
  if (data.length === 0) return <p className="text-sm text-muted-foreground">Not submitted for approval yet.</p>;
  const [latest, ...older] = data;
  const canAct = latest.status === "pending" && inbox.some((r) => r.id === latest.id);
  const canCancel = latest.status === "pending" && latest.requester?.id === user.id;
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["approvals", entityType, entityId] });
    qc.invalidateQueries({ queryKey: ["approvals-inbox"] });
    onDecided?.();
  };
  return (
    <div className="flex flex-col gap-4">
      <ApprovalTimeline request={latest} />
      {canAct && <ApprovalActions requestId={latest.id} onDone={refresh} />}
      {canCancel && !canAct && <CancelApproval requestId={latest.id} onDone={refresh} />}
      {older.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">Previous submissions ({older.length})</summary>
          <div className="mt-3 flex flex-col gap-4">
            {older.map((r) => (
              <ApprovalTimeline key={r.id} request={r} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

export function ApprovalTimeline({ request }: { request: ApprovalRequest }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <StatusBadge status={request.status} />
        {request.auto_approved && <span className="text-xs text-muted-foreground">auto-approved by policy</span>}
        <span className="text-xs text-muted-foreground">
          submitted by {request.requester?.full_name ?? "—"} · <DateTime value={request.submitted_at} relative />
        </span>
      </div>
      <ol className="flex flex-col gap-2">
        {[...request.steps]
          .sort((a, b) => a.step_order - b.step_order)
          .map((s) => {
            const acts = request.actions.filter((a) => a.step_id === s.id);
            return (
              <li key={s.id} className="flex gap-2.5 rounded-md border px-3 py-2">
                <span
                  className={cn(
                    "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
                    s.status === "approved" ? "bg-primary text-primary-foreground" : s.status === "rejected" ? "bg-destructive text-white" : s.status === "pending" ? "bg-amber-500 text-white" : "bg-muted text-muted-foreground",
                  )}
                >
                  {s.status === "approved" ? <Check className="size-3" /> : s.status === "rejected" ? <X className="size-3" /> : s.step_order}
                </span>
                <div className="min-w-0 flex-1 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{s.name}</span>
                    <StatusBadge status={s.status} />
                    {s.required_approvals > 1 && <span className="text-xs text-muted-foreground">{s.required_approvals} approvals needed</span>}
                    {s.status === "pending" && s.due_at && (
                      <span className="text-xs text-muted-foreground">
                        due <DateTime value={s.due_at} relative />
                      </span>
                    )}
                  </div>
                  {s.note && <p className="text-xs text-muted-foreground">{s.note}</p>}
                  {acts.map((a) => (
                    <p key={a.id} className="mt-1 text-xs">
                      <span className="font-medium">{a.actor?.full_name}</span> {a.action}d{a.on_behalf_of ? " (as delegate)" : ""}
                      {a.comment && <span className="text-muted-foreground"> — “{a.comment}”</span>}
                    </p>
                  ))}
                </div>
              </li>
            );
          })}
      </ol>
      {request.actions
        .filter((a) => a.action === "comment" || a.action === "cancel")
        .map((a) => (
          <p key={a.id} className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{a.actor?.full_name}</span> {a.action === "cancel" ? "cancelled" : "commented"}
            {a.comment && <>: “{a.comment}”</>}
          </p>
        ))}
    </div>
  );
}

export function ApprovalActions({ requestId, onDone }: { requestId: string; onDone: () => void }) {
  const [mode, setMode] = useState<"approve" | "reject" | null>(null);
  const [comment, setComment] = useState("");
  const act = useMutation({
    mutationFn: () => api<{ status: string }>(`/approvals/${requestId}/act`, { body: { action: mode, comment: comment || undefined } }),
    onSuccess: (r) => {
      toast.success(r.status === "pending" ? "Approved — moved to the next step" : `Request ${r.status}`);
      setMode(null);
      setComment("");
      onDone();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <>
      <div className="flex gap-2">
        <Button onClick={() => setMode("approve")} className="flex-1 sm:flex-none">
          <Check /> Approve
        </Button>
        <Button variant="outline" onClick={() => setMode("reject")} className="flex-1 sm:flex-none">
          <X /> Reject
        </Button>
      </div>
      <Dialog open={mode !== null} onOpenChange={(o) => !o && setMode(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{mode === "approve" ? "Approve request" : "Reject request"}</DialogTitle>
            <DialogDescription>{mode === "reject" ? "A reason is required and will be shared with the requester." : "Add an optional note."}</DialogDescription>
          </DialogHeader>
          <Textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder={mode === "reject" ? "Reason for rejection" : "Note (optional)"} autoFocus />
          <DialogFooter>
            <Button variant="outline" onClick={() => setMode(null)}>
              Cancel
            </Button>
            <Button variant={mode === "reject" ? "destructive" : "default"} disabled={mode === "reject" && !comment.trim()} loading={act.isPending} onClick={() => act.mutate()}>
              {mode === "approve" ? "Approve" : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function CancelApproval({ requestId, onDone }: { requestId: string; onDone: () => void }) {
  const cancel = useMutation({
    mutationFn: () => api(`/approvals/${requestId}/cancel`, { body: {} }),
    onSuccess: () => {
      toast.success("Request withdrawn");
      onDone();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Button variant="outline" size="sm" className="self-start" onClick={() => cancel.mutate()} loading={cancel.isPending}>
      Withdraw request
    </Button>
  );
}
