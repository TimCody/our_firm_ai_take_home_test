import mammoth from "mammoth";
import sharp from "sharp";
import { createCanvas } from "@napi-rs/canvas";
import type { ExtractionResult, RegionResult } from "../types.js";
import { bufferToDataUrl } from "./crop.js";

/**
 * DOCX handling.
 *
 * This is a pragmatic compromise. We don't have a perfect Word renderer
 * in pure JS, and shipping LibreOffice as a system dependency would
 * break our "single command to start" promise. So:
 *
 *   1. mammoth converts the .docx to plain text.
 *   2. We render that text onto a synthetic US Letter canvas.
 *   3. The same top/bottom slice strategy runs on that canvas.
 *
 * Trade-off documented in the README. Embedded image signatures inside
 * a DOCX are NOT extracted in this MVP. That requires walking the
 * Open XML for `w:drawing` elements, which is bonus territory.
 */
export async function extractFromDocx(
  buffer: Buffer,
  fileName: string,
): Promise<ExtractionResult> {
  const { value: text } = await mammoth.extractRawText({ buffer });
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);

  // US Letter at 96 dpi.
  const pageWidth = 816;
  const pageHeight = 1056;
  const padding = 64;
  const lineHeight = 20;

  const canvas = createCanvas(pageWidth, pageHeight);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, pageWidth, pageHeight);
  ctx.fillStyle = "#111111";
  ctx.font = "14px Helvetica, Arial, sans-serif";

  // Only render as many lines as actually fit. Anything past the
  // visible area is dropped.
  const maxVisibleLines = Math.floor((pageHeight - 2 * padding) / lineHeight);
  const visibleLines = lines.slice(0, maxVisibleLines);

  for (let i = 0; i < visibleLines.length; i++) {
    const raw = visibleLines[i]!;
    const truncated = raw.length > 90 ? raw.slice(0, 90) + "…" : raw;
    ctx.fillText(truncated, padding, padding + (i + 1) * lineHeight);
  }

  const pageBuffer = Buffer.from(await canvas.encode("png"));

  // Slice the same regions from the synthetic page.
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
      "DOCX signatures are usually embedded images. Extracting them requires Open XML traversal, which is out of scope for the MVP. See README.",
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
    kind: "letterhead", // gets overwritten by the caller
    detected: true,
    imageDataUrl: bufferToDataUrl(cropped),
    confidence: 0.5,
    page: 1,
    rationale: `Synthesized from DOCX text. Sample: "${rationaleSample.slice(0, 80)}".`,
    width: box.width,
    height: box.height,
  };
}
