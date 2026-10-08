"use client";
import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Field } from "@/components/shared/fields";
import { LanguageSelect } from "@/components/shared/language-select";
import { ScorePicker } from "@/components/shared/score-picker";
import { captchaEnabled, Turnstile } from "@/components/shared/turnstile";
import { useT } from "@/lib/i18n/client";

interface Survey {
  title: string;
  description: string | null;
  kind: "nps" | "csat";
  question: string;
  follow_up: string | null;
  anonymous: boolean;
  organisation: { name: string };
  campus: string | null;
}
const SEGMENTS = ["parent", "student", "staff", "alumni", "visitor", "other"] as const;

export function PublicSurvey({ token }: { token: string }) {
  const { t } = useT();
  const [survey, setSurvey] = useState<Survey | null | undefined>(undefined);
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [segment, setSegment] = useState<string>("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetch(`/api/v1/public/surveys/${encodeURIComponent(token)}`)
      .then(async (r) => (r.ok ? ((await r.json()).data as Survey) : null))
      .then(setSurvey)
      .catch(() => setSurvey(null));
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || score === null) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/public/surveys/${encodeURIComponent(token)}/responses`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          score, comment: comment || undefined, segment: segment || undefined, name: name || undefined, email: email || undefined,
          captcha_token: captcha ?? undefined, website: honeypot || undefined,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error?.message ?? t("ui.somethingWrong"));
      }
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("ui.somethingWrong"));
    } finally {
      setBusy(false);
    }
  };

  if (survey === undefined) return <Skeleton className="h-80" />;
  if (survey === null)
    return <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">{t("surveys.public.unavailable")}</CardContent></Card>;
  if (done)
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
          <CheckCircle2 className="size-10 text-primary" />
          <h1 className="text-lg font-semibold">{t("surveys.public.thanks")}</h1>
          <p className="text-sm text-muted-foreground">{t("surveys.public.thanksBody", { org: survey.organisation.name })}</p>
        </CardContent>
      </Card>
    );
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">{survey.organisation.name}{survey.campus ? ` · ${survey.campus}` : ""}</p>
          <h1 className="text-xl font-semibold break-words">{survey.title}</h1>
          {survey.description && <p className="mt-1 text-sm text-muted-foreground">{survey.description}</p>}
        </div>
        <LanguageSelect compact />
      </div>
      <Card>
        <CardContent className="flex flex-col gap-5 pt-5">
          <div className="flex flex-col gap-3">
            <p className="font-medium">{survey.question}</p>
            <ScorePicker kind={survey.kind} value={score} onChange={setScore} disabled={busy} />
          </div>
          <Field label={survey.follow_up || t("surveys.form.followUpDefault")}>
            <Textarea rows={3} maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)} />
          </Field>
          <Field label={t("surveys.public.iAm")}>
            <NativeSelect value={segment} onChange={(e) => setSegment(e.target.value)}>
              <option value="">{t("ui.select")}</option>
              {SEGMENTS.map((s) => <option key={s} value={s}>{t(`enum.surveySegment.${s}`)}</option>)}
            </NativeSelect>
          </Field>
          {!survey.anonymous && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("surveys.public.name")} hint={t("ui.optional")}><Input value={name} maxLength={120} autoComplete="name" onChange={(e) => setName(e.target.value)} /></Field>
              <Field label={t("surveys.public.email")} hint={t("surveys.public.emailHint")}><Input type="email" inputMode="email" autoCapitalize="none" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            </div>
          )}
          {survey.anonymous && <p className="text-xs text-muted-foreground">{t("surveys.public.anonymousNote")}</p>}
          <input type="text" tabIndex={-1} autoComplete="off" aria-hidden className="hidden" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} name="website" />
          <Turnstile onToken={setCaptcha} />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" size="lg" loading={busy} disabled={score === null || (captchaEnabled && !captcha)}>{t("surveys.public.submit")}</Button>
        </CardContent>
      </Card>
    </form>
  );
}
