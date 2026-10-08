"use client";
import { Languages } from "lucide-react";
import { useTransition } from "react";
import { NativeSelect } from "@/components/ui/input";
import { LOCALES, isLocale } from "@/lib/i18n/config";
import { useSetLocale, useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils/cn";

/** Interface language picker; each option is shown in its own script. */
export function LanguageSelect({ className, compact }: { className?: string; compact?: boolean }) {
  const { t, lang } = useT();
  const setLocale = useSetLocale();
  const [pending, start] = useTransition();
  return (
    <label className={cn("flex items-center gap-2 text-sm", className)}>
      <Languages className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className={compact ? "sr-only" : "text-muted-foreground"}>{t("common.language")}</span>
      <NativeSelect
        value={lang}
        disabled={pending}
        aria-label={t("common.language")}
        className={cn("h-8 min-w-0 flex-1 text-sm", compact && "w-auto flex-none")}
        onChange={(e) => isLocale(e.target.value) && start(() => setLocale(e.target.value as never))}
      >
        {LOCALES.map((l) => (
          <option key={l.code} value={l.code} lang={l.code}>
            {l.code === "en" ? l.name : `${l.name} · ${l.english}`}
          </option>
        ))}
      </NativeSelect>
    </label>
  );
}
