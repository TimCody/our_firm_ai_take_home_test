/**
 * Fixture generator — produces a labelled corpus of test documents in
 * samples/{easy,medium,hard,images,docx}/.
 *
 * Design goals:
 *   - Reproducible (no randomness; deterministic seeded variations)
 *   - Span the realistic difficulty spectrum (clean letter → garbage)
 *   - Each sample is *labelled* in samples/INDEX.json so we can later
 *     build a regression harness that scores extraction against ground truth
 *
 * Run: `npm run fixtures`
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";
import sharp from "sharp";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Header,
  Footer,
  AlignmentType,
} from "docx";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "samples");

interface FixtureLabel {
  file: string;
  tier: "easy" | "medium" | "hard" | "image" | "docx";
  description: string;
  expectations: {
    letterhead: boolean;
    footer: boolean;
    signature: boolean;
  };
}

const index: FixtureLabel[] = [];

async function ensureDir(p: string) {
  await mkdir(p, { recursive: true });
}

interface PdfRecipe {
  filename: string;
  tier: "easy" | "medium" | "hard";
  description: string;
  expectations: { letterhead: boolean; footer: boolean; signature: boolean };
  draw: (doc: PDFKit.PDFDocument) => void;
}

const PALETTE = {
  ink: "#111111",
  dim: "#666666",
  accent: "#2454b8",
};

function drawLetterhead(
  doc: PDFKit.PDFDocument,
  variant: {
    companyName: string;
    addressLines: string[];
    centered?: boolean;
    withRule?: boolean;
    color?: string;
  },
) {
  const { companyName, addressLines, centered, withRule } = variant;
  const color = variant.color ?? PALETTE.accent;
  doc.fillColor(color).fontSize(22).font("Helvetica-Bold");
  doc.text(companyName, { align: centered ? "center" : "left" });
  doc.fillColor(PALETTE.dim).fontSize(10).font("Helvetica");
  addressLines.forEach((line) =>
    doc.text(line, { align: centered ? "center" : "left" }),
  );
  if (withRule) {
    const y = doc.y + 6;
    doc.moveTo(72, y).lineTo(540, y).strokeColor(color).lineWidth(1.5).stroke();
  }
  doc.moveDown(1.5);
  doc.fillColor(PALETTE.ink).font("Helvetica");
}

function drawBody(doc: PDFKit.PDFDocument, paragraphs: string[]) {
  doc.fontSize(11).fillColor(PALETTE.ink).font("Helvetica");
  paragraphs.forEach((p) => {
    doc.text(p, { align: "left", lineGap: 2 });
    doc.moveDown(0.8);
  });
}

function drawSignOff(
  doc: PDFKit.PDFDocument,
  variant: {
    closing: string;
    typedName: string;
    title?: string;
    withSignatureLine?: boolean;
    italicSignature?: boolean;
  },
) {
  doc.moveDown(1);
  doc.font("Helvetica").fontSize(11).text(variant.closing);
  doc.moveDown(2.5); // space for handwritten signature

  if (variant.withSignatureLine) {
    const y = doc.y;
    doc
      .moveTo(72, y)
      .lineTo(280, y)
      .strokeColor(PALETTE.ink)
      .lineWidth(0.6)
      .stroke();
    doc.moveDown(0.3);
  }
  if (variant.italicSignature) {
    doc.font("Helvetica-Oblique").fontSize(14).text(variant.typedName);
    doc.font("Helvetica").fontSize(11);
  } else {
    doc.text(variant.typedName);
  }
  if (variant.title) {
    doc.fillColor(PALETTE.dim).fontSize(10).text(variant.title);
    doc.fillColor(PALETTE.ink).fontSize(11);
  }
}

/**
 * Draw a synthetic "handwritten signature" using a smooth bezier scribble.
 * Looks signature-ish under both human eyes and our ink-density scan.
 */
function drawHandwrittenSignature(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width = 180,
  height = 36,
) {
  doc
    .strokeColor("#0a1f5c")
    .lineWidth(1.6)
    .moveTo(x, y + height * 0.6)
    .bezierCurveTo(
      x + width * 0.1, y + height * 0.1,
      x + width * 0.2, y + height * 0.9,
      x + width * 0.3, y + height * 0.4,
    )
    .bezierCurveTo(
      x + width * 0.45, y - height * 0.1,
      x + width * 0.55, y + height * 0.9,
      x + width * 0.7, y + height * 0.5,
    )
    .bezierCurveTo(
      x + width * 0.8, y + height * 0.2,
      x + width * 0.9, y + height * 0.8,
      x + width, y + height * 0.4,
    )
    .stroke();
  // Loop flourish
  doc
    .moveTo(x + width * 0.65, y + height * 0.7)
    .bezierCurveTo(
      x + width * 0.75, y + height * 1.1,
      x + width * 0.85, y + height * 1.0,
      x + width * 0.95, y + height * 0.6,
    )
    .stroke();
}

