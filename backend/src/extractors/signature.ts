import sharp from "sharp";
import type { BoundingBox, PageRender, RegionResult, TextItem } from "../types.js";
import { bufferToDataUrl, cropPng } from "./crop.js";
import { groupIntoLines, lineText } from "../lib/text-layout.js";
import {
  computeRowDarkness,
  findDensestDarkRun,
} from "../lib/ink-density.js";

/**
 * Signature extractor — operates on the last page.
 *
 * Runs three independent search strategies and picks the highest-confidence
 * candidate. Each strategy is small and named so the rationale we return
 * to the UI matches the code path that produced it.
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
  return await materializeCandidate(lastPage, best);
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
  return candidates.reduce((a, b) => (a.confidence >= b.confidence ? a : b));
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
 * Strategy A: look for sign-off tokens ("Sincerely,", "Regards,", etc.) in
 * the bottom half. When found, crop from that line down by ~180px.
 */
export function findBySignOffToken(page: PageRender): Candidate | null {
  const { textItems, width, height } = page;
  const bottomHalfStart = height * 0.5;
  const lines = groupIntoLines(
    textItems.filter((t) => t.y >= bottomHalfStart),
  );

  for (const line of lines) {
    const text = lineText(line).toLowerCase();
    const token = SIGN_OFF_TOKENS.find((t) => text.includes(t));
    if (!token) continue;

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
  return null;
}

/**
 * Strategy B: look for italic / script fonts in the bottom half. PDFs that
 * use a font like "Helvetica-Oblique" or "BradleyHandITCTT" for the typed
 * name are common.
 */
export function findByItalicFont(page: PageRender): Candidate | null {
  const { textItems, width, height } = page;
  const italicItems = textItems.filter(
    (t) => t.italic && t.y >= height * 0.55,
  );
  if (italicItems.length === 0) return null;

  const lines = groupIntoLines(italicItems);
  if (lines.length === 0) return null;

  const top = Math.max(0, lines[0]!.y - 6);
  const last = lines[lines.length - 1]!;
  const bottom = Math.min(height, last.y + last.height + 20);

  return {
    box: { x: 0, y: top, width, height: bottom - top },
    confidence: 0.6,
    rationale: `Italic/script font detected (${italicItems.length} glyph runs) in the bottom half of the page.`,
  };
}

/**
 * Strategy C: scan the rasterized bottom 40% for a horizontal band of
 * elevated ink density. Catches handwritten-image signatures that have
 * no text-layer representation.
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
  if (!run) return null;

  const padding = 8;
  const boxTop = scanTop + Math.max(0, run.start - padding);
  const boxBottom = scanTop + Math.min(scanHeight, run.end + padding);

  return {
    box: { x: 0, y: boxTop, width, height: boxBottom - boxTop },
    confidence: 0.55,
    rationale: `Ink-density scan found a dense band ${
      run.end - run.start
    }px tall in the bottom 40% — likely a handwritten signature.`,
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
