import mammoth from "mammoth";
import sharp from "sharp";
import { createCanvas } from "@napi-rs/canvas";
import type { ExtractionResult, RegionResult } from "../types.js";
import { bufferToDataUrl } from "./crop.js";

/**
 * DOCX handling — pragmatic compromise.
 *
 * We don't have a perfect Word renderer in pure JS. Rather than ship
 * LibreOffice as a system dep, we:
 *   1. Use mammoth to convert .docx → HTML + plain text
 *   2. Render the text content into a synthetic "page image" at letter size
 *   3. Apply the same top/bottom region strategy to that synthetic page
 *
 * The README documents this trade-off explicitly. Embedded signature images
 * inside docx are NOT extracted in this MVP — that needs proper Open XML
 * traversal which is bonus territory.
 */
export async function extractFromDocx(
  buffer: Buffer,
  fileName: string,
): Promise<ExtractionResult> {
  const { value: text } = await mammoth.extractRawText({ buffer });
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);

  // Synthesize a "page" by drawing the text on a US Letter canvas at 96dpi.
  const pageWidth = 816; // 8.5" × 96
  const pageHeight = 1056; // 11" × 96
  const padding = 64;
  const lineHeight = 20;

  const canvas = createCanvas(pageWidth, pageHeight);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, pageWidth, pageHeight);
  ctx.fillStyle = "#111111";
  ctx.font = "14px Helvetica, Arial, sans-serif";

  const visibleLines = lines.slice(0, Math.floor((pageHeight - 2 * padding) / lineHeight));
  visibleLines.forEach((line, i) => {
    const truncated = line.length > 90 ? line.slice(0, 90) + "…" : line;
    ctx.fillText(truncated, padding, padding + (i + 1) * lineHeight);
  });

  const pageBuffer = Buffer.from(await canvas.encode("png"));

  // Crop regions out of the synthetic page.
  const letterhead = await synthCrop(
    pageBuffer,
    { x: 0, y: 0, width: pageWidth, height: Math.floor(pageHeight * 0.18) },
    visibleLines.slice(0, 4).join(" | "),
  );
  const footer = await synthCrop(
    pageBuffer,
    {
      x: 0,
      y: Math.floor(pageHeight * 0.85),
      width: pageWidth,
      height: Math.floor(pageHeight * 0.15),
    },
    visibleLines.slice(-2).join(" | "),
  );
  const signature: RegionResult = {
    kind: "signature",
    detected: false,
    imageDataUrl: null,
    confidence: 0,
    page: null,
    rationale:
      "DOCX signatures are usually embedded images — extracting them requires Open XML traversal, which is out of scope for the MVP. See README.",
    width: null,
    height: null,
  };

  return {
    documentId: crypto.randomUUID(),
    fileName,
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    pageCount: 1,
    pagePreviews: [bufferToDataUrl(pageBuffer)],
    regions: {
      letterhead: { ...letterhead, kind: "letterhead" },
      footer: { ...footer, kind: "footer" },
      signature,
    },
    usedAiFallback: false,
    aiCostEstimate: null,
    aiAvailable: Boolean(process.env.ANTHROPIC_API_KEY),
    warnings: [
      "DOCX support is text-only in this MVP. Embedded images and exact Word layout are not preserved.",
    ],
  };
}

async function synthCrop(
  pageBuffer: Buffer,
  box: { x: number; y: number; width: number; height: number },
  rationaleSample: string,
): Promise<RegionResult> {
  const cropped = await sharp(pageBuffer)
    .extract({
      left: box.x,
      top: box.y,
      width: box.width,
      height: box.height,
    })
    .png()
    .toBuffer();

  return {
    kind: "letterhead", // overwritten by caller
    detected: true,
    imageDataUrl: bufferToDataUrl(cropped),
    confidence: 0.5,
    page: 1,
    rationale: `Synthesized from DOCX text. Sample: "${rationaleSample.slice(
      0,
      80,
    )}".`,
    width: box.width,
    height: box.height,
  };
}
