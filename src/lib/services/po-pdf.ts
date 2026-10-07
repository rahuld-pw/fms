import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { formatMoney } from "@/lib/utils/format";

interface PoLine {
  line_no: number;
  description: string;
  hsn_sac: string | null;
  quantity: number;
  unit: string;
  unit_price: number;
  discount_pct: number;
  tax_rate: number;
  taxable_amount: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  line_total: number;
}

export interface PoPdfData {
  org: { name: string; currency: string; locale: string };
  campus: { name: string; address: string | null; city: string | null; state: string | null; pincode: string | null; gstin: string | null };
  vendor: { name: string; legal_name: string | null; address: string | null; city: string | null; state: string | null; gstin: string | null; email: string | null; phone: string | null };
  po: {
    number: string;
    version: number;
    order_date: string;
    expected_delivery: string | null;
    status: string;
    payment_terms: string | null;
    terms_and_conditions: string | null;
    shipping_address: string | null;
    billing_address: string | null;
    notes: string | null;
    tax_type: string;
    subtotal: number;
    discount_total: number;
    tax_total: number;
    total: number;
  };
  lines: PoLine[];
}

const GREEN = rgb(0.086, 0.47, 0.27);
const GRAY = rgb(0.4, 0.4, 0.4);

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    let line = "";
    for (const word of para.split(" ")) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > width && line) {
        out.push(line);
        line = word;
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

/** Renders a GST-compliant purchase order PDF. */
export async function renderPoPdf(d: PoPdfData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Purchase Order ${d.po.number}`);
  pdf.setAuthor(d.org.name);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28;
  const H = 841.89;
  const M = 40;
  let page: PDFPage = pdf.addPage([W, H]);
  let y = H - M;
  // Standard fonts are WinAnsi; render the rupee sign as "Rs." to stay encodable.
  const money = (n: number) => formatMoney(n, d.org.currency, d.org.locale).replace("₹", "Rs. ");

  const text = (s: string, x: number, size = 9, f = font, color = rgb(0, 0, 0)) =>
    page.drawText(s.replace(/[^\x20-\x7E\n]/g, "?"), { x, y, size, font: f, color });

  // Header
  text(d.org.name, M, 16, bold, GREEN);
  y -= 16;
  text(d.campus.name, M, 9, font, GRAY);
  const campusAddr = [d.campus.address, d.campus.city, d.campus.state, d.campus.pincode].filter(Boolean).join(", ");
  if (campusAddr) {
    y -= 12;
    text(campusAddr.slice(0, 110), M, 8, font, GRAY);
  }
  if (d.campus.gstin) {
    y -= 12;
    text(`GSTIN: ${d.campus.gstin}`, M, 8, font, GRAY);
  }
  const titleY = H - M;
  page.drawText("PURCHASE ORDER", { x: W - M - bold.widthOfTextAtSize("PURCHASE ORDER", 14), y: titleY, size: 14, font: bold });
  const meta = [
    `No: ${d.po.number}${d.po.version > 1 ? ` (rev ${d.po.version})` : ""}`,
    `Date: ${d.po.order_date}`,
    d.po.expected_delivery ? `Delivery by: ${d.po.expected_delivery}` : null,
    `Status: ${d.po.status.replace(/_/g, " ")}`,
  ].filter(Boolean) as string[];
  meta.forEach((m, i) => page.drawText(m, { x: W - M - font.widthOfTextAtSize(m, 9), y: titleY - 18 - i * 12, size: 9, font }));

  y = Math.min(y, titleY - 18 - meta.length * 12) - 24;
  page.drawLine({ start: { x: M, y: y + 10 }, end: { x: W - M, y: y + 10 }, thickness: 0.5, color: rgb(0.85, 0.85, 0.85) });

  // Vendor & ship-to
  const colW = (W - M * 2) / 2;
  const startY = y;
  text("VENDOR", M, 8, bold, GRAY);
  y -= 12;
  text(d.vendor.legal_name ?? d.vendor.name, M, 10, bold);
  for (const l of [
    [d.vendor.address, d.vendor.city, d.vendor.state].filter(Boolean).join(", "),
    d.vendor.gstin ? `GSTIN: ${d.vendor.gstin}` : "",
    [d.vendor.email, d.vendor.phone].filter(Boolean).join(" | "),
  ].filter(Boolean)) {
    for (const w of wrap(l, font, 8, colW - 10)) {
      y -= 11;
      text(w, M, 8);
    }
  }
  const leftEnd = y;
  y = startY;
  text("SHIP TO", M + colW, 8, bold, GRAY);
  for (const w of wrap(d.po.shipping_address ?? (campusAddr || d.campus.name), font, 8, colW - 10)) {
    y -= 12;
    text(w, M + colW, 8);
  }
  y = Math.min(leftEnd, y) - 22;

  // Line items table
  const cols = [
    { h: "#", w: 18, a: "l" },
    { h: "Description", w: 170, a: "l" },
    { h: "HSN/SAC", w: 48, a: "l" },
    { h: "Qty", w: 40, a: "r" },
    { h: "Rate", w: 60, a: "r" },
    { h: "Disc%", w: 32, a: "r" },
    { h: "GST%", w: 32, a: "r" },
    { h: "Tax", w: 55, a: "r" },
    { h: "Amount", w: 60, a: "r" },
  ] as const;
  const header = () => {
    page.drawRectangle({ x: M, y: y - 4, width: W - M * 2, height: 16, color: rgb(0.94, 0.97, 0.95) });
    let x = M + 2;
    for (const c of cols) {
      const tw = bold.widthOfTextAtSize(c.h, 8);
      page.drawText(c.h, { x: c.a === "r" ? x + c.w - tw - 4 : x, y, size: 8, font: bold });
      x += c.w;
    }
    y -= 18;
  };
  header();
  for (const l of d.lines) {
    const descLines = wrap(l.description, font, 8, cols[1].w - 6);
    const rowH = Math.max(1, descLines.length) * 10 + 4;
    if (y - rowH < 140) {
      page = pdf.addPage([W, H]);
      y = H - M;
      header();
    }
    const tax = Number(l.cgst_amount) + Number(l.sgst_amount) + Number(l.igst_amount);
    const vals = [
      String(l.line_no),
      "",
      l.hsn_sac ?? "",
      `${Number(l.quantity)} ${l.unit}`,
      money(Number(l.unit_price)),
      Number(l.discount_pct) ? String(Number(l.discount_pct)) : "",
      String(Number(l.tax_rate)),
      money(tax),
      money(Number(l.line_total)),
    ];
    let x = M + 2;
    cols.forEach((c, i) => {
      if (i === 1) {
        descLines.forEach((dl, j) => page.drawText(dl.replace(/[^\x20-\x7E]/g, "?"), { x, y: y - j * 10, size: 8, font }));
      } else {
        const tw = font.widthOfTextAtSize(vals[i], 8);
        page.drawText(vals[i], { x: c.a === "r" ? x + c.w - tw - 4 : x, y, size: 8, font });
      }
      x += c.w;
    });
    y -= rowH;
    page.drawLine({ start: { x: M, y: y + 6 }, end: { x: W - M, y: y + 6 }, thickness: 0.3, color: rgb(0.9, 0.9, 0.9) });
  }

  // Totals
  y -= 8;
  const cgst = d.lines.reduce((s, l) => s + Number(l.cgst_amount), 0);
  const sgst = d.lines.reduce((s, l) => s + Number(l.sgst_amount), 0);
  const igst = d.lines.reduce((s, l) => s + Number(l.igst_amount), 0);
  const totals: [string, number, boolean][] = [
    ["Subtotal", Number(d.po.subtotal), false],
    ...(Number(d.po.discount_total) ? ([["Discount", -Number(d.po.discount_total), false]] as [string, number, boolean][]) : []),
    ...(d.po.tax_type === "igst"
      ? ([["IGST", igst, false]] as [string, number, boolean][])
      : ([["CGST", cgst, false], ["SGST", sgst, false]] as [string, number, boolean][])),
    ["Total", Number(d.po.total), true],
  ];
  for (const [label, value, strong] of totals) {
    const f = strong ? bold : font;
    const v = money(value);
    page.drawText(label, { x: W - M - 200, y, size: strong ? 11 : 9, font: f });
    page.drawText(v, { x: W - M - f.widthOfTextAtSize(v, strong ? 11 : 9) - 4, y, size: strong ? 11 : 9, font: f });
    y -= strong ? 18 : 13;
  }

  // Terms
  y -= 10;
  for (const [label, body] of [
    ["Payment terms", d.po.payment_terms],
    ["Terms & conditions", d.po.terms_and_conditions],
    ["Notes", d.po.notes],
  ] as [string, string | null][]) {
    if (!body) continue;
    if (y < 100) {
      page = pdf.addPage([W, H]);
      y = H - M;
    }
    text(label.toUpperCase(), M, 8, bold, GRAY);
    for (const w of wrap(body, font, 8, W - M * 2)) {
      y -= 11;
      if (y < 60) {
        page = pdf.addPage([W, H]);
        y = H - M;
      }
      text(w, M, 8);
    }
    y -= 16;
  }

  // Signature block on the last page
  page.drawLine({ start: { x: W - M - 160, y: 70 }, end: { x: W - M, y: 70 }, thickness: 0.5 });
  page.drawText("Authorised signatory", { x: W - M - 160, y: 58, size: 8, font, color: GRAY });
  page.drawText(`Generated by Campus Ops · ${d.po.number}`, { x: M, y: 30, size: 7, font, color: GRAY });
  return pdf.save();
}
