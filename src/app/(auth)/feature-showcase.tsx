import { BadgeCheck, ClipboardList, KeyRound, Languages, ListChecks, MessageSquareHeart, QrCode, ShieldCheck, ShoppingCart, Smartphone, Wallet } from "lucide-react";
import { getT } from "@/lib/i18n/server";

const MODULES = [
  { key: "facility", icon: ClipboardList },
  { key: "expense", icon: Wallet },
  { key: "tasks", icon: ListChecks },
  { key: "po", icon: ShoppingCart },
  { key: "surveys", icon: MessageSquareHeart },
] as const;

const HIGHLIGHTS = [
  { key: "h1", icon: BadgeCheck },
  { key: "h2", icon: Smartphone },
  { key: "h3", icon: QrCode },
  { key: "h4", icon: ShieldCheck },
  { key: "h5", icon: KeyRound },
  { key: "h6", icon: Languages },
];

/** Product overview beside the sign-in form (below it on phones). */
export async function FeatureShowcase() {
  const { t } = await getT();
  return (
    <section className="border-t bg-muted/40 px-4 py-10 lg:order-1 lg:flex lg:flex-1 lg:items-center lg:border-t-0 lg:border-r lg:px-12" aria-labelledby="features-heading">
      <div className="mx-auto w-full max-w-2xl">
        <p className="text-xs font-semibold tracking-wide text-primary uppercase">{t("features.eyebrow")}</p>
        <h2 id="features-heading" className="mt-2 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
          {t("features.headline")}
        </h2>
        <p className="mt-3 text-sm text-muted-foreground sm:text-base">{t("features.lead")}</p>
        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          {MODULES.map((m) => (
            <div key={m.key} className={`rounded-xl border bg-card p-4 ${m.key === "surveys" ? "sm:col-span-2" : ""}`}>
              <div className="flex items-center gap-2">
                <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary"><m.icon className="size-4" /></span>
                <h3 className="font-semibold">{t(`modules.${m.key}`)}</h3>
              </div>
              <ul className="mt-3 flex flex-col gap-1.5 text-sm text-muted-foreground">
                {[1, 2, 3].map((i) => (
                  <li key={i} className="flex gap-2"><span className="mt-2 size-1 shrink-0 rounded-full bg-primary" aria-hidden />{t(`features.${m.key}${i}`)}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <ul className="mt-6 grid gap-2 text-sm sm:grid-cols-2">
          {HIGHLIGHTS.map((h) => (
            <li key={h.key} className="flex items-center gap-2 text-muted-foreground"><h.icon className="size-4 shrink-0 text-primary" />{t(`features.${h.key}`)}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
