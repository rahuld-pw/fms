"use client";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useMemo } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { LOCALE_COOKIE, localeInfo, type Locale } from "./config";
import { makeT, type FlatDict } from "./translate";

const Ctx = createContext<{ locale: Locale; messages: FlatDict } | null>(null);

export function I18nProvider({ locale, messages, children }: { locale: Locale; messages: FlatDict; children: React.ReactNode }) {
  const value = useMemo(() => ({ locale, messages }), [locale, messages]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** t(key, vars?, fallback?) plus the Intl locale tag for number/date formatting. */
export function useT() {
  const ctx = useContext(Ctx);
  const t = useMemo(() => makeT(ctx?.messages ?? {}), [ctx?.messages]);
  const lang = ctx?.locale ?? "en";
  return { t, lang, locale: localeInfo(lang).intl };
}

/** Switch language: remembered on this device and, when signed in, on the account. */
export function useSetLocale() {
  const router = useRouter();
  return useCallback(
    async (locale: Locale) => {
      document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`;
      const supabase = supabaseBrowser();
      const { data } = await supabase.auth.getSession();
      if (data.session) await supabase.auth.updateUser({ data: { locale } }).catch(() => undefined);
      router.refresh();
    },
    [router],
  );
}
