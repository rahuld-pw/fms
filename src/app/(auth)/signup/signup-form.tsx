"use client";
import { useT } from "@/lib/i18n/client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabaseBrowser } from "@/lib/supabase/browser";

export function SignupForm() {
  const router = useRouter();
  const nextParam = useSearchParams().get("next");
  // only same-site paths (e.g. an invitation link)
  const next = nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/onboarding";
  const invited = next.startsWith("/invite/");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [loading, setLoading] = useState(false);
  const { t } = useT();
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    const { data, error } = await supabaseBrowser().auth.signUp({
      email: form.email,
      password: form.password,
      options: { data: { full_name: form.name }, emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    if (error) {
      setLoading(false);
      return toast.error(error.message);
    }
    // with a session, stay busy until the navigation replaces this page
    if (data.session) router.replace(next);
    else {
      setLoading(false);
      toast.success(t("auth.confirmEmail"));
    }
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">{invited ? t("auth.signupInvitedTitle") : t("auth.signupTitle")}</h1>
        <p className="text-sm text-muted-foreground">{invited ? t("auth.signupInvitedSubtitle") : t("auth.signupSubtitle")}</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">{t("auth.fullName")}</Label>
        <Input id="name" required value={form.name} onChange={set("name")} autoComplete="name" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">{t("auth.email")}</Label>
        <Input id="email" type="email" required value={form.email} onChange={set("email")} autoComplete="email" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">{t("auth.password")}</Label>
        <Input id="password" type="password" minLength={8} required value={form.password} onChange={set("password")} autoComplete="new-password" />
      </div>
      <Button type="submit" size="lg" loading={loading}>
        {t("auth.createAccount")}
      </Button>
      {!invited && <p className="rounded-md bg-muted/60 p-3 text-xs text-muted-foreground">
        {t("auth.schoolNote")}
      </p>}
      <p className="text-center text-sm text-muted-foreground">
        {t("auth.haveAccount")}{" "}
        <Link href={invited ? `/login?next=${encodeURIComponent(next)}` : "/login"} className="text-primary hover:underline">
          {t("auth.signIn")}
        </Link>
      </p>
    </form>
  );
}
