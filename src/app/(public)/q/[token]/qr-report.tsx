"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, Copy, MapPin, Package, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Field } from "@/components/shared/fields";
import { cn } from "@/lib/utils/cn";
import { captchaEnabled, Turnstile } from "@/components/shared/turnstile";
import { useT } from "@/lib/i18n/client";

interface QrInfo { kind: "location" | "asset"; id: string; name: string; path: string | null; campus: string; org_name: string; asset_tag?: string; facility_enabled: boolean; public_reporting: boolean; categories: { id: string; name: string }[] }
type Result = { number: string; tracking_token: string };

async function post<T>(path: string, body: unknown, fallbackError: string): Promise<T> {
  const res = await fetch(`/api/v1${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error?.message ?? fallbackError);
  return json.data as T;
}

export function QrReport({ token }: { token: string }) {
  const { t } = useT();
  const [info, setInfo] = useState<QrInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [photos, setPhotos] = useState<File[]>([]);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [honeypot, setHoneypot] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch(`/api/v1/public/qr/${encodeURIComponent(token)}`)
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j?.error?.message ?? t("public.qr.unknownCode")); setInfo(j.data); })
      .catch((e: Error) => setError(e.message));
  }, [token, t]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const cat = info?.categories.find((c) => c.id === category);
      const r = await post<Result & { uploads: { url: string }[] }>("/public/issues", {
        qr_token: token, title: title.trim() || cat?.name || "Issue reported", description: description || undefined, category_id: category ?? undefined,
        priority: urgent ? "high" : undefined, captcha_token: captcha ?? undefined, website: honeypot || undefined,
        photos: photos.map((p) => ({ file_name: p.name || "photo.jpg", mime_type: p.type || "image/jpeg", size_bytes: p.size })),
      }, t("public.qr.somethingWrong"));
      await Promise.all(r.uploads.map((u, i) => {
        const form = new FormData();
        form.append("", photos[i]);
        const url = u.url.startsWith("http") ? u.url : `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1${u.url}`;
        return fetch(url, { method: "PUT", body: form }).catch(() => null);
      }));
      setResult({ number: r.number, tracking_token: r.tracking_token });
      try { localStorage.setItem(`co-issue-${r.number}`, r.tracking_token); } catch {}
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (error && !info) return <Card><CardContent className="py-10 text-center"><p className="font-medium">{error}</p><p className="mt-1 text-sm text-muted-foreground">{t("public.qr.checkCode")}</p></CardContent></Card>;
  if (!info) return <Skeleton className="h-96" />;
  if (!info.facility_enabled || !info.public_reporting) return <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">{t("public.qr.unavailable")}</CardContent></Card>;

  if (result) {
    const statusUrl = `/report/status?token=${result.tracking_token}`;
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
          <CheckCircle2 className="size-12 text-primary" />
          <h1 className="text-lg font-semibold">{t("public.qr.thanks", { number: result.number })}</h1>
          <p className="text-sm text-muted-foreground">{t("public.qr.notified")}</p>
          <div className="flex w-full gap-2">
            <Input readOnly value={typeof window !== "undefined" ? `${window.location.origin}${statusUrl}` : statusUrl} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
            <Button size="icon" variant="outline" aria-label={t("public.qr.copyLink")} onClick={() => navigator.clipboard.writeText(`${window.location.origin}${statusUrl}`)}><Copy /></Button>
          </div>
          <Button asChild className="w-full" size="lg"><Link href={statusUrl}>{t("public.qr.trackIssue")}</Link></Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div>
        <p className="text-xs text-muted-foreground">{info.org_name} · {info.campus}</p>
        <h1 className="mt-1 flex items-center gap-2 text-xl font-semibold">
          {info.kind === "asset" ? <Package className="size-5 text-muted-foreground" /> : <MapPin className="size-5 text-muted-foreground" />}
          {info.name}
        </h1>
        {(info.path || info.asset_tag) && <p className="text-sm text-muted-foreground">{[info.asset_tag, info.path].filter(Boolean).join(" · ")}</p>}
      </div>
      <Card>
        <CardContent className="flex flex-col gap-4 pt-4">
          <fieldset>
            <legend className="mb-2 text-sm font-medium">{t("public.qr.whatsProblem")}</legend>
            <div className="grid grid-cols-2 gap-2">
              {info.categories.map((c) => (
                <button key={c.id} type="button" onClick={() => setCategory(category === c.id ? null : c.id)} aria-pressed={category === c.id}
                  className={cn("min-h-12 rounded-lg border px-3 py-2 text-left text-sm transition-colors", category === c.id ? "border-primary bg-primary/10 font-medium text-primary" : "hover:bg-muted")}>
                  {c.name}
                </button>
              ))}
            </div>
          </fieldset>
          <Field label={t("public.qr.summary")} hint={category ? t("public.qr.optional") : undefined}>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder={t("public.qr.summaryPlaceholder")} required={!category} />
          </Field>
          <Field label={t("public.qr.details")}><Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} placeholder={t("public.qr.detailsPlaceholder")} /></Field>
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              {photos.map((p, i) => (
                <div key={i} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={URL.createObjectURL(p)} alt={t("public.qr.photoAlt", { n: i + 1 })} className="size-20 rounded-md object-cover" />
                  <button type="button" className="absolute -top-1.5 -right-1.5 rounded-full bg-foreground p-0.5 text-background" aria-label={t("public.qr.removePhoto")} onClick={() => setPhotos(photos.filter((_, j) => j !== i))}><X className="size-3" /></button>
                </div>
              ))}
            </div>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { setPhotos([...photos, ...Array.from(e.target.files ?? [])].slice(0, 3)); e.target.value = ""; }} />
            {photos.length < 3 && <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}><Camera /> {t("public.qr.addPhoto")}</Button>}
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[var(--primary)]" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} /> {t("public.qr.urgent")}</label>
          <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} aria-hidden />
          <Turnstile onToken={setCaptcha} />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" size="lg" loading={busy} disabled={(captchaEnabled && !captcha) || (!category && title.trim().length < 3)}>{t("public.qr.submit")}</Button>
          <p className="text-center text-xs text-muted-foreground">{t("public.qr.anonymousNote")}</p>
        </CardContent>
      </Card>
      <p className="text-center text-xs text-muted-foreground">{t("public.qr.staffMember")} <Link className="underline" href={info.kind === "asset" ? `/facility/assets/${info.id}` : `/facility/issues/new?location=${info.id}`}>{t("public.qr.openInApp")}</Link></p>
    </form>
  );
}
