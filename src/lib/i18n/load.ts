import type { Locale } from "./config";
import { flatten, type Dict, type FlatDict } from "./translate";
import en from "./messages/en";

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

const english = flatten(en);

/** English merged with the locale's translations (missing keys stay English). */
export async function loadMessages(locale: Locale): Promise<FlatDict> {
  if (locale === "en") return english;
  const mod = await loaders[locale]();
  return { ...english, ...flatten(mod.default) };
}
