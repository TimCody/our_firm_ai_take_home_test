import type { PageRender, RegionResult, TextItem } from "../types.js";
import { bufferToDataUrl, cropPng } from "./crop.js";

/**
 * Footer extractor. Bottom-band detection on a single page.
 *
 * Strategy:
 *   1. Look at the bottom 18% of the page.
 *   2. The footer's top edge is the topmost text item in that band.
 *   3. If the band has no text, return "not detected". Don't crop empty
 *      space; surfacing a blank rectangle is worse than honestly saying
 *      there's no footer.
 */

const FOOTER_BAND_RATIO = 0.82;
const PADDING_RATIO = 0.01;

export async function extractFooter(
  page: PageRender,
  options?: { allPages?: PageRender[] },
): Promise<RegionResult> {
  const { width, height, pngBuffer, pageIndex } = page;
  const footerItems = collectFooterItems(page);

  if (footerItems.length === 0) {
    return {
      kind: "footer",
      detected: false,
      imageDataUrl: null,
      confidence: 0.85, // confident absence
      page: null,
      rationale:
        "No text detected in the bottom 18% of the page. Likely no footer.",
      width: null,
      height: null,
    };
  }

  const cropTop = computeFooterTop(footerItems, height);
  const cropHeight = height - cropTop;
  const confidence = scoreFooter(footerItems, options?.allPages, pageIndex);

  const hasMultiplePages =
    options?.allPages !== undefined && options.allPages.length > 1;
  const rationale = hasMultiplePages
    ? `Found ${footerItems.length} text item(s) in the bottom 18%. Compared against other pages for repetition signal.`
    : `Found ${footerItems.length} text item(s) in the bottom 18%.`;

  try {
    const { buffer, width: cw, height: ch } = await cropPng(
      pngBuffer,
      { x: 0, y: cropTop, width, height: cropHeight },
      width,
      height,
    );
    return {
      kind: "footer",
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
      kind: "footer",
      detected: false,
      imageDataUrl: null,
      confidence: 0,
      page: null,
      rationale: `Footer crop failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
      width: null,
      height: null,
    };
  }
}

function collectFooterItems(page: PageRender): TextItem[] {
  const bandTop = page.height * FOOTER_BAND_RATIO;
  return page.textItems.filter((t) => t.y >= bandTop);
}

function computeFooterTop(footerItems: TextItem[], pageHeight: number): number {
  let topY = Infinity;
  for (const t of footerItems) {
    if (t.y < topY) topY = t.y;
  }
  return Math.max(0, Math.floor(topY - pageHeight * PADDING_RATIO));
}

const HAS_COPYRIGHT = /©|\bcopyright\b|\(c\)/i;
const HAS_PAGE_NUMBER = /\bpage\s*\d+(\s*of\s*\d+)?\b/i;
const HAS_PAGE_RATIO = /\b\d+\s*\/\s*\d+\b/;

/**
 * Score the confidence of a footer detection.
 *
 * Pure function. Testable. Bumps:
 *   - copyright marks (very strong signal)
 *   - "Page X of Y" patterns
 *   - "X/Y" ratios
 *   - text that REPEATS across pages (the strongest signal; real
 *     footers are usually the same on every page)
 */
export function scoreFooter(
  items: TextItem[],
  allPages: PageRender[] | undefined,
  thisPageIndex: number,
): number {
  let score = 0.5;
  const text = items.map((i) => i.str).join(" ");

  if (HAS_COPYRIGHT.test(text)) score += 0.15;
  if (HAS_PAGE_NUMBER.test(text)) score += 0.1;
  if (HAS_PAGE_RATIO.test(text)) score += 0.05;

  if (allPages && allPages.length > 1) {
    if (textRepeatsOnAnotherPage(text, allPages, thisPageIndex)) {
      score += 0.2;
    }
  }

  return Math.min(0.97, score);
}

/**
 * Look for the same footer-shaped text on any OTHER page in the doc.
 * If it shows up twice, we're very confident it's a real footer and
 * not body text that happens to live near the bottom of one page.
 *
 * We normalize before comparing: lowercased, digits collapsed to "#"
 * (so "Page 1 of 3" matches "Page 2 of 3"), whitespace squashed.
 */
export function textRepeatsOnAnotherPage(
  text: string,
  allPages: PageRender[],
  thisPageIndex: number,
): boolean {
  const target = normalizeForRepetition(text).slice(0, 20);
  if (!target) return false;

  for (const p of allPages) {
    if (p.pageIndex === thisPageIndex) continue;

    const otherFooterText = p.textItems
      .filter((t) => t.y >= p.height * FOOTER_BAND_RATIO)
      .map((t) => t.str)
      .join(" ");

    if (normalizeForRepetition(otherFooterText).includes(target)) {
      return true;
    }
  }
  return false;
}

function normalizeForRepetition(s: string): string {
  return s
    .toLowerCase()
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ")
    .trim();
}
