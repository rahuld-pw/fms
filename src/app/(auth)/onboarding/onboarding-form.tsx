"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabaseBrowser } from "@/lib/supabase/browser";

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

export function OnboardingForm() {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [campus, setCampus] = useState("Main Campus");
  const [timezone, setTimezone] = useState("Asia/Kolkata");
  const [currency, setCurrency] = useState("INR");
  const [loading, setLoading] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabaseBrowser().rpc("create_organisation", {
      p_name: name,
      p_slug: slug || slugify(name),
      p_timezone: timezone,
      p_currency: currency,
      p_campus_name: campus,
      p_campus_code: "MAIN",
    });
    setLoading(false);
    if (error) return toast.error(error.message.includes("duplicate") ? "That URL name is taken" : error.message);
    window.location.href = "/";
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">Set up your organisation</h1>
        <p className="text-sm text-muted-foreground">All modules are enabled; you can turn them off later in Settings.</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="org">School / institute name</Label>
        <Input id="org" required value={name} onChange={(e) => { setName(e.target.value); if (!slug) setSlug(""); }} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="slug">Short name (used in public links)</Label>
        <Input id="slug" value={slug || slugify(name)} onChange={(e) => setSlug(slugify(e.target.value))} pattern="[a-z0-9][a-z0-9-]{1,47}" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="campus">First campus</Label>
        <Input id="campus" required value={campus} onChange={(e) => setCampus(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tz">Timezone</Label>
          <NativeSelect id="tz" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
            {["Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Europe/London", "America/New_York", "UTC"].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cur">Currency</Label>
          <NativeSelect id="cur" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {["INR", "AED", "SGD", "GBP", "USD", "EUR"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </NativeSelect>
        </div>
      </div>
      <Button type="submit" loading={loading}>
        Create organisation
      </Button>
    </form>
  );
}
