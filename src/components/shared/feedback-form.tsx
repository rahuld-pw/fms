"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Bug, CheckCircle2, Lightbulb, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/shared/fields";
import { captchaEnabled, Turnstile } from "@/components/shared/turnstile";
import { useT } from "@/lib/i18n/client";
import type { TFunction } from "@/lib/i18n/translate";
import { cn } from "@/lib/utils/cn";

export type FeedbackKind = "bug" | "feature" | "other";

const kinds = (t: TFunction): { value: FeedbackKind; label: string; icon: React.ComponentType<{ className?: string }>; title: string; hint: string }[] => [
  { value: "bug", label: t("account.reportBug"), icon: Bug, title: t("shared.feedback.bugTitle"), hint: t("shared.feedback.bugHint") },
  { value: "feature", label: t("account.suggestFeature"), icon: Lightbulb, title: t("shared.feedback.featureTitle"), hint: t("shared.feedback.featureHint") },
  { value: "other", label: t("shared.feedback.other"), icon: MessageSquare, title: t("shared.feedback.otherTitle"), hint: t("shared.feedback.otherHint") },
];

/**
 * Bug report / feature request form. Signed-in users are identified by their
 * session; anonymous visitors (`anonymous`) give an email and pass the captcha.
 */
export function FeedbackForm({ initialKind = "bug", anonymous = false, onDone, onSent }: { initialKind?: FeedbackKind; anonymous?: boolean; onDone?: () => void; onSent?: () => void }) {
  const pathname = usePathname();
  const { t } = useT();
  const [kind, setKind] = useState<FeedbackKind>(initialKind);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [email, setEmail] = useState("");
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [honeypot, setHoneypot] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const KINDS = kinds(t);
  const k = KINDS.find((x) => x.value === kind)!;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/v1/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind, title, description, page_url: typeof window !== "undefined" ? window.location.href.slice(0, 500) : pathname,
        email: anonymous ? email : undefined, captcha_token: captcha ?? undefined, website: honeypot || undefined,
      }),
    }).catch(() => null);
    const json = await res?.json().catch(() => null);
    setBusy(false);
    if (!res?.ok) return setError(json?.error?.message ?? t("shared.feedback.sendFailed"));
    setSent(true);
    onSent?.();
  };

  if (sent) {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <CheckCircle2 className="size-10 text-primary" />
        <p className="font-medium">{t("shared.feedback.thanks")}</p>
        <p className="text-sm text-muted-foreground">{kind === "bug" ? t("shared.feedback.thanksBug") : t("shared.feedback.thanksOther")}</p>
        <div className="flex flex-wrap justify-center gap-2">
          {!anonymous && <Button asChild variant="outline"><Link href="/settings/feedback" onClick={onDone}>{t("shared.feedback.track")}</Link></Button>}
          {onDone && <Button variant="outline" onClick={onDone}>{t("ui.close")}</Button>}
        </div>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t("ui.type")}>
        {KINDS.map((x) => (
          <button key={x.value} type="button" role="radio" aria-checked={kind === x.value} onClick={() => setKind(x.value)}
            className={cn("flex min-h-16 flex-col items-center justify-center gap-1 rounded-lg border p-2 text-center text-xs", kind === x.value ? "border-primary bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted")}>
            <x.icon className="size-5" />
            {x.label}
          </button>
        ))}
      </div>
      <Field label={t("shared.feedback.summary")} required><Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required minLength={3} placeholder={kind === "bug" ? t("shared.feedback.bugPlaceholder") : t("shared.feedback.featurePlaceholder")} /></Field>
      <Field label={k.title} hint={k.hint} required><Textarea rows={5} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={5000} required minLength={10} /></Field>
      {anonymous && (
        <Field label={t("shared.feedback.yourEmail")} hint={t("shared.feedback.yourEmailHint")} required>
          <Input type="email" inputMode="email" autoCapitalize="none" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
      )}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} aria-hidden />
      {anonymous && <Turnstile onToken={setCaptcha} />}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" loading={busy} disabled={anonymous && captchaEnabled && !captcha}>{t("shared.feedback.send")}</Button>
      {kind === "bug" && <p className="text-xs text-muted-foreground">{t("shared.feedback.bugNote")}</p>}
    </form>
  );
}

export function FeedbackDialog({ open, onOpenChange, kind, onSent }: { open: boolean; onOpenChange: (o: boolean) => void; kind: FeedbackKind; onSent?: () => void }) {
  const { t } = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("shared.feedback.title")}</DialogTitle>
          <DialogDescription>{t("shared.feedback.description")}</DialogDescription>
        </DialogHeader>
        {open && <FeedbackForm key={kind} initialKind={kind} onDone={() => onOpenChange(false)} onSent={onSent} />}
      </DialogContent>
    </Dialog>
  );
}
