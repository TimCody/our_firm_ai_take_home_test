import type { PageRender, RegionResult, TextItem } from "../types.js";
import { bufferToDataUrl, cropPng } from "./crop.js";
import {
  findTopCluster,
  isHorizontallyCentered,
} from "../lib/text-layout.js";

/**
 * Letterhead extractor. First page, top region.
 *
 * Two steps:
 *   1. Geometry. Find the topmost text cluster (see `lib/text-layout`).
 *   2. Scoring. Assess how letterhead-ish that cluster looks.
 *
 * If there's no top-text cluster (image-only PDF, poster), we fall
 * back to "top 18% of the page" so we still surface something visual.
 * The confidence drops to 0.35, which sits below all our thresholds,
 * so it'll flag in the UI.
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

  if (cluster === null) {
    cropBottom = Math.floor(height * FALLBACK_CROP_RATIO);
    confidence = 0.35;
    rationale =
      "No text detected in the top quartile. Falling back to top 18% of the page.";
  } else {
    const paddedBottom = Math.ceil(cluster.bottomY + height * PADDING_RATIO);
    const maxBottom = Math.floor(height * MAX_LETTERHEAD_RATIO);
    cropBottom = Math.min(paddedBottom, maxBottom);

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

// Each of these patterns adds a small confidence bump. They're tuned
// for the kinds of tokens that show up in real letterheads.
const HAS_URL = /\b(www\.|http|@|\.com|\.org|\.net)\b/;
// Matches (415) 555-0123, 415-555-0123, 415.555.0123, 415 555 0123.
// Requires a separator so we don't false-positive on 10-digit account numbers.
const HAS_PHONE = /\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/;
const HAS_COMPANY_SUFFIX = /\b(inc|llc|ltd|corp|company|firm|group)\b/i;
const HAS_ADDRESS_KEYWORD = /\b(street|st\.|ave|avenue|blvd|suite|ste)\b/i;

/**
 * Score how letterhead-ish a text cluster looks.
 *
 * Pure function. Testable. Base score is 0.5; we bump it for each
 * letterhead-tell signal. Capped at 0.95 so there's always a little
 * headroom for the AI to push it higher.
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

  // Centered alignment is a strong letterhead signal.
  if (isHorizontallyCentered(cluster, pageWidth)) score += 0.1;

  // Larger-than-body fonts usually mean a branded title or logo.
  let avgHeight = 0;
  for (const t of cluster) avgHeight += t.height;
  avgHeight = avgHeight / cluster.length;
  if (avgHeight > 18) score += 0.05;

  return Math.min(0.95, score);
}
