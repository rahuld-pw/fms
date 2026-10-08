import "server-only";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { getSessionUser } from "@/lib/auth/context";
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, localeInfo, matchAcceptLanguage, type Locale } from "./config";
import { loadMessages } from "./load";
import { makeT } from "./translate";

/** Device choice (cookie) → the user's saved preference → browser language → English. */
export const getLocale = cache(async (): Promise<Locale> => {
  const fromCookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(fromCookie)) return fromCookie;
  const user = await getSessionUser().catch(() => null);
  if (isLocale(user?.locale)) return user.locale;
  return matchAcceptLanguage((await headers()).get("accept-language")) ?? DEFAULT_LOCALE;
});

export const getMessages = cache(async () => loadMessages(await getLocale()));

export async function getT() {
  const locale = await getLocale();
  return { t: makeT(await getMessages()), locale, intl: localeInfo(locale).intl };
}
