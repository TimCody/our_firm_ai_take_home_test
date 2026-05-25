import type { PageRender, RegionResult, TextItem } from "../types.js";
import { bufferToDataUrl, cropPng } from "./crop.js";
import {
  findTopCluster,
  isHorizontallyCentered,
} from "../lib/text-layout.js";

/**
 * Letterhead extractor — first page, top region.
 *
 * Composed of two steps:
 *   1. Geometry: find the topmost text cluster (see `lib/text-layout`).
 *   2. Scoring: assess how letterhead-ish the cluster looks.
 *
 * If no top-text cluster exists we fall back to "top 18% of the page" so
 * image-only PDFs still surface *something*.
 */

const FALLBACK_CROP_RATIO = 0.18;
const MAX_LETTERHEAD_RATIO = 0.25;
const PADDING_RATIO = 0.02;

export async function extractLetterhead(
  firstPage: PageRender,
): Promise<RegionResult> {
  const { width, height, pngBuffer, pageIndex } = firstPage;
  const cluster = findTopCluster(firstPage.textItems, height);

  let cropBottom: number;
  let confidence: number;
  let rationale: string;

  if (!cluster) {
    cropBottom = Math.floor(height * FALLBACK_CROP_RATIO);
    confidence = 0.35;
    rationale =
      "No text detected in the top quartile — falling back to top 18% of the page.";
  } else {
    cropBottom = Math.min(
      Math.ceil(cluster.bottomY + height * PADDING_RATIO),
      Math.floor(height * MAX_LETTERHEAD_RATIO),
    );
    confidence = scoreLetterhead(cluster.items, width);
    rationale = `Top text cluster spans ${cluster.items.length} item(s); cropped to y=${Math.round(
      cropBottom,
    )} (page height ${height}).`;
  }

  try {
    const { buffer, width: cw, height: ch } = await cropPng(
      pngBuffer,
      { x: 0, y: 0, width, height: cropBottom },
      width,
      height,
    );
    return {
      kind: "letterhead",
      detected: true,
      imageDataUrl: bufferToDataUrl(buffer),
      confidence,
      page: pageIndex + 1,
      rationale,
      width: cw,
      height: ch,
    };
  } catch (err) {
    return {
      kind: "letterhead",
      detected: false,
      imageDataUrl: null,
      confidence: 0,
      page: null,
      rationale: `Letterhead crop failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
      width: null,
      height: null,
    };
  }
}

const HAS_URL = /\b(www\.|http|@|\.com|\.org|\.net)\b/;
const HAS_PHONE = /\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/;
const HAS_COMPANY_SUFFIX = /\b(inc|llc|ltd|corp|company|firm|group)\b/i;
const HAS_ADDRESS_KEYWORD = /\b(street|st\.|ave|avenue|blvd|suite|ste)\b/i;

/**
 * Score how letterhead-ish a text cluster looks. Pure function — testable.
 *
 * Base score 0.5; bumps for letterhead-tell signals (contact info, large
 * font, centering). Capped at 0.95.
 */
export function scoreLetterhead(
  cluster: TextItem[],
  pageWidth: number,
): number {
  if (cluster.length === 0) return 0.3;
  let score = 0.5;
  const text = cluster.map((t) => t.str).join(" ");

  if (HAS_URL.test(text)) score += 0.1;
  if (HAS_PHONE.test(text)) score += 0.05;
  if (HAS_COMPANY_SUFFIX.test(text)) score += 0.05;
  if (HAS_ADDRESS_KEYWORD.test(text)) score += 0.05;

  if (isHorizontallyCentered(cluster, pageWidth)) score += 0.1;

  const avgHeight =
    cluster.reduce((sum, t) => sum + t.height, 0) / cluster.length;
  if (avgHeight > 18) score += 0.05;

  return Math.min(0.95, score);
}
