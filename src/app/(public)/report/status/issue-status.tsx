"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Circle, MapPin, RotateCcw, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/shared/status";
import { cn } from "@/lib/utils/cn";
import { humanize } from "@/lib/utils/format";

interface Status {
  number: string; title: string; status: string; priority: string; created_at: string; resolved_at: string | null; closed_at: string | null;
  resolution_notes: string | null; rating: number | null; location: string | null; updates: { body: string; at: string; by: string }[];
}
const STEPS = ["open", "assigned", "in_progress", "resolved", "closed"];
const fmt = (s: string) => new Date(s).toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export function IssueStatus() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token");
  const [input, setInput] = useState("");
  const [data, setData] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!token);
  const load = useCallback(async () => {
    if (!token) return;
    const r = await fetch(`/api/v1/public/issues/status?token=${encodeURIComponent(token)}`);
    const j = await r.json().catch(() => null);
    if (!r.ok) setError(j?.error?.message ?? "Not found");
    else { setData(j.data); setError(null); }
    setLoading(false);
  }, [token]);
  useEffect(() => { void load(); }, [load]);

  if (!token) {
    return (
      <Card>
        <CardHeader><CardTitle>Track an issue</CardTitle></CardHeader>
        <CardContent>
          <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); const t = input.trim().split("token=").pop(); if (t) router.push(`/report/status?token=${encodeURIComponent(t)}`); }}>
            <p className="text-sm text-muted-foreground">Paste the tracking link or code you got when you reported the issue.</p>
            <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Tracking code or link" autoCapitalize="none" />
            <Button type="submit" size="lg" disabled={input.trim().length < 10}>Check status</Button>
          </form>
        </CardContent>
      </Card>
    );
  }
  if (loading) return <Skeleton className="h-80" />;
  if (error || !data) return <Card><CardContent className="py-10 text-center text-sm">{error ?? "Not found"}</CardContent></Card>;

  const idx = data.status === "reopened" ? 0 : STEPS.indexOf(data.status === "acknowledged" ? "open" : data.status === "on_hold" ? "in_progress" : data.status);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="font-mono text-xs text-muted-foreground">{data.number}</p>
        <h1 className="text-xl font-semibold">{data.title}</h1>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <StatusBadge status={data.status} />
          {data.location && <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" /> {data.location}</span>}
        </div>
      </div>
      {data.status !== "cancelled" && (
        <Card>
          <CardContent className="pt-4">
            <ol className="flex justify-between gap-1">
              {STEPS.map((s, i) => (
                <li key={s} className="flex flex-1 flex-col items-center gap-1 text-center text-[11px]">
                  {i <= idx ? <CheckCircle2 className="size-5 text-primary" /> : <Circle className="size-5 text-muted-foreground/40" />}
                  <span className={cn(i <= idx ? "font-medium" : "text-muted-foreground")}>{humanize(s)}</span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader><CardTitle>Updates</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <div><span className="text-xs text-muted-foreground">{fmt(data.created_at)}</span><p>Reported</p></div>
          {data.updates.map((u, i) => (
            <div key={i}><span className="text-xs text-muted-foreground">{fmt(u.at)} · {u.by}</span><p className="whitespace-pre-wrap">{u.body}</p></div>
          ))}
          {data.resolution_notes && <div><span className="text-xs text-muted-foreground">{data.resolved_at && fmt(data.resolved_at)} · Resolution</span><p>{data.resolution_notes}</p></div>}
        </CardContent>
      </Card>
      {["resolved", "closed"].includes(data.status) && <Feedback token={token} status={data} onDone={load} />}
    </div>
  );
}

function Feedback({ token, status, onDone }: { token: string; status: Status; onDone: () => void }) {
  const [rating, setRating] = useState(status.rating ?? 0);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"rate" | "reopen" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const send = async (action: "rate" | "reopen") => {
    setBusy(action);
    const r = await fetch("/api/v1/public/issues/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, action, rating: action === "rate" ? rating : undefined, feedback: text || undefined }) });
    const j = await r.json().catch(() => null);
    setBusy(null);
    setMsg(r.ok ? (action === "rate" ? "Thanks for the feedback!" : "Reopened — the team has been notified.") : j?.error?.message ?? "Something went wrong");
    if (r.ok) onDone();
  };
  if (status.rating && status.status === "closed") return <p className="text-center text-sm text-muted-foreground">You rated this {status.rating}/5. Thank you!</p>;
  return (
    <Card>
      <CardHeader><CardTitle>Is it fixed?</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex justify-center gap-1" role="radiogroup" aria-label="Rating">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} star${n > 1 ? "s" : ""}`} onClick={() => setRating(n)} className="p-1.5">
              <Star className={cn("size-8", n <= rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground")} />
            </button>
          ))}
        </div>
        <Textarea rows={2} placeholder="Anything to add? (optional)" value={text} onChange={(e) => setText(e.target.value)} />
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" size="lg" loading={busy === "reopen"} onClick={() => send("reopen")}><RotateCcw /> Not fixed</Button>
          <Button size="lg" loading={busy === "rate"} disabled={!rating} onClick={() => send("rate")}>Rate</Button>
        </div>
        {msg && <p className="text-center text-sm">{msg}</p>}
      </CardContent>
    </Card>
  );
}
