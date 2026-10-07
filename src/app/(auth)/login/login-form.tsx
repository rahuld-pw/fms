"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabaseBrowser } from "@/lib/supabase/browser";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [magic, setMagic] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const sb = supabaseBrowser();
    if (magic) {
      const { error } = await sb.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`, shouldCreateUser: false },
      });
      setLoading(false);
      if (error) toast.error(error.message);
      else toast.success("Check your email for a sign-in link");
      return;
    }
    const { error } = await sb.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    router.replace(next.startsWith("/") ? next : "/");
    router.refresh();
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">Sign in</h1>
        <p className="text-sm text-muted-foreground">Welcome back.</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      {!magic && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
      )}
      <Button type="submit" loading={loading}>
        {magic ? "Email me a sign-in link" : "Sign in"}
      </Button>
      <button type="button" className="text-sm text-primary hover:underline" onClick={() => setMagic((m) => !m)}>
        {magic ? "Use a password instead" : "Sign in with a magic link"}
      </button>
      <p className="text-center text-sm text-muted-foreground">
        New to Campus Ops?{" "}
        <Link href="/signup" className="text-primary hover:underline">
          Create an organisation
        </Link>
      </p>
    </form>
  );
}
