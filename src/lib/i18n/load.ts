import type { Locale } from "./config";
import { flatten, type Dict, type FlatDict } from "./translate";
import en from "./messages/en";
import { englishAreas } from "./messages/areas";
import { areaLoaders } from "./messages/areas/locales";

const loaders: Record<Exclude<Locale, "en">, () => Promise<{ default: Dict }>> = {
  hi: () => import("./messages/hi"),
  bn: () => import("./messages/bn"),
  te: () => import("./messages/te"),
  mr: () => import("./messages/mr"),
  ta: () => import("./messages/ta"),
  ur: () => import("./messages/ur"),
  gu: () => import("./messages/gu"),
  kn: () => import("./messages/kn"),
  or: () => import("./messages/or"),
  ml: () => import("./messages/ml"),
  pa: () => import("./messages/pa"),
  as: () => import("./messages/as"),
};

const english: FlatDict = Object.assign({}, ...englishAreas.map((d) => flatten(d)), flatten(en));

/** English merged with the locale's translations (missing keys stay English). */
export async function loadMessages(locale: Locale): Promise<FlatDict> {
  if (locale === "en") return english;
  const [core, ...areas] = await Promise.all([loaders[locale](), ...(areaLoaders[locale] ?? []).map((l) => l())]);
  return Object.assign({ ...english }, ...areas.map((m) => flatten(m.default)), flatten(core.default));
}
