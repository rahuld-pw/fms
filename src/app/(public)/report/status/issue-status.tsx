"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { CheckCircle2, Circle, MapPin, RotateCcw, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/shared/status";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils/cn";
import { humanize } from "@/lib/utils/format";

interface Status {
  number: string; title: string; status: string; priority: string; created_at: string; resolved_at: string | null; closed_at: string | null;
  resolution_notes: string | null; rating: number | null; location: string | null; updates: { body: string; at: string; by: string }[];
}
const STEPS = ["open", "assigned", "in_progress", "resolved", "closed"];
const fmt = (s: string) => new Date(s).toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export function IssueStatus() {
  const { t } = useT();
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token");
  const [input, setInput] = useState("");
  const { data, error, isLoading: loading, refetch } = useQuery({
    queryKey: ["public-issue", token],
    enabled: !!token,
    retry: false,
    queryFn: async () => {
      const r = await fetch(`/api/v1/public/issues/status?token=${encodeURIComponent(token!)}`);
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.error?.message ?? t("public.status.notFound"));
      return j.data as Status;
    },
  });
  const load = () => void refetch();

  if (!token) {
    return (
      <Card>
        <CardHeader><CardTitle>{t("public.status.title")}</CardTitle></CardHeader>
        <CardContent>
          <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); const code = input.trim().split("token=").pop(); if (code) router.push(`/report/status?token=${encodeURIComponent(code)}`); }}>
            <p className="text-sm text-muted-foreground">{t("public.status.pasteHint")}</p>
            <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder={t("public.status.codePlaceholder")} autoCapitalize="none" />
            <Button type="submit" size="lg" disabled={input.trim().length < 10}>{t("public.status.check")}</Button>
          </form>
        </CardContent>
      </Card>
    );
  }
  if (loading) return <Skeleton className="h-80" />;
  if (error || !data) return <Card><CardContent className="py-10 text-center text-sm">{error?.message ?? t("public.status.notFound")}</CardContent></Card>;

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
                  <span className={cn(i <= idx ? "font-medium" : "text-muted-foreground")}>{t(`status.${s}`, undefined, humanize(s))}</span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader><CardTitle>{t("public.status.updates")}</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <div><span className="text-xs text-muted-foreground">{fmt(data.created_at)}</span><p>{t("public.status.reported")}</p></div>
          {data.updates.map((u, i) => (
            <div key={i}><span className="text-xs text-muted-foreground">{fmt(u.at)} · {u.by}</span><p className="whitespace-pre-wrap">{u.body}</p></div>
          ))}
          {data.resolution_notes && <div><span className="text-xs text-muted-foreground">{data.resolved_at && fmt(data.resolved_at)} · {t("public.status.resolution")}</span><p>{data.resolution_notes}</p></div>}
        </CardContent>
      </Card>
      {["resolved", "closed"].includes(data.status) && <Feedback token={token} status={data} onDone={load} />}
    </div>
  );
}

function Feedback({ token, status, onDone }: { token: string; status: Status; onDone: () => void }) {
  const { t } = useT();
  const [rating, setRating] = useState(status.rating ?? 0);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"rate" | "reopen" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const send = async (action: "rate" | "reopen") => {
    if (busy) return;
    setBusy(action);
    const r = await fetch("/api/v1/public/issues/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, action, rating: action === "rate" ? rating : undefined, feedback: text || undefined }) });
    const j = await r.json().catch(() => null);
    setBusy(null);
    setMsg(r.ok ? (action === "rate" ? t("public.status.thanksFeedback") : t("public.status.reopened")) : j?.error?.message ?? t("public.status.somethingWrong"));
    if (r.ok) onDone();
  };
  if (status.rating && status.status === "closed") return <p className="text-center text-sm text-muted-foreground">{t("public.status.ratedThanks", { rating: status.rating })}</p>;
  return (
    <Card>
      <CardHeader><CardTitle>{t("public.status.isFixed")}</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex justify-center gap-1" role="radiogroup" aria-label={t("public.status.rating")}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={t(n > 1 ? "public.status.starOther" : "public.status.starOne", { n })} onClick={() => setRating(n)} className="p-1.5">
              <Star className={cn("size-8", n <= rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground")} />
            </button>
          ))}
        </div>
        <Textarea rows={2} placeholder={t("public.status.anythingToAdd")} value={text} onChange={(e) => setText(e.target.value)} />
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" size="lg" loading={busy === "reopen"} disabled={!!busy} onClick={() => send("reopen")}><RotateCcw /> {t("public.status.notFixed")}</Button>
          <Button size="lg" loading={busy === "rate"} disabled={!rating || !!busy} onClick={() => send("rate")}>{t("public.status.rate")}</Button>
        </div>
        {msg && <p className="text-center text-sm">{msg}</p>}
      </CardContent>
    </Card>
  );
}
