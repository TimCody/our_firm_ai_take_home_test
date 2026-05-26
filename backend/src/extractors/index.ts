import { randomUUID } from "node:crypto";
import { loadPdf } from "./pdf.js";
import { extractLetterhead } from "./letterhead.js";
import { extractFooter } from "./footer.js";
import {
  extractSignature,
  SIGNATURE_AI_FALLBACK_THRESHOLD,
} from "./signature.js";
import { aiLocateRegions } from "./ai-fallback.js";
import { extractFromDocx } from "./docx.js";
import { extractFromImage } from "./image.js";
import { bufferToDataUrl } from "./crop.js";
import { sniffMime } from "../lib/mime-sniff.js";
import { estimateVisionCost } from "../lib/cost-estimator.js";
import type {
  AiCostEstimate,
  ExtractionResult,
  PageRender,
  RegionResult,
} from "../types.js";

/**
 * AI policy modes.
 *
 *   off  - never call the AI. Deterministic only. This is the default.
 *   on   - always call the AI. Used when the user clicks
 *          "Improve with LLM" in the UI.
 *   auto - call the AI when the deterministic signature confidence
 *          falls below SIGNATURE_AI_FALLBACK_THRESHOLD. Useful for
 *          batch workflows that don't have a human in the loop.
 */
export type AiMode = "off" | "auto" | "on";

export interface ExtractOptions {
  ai?: AiMode;
}

export async function extractDocument(
  buffer: Buffer,
  fileName: string,
  mimeType: string,
  options: ExtractOptions = {},
): Promise<ExtractionResult> {
  if (buffer.length === 0) {
    throw new Error("Uploaded file is empty.");
  }

  const kind = sniffMime(buffer, mimeType);

  if (kind === "pdf") return extractFromPdf(buffer, fileName, options);
  if (kind === "docx") return extractFromDocx(buffer, fileName);
  if (kind === "image") return extractFromImage(buffer, fileName, mimeType);

  throw new Error(
    `Unsupported file type: ${mimeType}. Supported: PDF, DOCX, PNG/JPEG.`,
  );
}

async function extractFromPdf(
  buffer: Buffer,
  fileName: string,
  options: ExtractOptions,
): Promise<ExtractionResult> {
  const aiMode = options.ai ?? "off";
  const pdf = await loadPdf(buffer);
  const pageCount = pdf.pageCount;
  const warnings: string[] = [];

  // Render the first and last page at full scale. These are the pages
  // we run extraction against.
  const firstPage = await pdf.renderPage(0, 2);
  const lastPage =
    pageCount === 1 ? firstPage : await pdf.renderPage(pageCount - 1, 2);

  // For the footer's cross-page repetition signal, peek at one middle
  // page (when there is one). Best-effort; failure is non-fatal.
  const middleSample = await renderMiddleSample(pdf, pageCount);

  let letterhead = await extractLetterhead(firstPage);
  let footer = await extractFooter(lastPage, {
    allPages: middleSample
      ? [firstPage, middleSample, lastPage]
      : [firstPage, lastPage],
  });
  let signature: RegionResult = await extractSignature(lastPage);

  // AI step (opt-in). Reconcile its verdicts against the deterministic
  // results so the user gets visible feedback that AI ran.
  let usedAiFallback = false;
  if (shouldRunAi(aiMode, signature.confidence)) {
    const aiResults = await aiLocateRegions(lastPage);
    if (aiResults) {
      // The fact that AI ran is itself useful information for the UI.
      // Flip the flag whenever we got a verdict back, not only when
      // we adopted it.
      usedAiFallback = true;

      if (aiResults.signature) {
        signature = reconcile(signature, aiResults.signature);
      }
      if (aiResults.footer) {
        footer = reconcile(footer, aiResults.footer);
      }
      // Letterhead lives on the FIRST page. AI only saw the last page,
      // so its letterhead verdict is only valid when first === last.
      if (pageCount === 1 && aiResults.letterhead) {
        letterhead = reconcile(letterhead, aiResults.letterhead);
      }
    }
  }

  const pagePreviews = await renderPreviews(pdf, {
    pageCount,
    firstPage,
    lastPage,
    warnings,
  });

  return {
    documentId: randomUUID(),
    fileName,
    mimeType: "application/pdf",
    pageCount,
    pagePreviews,
    regions: { letterhead, footer, signature },
    usedAiFallback,
    aiCostEstimate: buildCostEstimate(lastPage),
    aiAvailable: Boolean(process.env.ANTHROPIC_API_KEY),
    warnings,
  };
}

