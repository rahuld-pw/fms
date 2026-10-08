"use client";
import { BellRing } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/checkbox";
import { errorMessage } from "@/lib/client/api";
import { useT } from "@/lib/i18n/client";
import { usePush } from "./pwa";

/** Turns push notifications on or off for the device in hand. */
export function PushToggle() {
  const { t } = useT();
  const { state, enable, disable, test } = usePush();
  const [busy, setBusy] = useState<"toggle" | "test" | null>(null);

  const toggle = async (on: boolean) => {
    setBusy("toggle");
    try {
      if (on) {
        if (await enable()) toast.success(t("settings.profile.push.enabled"));
      } else {
        await disable();
        toast.success(t("settings.profile.push.disabled"));
      }
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const sendTest = async () => {
    setBusy("test");
    try {
      await test();
      toast.success(t("settings.profile.push.testSent"));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const hint =
    state === "unsupported" ? t("settings.profile.push.unsupported")
    : state === "ios-install" ? t("settings.profile.push.ios")
    : state === "blocked" ? t("settings.profile.push.blocked")
    : t("settings.profile.push.description");

  return (
    <div id="push" className="flex scroll-mt-20 flex-col gap-3 rounded-lg border bg-muted/30 p-3 sm:flex-row sm:items-center">
      <BellRing className="hidden size-5 shrink-0 text-primary sm:block" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{t("settings.profile.push.title")}</div>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <div className="flex items-center gap-3">
        {state === "on" && (
          <Button size="sm" variant="outline" onClick={sendTest} disabled={busy !== null} loading={busy === "test"}>
            {t("settings.profile.push.test")}
          </Button>
        )}
        <Switch
          checked={state === "on"}
          disabled={busy !== null || state === "loading" || state === "unsupported" || state === "ios-install" || state === "blocked"}
          aria-busy={busy === "toggle" || undefined}
          onCheckedChange={toggle}
          aria-label={t("settings.profile.push.title")}
        />
      </div>
    </div>
  );
}
