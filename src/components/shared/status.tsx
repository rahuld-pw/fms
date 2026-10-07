import { Badge } from "@/components/ui/badge";
import { humanize } from "@/lib/utils/format";

type Tone = "neutral" | "green" | "blue" | "amber" | "red" | "violet";

const TONES: Record<string, Tone> = {
  // generic
  draft: "neutral", active: "green", inactive: "neutral", cancelled: "neutral", closed: "neutral", archived: "neutral",
  pending: "amber", pending_approval: "amber", approved: "green", rejected: "red", paid: "green",
  // issues
  open: "blue", acknowledged: "blue", assigned: "violet", in_progress: "amber", on_hold: "neutral", resolved: "green", reopened: "red",
  // work orders
  scheduled: "violet", completed: "green", verified: "green",
  // assets
  in_stock: "neutral", in_use: "green", under_repair: "amber", disposed: "neutral", lost: "red",
  // vendors
  invited: "neutral", submitted: "blue", under_verification: "amber", blacklisted: "red",
  // po
  sent: "blue", acknowledged_po: "violet", partially_received: "amber", received: "green", rfq: "violet", ordered: "green",
  // invoices / match
  matched: "green", qty_mismatch: "red", price_mismatch: "red", over_billed: "red", override: "amber", partially_paid: "amber", disputed: "red",
  // advances
  disbursed: "violet", settled: "green",
  // tasks
  todo: "neutral", blocked: "red", done: "green",
  // budget checks
  ok: "green", warning: "amber", blocked_budget: "red", no_budget: "neutral",
  // priority
  low: "neutral", medium: "blue", high: "amber", critical: "red", urgent: "red",
  // approval steps
  waiting: "neutral", skipped: "neutral",
  // webhooks
  succeeded: "green", failed: "red", dead: "red", in_flight: "blue",
  // booking
  requested: "amber", confirmed: "green", declined: "red", rescheduled: "violet", not_required: "neutral",
};

export function StatusBadge({ status, label }: { status: string | null | undefined; label?: string }) {
  if (!status) return <span className="text-muted-foreground">—</span>;
  return <Badge tone={TONES[status] ?? "neutral"}>{label ?? humanize(status)}</Badge>;
}

const PRIORITY_DOT: Record<string, string> = {
  low: "bg-zinc-400", medium: "bg-sky-500", high: "bg-amber-500", critical: "bg-red-500", urgent: "bg-red-500",
};

export function PriorityLabel({ priority }: { priority: string | null | undefined }) {
  if (!priority) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <span className={`size-2 rounded-full ${PRIORITY_DOT[priority] ?? "bg-zinc-400"}`} />
      {humanize(priority)}
    </span>
  );
}