function drawFooter(
  doc: PDFKit.PDFDocument,
  text: string,
  pageNumber?: number,
  totalPages?: number,
) {
  const bottom = doc.page.height - 60;
  doc
    .strokeColor(PALETTE.dim)
    .lineWidth(0.5)
    .moveTo(72, bottom)
    .lineTo(540, bottom)
    .stroke();
  doc.fillColor(PALETTE.dim).fontSize(9).font("Helvetica");
  doc.text(text, 72, bottom + 6, { width: 468, align: "left" });
  if (pageNumber !== undefined && totalPages !== undefined) {
    doc.text(`Page ${pageNumber} of ${totalPages}`, 72, bottom + 6, {
      width: 468,
      align: "right",
    });
  }
}

const FILLER = [
  "We are pleased to confirm the terms of our engagement as outlined in the attached statement of work. The scope of services described therein will commence on the agreed start date and continue through the milestones jointly defined by both parties.",
  "Payment terms are net thirty (30) days from the date of invoice. All amounts are stated in United States dollars unless otherwise specified. Late payments may be subject to a service charge of one and one-half percent (1.5%) per month, or the maximum rate permitted by applicable law.",
  "Both parties acknowledge that confidential information exchanged in the course of this engagement shall be maintained in strict confidence and used solely for the purposes of fulfilling the obligations set forth herein.",
  "This agreement constitutes the entire understanding between the parties with respect to its subject matter and supersedes all prior negotiations, representations, or agreements, whether written or oral.",
  "Please review the enclosed materials and return one fully executed counterpart at your earliest convenience. We look forward to the continued partnership.",
];

