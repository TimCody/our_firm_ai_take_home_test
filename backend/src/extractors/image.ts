import sharp from "sharp";
import type { ExtractionResult, RegionResult } from "../types.js";
import { bufferToDataUrl } from "./crop.js";

/**
 * Image input handling (PNG, JPEG).
 *
 * We treat the uploaded image as a single "page" and slice it the same
 * way we'd slice a PDF page:
 *   - letterhead = top 18%
 *   - footer     = bottom 15%
 *   - signature  = not attempted
 *
 * Signature is skipped on raw images because there's no text layer to
 * anchor on, and ink-density alone is too unreliable on real photos
 * (compression artifacts, JPEG noise, color cast). Documented in the
 * README as a deliberate MVP cut.
 */
export async function extractFromImage(
  buffer: Buffer,
  fileName: string,
  mimeType: string,
): Promise<ExtractionResult> {
  // .rotate() applies EXIF orientation so portrait photos taken on a
  // phone don't come in sideways.
  const normalized = await sharp(buffer).rotate().png().toBuffer();

  const meta = await sharp(normalized).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;

  if (!width || !height) {
    throw new Error("Could not determine image dimensions.");
  }

  const letterheadHeight = Math.floor(height * 0.18);
  const footerHeight = Math.floor(height * 0.15);
  const footerTop = height - footerHeight;

  const [letterheadPng, footerPng] = await Promise.all([
    sharp(normalized)
      .extract({ left: 0, top: 0, width, height: letterheadHeight })
      .png()
      .toBuffer(),
    sharp(normalized)
      .extract({ left: 0, top: footerTop, width, height: footerHeight })
      .png()
      .toBuffer(),
  ]);

  const letterhead: RegionResult = {
    kind: "letterhead",
    detected: true,
    imageDataUrl: bufferToDataUrl(letterheadPng),
    confidence: 0.5,
    page: 1,
    rationale: "Image input: cropped top 18% as letterhead.",
    width,
    height: letterheadHeight,
  };

  const footer: RegionResult = {
    kind: "footer",
    detected: true,
    imageDataUrl: bufferToDataUrl(footerPng),
    confidence: 0.5,
    page: 1,
    rationale: "Image input: cropped bottom 15% as footer.",
    width,
    height: footerHeight,
  };

  const signature: RegionResult = {
    kind: "signature",
    detected: false,
    imageDataUrl: null,
    confidence: 0,
    page: null,
    rationale:
      "Signature extraction from raw images is not attempted in MVP. No text layer to anchor the search.",
    width: null,
    height: null,
  };

  return {
    documentId: crypto.randomUUID(),
    fileName,
    mimeType,
    pageCount: 1,
    pagePreviews: [bufferToDataUrl(normalized)],
    regions: { letterhead, footer, signature },
    usedAiFallback: false,
    aiCostEstimate: null,
    aiAvailable: Boolean(process.env.ANTHROPIC_API_KEY),
    warnings: [],
  };
}
