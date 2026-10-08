// Renders queued messages (message_outbox rows) into email / WhatsApp content.
// Kept free of runtime dependencies so it can be unit tested in Node.

export interface OutboxMessage {
  channel: "email" | "whatsapp" | "sms" | "push";
  template: string;
  subject: string | null;
  payload: Record<string, unknown>;
}
export interface Rendered {
  subject: string;
  text: string;
  html: string;
  /** WhatsApp Cloud API template name + ordered body parameters. */
  whatsapp?: { name: string; params: string[] };
}

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const abs = (appUrl: string, link: unknown) => (typeof link === "string" && link ? (link.startsWith("http") ? link : `${appUrl.replace(/\/$/, "")}${link}`) : "");
const fmtDate = (v: unknown) => (v ? new Date(String(v)).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "");
const fmtMoney = (v: unknown) => (v == null ? "" : new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(Number(v)));

function layout(org: string, heading: string, lines: string[], cta?: { label: string; url: string }) {
  const body = lines.filter(Boolean).map((l) => `<p style="margin:0 0 12px">${l}</p>`).join("");
  const button = cta?.url
    ? `<p style="margin:20px 0"><a href="${esc(cta.url)}" style="background:#15803d;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block">${esc(cta.label)}</a></p>`
    : "";
  return `<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#1c1917;background:#fafaf9;padding:24px">
<div style="max-width:560px;margin:auto;background:#fff;border:1px solid #e7e5e4;border-radius:10px;padding:24px">
<p style="margin:0 0 4px;color:#78716c;font-size:12px">${esc(org)}</p><h2 style="margin:0 0 16px;font-size:18px">${esc(heading)}</h2>${body}${button}
<p style="margin:24px 0 0;color:#a8a29e;font-size:12px">Sent by Campus Ops</p></div></body></html>`;
}

/** `ctx.portalLink` is a fresh vendor-portal link when the message is for a vendor. */
export function render(m: OutboxMessage, ctx: { appUrl: string; org: string; portalLink?: string }): Rendered {
  const p = m.payload ?? {};
  const out = (heading: string, lines: string[], cta?: { label: string; url: string }, whatsapp?: Rendered["whatsapp"]): Rendered => ({
    subject: m.subject ?? heading,
    html: layout(ctx.org, heading, lines.map(esc), cta),
    text: [heading, ...lines, cta?.url ? `${cta.label}: ${cta.url}` : ""].filter(Boolean).join("\n\n"),
    whatsapp,
  });
  switch (m.template) {
    case "notification":
      return out(String(p.title ?? m.subject ?? "Notification"), [String(p.body ?? "")], { label: "Open in Campus Ops", url: abs(ctx.appUrl, p.link) || ctx.appUrl });
    case "invitation":
      return out(`You're invited to ${p.org ?? ctx.org}`, [`${p.name ? `Hi ${p.name}, you` : "You"} have been invited to join ${p.org ?? ctx.org} on Campus Ops.`, "The link is valid for 7 days."], { label: "Accept invitation", url: String(p.link ?? "") });
    case "vendor_invite":
      return out("Complete your vendor registration", [`Hello ${p.vendor ?? ""},`, `${ctx.org} has invited you to register as a vendor. Please fill in your business and bank details and upload the requested documents.`], { label: "Start registration", url: String(p.link ?? "") });
    case "vendor_magic_link":
      return out("Your vendor portal sign-in link", ["Use the button below to open the vendor portal. The link expires in 48 hours."], { label: "Open vendor portal", url: String(p.link ?? "") });
    case "vendor_approved":
      return out("You are now an approved vendor", [`Hello ${p.vendor ?? ""}, your registration with ${ctx.org} has been approved.`], ctx.portalLink ? { label: "Open vendor portal", url: ctx.portalLink } : undefined);
    case "po_sent":
      return out(`Purchase Order ${p.number}${Number(p.version) > 1 ? ` (revision ${p.version})` : ""}`, [`Hello ${p.vendor ?? ""},`, `${ctx.org} has issued purchase order ${p.number} for ${fmtMoney(p.total)}.`, "Please review and acknowledge it in the vendor portal."], ctx.portalLink ? { label: "View and acknowledge", url: ctx.portalLink } : undefined);
    case "rfq_invite":
      return out(m.subject ?? "Request for quotation", [`Hello ${p.vendor ?? ""},`, `${ctx.org} invites you to quote. Please submit your rates by ${fmtDate(p.due_date)}.`], ctx.portalLink ? { label: "Submit quote", url: ctx.portalLink } : undefined);
    case "vendor_booking_reminder":
      return out(m.subject ?? `Please confirm visit ${p.number}`, [`A service visit (${p.number}) is scheduled for ${fmtDate(p.scheduled_for)}. Please confirm, reschedule or decline.`],
        ctx.portalLink ? { label: "Confirm visit", url: ctx.portalLink } : undefined,
        { name: "vendor_booking_reminder", params: [String(p.number ?? ""), fmtDate(p.scheduled_for), ctx.portalLink ?? ctx.appUrl] });
    case "compliance_due":
      return out(`Compliance due: ${p.title}`, [`Hi ${p.name ?? ""}, "${p.title}" is due on ${fmtDate(p.due)}.`], { label: "Open compliance calendar", url: `${ctx.appUrl}/facility/maintenance?tab=compliance` },
        { name: "compliance_due", params: [String(p.name ?? ""), String(p.title ?? ""), fmtDate(p.due)] });
    default:
      return out(m.subject ?? "Update from Campus Ops", [String(p.body ?? p.title ?? "")]);
  }
}

/** Vendor templates carry a portal link, minted at send time so it is fresh. */
export const VENDOR_TEMPLATES = new Set(["vendor_approved", "po_sent", "rfq_invite", "vendor_booking_reminder"]);