const RECIPES: PdfRecipe[] = [
  // ---------- EASY (12) ----------
  {
    filename: "easy/01-clean-letter.pdf",
    tier: "easy",
    description: "Single-page formal letter; clear letterhead, footer, italic-name signature",
    expectations: { letterhead: true, footer: true, signature: true },
    draw: (doc) => {
      drawLetterhead(doc, {
        companyName: "Sterling & Partners LLP",
        addressLines: [
          "100 Market Street, Suite 1200",
          "San Francisco, CA 94105 · (415) 555-0123 · www.sterling-partners.example",
        ],
        withRule: true,
      });
      drawBody(doc, [`May 4, 2026`, FILLER[0]!, FILLER[1]!]);
      drawSignOff(doc, {
        closing: "Sincerely,",
        typedName: "Eleanor M. Sterling",
        title: "Managing Partner",
        italicSignature: true,
      });
      drawFooter(doc, "© 2026 Sterling & Partners LLP. All rights reserved.");
    },
  },
  {
    filename: "easy/02-centered-letterhead.pdf",
    tier: "easy",
    description: "Centered letterhead, handwritten-style signature scribble, footer with page number",
    expectations: { letterhead: true, footer: true, signature: true },
    draw: (doc) => {
      drawLetterhead(doc, {
        companyName: "Whitfield Medical Group",
        addressLines: [
          "2400 Beacon Avenue · Boston, MA 02108",
          "office@whitfield.example  ·  (617) 555-0199",
        ],
        centered: true,
        withRule: true,
      });
      drawBody(doc, [FILLER[2]!, FILLER[3]!]);
      drawSignOff(doc, {
        closing: "Best regards,",
        typedName: "Dr. James Whitfield, MD",
        withSignatureLine: true,
      });
      drawHandwrittenSignature(doc, 90, doc.y - 50, 200, 32);
      drawFooter(doc, "Whitfield Medical Group · Confidential", 1, 1);
    },
  },
  {
    filename: "easy/03-corporate-memo.pdf",
    tier: "easy",
    description: "Memo style: bold letterhead, simple footer, italic signature",
    expectations: { letterhead: true, footer: true, signature: true },
    draw: (doc) => {
      drawLetterhead(doc, {
        companyName: "NORTHWIND TRADING CO.",
        addressLines: ["Internal Memorandum · Distribution: Senior Staff"],
        withRule: true,
        color: "#111111",
      });
      drawBody(doc, [`To: All Department Heads`, `From: Office of the CFO`, FILLER[1]!]);
      drawSignOff(doc, {
        closing: "Regards,",
        typedName: "Margaret O'Sullivan",
        title: "Chief Financial Officer",
        italicSignature: true,
      });
      drawFooter(doc, "Northwind Trading Co. — Internal Use Only");
    },
  },
  {
    filename: "easy/04-firm-letterhead.pdf",
    tier: "easy",
    description: "Law-firm style with name partner list, classic sign-off",
    expectations: { letterhead: true, footer: true, signature: true },
    draw: (doc) => {
      drawLetterhead(doc, {
        companyName: "Harrington, Cole & Wright",
        addressLines: [
          "Attorneys at Law",
          "555 Federal Plaza · Chicago, IL 60604 · (312) 555-0144",
        ],
        centered: true,
        withRule: true,
        color: "#2a1a4a",
      });
      drawBody(doc, [`Re: Matter No. 2026-0418`, FILLER[0]!]);
      drawSignOff(doc, {
        closing: "Respectfully,",
        typedName: "Theodore B. Harrington",
        title: "Partner",
        italicSignature: true,
        withSignatureLine: true,
      });
      drawHandwrittenSignature(doc, 80, doc.y - 50, 220, 36);
      drawFooter(doc, "Harrington, Cole & Wright · Privileged & Confidential");
    },
  },
  {
    filename: "easy/05-thank-you.pdf",
    tier: "easy",
    description: "Short thank-you letter, casual sign-off",
    expectations: { letterhead: true, footer: true, signature: true },
    draw: (doc) => {
      drawLetterhead(doc, {
        companyName: "Sunrise Coffee Roasters",
        addressLines: ["18 Beach Road · Half Moon Bay, CA 94019"],
        withRule: true,
        color: "#8a4a1a",
      });
      drawBody(doc, [FILLER[4]!]);
      drawSignOff(doc, {
        closing: "Warmly,",
        typedName: "Priya Subramanian",
        title: "Owner & Head Roaster",
        italicSignature: true,
      });
      drawFooter(doc, "Thanks for supporting small business · sunrisecoffee.example");
    },
  },
  {
    filename: "easy/06-engagement-letter.pdf",
    tier: "easy",
    description: "Multi-paragraph engagement letter with explicit signature line",
    expectations: { letterhead: true, footer: true, signature: true },
    draw: (doc) => {
      drawLetterhead(doc, {
        companyName: "Apex Advisory Group",
        addressLines: [
          "Strategic Consulting · 901 Ridgewood Drive, Suite 700",
          "Atlanta, GA 30309 · advisors@apex.example",
        ],
        withRule: true,
      });
      drawBody(doc, [FILLER[0]!, FILLER[1]!, FILLER[3]!]);
      drawSignOff(doc, {
        closing: "Yours truly,",
        typedName: "David Park, CPA",
        title: "Managing Director",
        withSignatureLine: true,
        italicSignature: true,
      });
      drawHandwrittenSignature(doc, 80, doc.y - 50, 180, 30);
      drawFooter(doc, "© 2026 Apex Advisory Group LLC");
    },
  },
  {
    filename: "easy/07-multipage-letter.pdf",
    tier: "easy",
    description: "Two-page letter; footer repeats on each page",
    expectations: { letterhead: true, footer: true, signature: true },
    draw: (doc) => {
      drawLetterhead(doc, {
        companyName: "Cedar Ridge Property Management",
        addressLines: ["445 Cedar Ridge Road · Denver, CO 80202"],
        withRule: true,
      });
      drawBody(doc, [FILLER[0]!, FILLER[1]!, FILLER[2]!]);
      drawFooter(doc, "Cedar Ridge Property Management · 445 Cedar Ridge Rd", 1, 2);
      doc.addPage();
      drawBody(doc, [FILLER[3]!, FILLER[4]!]);
      drawSignOff(doc, {
        closing: "Sincerely,",
        typedName: "Maria González",
        title: "Property Manager",
        italicSignature: true,
      });
      drawFooter(doc, "Cedar Ridge Property Management · 445 Cedar Ridge Rd", 2, 2);
    },
  },
  {
    filename: "easy/08-bold-header.pdf",
    tier: "easy",
    description: "Big bold header band — classic letterhead",
    expectations: { letterhead: true, footer: true, signature: true },
    draw: (doc) => {
      doc.rect(0, 0, doc.page.width, 84).fill("#1a1a2e");
      doc.fillColor("#ffffff").fontSize(24).font("Helvetica-Bold");
      doc.text("ATLAS LOGISTICS", 72, 28);
      doc.fontSize(10).font("Helvetica").fillColor("#bbbbcc");
      doc.text("Freight · Warehousing · Distribution", 72, 60);
      doc.fillColor(PALETTE.ink).font("Helvetica");
      doc.y = 110;
      drawBody(doc, [FILLER[1]!, FILLER[2]!]);
      drawSignOff(doc, {
        closing: "Best,",
        typedName: "Liam O'Brien",
        title: "VP Operations",
        italicSignature: true,
      });
      drawFooter(doc, "Atlas Logistics, Inc. · atlaslogistics.example");
    },
  },
  {
    filename: "easy/09-cover-letter.pdf",
    tier: "easy",
    description: "Personal cover letter (no company brand, just name/address as letterhead)",
    expectations: { letterhead: true, footer: false, signature: true },
    draw: (doc) => {
      drawLetterhead(doc, {
        companyName: "Hannah J. Kowalski",
        addressLines: [
          "742 Evergreen Terrace · Springfield, OR 97477",
          "hannah.kowalski@example.com · (541) 555-0167",
        ],
        centered: true,
        color: "#222222",
      });
      drawBody(doc, [`Dear Hiring Manager,`, FILLER[4]!, FILLER[2]!]);
      drawSignOff(doc, {
        closing: "Sincerely,",
        typedName: "Hannah J. Kowalski",
        italicSignature: true,
      });
      // No drawn footer — confirms our "footer absent" path
    },
  },
  {
    filename: "easy/10-classic-letter.pdf",
    tier: "easy",
    description: "Classic business letter, all three regions present and clean",
    expectations: { letterhead: true, footer: true, signature: true },
    draw: (doc) => {
      drawLetterhead(doc, {
        companyName: "Pinewood Insurance Brokers",
        addressLines: [
          "12 Pinewood Court · Portland, ME 04101",
          "info@pinewoodbrokers.example",
        ],
        withRule: true,
        color: "#1c4a2a",
      });
      drawBody(doc, [FILLER[0]!, FILLER[1]!]);
      drawSignOff(doc, {
        closing: "Cordially,",
        typedName: "Robert Chen",
        title: "Senior Broker",
        withSignatureLine: true,
        italicSignature: true,
      });
      drawHandwrittenSignature(doc, 80, doc.y - 50);
      drawFooter(doc, "© 2026 Pinewood Insurance Brokers · Page 1 of 1");
    },
  },
  // ---------- MEDIUM (6) ----------
  {
    filename: "medium/01-no-signature.pdf",
    tier: "medium",
    description: "Letterhead + footer, no signature — tests \"not detected\" path",
    expectations: { letterhead: true, footer: true, signature: false },
    draw: (doc) => {
      drawLetterhead(doc, {
        companyName: "Helix Biotech Inc.",
        addressLines: ["Research Park · Cambridge, MA 02139"],
        withRule: true,
      });
      drawBody(doc, [`Notice of Public Filing`, FILLER[3]!, FILLER[2]!]);
      drawFooter(doc, "Helix Biotech Inc. · SEC Filing 10-K Exhibit 1.4");
    },
  },
  {
    filename: "medium/02-no-letterhead.pdf",
    tier: "medium",
    description: "Body-only document with signature and footer but no letterhead",
    expectations: { letterhead: false, footer: true, signature: true },
    draw: (doc) => {
      doc.moveDown(2);
      drawBody(doc, [`Statement of Work — Phase II`, FILLER[0]!, FILLER[1]!]);
      drawSignOff(doc, {
        closing: "Signed,",
        typedName: "Anita Vasquez",
        italicSignature: true,
      });
      drawFooter(doc, "Statement of Work · Confidential · 1/1");
    },
  },
  {
    filename: "medium/03-small-font.pdf",
    tier: "medium",
    description: "Tiny body font, dense paragraphs — tests robustness to dense layouts",
    expectations: { letterhead: true, footer: true, signature: true },
    draw: (doc) => {
      drawLetterhead(doc, {
        companyName: "Quantum Capital Partners",
        addressLines: ["350 Park Avenue, 18th Floor · New York, NY 10022"],
      });
      doc.fontSize(7).font("Helvetica");
      [FILLER[0]!, FILLER[1]!, FILLER[2]!, FILLER[3]!, FILLER[4]!].forEach((p) => {
        doc.text(p, { align: "justify", lineGap: 0.5 });
        doc.moveDown(0.4);
      });
      drawSignOff(doc, {
        closing: "Regards,",
        typedName: "Vikram Iyer",
        italicSignature: true,
      });
      drawFooter(doc, "Quantum Capital Partners · Risk Disclosure on file");
    },
  },
  {
    filename: "medium/04-rotated-text.pdf",
    tier: "medium",
    description: "Side watermark + body text — letterhead and footer at normal positions",
    expectations: { letterhead: true, footer: true, signature: true },
    draw: (doc) => {
      drawLetterhead(doc, {
        companyName: "Bluebird Architects",
        addressLines: ["77 Greene Street · New York, NY 10012"],
        withRule: true,
        color: "#1a5a8a",
      });
      // Rotated watermark
      doc.save();
      doc.fillColor("#eeeeee").fontSize(56).font("Helvetica-Bold");
      doc.rotate(-30, { origin: [300, 400] });
      doc.text("DRAFT", 200, 380);
      doc.restore();
      doc.fillColor(PALETTE.ink).font("Helvetica").fontSize(11);
      drawBody(doc, [FILLER[0]!, FILLER[2]!]);
      drawSignOff(doc, {
        closing: "Sincerely,",
        typedName: "Akiko Tanaka, AIA",
        italicSignature: true,
      });
      drawFooter(doc, "Bluebird Architects · Project 2026-118 · DRAFT");
    },
  },
  {
    filename: "medium/05-three-pages.pdf",
    tier: "medium",
    description: "Three-page document — signature only on last page, footer on every page",
    expectations: { letterhead: true, footer: true, signature: true },
    draw: (doc) => {
      drawLetterhead(doc, {
        companyName: "Granite Construction Co.",
        addressLines: ["1100 Industrial Way · Reno, NV 89502"],
        withRule: true,
      });
      drawBody(doc, [FILLER[0]!, FILLER[1]!]);
      drawFooter(doc, "Granite Construction Co. · Contract #GC-2026-0042", 1, 3);
      doc.addPage();
      drawBody(doc, [FILLER[2]!, FILLER[3]!]);
      drawFooter(doc, "Granite Construction Co. · Contract #GC-2026-0042", 2, 3);
      doc.addPage();
      drawBody(doc, [FILLER[4]!]);
      drawSignOff(doc, {
        closing: "Yours faithfully,",
        typedName: "Carlos Mendoza",
        title: "Project Manager",
        withSignatureLine: true,
        italicSignature: true,
      });
      drawHandwrittenSignature(doc, 80, doc.y - 50);
      drawFooter(doc, "Granite Construction Co. · Contract #GC-2026-0042", 3, 3);
    },
  },
  {
    filename: "medium/06-low-contrast.pdf",
    tier: "medium",
    description: "Light-grey signature stroke — tests ink-density threshold",
    expectations: { letterhead: true, footer: true, signature: true },
    draw: (doc) => {
      drawLetterhead(doc, {
        companyName: "Coastal Realty",
        addressLines: ["88 Ocean Drive · Charleston, SC 29401"],
        withRule: true,
      });
      drawBody(doc, [FILLER[1]!, FILLER[4]!]);
      doc.moveDown(2);
      doc.text("Sincerely,");
      doc.moveDown(2);
      // Light grey signature - tests our threshold
      doc.strokeColor("#999999").lineWidth(1).moveTo(80, doc.y);
      drawHandwrittenSignature(doc, 80, doc.y, 200, 30);
      doc.moveDown(2);
      doc.text("Rachel Kim");
      drawFooter(doc, "Coastal Realty · License #SC-RE-12489");
    },
  },
  // ---------- HARD (2) ----------
  {
    filename: "hard/01-poster-style.pdf",
    tier: "hard",
    description: "Poster/flyer with title-as-letterhead, no signature, no clear footer",
    expectations: { letterhead: true, footer: false, signature: false },
    draw: (doc) => {
      doc.fontSize(40).font("Helvetica-Bold").fillColor("#d63a3a");
      doc.text("ANNUAL CHARITY GALA", { align: "center" });
      doc.moveDown(0.2);
      doc.fontSize(16).fillColor("#333333").font("Helvetica");
      doc.text("Saturday, October 18, 2026 · 7:00 PM", { align: "center" });
      doc.moveDown(2);
      doc.fontSize(14).fillColor("#111111");
      doc.text(
        "Join us for an evening of celebration and giving. Live music, silent auction, and dinner prepared by award-winning chefs.",
        { align: "center" },
      );
      doc.moveDown(3);
      doc.fontSize(12).fillColor("#555555");
      doc.text("Tickets: gala2026.example", { align: "center" });
      // No footer, no signature — exercise the "missing" UI
    },
  },
  {
    filename: "hard/02-jumbled-layout.pdf",
    tier: "hard",
    description: "Three-column ish layout, footer-positioned legal text mid-page — adversarial",
    expectations: { letterhead: true, footer: true, signature: true },
    draw: (doc) => {
      // Letterhead in lower-half ribbon to confuse our top-region heuristic
      doc.fontSize(20).font("Helvetica-Bold").fillColor("#444444");
      doc.text("MEMORANDUM", 72, 80);
      doc.fontSize(10).font("Helvetica").fillColor("#666666");
      doc.text("Department of Records · File 2026-441", 72, 110);
      doc.moveDown(2);
      drawBody(doc, [FILLER[0]!, FILLER[3]!]);
      // Stray "footer-looking" text mid-page
      doc.fontSize(9).fillColor("#888888");
      doc.text("Page 1 of 1 · do not reproduce without written consent", 72, 400);
      doc.moveDown(2);
      doc.fillColor(PALETTE.ink).fontSize(11);
      drawBody(doc, [FILLER[2]!]);
      drawSignOff(doc, {
        closing: "Best,",
        typedName: "F. Whitmore",
        italicSignature: true,
      });
      drawFooter(doc, "Department of Records · Confidential");
    },
  },
];

