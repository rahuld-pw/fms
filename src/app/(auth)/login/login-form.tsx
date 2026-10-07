"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  const [loading, setLoading] = useState(false);

  const done = () => {
    router.replace(next.startsWith("/") && !next.startsWith("//") ? next : "/");
    router.refresh();
  };

  const sendCode = async () => {
    setLoading(true);
    const { error } = await supabaseBrowser().auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
    setLoading(false);
    if (error) return toast.error(error.message);
    setCodeSent(true);
    toast.success("We emailed you a sign-in code");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const sb = supabaseBrowser();
    if (method === "otp") {
      if (!codeSent) return sendCode();
      setLoading(true);
      const { error } = await sb.auth.verifyOtp({ email, token: code.trim(), type: "email" });
      setLoading(false);
      if (error) return toast.error(error.message);
      return done();
    }
    setLoading(true);
    const { error } = await sb.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) return toast.error(error.message);
    done();
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">Sign in</h1>
        <p className="text-sm text-muted-foreground">Welcome back.</p>
      </div>
      <Tabs value={method} onValueChange={(v) => { setMethod(v as Method); setCodeSent(false); setCode(""); }}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="password">Password</TabsTrigger>
          <TabsTrigger value="otp">Email code</TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" required value={email} disabled={codeSent}
          onChange={(e) => setEmail(e.target.value)} />
      </div>
      {method === "password" && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
      )}
      {method === "otp" && codeSent && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="code">Code from email</Label>
          <Input id="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,10}" maxLength={10} required autoFocus
            className="text-center font-mono text-lg tracking-[0.4em]" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
          <div className="flex justify-between text-xs">
            <button type="button" className="text-muted-foreground hover:underline" onClick={() => { setCodeSent(false); setCode(""); }}>Change email</button>
            <button type="button" className="text-primary hover:underline" disabled={loading} onClick={sendCode}>Resend code</button>
          </div>
        </div>
      )}
      <Button type="submit" size="lg" loading={loading}>
        {method === "password" ? "Sign in" : codeSent ? "Verify and sign in" : "Email me a code"}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        New to Campus Ops?{" "}
        <Link href="/signup" className="text-primary hover:underline">Create a free account</Link>
      </p>
    </form>
  );
}
