import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import { storageGetSignedUrl } from "../storage";

const BLUE = "#5A92C9";
const ORANGE = "#D58240";
const DARK = "#16191D";
const MUTED = "#6A7280";
const DEFAULT_WELFARE_LOGO_KEY = "welfare-pride-logo_82951fbd.png";

type InvoiceBundle = {
  invoice: {
    id: number;
    invoiceNumber: string;
    currency: string;
    issueDate: Date;
    dueDate: Date;
    subtotalCents: number;
    discountCents: number;
    taxCents: number;
    totalCents: number;
    notes: string | null;
    terms: string | null;
    paymentInstructions: string | null;
  };
  company: {
    name: string;
    legalName: string | null;
    email: string | null;
    phone: string | null;
    website: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    region: string | null;
    postalCode: string | null;
    country: string | null;
    primaryColor: string;
    accentColor: string;
    footerText: string | null;
    logoKey: string | null;
    logoScale: number;
    logoAlignment: "left" | "right";
  };
  contact: {
    companyName: string;
    contactName: string | null;
    email: string | null;
    phone: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    region: string | null;
    postalCode: string | null;
    country: string | null;
  };
  lineItems: Array<{ description: string; quantity: number; unitPriceCents: number; taxable: boolean }>;
};

function clean(value: string | null | undefined) {
  return (value ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ").trim();
}

function money(cents: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 2 }).format(cents / 100);
}

function addressLines(entity: { addressLine1: string | null; addressLine2: string | null; city: string | null; region: string | null; postalCode: string | null; country: string | null }) {
  const cityLine = [entity.city, entity.region, entity.postalCode].filter(Boolean).join(", ").replace(/, ([^,]+)$/, " $1");
  const countryCode = clean(entity.country).toUpperCase();
  let country = countryCode;
  if (/^[A-Z]{2}$/.test(countryCode)) {
    try { country = new Intl.DisplayNames(["en"], { type: "region" }).of(countryCode) || countryCode; } catch { /* Retain a valid stored code if the runtime cannot expand it. */ }
  }
  return [entity.addressLine1, entity.addressLine2, cityLine, country].map(clean).filter(Boolean);
}

function fontPath(name: string) {
  const root = process.cwd();
  const relative = process.env.NODE_ENV === "production" ? "dist/public/brand/fonts" : "client/public/brand/fonts";
  return path.join(root, relative, name);
}

async function loadLogo(logoKey: string | null) {
  if (!logoKey) return null;
  try {
    const signedUrl = await storageGetSignedUrl(logoKey);
    const response = await fetch(signedUrl);
    if (response.ok) return Buffer.from(await response.arrayBuffer());
  } catch {
    // Fall through to the bundled default only; tenant-uploaded assets never use a browser URL fallback.
  }
  if (logoKey === DEFAULT_WELFARE_LOGO_KEY) {
    const root = process.cwd();
    const relative = process.env.NODE_ENV === "production" ? "dist/public/brand/welfare-pride-logo.png" : "client/public/brand/welfare-pride-logo.png";
    const fallback = path.join(root, relative);
    if (fs.existsSync(fallback)) return fs.readFileSync(fallback);
  }
  return null;
}

function drawRule(doc: PDFKit.PDFDocument, y: number, color: string) {
  doc.save().strokeColor(color).lineWidth(1).moveTo(48, y).lineTo(564, y).stroke().restore();
}

function drawLabel(doc: PDFKit.PDFDocument, value: string, x: number, y: number) {
  doc.font("RobotoMedium").fontSize(7.5).fillColor(MUTED).text(value.toUpperCase(), x, y, { characterSpacing: 1.1 });
}