async function generatePdfs() {
  for (const recipe of RECIPES) {
    const outPath = join(OUT, recipe.filename);
    await ensureDir(join(OUT, recipe.filename.split("/")[0]!));
    await new Promise<void>((resolve, reject) => {
      const doc = new PDFDocument({ size: "LETTER", margin: 72 });
      const chunks: Buffer[] = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", async () => {
        try {
          await writeFile(outPath, Buffer.concat(chunks));
          resolve();
        } catch (err) {
          reject(err);
        }
      });
      doc.on("error", reject);
      try {
        recipe.draw(doc);
      } catch (err) {
        reject(err);
        return;
      }
      doc.end();
    });
    index.push({
      file: recipe.filename,
      tier: recipe.tier,
      description: recipe.description,
      expectations: recipe.expectations,
    });
    console.log(`  ✓ ${recipe.filename}`);
  }
}

async function generateImages() {
  // Take a few PDFs and rasterize a page as an image input (PNG + JPEG).
  // This validates our image-input pipeline end to end.
  const imagesDir = join(OUT, "images");
  await ensureDir(imagesDir);

  // Use a synthesized image with a top band + bottom band so the
  // top/bottom slice heuristic produces visibly correct crops.
  const w = 1240;
  const h = 1754; // A4-ish at 150dpi

  const svg = `
  <svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${w}" height="${h}" fill="#ffffff"/>
    <rect x="0" y="0" width="${w}" height="240" fill="#1a3a8a"/>
    <text x="${w / 2}" y="120" font-family="Helvetica" font-size="46" font-weight="bold"
      fill="white" text-anchor="middle">MAPLEWOOD REALTY</text>
    <text x="${w / 2}" y="180" font-family="Helvetica" font-size="22"
      fill="#cfd9ee" text-anchor="middle">123 Maple Avenue · Toronto, ON M5V 3A8</text>
    <text x="120" y="400" font-family="Helvetica" font-size="22" fill="#222">Dear Mr. and Mrs. Henderson,</text>
    <text x="120" y="460" font-family="Helvetica" font-size="18" fill="#444">
      Thank you for choosing Maplewood Realty for the sale of your property.
    </text>
    <text x="120" y="490" font-family="Helvetica" font-size="18" fill="#444">
      Please find the enclosed listing agreement and disclosure documents.
    </text>
    <text x="120" y="${h - 220}" font-family="Helvetica" font-size="20" fill="#222">Sincerely,</text>
    <text x="120" y="${h - 160}" font-family="Helvetica" font-style="italic" font-size="28" fill="#102060">
      Jennifer Walsh
    </text>
    <rect x="0" y="${h - 80}" width="${w}" height="80" fill="#1a3a8a"/>
    <text x="${w / 2}" y="${h - 30}" font-family="Helvetica" font-size="18"
      fill="#ffffff" text-anchor="middle">© 2026 Maplewood Realty Inc. · maplewood.example</text>
  </svg>
  `;

  const pngBuffer = await sharp(Buffer.from(svg)).png().toBuffer();
  await writeFile(join(imagesDir, "letter-photo.png"), pngBuffer);
  index.push({
    file: "images/letter-photo.png",
    tier: "image",
    description: "PNG image of a letter — exercises image-input pipeline",
    expectations: { letterhead: true, footer: true, signature: false },
  });
  console.log("  ✓ images/letter-photo.png");

  const jpegBuffer = await sharp(Buffer.from(svg))
    .jpeg({ quality: 70 })
    .toBuffer();
  await writeFile(join(imagesDir, "letter-photo.jpg"), jpegBuffer);
  index.push({
    file: "images/letter-photo.jpg",
    tier: "image",
    description: "JPEG version of the letter — same content, lossy compression",
    expectations: { letterhead: true, footer: true, signature: false },
  });
  console.log("  ✓ images/letter-photo.jpg");
}