function shouldRunAi(mode: AiMode, deterministicConfidence: number): boolean {
  if (mode === "off") return false;
  if (mode === "on") return true;
  // mode === "auto": fire when deterministic isn't confident enough.
  return deterministicConfidence < SIGNATURE_AI_FALLBACK_THRESHOLD;
}

/**
 * Reconcile a deterministic verdict with an AI verdict for the same region.
 *
 * Three cases:
 *   1. AI found something we missed (or with higher confidence) -> use AI.
 *   2. AI confidently confirms ABSENCE that we also said wasn't there ->
 *      use AI's higher-confidence verdict + rationale so the user sees
 *      vision was consulted.
 *   3. Anything else -> keep deterministic but annotate the rationale
 *      so the user sees the click actually did something.
 */
function reconcile(deterministic: RegionResult, ai: RegionResult): RegionResult {
  if (shouldPreferAi(deterministic, ai)) return ai;
  return {
    ...deterministic,
    rationale: appendAiAgreement(deterministic, ai),
  };
}

function shouldPreferAi(
  deterministic: RegionResult,
  ai: RegionResult,
): boolean {
  // AI found something we missed.
  if (!deterministic.detected && ai.detected) return true;
  // AI located the same region with higher confidence.
  if (ai.detected && ai.confidence > deterministic.confidence) return true;
  // Both agree there's nothing there, but AI is more confident in
  // the absence verdict.
  if (
    !deterministic.detected &&
    !ai.detected &&
    ai.confidence > deterministic.confidence
  ) {
    return true;
  }
  return false;
}

function appendAiAgreement(
  deterministic: RegionResult,
  ai: RegionResult,
): string {
  const kind = deterministic.kind;
  const verdict = ai.detected
    ? `agreed a ${kind} is present (Claude conf ${(ai.confidence * 100).toFixed(0)}%)`
    : `also found no ${kind} (Claude conf ${(ai.confidence * 100).toFixed(0)}%)`;
  return `${deterministic.rationale} · Claude vision (Haiku) ${verdict}.`;
}

async function renderMiddleSample(
  pdf: Awaited<ReturnType<typeof loadPdf>>,
  pageCount: number,
): Promise<PageRender | null> {
  if (pageCount < 3) return null;
  try {
    return await pdf.renderPage(Math.floor(pageCount / 2), 1);
  } catch {
    // Non-fatal. Cross-page repetition is a bonus signal, not a hard
    // dependency.
    return null;
  }
}

/**
 * Build thumbnail previews for the gallery. We render at low scale to
 * keep the payload small, and cap at 8 pages so a 200-page PDF doesn't
 * balloon the response.
 */
async function renderPreviews(
  pdf: Awaited<ReturnType<typeof loadPdf>>,
  ctx: {
    pageCount: number;
    firstPage: PageRender;
    lastPage: PageRender;
    warnings: string[];
  },
): Promise<string[]> {
  const limit = Math.min(ctx.pageCount, 8);
  const previews: string[] = [];

  for (let i = 0; i < limit; i++) {
    let rendered: PageRender;
    if (i === 0) {
      rendered = ctx.firstPage;
    } else if (i === ctx.pageCount - 1 && ctx.pageCount > 1) {
      rendered = ctx.lastPage;
    } else {
      rendered = await pdf.renderPage(i, 0.6);
    }
    previews.push(bufferToDataUrl(rendered.pngBuffer));
  }

  if (ctx.pageCount > limit) {
    ctx.warnings.push(
      `Document has ${ctx.pageCount} pages; preview thumbnails truncated to ${limit}.`,
    );
  }
  return previews;
}

function buildCostEstimate(lastPage: PageRender): AiCostEstimate {
  // Three-region prompt (letterhead + footer + signature) is a touch
  // longer than the old signature-only prompt and outputs a larger
  // JSON. Still pennies. Haiku 4.5 keeps it cheap.
  const e = estimateVisionCost({
    imageWidth: lastPage.width,
    imageHeight: lastPage.height,
    promptTokens: 280,
    maxOutputTokens: 500,
    model: "haiku",
  });
  return {
    model: e.model,
    imageTokens: e.imageTokens,
    promptTokens: e.promptTokens,
    maxOutputTokens: e.maxOutputTokens,
    estimatedUsd: e.estimatedUsd,
    pretty: e.pretty,
  };
}
