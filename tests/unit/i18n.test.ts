import { describe, expect, it } from "vitest";
import { LOCALES, matchAcceptLanguage } from "@/lib/i18n/config";
import { loadMessages } from "@/lib/i18n/load";
import { flatten, makeT, type Dict } from "@/lib/i18n/translate";
import en from "@/lib/i18n/messages/en";

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("i18n", () => {
  it("picks the best supported language from Accept-Language", () => {
    expect(matchAcceptLanguage("hi-IN,hi;q=0.9,en;q=0.8")).toBe("hi");
    expect(matchAcceptLanguage("fr-FR,ta;q=0.5")).toBe("ta");
    expect(matchAcceptLanguage("en;q=0.2,ml;q=0.9")).toBe("ml");
    expect(matchAcceptLanguage("fr-FR,de")).toBeNull();
    expect(matchAcceptLanguage(undefined)).toBeNull();
  });

  it("interpolates placeholders and falls back to English or the key", () => {
    const t = makeT({ "a.b": "Hello {name}, {n} new" });
    expect(t("a.b", { name: "Asha", n: 3 })).toBe("Hello Asha, 3 new");
    expect(t("missing", undefined, "Fallback")).toBe("Fallback");
    expect(t("missing")).toBe("missing");
  });

  const english = flatten(en as Dict);
  it.each(LOCALES.filter((l) => l.code !== "en").map((l) => l.code))("%s has every English key and the same placeholders", async (code) => {
    const mod = (await import(`@/lib/i18n/messages/${code}.ts`)) as { default: Dict };
    const dict = flatten(mod.default);
    expect(Object.keys(dict).sort()).toEqual(Object.keys(english).sort());
    for (const [k, v] of Object.entries(dict)) {
      expect(v.trim(), `${code}:${k}`).not.toBe("");
      expect(placeholders(v), `${code}:${k}`).toEqual(placeholders(english[k]));
    }
    const merged = await loadMessages(code);
    expect(merged["nav./"]).toBe(dict["nav./"]);
  });
});