async function generateDocx() {
  const docxDir = join(OUT, "docx");
  await ensureDir(docxDir);

  const doc = new Document({
    sections: [
      {
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    text: "SUMMIT PEAK CONSULTING",
                    bold: true,
                    size: 32,
                  }),
                ],
              }),
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    text: "Strategic Advisory · Operations Consulting",
                    size: 20,
                  }),
                ],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    text: "© 2026 Summit Peak Consulting · Confidential",
                    size: 18,
                  }),
                ],
              }),
            ],
          }),
        },
        children: [
          new Paragraph({ children: [new TextRun("Dear Ms. Lambert,")] }),
          new Paragraph({ children: [new TextRun(FILLER[0]!)] }),
          new Paragraph({ children: [new TextRun(FILLER[1]!)] }),
          new Paragraph({ children: [new TextRun("Sincerely,")] }),
          new Paragraph({
            children: [
              new TextRun({
                text: "Andrew P. Bryant",
                italics: true,
                size: 28,
              }),
            ],
          }),
          new Paragraph({ children: [new TextRun("Managing Director")] }),
        ],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  await writeFile(join(docxDir, "engagement-letter.docx"), buffer);
  index.push({
    file: "docx/engagement-letter.docx",
    tier: "docx",
    description: "DOCX with header, footer, and italic sign-off name",
    expectations: { letterhead: true, footer: true, signature: false },
  });
  console.log("  ✓ docx/engagement-letter.docx");
}

