"use client";
import { useT } from "@/lib/i18n/client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabaseBrowser } from "@/lib/supabase/browser";

type Method = "password" | "otp";

/**
 * Two sign-in methods: email + password, and email + one-time code.
 * The OTP email template must include {{ .Token }} (see README → Auth).
 */
export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/";
  const [method, setMethod] = useState<Method>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  // "resend" only spins the resend link; both block the form while in flight
  const [pending, setPending] = useState<"submit" | "resend" | null>(null);
  // the first code is sent in the background: the code box shows at once
  const [sending, setSending] = useState(false);
  const loading = pending !== null;
  const { t } = useT();

  const done = () => {
    router.replace(next.startsWith("/") && !next.startsWith("//") ? next : "/");
    router.refresh();
  };

  const sendCode = async (resend = false) => {
    if (sending) return;
    if (resend) setPending("resend");
    else {
      // sending the email takes a few seconds; let the user get ready to type the code meanwhile
      setCodeSent(true);
      setSending(true);
    }
    const { error } = await supabaseBrowser().auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
    setPending(null);
    setSending(false);
    if (error) {
      if (!resend) setCodeSent(false);
      return toast.error(error.message);
    }
    toast.success(t("auth.codeSent"));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    const sb = supabaseBrowser();
    if (method === "otp") {
      if (!codeSent) return sendCode();
      setPending("submit");
      const { error } = await sb.auth.verifyOtp({ email, token: code.trim(), type: "email" });
      // on success stay busy until the navigation replaces this page
      if (error) {
        setPending(null);
        return toast.error(error.message);
      }
      return done();
    }
    setPending("submit");
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
      setPending(null);
      return toast.error(error.message);
    }
    done();
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">{t("auth.signIn")}</h1>
        <p className="text-sm text-muted-foreground">{t("auth.welcomeBack")}</p>
      </div>
      <Tabs value={method} onValueChange={(v) => { setMethod(v as Method); setCodeSent(false); setCode(""); }}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="password">{t("auth.password")}</TabsTrigger>
          <TabsTrigger value="otp">{t("auth.emailCode")}</TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">{t("auth.email")}</Label>
        <Input id="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" required value={email} disabled={codeSent}
          onChange={(e) => setEmail(e.target.value)} />
      </div>
      {method === "password" && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">{t("auth.password")}</Label>
          <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
      )}
      {method === "otp" && codeSent && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="code">{t("auth.codeFromEmail")}</Label>
          <Input id="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,10}" maxLength={10} required autoFocus
            className="text-center font-mono text-lg tracking-[0.4em]" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
          {sending && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status"><Spinner />{t("auth.sendingCode")}</p>
          )}
          <div className="flex justify-between text-xs">
            <button type="button" className="text-muted-foreground hover:underline disabled:opacity-50" disabled={loading || sending} onClick={() => { setCodeSent(false); setCode(""); }}>{t("auth.changeEmail")}</button>
            <button type="button" className="inline-flex items-center gap-1.5 text-primary hover:underline disabled:opacity-50" disabled={loading || sending} aria-busy={pending === "resend" || undefined} onClick={() => sendCode(true)}>{pending === "resend" && <Spinner />}{t("auth.resendCode")}</button>
          </div>
        </div>
      )}
      <Button type="submit" size="lg" disabled={loading} loading={pending === "submit"}>
        {method === "password" ? t("auth.signIn") : codeSent ? t("auth.verify") : t("auth.emailMeCode")}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        {t("auth.newHere")}{" "}
        <Link href="/signup" className="text-primary hover:underline">{t("auth.createFree")}</Link>
      </p>
    </form>
  );
}
