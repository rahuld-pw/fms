import "server-only";
import nodemailer, { type Transporter } from "nodemailer";

// Optional SMTP sender (e.g. Gmail with an app password) for when there's no
// domain for a provider like Resend. Configured with SMTP_HOST, SMTP_PORT,
// SMTP_USER, SMTP_PASS and EMAIL_FROM.

let transport: Transporter | null | undefined;

export function smtpConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function getTransport() {
  if (transport !== undefined) return transport;
  if (!smtpConfigured()) return (transport = null);
  const port = Number(process.env.SMTP_PORT || 465);
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465, // 465 = TLS from the start; 587 upgrades with STARTTLS
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return transport;
}

export async function sendSmtpEmail(msg: { to: string; subject: string; html: string; text: string }) {
  const t = getTransport();
  if (!t) return "skipped" as const;
  await t.sendMail({
    from: process.env.EMAIL_FROM || `Campus Ops <${process.env.SMTP_USER}>`,
    to: msg.to,
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
  });
  return "sent" as const;
}
