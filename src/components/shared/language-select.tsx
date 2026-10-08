"use client";
import { Languages } from "lucide-react";
import { useTransition } from "react";
import { NativeSelect } from "@/components/ui/input";
import { LOCALES, isLocale } from "@/lib/i18n/config";
import { useSetLocale, useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils/cn";

/**
 * Interface language picker; each option is shown in its own script.
 * On phones only the language icon shows: the native select is laid
 * invisibly over it, so a tap opens the phone's own picker.
 */
export function LanguageSelect({ className, compact }: { className?: string; compact?: boolean }) {
  const { t, lang } = useT();
  const setLocale = useSetLocale();
  const [pending, start] = useTransition();
  return (
    <label className={cn("relative inline-flex w-fit items-center gap-2 text-sm sm:flex sm:w-auto", className)} title={t("common.language")}>
      {/* phones: icon button */}
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-md border text-muted-foreground sm:hidden",
          pending && "opacity-50",
        )}
        aria-hidden
      >
        <Languages className="size-4" />
      </span>
      {/* larger screens: icon, label and select */}
      <Languages className="hidden size-4 shrink-0 text-muted-foreground sm:block" aria-hidden />
      <span className={cn("hidden text-muted-foreground", !compact && "sm:inline")}>{t("common.language")}</span>
      <NativeSelect
        value={lang}
        disabled={pending}
        aria-label={t("common.language")}
        className={cn(
          "absolute inset-0 h-full w-full cursor-pointer opacity-0",
          "sm:static sm:h-8 sm:w-auto sm:min-w-0 sm:cursor-auto sm:text-sm sm:opacity-100",
          compact ? "sm:flex-none" : "sm:flex-1",
        )}
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
