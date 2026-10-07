import { BadgeCheck, ClipboardList, KeyRound, ListChecks, QrCode, ShieldCheck, ShoppingCart, Smartphone, Wallet } from "lucide-react";

const MODULES = [
  {
    icon: ClipboardList,
    title: "Facilities",
    points: ["Issue reporting by QR — no login needed", "SLA timers, escalations and work orders", "Asset register, PM schedules, AMC and compliance"],
  },
  {
    icon: Wallet,
    title: "Expenses",
    points: ["Budgets by campus, department and category", "Claims, advances and petty cash with receipts", "Live committed vs actual spend"],
  },
  {
    icon: ListChecks,
    title: "Tasks",
    points: ["Projects with list, board, calendar and timeline", "Subtasks, dependencies and recurring work", "Free personal workspace for everyone"],
  },
  {
    icon: ShoppingCart,
    title: "Purchasing",
    points: ["Requisitions, RFQs and quote comparison", "GST-ready POs, goods receipts and invoices", "3-way match before every payment"],
  },
];

const HIGHLIGHTS = [
  { icon: BadgeCheck, text: "One approval engine for claims, POs and vendors" },
  { icon: Smartphone, text: "Built for phones: approve, scan and update on the go" },
  { icon: QrCode, text: "QR codes on rooms and assets" },
  { icon: ShieldCheck, text: "Role-based access by campus and department" },
  { icon: KeyRound, text: "REST API, webhooks and CSV everywhere" },
];

/** Product overview beside the sign-in form (below it on phones). */
export function FeatureShowcase() {
  return (
    <section className="border-t bg-muted/40 px-4 py-10 lg:order-1 lg:flex lg:flex-1 lg:items-center lg:border-t-0 lg:border-r lg:px-12" aria-labelledby="features-heading">
      <div className="mx-auto w-full max-w-2xl">
        <p className="text-xs font-semibold tracking-wide text-primary uppercase">For schools and institutes</p>
        <h2 id="features-heading" className="mt-2 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
          Run your campus — facilities, money, tasks and purchasing — in one place.
        </h2>
        <p className="mt-3 text-sm text-muted-foreground sm:text-base">
          Four modules that share people, budgets and approvals, so a broken projector, the PO to replace it and the follow-up task all stay connected.
        </p>
        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          {MODULES.map((m) => (
            <div key={m.title} className="rounded-xl border bg-card p-4">
              <div className="flex items-center gap-2">
                <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary"><m.icon className="size-4" /></span>
                <h3 className="font-semibold">{m.title}</h3>
              </div>
              <ul className="mt-3 flex flex-col gap-1.5 text-sm text-muted-foreground">
                {m.points.map((p) => (
                  <li key={p} className="flex gap-2"><span className="mt-2 size-1 shrink-0 rounded-full bg-primary" aria-hidden />{p}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <ul className="mt-6 grid gap-2 text-sm sm:grid-cols-2">
          {HIGHLIGHTS.map((h) => (
            <li key={h.text} className="flex items-center gap-2 text-muted-foreground"><h.icon className="size-4 shrink-0 text-primary" />{h.text}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
