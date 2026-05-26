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
 * AI fallback policy. The default changed from "auto" to "off" — we now
 * never call the AI implicitly. The frontend's "Improve with LLM" button
 * sets `on` explicitly after showing the cost preview.
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

  const firstPage = await pdf.renderPage(0, 2);
  const lastPage =
    pageCount === 1 ? firstPage : await pdf.renderPage(pageCount - 1, 2);

  const middleSample = await renderMiddleSample(pdf, pageCount);

  let letterhead = await extractLetterhead(firstPage);
  let footer = await extractFooter(lastPage, {
    allPages: middleSample
      ? [firstPage, middleSample, lastPage]
      : [firstPage, lastPage],
  });
  let signature: RegionResult = await extractSignature(lastPage);

  let usedAiFallback = false;
  if (shouldRunAi(aiMode, signature.confidence)) {
    const aiResults = await aiLocateRegions(lastPage);
    if (aiResults) {
      // AI ran — flip the flag so the UI shows the "AI" badge and the
      // user gets visible feedback that their click did something.
      usedAiFallback = true;

      if (aiResults.signature) {
        signature = reconcile(signature, aiResults.signature);
      }
      if (aiResults.footer) {
        footer = reconcile(footer, aiResults.footer);
      }
      // Letterhead lives on the FIRST page. AI only saw the last page, so
      // its letterhead verdict is only valid for single-page docs (where
      // firstPage === lastPage).
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
  return deterministicConfidence < SIGNATURE_AI_FALLBACK_THRESHOLD;
}

/**
 * Reconcile a deterministic verdict with an AI verdict for the same region.
 *
 * Three cases:
 *   1. AI found something we missed (or with higher confidence) → use AI.
 *   2. AI confidently confirms ABSENCE that we also said wasn't there →
 *      use AI's higher-confidence verdict + rationale.
 *   3. Anything else → keep deterministic but annotate the rationale so
 *      the user sees the click actually did something.
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
  if (!deterministic.detected && ai.detected) return true;
  if (ai.detected && ai.confidence > deterministic.confidence) return true;
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
    return null;
  }
}

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
    if (i === 0) rendered = ctx.firstPage;
    else if (i === ctx.pageCount - 1 && ctx.pageCount > 1) rendered = ctx.lastPage;
    else rendered = await pdf.renderPage(i, 0.6);
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
  // longer than the old signature-only prompt and outputs a larger JSON,
  // so we bump both budgets. Still pennies — Haiku 4.5 keeps it cheap.
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
