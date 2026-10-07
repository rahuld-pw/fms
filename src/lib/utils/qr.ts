import "server-only";
import QRCode from "qrcode";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { publicEnv } from "@/lib/env";

/** Public URL encoded in every QR code: opens the scan page (report issue / view asset). */
export const qrUrl = (token: string) => `${publicEnv.appUrl}/q/${token}`;

export async function qrSvg(token: string): Promise<string> {
  return QRCode.toString(qrUrl(token), { type: "svg", margin: 1, errorCorrectionLevel: "M" });
}

export async function qrPng(token: string, width = 300): Promise<Buffer> {
  return QRCode.toBuffer(qrUrl(token), { type: "png", margin: 1, width, errorCorrectionLevel: "M" });
}

export interface Label {
  token: string;
  title: string;
  subtitle?: string;
}

/** A4 sheet of QR labels (3 x 7 grid), ready to print on sticker paper. */
export async function labelsPdf(labels: Label[], orgName: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const [W, H] = [595.28, 841.89];
  const cols = 3;
  const rows = 7;
  const margin = 24;
  const cellW = (W - margin * 2) / cols;
  const cellH = (H - margin * 2) / rows;
  const clip = (s: string, max: number, f = font, size = 8) => {
    let out = s;
    while (out.length > 1 && f.widthOfTextAtSize(out, size) > max) out = out.slice(0, -2) + "…";
    return out;
  };
  for (let i = 0; i < labels.length; i++) {
    const idx = i % (cols * rows);
    if (idx === 0) pdf.addPage([W, H]);
    const page = pdf.getPages()[pdf.getPageCount() - 1];
    const c = idx % cols;
    const r = Math.floor(idx / cols);
    const x = margin + c * cellW;
    const y = H - margin - (r + 1) * cellH;
    const png = await pdf.embedPng(await qrPng(labels[i].token, 240));
    const size = cellH - 16;
    page.drawRectangle({ x: x + 2, y: y + 2, width: cellW - 4, height: cellH - 4, borderColor: rgb(0.85, 0.85, 0.85), borderWidth: 0.5 });
    page.drawImage(png, { x: x + 8, y: y + 8, width: size, height: size });
    const tx = x + size + 14;
    const tw = cellW - size - 22;
    page.drawText(clip(orgName, tw, font, 6), { x: tx, y: y + cellH - 22, size: 6, font, color: rgb(0.4, 0.4, 0.4) });
    page.drawText(clip(labels[i].title, tw, bold, 9), { x: tx, y: y + cellH - 38, size: 9, font: bold });
    if (labels[i].subtitle) page.drawText(clip(labels[i].subtitle!, tw, font, 7), { x: tx, y: y + cellH - 52, size: 7, font });
    page.drawText(clip("Scan to report an issue", tw, font, 6), { x: tx, y: y + 12, size: 6, font, color: rgb(0.13, 0.55, 0.3) });
  }
  if (labels.length === 0) pdf.addPage([W, H]);
  return pdf.save();
}