async function main() {
  console.log("Generating fixtures →", OUT);
  await ensureDir(OUT);
  await generatePdfs();
  await generateImages();
  await generateDocx();
  await writeFile(
    join(OUT, "INDEX.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), fixtures: index }, null, 2),
  );
  await writeFile(join(OUT, "README.md"), buildSamplesReadme());
  console.log(`Done. ${index.length} fixtures written.`);
}

function buildSamplesReadme(): string {
  const groups: Record<string, FixtureLabel[]> = {};
  for (const f of index) {
    (groups[f.tier] ??= []).push(f);
  }
  let md = `# Sample fixtures\n\nGenerated by \`npm run fixtures\`. Re-run to refresh.\n\nEach fixture is labelled with expected regions so a regression harness can score the extractor.\n\n`;
  for (const tier of ["easy", "medium", "hard", "image", "docx"]) {
    const items = groups[tier];
    if (!items?.length) continue;
    md += `## ${tier} (${items.length})\n\n`;
    md += `| File | Letterhead | Footer | Signature | Notes |\n|---|---|---|---|---|\n`;
    for (const f of items) {
      md += `| \`${f.file}\` | ${tick(f.expectations.letterhead)} | ${tick(
        f.expectations.footer,
      )} | ${tick(f.expectations.signature)} | ${f.description} |\n`;
    }
    md += "\n";
  }
  return md;
}

function tick(b: boolean): string {
  return b ? "✓" : "—";
}

void main();