export async function renderInvoicePdf(bundle: InvoiceBundle) {
  const doc = new PDFDocument({ size: "LETTER", margin: 48, bufferPages: true, info: { Title: `Invoice ${bundle.invoice.invoiceNumber}`, Author: bundle.company.name } });
  const chunks: Buffer[] = [];
  const complete = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const regular = fontPath("Roboto-Regular.ttf");
  const medium = fontPath("Roboto-Medium.ttf");
  const bold = fontPath("Roboto-Bold.ttf");
  if (fs.existsSync(regular) && fs.existsSync(medium) && fs.existsSync(bold)) {
    doc.registerFont("Roboto", regular);
    doc.registerFont("RobotoMedium", medium);
    doc.registerFont("RobotoBold", bold);
  } else {
    doc.registerFont("Roboto", "Helvetica");
    doc.registerFont("RobotoMedium", "Helvetica-Bold");
    doc.registerFont("RobotoBold", "Helvetica-Bold");
  }

  const primary = /^#[0-9a-fA-F]{6}$/.test(bundle.company.primaryColor) ? bundle.company.primaryColor : BLUE;
  const accent = /^#[0-9a-fA-F]{6}$/.test(bundle.company.accentColor) ? bundle.company.accentColor : ORANGE;
  doc.rect(0, 0, 612, 10).fill(primary);

  const logo = await loadLogo(bundle.company.logoKey);
  const scale = Math.min(160, Math.max(50, bundle.company.logoScale || 100)) / 100;
  const logoWidth = 148 * scale;
  const logoHeight = 58 * scale;
  const logoX = bundle.company.logoAlignment === "right" ? 564 - logoWidth : 48;
  if (logo) {
    try {
      // PDFKit's fit option is deliberate: it contains rather than stretches/crops the source artwork.
      doc.image(logo, logoX, 30, { fit: [logoWidth, logoHeight], align: bundle.company.logoAlignment === "right" ? "right" : "center", valign: "center" });
    } catch {
      doc.font("RobotoBold").fontSize(19).fillColor(primary).text(clean(bundle.company.name), logoX, 42, { width: logoWidth });
    }
  } else {
    doc.font("RobotoBold").fontSize(19).fillColor(primary).text(clean(bundle.company.name), logoX, 42, { width: logoWidth });
  }

  const detailX = 390;
  doc.font("RobotoBold").fontSize(26).fillColor(DARK).text("INVOICE", detailX, 38, { width: 174, align: "right" });
  doc.font("RobotoMedium").fontSize(9).fillColor(MUTED).text(clean(bundle.invoice.invoiceNumber), detailX, 72, { width: 174, align: "right" });
  drawRule(doc, 106, primary);

  drawLabel(doc, "From", 48, 124);
  doc.font("RobotoBold").fontSize(10.5).fillColor(DARK).text(clean(bundle.company.legalName || bundle.company.name), 48, 139, { width: 220 });
  const fromLines = addressLines(bundle.company);
  if (bundle.company.email) fromLines.push(clean(bundle.company.email));
  if (bundle.company.phone) fromLines.push(clean(bundle.company.phone));
  doc.font("Roboto").fontSize(9).fillColor(DARK).text(fromLines.join("\n"), 48, 156, { width: 220, lineGap: 2 });

  drawLabel(doc, "Bill To", 300, 124);
  doc.font("RobotoBold").fontSize(10.5).fillColor(DARK).text(clean(bundle.contact.companyName), 300, 139, { width: 264 });
  const toLines = [bundle.contact.contactName, ...addressLines(bundle.contact), bundle.contact.email, bundle.contact.phone].map(clean).filter(Boolean);
  doc.font("Roboto").fontSize(9).fillColor(DARK).text(toLines.join("\n"), 300, 156, { width: 264, lineGap: 2 });

  drawRule(doc, 239, "#D6DEE6");
  const dates = [
    ["Issued", new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(bundle.invoice.issueDate)],
    ["Due", new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(bundle.invoice.dueDate)],
    ["Currency", bundle.invoice.currency],
  ];
  dates.forEach(([label, value], index) => {
    const x = 48 + index * 172;
    drawLabel(doc, label, x, 255);
    doc.font("RobotoMedium").fontSize(9.5).fillColor(DARK).text(value, x, 270);
  });

  const tableTop = 308;
  doc.rect(48, tableTop, 516, 26).fill(primary);
  doc.font("RobotoMedium").fontSize(8).fillColor("#FFFFFF");
  doc.text("DESCRIPTION", 60, tableTop + 9);
  doc.text("QTY", 370, tableTop + 9, { width: 36, align: "right" });
  doc.text("UNIT PRICE", 421, tableTop + 9, { width: 62, align: "right" });
  doc.text("AMOUNT", 493, tableTop + 9, { width: 58, align: "right" });

  let y = tableTop + 26;
  for (const [index, item] of bundle.lineItems.entries()) {
    const descriptionHeight = Math.max(28, doc.font("Roboto").fontSize(9).heightOfString(clean(item.description), { width: 300 }));
    const rowHeight = Math.min(64, descriptionHeight + 14);
    if (y + rowHeight > 625) {
      doc.addPage();
      doc.rect(0, 0, 612, 10).fill(primary);
      y = 48;
      doc.rect(48, y, 516, 26).fill(primary);
      doc.font("RobotoMedium").fontSize(8).fillColor("#FFFFFF");
      doc.text("DESCRIPTION", 60, y + 9);
      doc.text("QTY", 370, y + 9, { width: 36, align: "right" });
      doc.text("UNIT PRICE", 421, y + 9, { width: 62, align: "right" });
      doc.text("AMOUNT", 493, y + 9, { width: 58, align: "right" });
      y += 26;
    }
    if (index % 2 === 0) doc.rect(48, y, 516, rowHeight).fill("#F6F9FB");
    doc.font("Roboto").fontSize(9).fillColor(DARK).text(clean(item.description), 60, y + 8, { width: 300, height: rowHeight - 10 });
    doc.font("Roboto").fontSize(9).text(String(item.quantity), 370, y + 8, { width: 36, align: "right" });
    doc.text(money(item.unitPriceCents, bundle.invoice.currency), 410, y + 8, { width: 73, align: "right" });
    doc.font("RobotoMedium").text(money(item.quantity * item.unitPriceCents, bundle.invoice.currency), 485, y + 8, { width: 66, align: "right" });
    y += rowHeight;
  }

  const totalsTop = Math.max(y + 18, 510);
  const amountX = 436;
  const totals = [
    ["Subtotal", money(bundle.invoice.subtotalCents, bundle.invoice.currency)],
    ...(bundle.invoice.discountCents ? [["Discount", `−${money(bundle.invoice.discountCents, bundle.invoice.currency)}`]] : []),
    ...(bundle.invoice.taxCents ? [["Tax", money(bundle.invoice.taxCents, bundle.invoice.currency)]] : []),
  ];
  totals.forEach(([label, value], index) => {
    doc.font("Roboto").fontSize(9).fillColor(MUTED).text(label, 360, totalsTop + index * 19, { width: 70, align: "right" });
    doc.font("RobotoMedium").fillColor(DARK).text(value, amountX, totalsTop + index * 19, { width: 115, align: "right" });
  });
  const totalY = totalsTop + totals.length * 19 + 4;
  doc.rect(350, totalY, 214, 31).fill(accent);
  doc.font("RobotoBold").fontSize(10).fillColor("#FFFFFF").text("TOTAL DUE", 362, totalY + 10);
  doc.font("RobotoBold").fontSize(12).text(money(bundle.invoice.totalCents, bundle.invoice.currency), amountX, totalY + 8, { width: 115, align: "right" });

  let notesY = Math.max(totalY + 58, 612);
  const textSections: Array<[string, string]> = [
    ["Payment instructions", bundle.invoice.paymentInstructions],
    ["Terms & conditions", bundle.invoice.terms],
    ["Notes", bundle.invoice.notes],
  ].flatMap(([label, value]) => {
    const content = clean(value);
    return content ? [[label, content] as [string, string]] : [];
  });
  for (const [label, value] of textSections) {
    if (notesY > 710) { doc.addPage(); doc.rect(0, 0, 612, 10).fill(primary); notesY = 52; }
    drawLabel(doc, label, 48, notesY);
    notesY += 14;
    const height = doc.font("Roboto").fontSize(8.8).fillColor(DARK).heightOfString(value, { width: 516, lineGap: 2 });
    doc.text(value, 48, notesY, { width: 516, lineGap: 2 });
    notesY += height + 14;
  }

  const range = doc.bufferedPageRange();
  for (let index = 0; index < range.count; index += 1) {
    doc.switchToPage(index);
    // Keep the footer inside PDFKit's 48pt bottom margin so it cannot force a blank overflow page.
    doc.font("Roboto").fontSize(7.5).fillColor(MUTED).text(clean(bundle.company.footerText ?? "Thank you for your business."), 48, 724, { width: 420 });
    doc.text(`${index + 1} / ${range.count}`, 490, 724, { width: 74, align: "right" });
  }
  doc.end();
  return complete;
}

export function invoicePdfFilename(invoiceNumber: string) {
  return `${invoiceNumber.replace(/[^A-Za-z0-9._-]/g, "-") || "invoice"}.pdf`;
}
