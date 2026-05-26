import sharp from "sharp";
import type {
  BoundingBox,
  PageRender,
  RegionResult,
  TextItem,
} from "../types.js";
import { bufferToDataUrl, cropPng } from "./crop.js";
import { groupIntoLines, lineText } from "../lib/text-layout.js";
import {
  computeRowDarkness,
  findDensestDarkRun,
} from "../lib/ink-density.js";

/**
 * Signature extractor. Operates on the last page.
 *
 * The signature is the trickiest of the three regions. We run three
 * independent search strategies in parallel and pick the highest-
 * confidence candidate. Each strategy is small and named so the
 * rationale we send to the UI matches the code path that produced it.
 *
 * Strategy comparison:
 *   A. Sign-off token (e.g. "Sincerely,") - strongest signal, 0.78
 *   B. Italic / script font - decent signal, 0.6
 *   C. Ink-density scan (handwriting on raster) - last resort, 0.55
 *
 * If none of the three finds anything, we return "not detected" and
 * the AI improvement step is the user's next move.
 */

export const SIGN_OFF_TOKENS = [
  "sincerely",
  "regards",
  "best regards",
  "best,",
  "yours truly",
  "yours faithfully",
  "respectfully",
  "warmly",
  "thank you",
  "thanks,",
  "cordially",
  "signed,",
  "/s/",
  "signature:",
];

export const SIGNATURE_AI_FALLBACK_THRESHOLD = 0.65;

export async function extractSignature(
  lastPage: PageRender,
): Promise<RegionResult> {
  const candidates = await collectCandidates(lastPage);
  if (candidates.length === 0) {
    return notDetected(
      "No sign-off token, italic font, or ink cluster found in the bottom 40% of the last page.",
    );
  }

  const best = pickBest(candidates);
  return materializeCandidate(lastPage, best);
}

interface Candidate {
  box: BoundingBox;
  confidence: number;
  rationale: string;
}

async function collectCandidates(page: PageRender): Promise<Candidate[]> {
  const results: Candidate[] = [];

  const token = findBySignOffToken(page);
  if (token) results.push(token);

  const italic = findByItalicFont(page);
  if (italic) results.push(italic);

  const ink = await findByInkDensity(page);
  if (ink) results.push(ink);

  return results;
}

function pickBest(candidates: Candidate[]): Candidate {
  let best = candidates[0]!;
  for (let i = 1; i < candidates.length; i++) {
    const c = candidates[i]!;
    if (c.confidence > best.confidence) best = c;
  }
  return best;
}

async function materializeCandidate(
  page: PageRender,
  best: Candidate,
): Promise<RegionResult> {
  try {
    const { buffer, width, height } = await cropPng(
      page.pngBuffer,
      best.box,
      page.width,
      page.height,
    );
    return {
      kind: "signature",
      detected: true,
      imageDataUrl: bufferToDataUrl(buffer),
      confidence: best.confidence,
      page: page.pageIndex + 1,
      rationale: best.rationale,
      width,
      height,
    };
  } catch (err) {
    return notDetected(
      `Signature crop failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

/**
 * Strategy A: look for sign-off tokens.
 *
 * We search the WHOLE page (not just the bottom half) and pick the
 * LAST occurrence. Sign-offs are by convention near the end of a
 * letter, so the latest match is almost always the right one.
 *
 * Body-text false positives are avoided by a line-length filter: a
 * real sign-off line is short ("Sincerely," is 10 chars,
 * "Best regards," is 13). Body sentences that happen to contain a
 * word like "sincerely" run far longer.
 */
const MAX_SIGN_OFF_LINE_LENGTH = 30;

export function findBySignOffToken(page: PageRender): Candidate | null {
  const { textItems, width, height } = page;
  const lines = groupIntoLines(textItems);

  // Walk all lines and remember the latest one that looks like a sign-off.
  type Match = { line: ReturnType<typeof groupIntoLines>[number]; token: string };
  let lastMatch: Match | null = null;

  for (const line of lines) {
    const text = lineText(line);
    if (text.length > MAX_SIGN_OFF_LINE_LENGTH) continue;

    const lower = text.toLowerCase();
    const token = SIGN_OFF_TOKENS.find((t) => lower.includes(t));
    if (token) {
      lastMatch = { line, token };
    }
  }

  if (lastMatch === null) return null;

  const { line, token } = lastMatch;
  const top = Math.max(0, line.y - 4);
  const bottom = Math.min(height, line.y + line.height + 180);

  return {
    box: { x: 0, y: top, width, height: bottom - top },
    confidence: 0.78,
    rationale: `Found sign-off token "${token}" on a line ${Math.round(
      (line.y / height) * 100,
    )}% down the page.`,
  };
}

/**
 * Strategy B: look for italic or script fonts in the bottom half.
 *
 * Italic in the upper half is usually a heading, not a signature, so
 * we restrict this search. PDFs with a font like "Helvetica-Oblique"
 * or "BradleyHandITCTT" for the typed name will trigger this.
 */
export function findByItalicFont(page: PageRender): Candidate | null {
  const { textItems, width, height } = page;
  const italicItems = textItems.filter(
    (t) => t.italic && t.y >= height * 0.55,
  );
  if (italicItems.length === 0) return null;

  const lines = groupIntoLines(italicItems);
  if (lines.length === 0) return null;

  const firstLine = lines[0]!;
  const lastLine = lines[lines.length - 1]!;

  const top = Math.max(0, firstLine.y - 6);
  const bottom = Math.min(height, lastLine.y + lastLine.height + 20);

  return {
    box: { x: 0, y: top, width, height: bottom - top },
    confidence: 0.6,
    rationale: `Italic/script font detected (${italicItems.length} glyph runs) in the bottom half of the page.`,
  };
}

/**
 * Strategy C: ink-density scan of the rasterized bottom 40%.
 *
 * Catches handwritten-image signatures that have no text-layer
 * representation. We extract the bottom band, convert to grayscale,
 * and look for a dense horizontal band that doesn't match a normal
 * text row pattern.
 *
 * This is the only strategy that works on scanned/image-only PDFs,
 * and it's also a useful backup when sign-off tokens aren't present
 * (e.g. someone signed without typing "Sincerely,").
 */
async function findByInkDensity(page: PageRender): Promise<Candidate | null> {
  const { pngBuffer, width, height } = page;

  const scanTop = Math.floor(height * 0.6);
  const scanHeight = height - scanTop;

  const { data, info } = await sharp(pngBuffer)
    .extract({ left: 0, top: scanTop, width, height: scanHeight })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const grayData = new Uint8Array(data);
  const rowDarkness = computeRowDarkness(grayData, info.width, info.height);
  const run = findDensestDarkRun(rowDarkness);
  if (run === null) return null;

  const padding = 8;
  const boxTop = scanTop + Math.max(0, run.start - padding);
  const boxBottom = scanTop + Math.min(scanHeight, run.end + padding);

  return {
    box: { x: 0, y: boxTop, width, height: boxBottom - boxTop },
    confidence: 0.55,
    rationale: `Ink-density scan found a dense band ${
      run.end - run.start
    }px tall in the bottom 40%. Likely a handwritten signature.`,
  };
}

function notDetected(rationale: string): RegionResult {
  return {
    kind: "signature",
    detected: false,
    imageDataUrl: null,
    confidence: 0.0,
    page: null,
    rationale,
    width: null,
    height: null,
  };
}

// Re-export TextItem so importers don't need a separate types import path.
export type { TextItem };
