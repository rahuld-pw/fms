// Supported interface languages: English plus the main Indian languages
// (scheduled languages with the largest numbers of speakers).

export const LOCALES = [
  { code: "en", name: "English", english: "English", intl: "en-IN" },
  { code: "hi", name: "हिन्दी", english: "Hindi", intl: "hi-IN" },
  { code: "bn", name: "বাংলা", english: "Bengali", intl: "bn-IN" },
  { code: "te", name: "తెలుగు", english: "Telugu", intl: "te-IN" },
  { code: "mr", name: "मराठी", english: "Marathi", intl: "mr-IN" },
  { code: "ta", name: "தமிழ்", english: "Tamil", intl: "ta-IN" },
  { code: "ur", name: "اردو", english: "Urdu", intl: "ur-IN", rtl: true },
  { code: "gu", name: "ગુજરાતી", english: "Gujarati", intl: "gu-IN" },
  { code: "kn", name: "ಕನ್ನಡ", english: "Kannada", intl: "kn-IN" },
  { code: "or", name: "ଓଡ଼ିଆ", english: "Odia", intl: "or-IN" },
  { code: "ml", name: "മലയാളം", english: "Malayalam", intl: "ml-IN" },
  { code: "pa", name: "ਪੰਜਾਬੀ", english: "Punjabi", intl: "pa-IN" },
  { code: "as", name: "অসমীয়া", english: "Assamese", intl: "as-IN" },
] as const;

export type Locale = (typeof LOCALES)[number]["code"];
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "locale";

export const isLocale = (v: unknown): v is Locale => typeof v === "string" && LOCALES.some((l) => l.code === v);
export const localeInfo = (code: Locale) => LOCALES.find((l) => l.code === code) ?? LOCALES[0];

/** Best supported locale for an Accept-Language header (e.g. "hi-IN,hi;q=0.9,en;q=0.8"). */
export function matchAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  const ranked = header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = Number(params.find((p) => p.trim().startsWith("q="))?.split("=")[1] ?? 1);
      return { lang: tag.toLowerCase().split("-")[0], q: Number.isFinite(q) ? q : 0 };
    })
    .sort((a, b) => b.q - a.q);
  return (ranked.find((r) => isLocale(r.lang))?.lang as Locale | undefined) ?? null;
}
