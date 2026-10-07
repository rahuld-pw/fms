"use client";
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
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { data, error } = await supabaseBrowser().auth.signUp({
      email: form.email,
      password: form.password,
      options: { data: { full_name: form.name }, emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    if (data.session) router.replace(next);
    else toast.success("Check your email to confirm your account, then sign in.");
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">{invited ? "Create your account to join" : "Create your free account"}</h1>
        <p className="text-sm text-muted-foreground">{invited ? "Use the email address the invitation was sent to." : "You get a personal workspace for tasks and projects."}</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">Full name</Label>
        <Input id="name" required value={form.name} onChange={set("name")} autoComplete="name" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" required value={form.email} onChange={set("email")} autoComplete="email" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">Password</Label>
        <Input id="password" type="password" minLength={8} required value={form.password} onChange={set("password")} autoComplete="new-password" />
      </div>
      <Button type="submit" size="lg" loading={loading}>
        Create account
      </Button>
      {!invited && <p className="rounded-md bg-muted/60 p-3 text-xs text-muted-foreground">
        Is your school or institute on Campus Ops? Use the invitation link from your administrator to join it with Facilities, Expenses and Purchasing.
      </p>}
      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href={invited ? `/login?next=${encodeURIComponent(next)}` : "/login"} className="text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
