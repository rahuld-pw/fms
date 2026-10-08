"use client";
import { useT } from "@/lib/i18n/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type ReactNode } from "react";
import { AtSign, Check, Download, FileText, ImageIcon, Lock, Paperclip, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/components/app/session";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/spinner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, errorMessage, uploadToSigned } from "@/lib/client/api";
import type { TFunction } from "@/lib/i18n/translate";
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
  const { t, locale } = useT();
  const qc = useQueryClient();
  const key = ["comments", entityType, entityId];
  const [body, setBody] = useState("");
  const [mentions, setMentions] = useState<string[]>([]);
  const [showMention, setShowMention] = useState(false);
  const [internal, setInternal] = useState(false);
  const { user } = useSession();
  const { data = [] } = useQuery({ queryKey: key, queryFn: () => api<Comment[]>(`/comments?entity_type=${entityType}&entity_id=${entityId}`) });
  // The draft is passed as variables: onMutate clears the box before the
  // request runs, so the request must not read the (now empty) state.
  type Draft = { body: string; mentions: string[]; internal: boolean };
  const add = useMutation({
    mutationFn: (d: Draft) => api<Comment>("/comments", { body: { entity_type: entityType, entity_id: entityId, body: d.body, mentions: d.mentions, is_internal: d.internal } }),
    onMutate: async (d: Draft) => {
      const optimistic: Comment = {
        id: `tmp-${Date.now()}`, body: d.body, created_at: new Date().toISOString(), is_internal: d.internal, author_label: null,
        author: { id: user.id, full_name: user.full_name },
      };
      qc.setQueryData<Comment[]>(key, (old = []) => [...old, optimistic]);
      setBody("");
      setMentions([]);
      setShowMention(false);
    },
    onError: (e, d) => {
      toast.error(errorMessage(e));
      setBody(d.body); // give the text back so nothing is lost
      qc.invalidateQueries({ queryKey: key });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
  return (
    <div className="flex flex-col gap-4">
      {data.length === 0 && <p className="text-sm text-muted-foreground">{t("shared.comments.empty")}</p>}
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
                    <Lock className="size-3" /> {t("shared.comments.internal")}
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
          if (add.isPending) return;
          if (body.trim()) add.mutate({ body, mentions, internal });
        }}
      >
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder={t("shared.comments.placeholder")} rows={3} aria-label={t("ui.comment")} />
        {showMention && <UserPicker multiple value={mentions} onChange={(v) => setMentions((v as string[]) ?? [])} placeholder={t("shared.comments.mentionPlaceholder")} />}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => setShowMention((s) => !s)}>
            <AtSign /> {mentions.length ? t("shared.comments.mentionCount", { n: mentions.length }) : t("shared.comments.mention")}
          </Button>
          {allowInternal && (
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Checkbox checked={internal} onCheckedChange={(v) => setInternal(!!v)} /> {t("shared.comments.internalNote")}
            </label>
          )}
          <Button type="submit" size="sm" className="ml-auto" disabled={!body.trim()} loading={add.isPending}>
            {t("ui.comment")}
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
  const { t } = useT();
  const qc = useQueryClient();
  const key = ["attachments", entityType, entityId];
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const { data = [] } = useQuery({ queryKey: key, queryFn: () => api<Attachment[]>(`/attachments?entity_type=${entityType}&entity_id=${entityId}`) });
  const upload = async (files: FileList | null) => {
    if (!files?.length || busy) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        const res = await api<{ upload: { url: string } }>("/attachments", {
          body: { entity_type: entityType, entity_id: entityId, file_name: file.name, mime_type: file.type || "application/octet-stream", size_bytes: file.size, kind },
        });
        await uploadToSigned(res.upload.url, file);
      }
      toast.success(files.length > 1 ? t("shared.attachments.uploadedMany", { n: files.length }) : t("shared.attachments.uploadedOne"));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
      qc.invalidateQueries({ queryKey: key });
      if (input.current) input.current.value = "";
    }
  };
  const [opening, setOpening] = useState<string | null>(null);
  const open = async (a: Attachment, download = false) => {
    setOpening(a.id);
    try {
      const { url } = await api<{ url: string }>(`/attachments/${a.id}/url${download ? "?download=true" : ""}`);
      window.open(url, "_blank", "noopener");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setOpening(null);
    }
  };
  const remove = useMutation({
    mutationFn: (id: string) => api(`/attachments/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="flex flex-col gap-2">
      {data.length === 0 && <p className="text-sm text-muted-foreground">{t("shared.attachments.empty")}</p>}
      <ul className="flex flex-col divide-y rounded-md border empty:hidden">
        {data.map((a) => (
          <li key={a.id} className="flex items-center gap-2 px-3 py-2 text-sm">
            {a.mime_type?.startsWith("image/") ? <ImageIcon className="size-4 text-muted-foreground" /> : <FileText className="size-4 text-muted-foreground" />}
            <button className="flex min-w-0 flex-1 items-center gap-1.5 text-left hover:underline disabled:opacity-50" disabled={opening === a.id} aria-busy={opening === a.id || undefined} onClick={() => open(a)}>
              <span className="truncate">{a.file_name}</span>
              {opening === a.id && <Spinner />}
            </button>
            <span className="hidden text-xs text-muted-foreground sm:inline">{a.size_bytes ? t("shared.attachments.kb", { n: Math.ceil(a.size_bytes / 1024) }) : ""}</span>
            <Button variant="ghost" size="icon-sm" onClick={() => open(a, true)} aria-label={t("ui.download")}>
              <Download />
            </Button>
            {canUpload && (
              <Button variant="ghost" size="icon-sm" disabled={remove.isPending} loading={remove.isPending && remove.variables === a.id} onClick={() => remove.mutate(a.id)} aria-label={t("ui.remove")}>
                {!(remove.isPending && remove.variables === a.id) && <Trash2 />}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {canUpload && (
        <>
          <input ref={input} type="file" multiple className="hidden" onChange={(e) => upload(e.target.files)} accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt" capture={undefined} />
          <Button variant="outline" size="sm" className="self-start" onClick={() => input.current?.click()} loading={busy}>
            {busy ? <Upload /> : <Paperclip />} {t("shared.attachments.attach")}
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
  const { t } = useT();
  const { data = [], isLoading } = useQuery({
    queryKey: ["activity", entityType, entityId],
    queryFn: () => api<Activity[]>(`/activity?entity_type=${entityType}&entity_id=${entityId}&limit=100`),
  });
  if (isLoading) return <p className="text-sm text-muted-foreground">{t("ui.loading")}</p>;
  if (data.length === 0) return <p className="text-sm text-muted-foreground">{t("shared.activity.empty")}</p>;
  return (
    <ol className="relative flex flex-col gap-3 border-l pl-4">
      {data.map((a) => {
        const [pre, post = ""] = describe(a, t).split("{actor}");
        return (
        <li key={a.id} className="relative text-sm">
          <span className="absolute top-1.5 -left-[21px] size-2 rounded-full bg-border ring-4 ring-background" />
          <div>
            {pre}
            <span className="font-medium">{a.actor?.full_name ?? (a.actor_type === "system" ? t("shared.activity.system") : a.actor_type === "anonymous" ? t("shared.activity.anonymous") : t("shared.activity.api"))}</span>
            <span className="text-muted-foreground">{post}</span>
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
        );
      })}
    </ol>
  );
}

/** Sentence with an `{actor}` marker where the actor's name goes. */
function describe(a: Activity, t: TFunction) {
  const actor = "{actor}";
  switch (a.action) {
    case "created": return t("shared.activity.created", { actor });
    case "status_changed": {
      const status = String(a.changes?.status?.[1] ?? "");
      return t("shared.activity.statusChanged", { actor, status: t(`status.${status}`, undefined, humanize(status)) });
    }
    case "commented": return t("shared.activity.commented", { actor });
    case "deleted": return t("shared.activity.deleted", { actor });
    case "escalated": return t("shared.activity.escalated", { actor, level: String(a.metadata?.level ?? "") });
    case "updated": return t("shared.activity.updated", { actor });
    case "restored": return t("shared.activity.restored", { actor });
    default: return t(`shared.activity.other.${a.action}`, { actor }, `{actor} ${humanize(a.action).toLowerCase()}`);
  }
}

/** Replaces `{token}` in a translated string with a React node. */
function withNode(text: string, token: string, node: ReactNode) {
  const [pre, post] = text.split(`{${token}}`);
  return (
    <>
      {pre}
      {post !== undefined && node}
      {post}
    </>
  );
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
  const { t } = useT();
  const qc = useQueryClient();
  const { user } = useSession();
  const { data = [] } = useQuery({
    queryKey: ["approvals", entityType, entityId],
    queryFn: () => api<ApprovalRequest[]>(`/approvals/for/${entityType}/${entityId}`),
  });
  const { data: inbox = [] } = useQuery({ queryKey: ["approvals-inbox"], queryFn: () => api<{ id: string }[]>("/approvals/inbox") });
  if (data.length === 0) return <p className="text-sm text-muted-foreground">{t("shared.approval.notSubmitted")}</p>;
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
          <summary className="cursor-pointer text-muted-foreground">{t("shared.approval.previous", { n: older.length })}</summary>
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
  const { t } = useT();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <StatusBadge status={request.status} />
        {request.auto_approved && <span className="text-xs text-muted-foreground">{t("shared.approval.autoApproved")}</span>}
        <span className="text-xs text-muted-foreground">
          {withNode(t("shared.approval.submittedBy", { name: request.requester?.full_name ?? "—" }), "time", <DateTime value={request.submitted_at} relative />)}
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
                    {s.required_approvals > 1 && <span className="text-xs text-muted-foreground">{t("shared.approval.approvalsNeeded", { n: s.required_approvals })}</span>}
                    {s.status === "pending" && s.due_at && (
                      <span className="text-xs text-muted-foreground">
                        {withNode(t("shared.approval.due"), "time", <DateTime value={s.due_at} relative />)}
                      </span>
                    )}
                  </div>
                  {s.note && <p className="text-xs text-muted-foreground">{s.note}</p>}
                  {acts.map((a) => (
                    <p key={a.id} className="mt-1 text-xs">
                      {withNode(
                        t(`shared.approval.acted.${a.action}${a.on_behalf_of ? "Delegate" : ""}`, undefined, `{actor} ${a.action}d${a.on_behalf_of ? " (as delegate)" : ""}`),
                        "actor",
                        <span className="font-medium">{a.actor?.full_name}</span>,
                      )}
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
            {withNode(
              a.comment
                ? t(a.action === "cancel" ? "shared.approval.cancelledWithComment" : "shared.approval.commentedWithComment", { comment: a.comment })
                : t(a.action === "cancel" ? "shared.approval.cancelled" : "shared.approval.commented"),
              "actor",
              <span className="font-medium text-foreground">{a.actor?.full_name}</span>,
            )}
          </p>
        ))}
    </div>
  );
}

export function ApprovalActions({ requestId, onDone }: { requestId: string; onDone: () => void }) {
  const { t } = useT();
  const [mode, setMode] = useState<"approve" | "reject" | null>(null);
  const [comment, setComment] = useState("");
  const act = useMutation({
    mutationFn: () => api<{ status: string }>(`/approvals/${requestId}/act`, { body: { action: mode, comment: comment || undefined } }),
    onSuccess: (r) => {
      toast.success(
        r.status === "pending"
          ? t("shared.approval.movedNext")
          : r.status === "approved"
            ? t("shared.approval.requestApproved")
            : r.status === "rejected"
              ? t("shared.approval.requestRejected")
              : t("shared.approval.requestStatus", { status: r.status }),
      );
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
          <Check /> {t("ui.approve")}
        </Button>
        <Button variant="outline" onClick={() => setMode("reject")} className="flex-1 sm:flex-none">
          <X /> {t("ui.reject")}
        </Button>
      </div>
      <Dialog open={mode !== null} onOpenChange={(o) => !o && setMode(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{mode === "approve" ? t("shared.approval.approveTitle") : t("shared.approval.rejectTitle")}</DialogTitle>
            <DialogDescription>{mode === "reject" ? t("shared.approval.rejectHelp") : t("shared.approval.approveHelp")}</DialogDescription>
          </DialogHeader>
          <Textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder={mode === "reject" ? t("shared.approval.rejectReason") : t("shared.approval.noteOptional")} autoFocus />
          <DialogFooter>
            <Button variant="outline" onClick={() => setMode(null)}>
              {t("ui.cancel")}
            </Button>
            <Button variant={mode === "reject" ? "destructive" : "default"} disabled={mode === "reject" && !comment.trim()} loading={act.isPending} onClick={() => act.mutate()}>
              {mode === "approve" ? t("ui.approve") : t("ui.reject")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function CancelApproval({ requestId, onDone }: { requestId: string; onDone: () => void }) {
  const { t } = useT();
  const cancel = useMutation({
    mutationFn: () => api(`/approvals/${requestId}/cancel`, { body: {} }),
    onSuccess: () => {
      toast.success(t("shared.approval.withdrawn"));
      onDone();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Button variant="outline" size="sm" className="self-start" onClick={() => cancel.mutate()} loading={cancel.isPending}>
      {t("shared.approval.withdraw")}
    </Button>
  );
}
